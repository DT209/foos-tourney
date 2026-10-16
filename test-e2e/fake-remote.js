// A stand-in for firebase-remote.js in UI tests. Installed before the page's
// scripts (evaluateOnNewDocument) as window.foosRemoteForTests, it has the
// same interface and uses the same TournamentLogic decisions, but keeps the
// "server" in localStorage (__fakeRemote.server), so every page in the test
// browser shares it. Every call is recorded in window.__remoteCalls.
//
// sessionStorage __fakeRemote.uid sets this tab's anonymous uid (default
// 'desk'); localStorage __fakeRemote.config can hold { unavailable: true }
// (every call fails, as if Firebase can't be reached).
function installFakeRemote() {
  const SERVER_KEY = '__fakeRemote.server';
  const calls = [];
  window.__remoteCalls = calls;
  const uid = sessionStorage.getItem('__fakeRemote.uid') || 'desk';
  const L = () => window.TournamentLogic;
  const config = () => JSON.parse(localStorage.getItem('__fakeRemote.config') || '{}');
  const empty = () => ({ slots: [null, null, null, null, null], tournaments: {}, owners: {}, codes: {} });
  const read = () => JSON.parse(localStorage.getItem(SERVER_KEY) || 'null') || empty();
  const listeners = new Map();

  const full = t =>
    t && { id: t.id, name: t.name, startedAt: t.startedAt, updatedAt: t.updatedAt, exportText: t.exportText };
  function notify() {
    const server = read();
    listeners.forEach((fns, id) => fns.forEach(fn => fn(full(server.tournaments[id] || null))));
  }
  function write(server) {
    localStorage.setItem(SERVER_KEY, JSON.stringify(server));
    notify();
  }
  // Lets a test announce a server change made from this page.
  window.__fakeRemoteNotify = notify;
  window.addEventListener('storage', e => {
    if (e.key === SERVER_KEY) notify();
  });

  async function call(method, details) {
    calls.push({ method, ...details });
    await new Promise(resolve => setTimeout(resolve, 10));
    if (config().unavailable) throw new Error('Firebase unavailable');
  }

  function remove(server, id) {
    delete server.tournaments[id];
    delete server.codes[id];
  }

  function put(server, state, slot, code) {
    const id = state.tournamentId;
    server.tournaments[id] = {
      id,
      slot,
      ownerUid: uid,
      name: state.tournamentName,
      startedAt: state.startedAt,
      updatedAt: Date.now(),
      exportText: L().publishedExport(state)
    };
    server.codes[id] = code;
    server.slots[slot - 1] = { tournamentId: id, ownerUid: uid };
    server.owners[uid] = { slot, tournamentId: id };
  }

  window.foosRemoteForTests = {
    async startPublishing({ state, code }) {
      await call('startPublishing', { id: state.tournamentId, name: state.tournamentName });
      const server = read();
      const decision = L().publishDecision({
        uid,
        owner: server.owners[uid] || null,
        slots: server.slots,
        tournaments: server.tournaments,
        now: Date.now()
      });
      if (decision.action !== 'claim') return decision;
      if (decision.expiredTournamentId) remove(server, decision.expiredTournamentId);
      put(server, state, decision.slot, code);
      write(server);
      return { action: 'published', slot: decision.slot };
    },

    async replacePublished({ state, code, held }) {
      await call('replacePublished', { id: state.tournamentId, oldId: held.tournamentId });
      const server = read();
      remove(server, held.tournamentId);
      put(server, state, held.slot, code);
      write(server);
      return { action: 'published', slot: held.slot };
    },

    async publish({ state }) {
      await call('publish', {
        id: state.tournamentId,
        name: state.tournamentName,
        exportText: L().publishedExport(state)
      });
      const server = read();
      const t = server.tournaments[state.tournamentId];
      if (!t || t.ownerUid !== uid) return { error: 'moved' };
      t.name = state.tournamentName;
      t.exportText = L().publishedExport(state);
      t.updatedAt = Date.now();
      write(server);
      return { ok: true };
    },

    async takeOver({ id, code, releaseCurrent = false }) {
      await call('takeOver', { id, code, releaseCurrent });
      const server = read();
      const target = server.tournaments[id];
      if (!target) return { error: 'That tournament is no longer published.' };
      if (target.ownerUid === uid) return { error: 'This browser already publishes that tournament.' };
      const held = L().heldSlot(uid, server.owners[uid] || null, server.slots);
      if (held && !releaseCurrent) {
        const current = server.tournaments[held.tournamentId];
        return { action: 'ask-release', name: current ? current.name : '' };
      }
      if (server.codes[id] !== code) return { error: 'That publisher code is not right for this tournament.' };
      if (held) {
        server.slots[held.slot - 1] = null;
        remove(server, held.tournamentId);
      }
      target.ownerUid = uid;
      target.updatedAt = Date.now();
      server.slots[target.slot - 1] = { tournamentId: id, ownerUid: uid };
      server.owners[uid] = { slot: target.slot, tournamentId: id };
      write(server);
      return { action: 'taken', slot: target.slot, exportText: target.exportText };
    },

    async published() {
      await call('published', {});
      const server = read();
      return L().publishedList(server.slots, server.tournaments, Date.now());
    },

    async fetchTournament(id) {
      await call('fetchTournament', { id });
      return full(read().tournaments[id] || null);
    },

    subscribe(id, onChange, onError) {
      calls.push({ method: 'subscribe', id });
      if (config().unavailable) {
        setTimeout(() => onError(new Error('Firebase unavailable')), 10);
        return () => {};
      }
      const fns = listeners.get(id) || new Set();
      listeners.set(id, fns);
      fns.add(onChange);
      setTimeout(() => fns.has(onChange) && onChange(full(read().tournaments[id] || null)), 10);
      return () => {
        calls.push({ method: 'unsubscribe', id });
        fns.delete(onChange);
      };
    }
  };
}

module.exports = { installFakeRemote };
