// ==========================================
// FIREBASE REMOTE
// ==========================================
// Thin adapter between the page and Firestore (see docs/firebase-plan.md).
// Loaded as a classic <script> (exposes window.FirebaseRemote) and in Node
// tests via require(). Decisions and write plans come from
// TournamentLogic; this file only talks to Firebase.
//
// FirebaseRemote.create({ config, logic }) returns null when publishing isn't
// configured, otherwise an object with async methods:
//   startPublishing({ state, code })        -> { action: 'published', slot } | publishDecision result
//   replacePublished({ state, code, held }) -> { action: 'published', slot }
//   publish({ state })                      -> { ok: true } | { error: 'moved' }
//   takeOver({ id, code, releaseCurrent })  -> { action: 'taken', slot, exportText } | { action: 'ask-release', name } | { error }
//   published()                             -> publishedList entries
//   fetchTournament(id)                     -> { id, name, exportText, updatedAt } | null
//   subscribe(id, onChange, onError)        -> unsubscribe; onChange(tournament or null)

globalThis.FirebaseRemote = (() => {
  // Pinned compat build of the Firebase JS SDK, loaded only when configured.
  const SDK_VERSION = '12.19.0';
  const SDK_FILES = ['app', 'auth', 'firestore'];
  const CLAIM_RETRIES = 3;

  function loadScript(src, doc) {
    return new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      doc.head.appendChild(script);
    });
  }

  // Loads the SDK scripts in order (each compat file extends the first).
  async function loadSdk(doc = globalThis.document) {
    for (const file of SDK_FILES) {
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${file}-compat.js`, doc);
    }
    return globalThis.firebase;
  }

  const isDenied = err => err && err.code === 'permission-denied';

  // config: the project's web config, plus optional { appName, emulators:
  // { firestore: 'host:port', auth: 'http://host:port' } } for tests.
  // firebase: an already loaded SDK namespace (Node tests); otherwise the
  // browser SDK is loaded on first use.
  function create({ config, logic, firebase = null, doc = globalThis.document }) {
    if (!config) return null;
    let ready = null;

    function connect() {
      ready =
        ready ||
        (async () => {
          const sdk = firebase || (await loadSdk(doc));
          const { appName, emulators, ...webConfig } = config;
          const app = sdk.initializeApp(webConfig, appName);
          const auth = app.auth();
          const db = app.firestore();
          if (emulators) {
            const [host, port] = emulators.firestore.split(':');
            db.useEmulator(host, Number(port));
            auth.useEmulator(emulators.auth, { disableWarnings: true });
          }
          // Returns the browser's existing anonymous user when there is one.
          const { user } = await auth.signInAnonymously();
          return { sdk, db, uid: user.uid };
        })();
      return ready;
    }

    function toFirestore(sdk, data) {
      const out = {};
      for (const [key, value] of Object.entries(data)) {
        out[key] = value === logic.SERVER_TIME ? sdk.firestore.FieldValue.serverTimestamp() : value;
      }
      return out;
    }

    async function commit(writes) {
      const { sdk, db } = await connect();
      const batch = db.batch();
      for (const { op, path, data } of writes) {
        const ref = db.doc(path);
        if (op === 'delete') batch.delete(ref);
        else batch[op](ref, toFirestore(sdk, data));
      }
      await batch.commit();
    }

    // 'estimate' fills in a pending server timestamp, so updatedAt is never null.
    const summary = snap => {
      const data = snap.data({ serverTimestamps: 'estimate' });
      return {
        id: snap.id,
        name: data.name,
        startedAt: data.startedAt,
        updatedAt: data.updatedAt.toMillis(),
        ownerUid: data.ownerUid,
        slot: data.slot
      };
    };

    // Everything a decision needs, read fresh from the server.
    async function status() {
      const { db, uid } = await connect();
      const slotSnaps = await Promise.all(
        Array.from({ length: logic.PUBLISH_SLOTS }, (_, i) => db.doc(`slots/${i + 1}`).get())
      );
      const slots = slotSnaps.map(snap => (snap.exists ? snap.data() : null));
      const ownerSnap = await db.doc(`owners/${uid}`).get();
      const tournamentSnaps = await Promise.all(
        slots.filter(Boolean).map(slot => db.doc(`tournaments/${slot.tournamentId}`).get())
      );
      const tournaments = {};
      tournamentSnaps.filter(snap => snap.exists).forEach(snap => (tournaments[snap.id] = summary(snap)));
      return { uid, owner: ownerSnap.exists ? ownerSnap.data() : null, slots, tournaments };
    }

    async function startPublishing({ state, code }, attemptsLeft = CLAIM_RETRIES) {
      const { uid, owner, slots, tournaments } = await status();
      const decision = logic.publishDecision({ uid, owner, slots, tournaments, now: Date.now() });
      if (decision.action !== 'claim') return decision;
      const document = logic.publishedDocument({ state, uid, slot: decision.slot });
      try {
        await commit(logic.claimWrites({ uid, ...decision, document, id: state.tournamentId, code }));
        return { action: 'published', slot: decision.slot };
      } catch (err) {
        if (!isDenied(err) || attemptsLeft === 1) throw err;
      }
      // Another browser won the slot (or the server disagrees about its
      // expiry): look again.
      return startPublishing({ state, code }, attemptsLeft - 1);
    }

    // held: the ask-replace decision ({ slot, tournamentId }).
    async function replacePublished({ state, code, held }) {
      const { uid } = await connect();
      const document = logic.publishedDocument({ state, uid, slot: held.slot });
      await commit(
        logic.replaceWrites({ uid, slot: held.slot, oldId: held.tournamentId, document, id: state.tournamentId, code })
      );
      return { action: 'published', slot: held.slot };
    }

    async function publish({ state }) {
      try {
        await commit(logic.publishWrites({ state }));
        return { ok: true };
      } catch (err) {
        if (isDenied(err)) return { error: 'moved' };
        throw err;
      }
    }

    async function takeOver({ id, code, releaseCurrent = false }) {
      const { uid, owner, slots, tournaments } = await status();
      const target = tournaments[id];
      if (!target || slots[target.slot - 1].tournamentId !== id) {
        return { error: 'That tournament is no longer published.' };
      }
      if (target.ownerUid === uid) return { error: 'This browser already publishes that tournament.' };
      const held = logic.heldSlot(uid, owner, slots);
      if (held && !releaseCurrent) {
        const current = tournaments[held.tournamentId];
        return { action: 'ask-release', name: current ? current.name : '' };
      }
      try {
        await commit(logic.takeOverWrites({ uid, id, slot: target.slot, code, release: held }));
      } catch (err) {
        if (isDenied(err)) return { error: 'That publisher code is not right for this tournament.' };
        throw err;
      }
      const tournament = await fetchTournament(id);
      return { action: 'taken', slot: target.slot, exportText: tournament.exportText };
    }

    async function published() {
      const { slots, tournaments } = await status();
      return logic.publishedList(slots, tournaments, Date.now());
    }

    const fullTournament = snap => (snap.exists ? { ...summary(snap), exportText: snap.data().export } : null);

    async function fetchTournament(id) {
      const { db } = await connect();
      return fullTournament(await db.doc(`tournaments/${id}`).get());
    }

    function subscribe(id, onChange, onError) {
      let unsubscribe = null;
      let stopped = false;
      connect().then(({ db }) => {
        if (stopped) return;
        unsubscribe = db.doc(`tournaments/${id}`).onSnapshot(snap => onChange(fullTournament(snap)), onError);
      }, onError);
      return () => {
        stopped = true;
        if (unsubscribe) unsubscribe();
      };
    }

    return { startPublishing, replacePublished, publish, takeOver, published, fetchTournament, subscribe };
  }

  return { SDK_VERSION, create, loadSdk };
})();
