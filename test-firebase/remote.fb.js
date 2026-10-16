// firebase-remote.js against the emulator: real SDK (npm compat build), real
// rules, real anonymous auth. Each "browser" is a separately named app, so it
// gets its own anonymous uid.
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');
require('../tournament-logic.js');
require('../firebase-remote.js');

const logic = globalThis.TournamentLogic;
const { FirebaseRemote } = globalThis;
const PROJECT = 'demo-foos-tourney';
const EMULATORS = { firestore: '127.0.0.1:8080', auth: 'http://127.0.0.1:9099' };
const CODE = 'ABCD2345EFGH';
const CODE2 = 'ZZZZ2345EFGH';

let browsers = 0;

function browser(overrides = {}) {
  const appName = `browser-${++browsers}`;
  return FirebaseRemote.create({
    config: { apiKey: 'demo-key', projectId: PROJECT, appName, emulators: EMULATORS },
    logic,
    firebase,
    ...overrides
  });
}

function tournament(name, changes = {}) {
  return {
    ...logic.newTournamentState(logic.createTournamentId(), new Date('2026-10-16T19:00:00Z')),
    tournamentName: name,
    adminPin: '1234',
    isLocked: true,
    ...changes
  };
}

async function clearFirestore() {
  const url = `http://${EMULATORS.firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const response = await fetch(url, { method: 'DELETE' });
  assert.equal(response.ok, true);
}

// The emulator's "owner" token bypasses the rules, e.g. to age a tournament
// so its slot counts as expired.
async function adminRequest(method, path, body) {
  const url = `http://${EMULATORS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  assert.equal(response.ok, true, await response.text());
}

async function age(id, hours) {
  const updatedAt = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  await adminRequest('PATCH', `tournaments/${id}?updateMask.fieldPaths=updatedAt`, {
    fields: { updatedAt: { timestampValue: updatedAt } }
  });
}

beforeEach(clearFirestore);
after(() => Promise.all(firebase.apps.map(app => app.delete())));

describe('creating the remote', () => {
  it('is off without a config', () => {
    assert.equal(FirebaseRemote.create({ config: null, logic }), null);
  });
});

describe('publishing', () => {
  it('claims a slot on New Tournament and publishes the JSON without the PIN', async () => {
    const alice = browser();
    const week3 = tournament('Week 3');
    assert.deepEqual(await alice.startPublishing({ state: week3, code: CODE }), { action: 'published', slot: 1 });
    const fetched = await alice.fetchTournament(week3.tournamentId);
    assert.equal(fetched.name, 'Week 3');
    const parsed = logic.parseTournamentExport(fetched.exportText);
    assert.equal(parsed.tournament.tournamentId, week3.tournamentId);
    assert.equal(parsed.tournament.adminPin, null);
    assert.equal(parsed.tournament.isLocked, false);
    const listed = await browser().published();
    assert.deepEqual(
      listed.map(t => [t.id, t.slot, t.name, t.expired]),
      [[week3.tournamentId, 1, 'Week 3', false]]
    );
  });

  it('asks before replacing, then swaps the new tournament into the same slot', async () => {
    const alice = browser();
    const week3 = tournament('Week 3');
    const week4 = tournament('Week 4');
    await alice.startPublishing({ state: week3, code: CODE });
    const decision = await alice.startPublishing({ state: week4, code: CODE2 });
    assert.deepEqual(decision, { action: 'ask-replace', slot: 1, tournamentId: week3.tournamentId, name: 'Week 3' });
    assert.deepEqual(await alice.replacePublished({ state: week4, code: CODE2, held: decision }), {
      action: 'published',
      slot: 1
    });
    assert.equal(await alice.fetchTournament(week3.tournamentId), null);
    assert.equal((await alice.fetchTournament(week4.tournamentId)).name, 'Week 4');
  });

  it('publishes changes from the owner only', async () => {
    const alice = browser();
    const week3 = tournament('Week 3');
    await alice.startPublishing({ state: week3, code: CODE });
    assert.deepEqual(await alice.publish({ state: { ...week3, tournamentName: 'Week 3 finals' } }), { ok: true });
    assert.equal((await alice.fetchTournament(week3.tournamentId)).name, 'Week 3 finals');
    assert.deepEqual(await browser().publish({ state: week3 }), { error: 'moved' });
  });

  it('fills the 5 slots, then reports when the next one frees', async () => {
    for (let i = 1; i <= 5; i++) {
      assert.equal((await browser().startPublishing({ state: tournament(`T${i}`), code: CODE })).action, 'published');
    }
    const decision = await browser().startPublishing({ state: tournament('T6'), code: CODE });
    assert.equal(decision.action, 'full');
    assert.ok(decision.nextFreeAt > Date.now() + 23 * 3600 * 1000);
  });

  it('takes the oldest expired slot when all are in use', async () => {
    const ids = [];
    for (let i = 1; i <= 5; i++) {
      const t = tournament(`T${i}`);
      ids.push(t.tournamentId);
      await browser().startPublishing({ state: t, code: CODE });
    }
    await age(ids[2], 25);
    const late = tournament('Late');
    assert.deepEqual(await browser().startPublishing({ state: late, code: CODE }), { action: 'published', slot: 3 });
    assert.equal(await browser().fetchTournament(ids[2]), null);
  });

  it('lets two browsers racing for the same slot both end up published', async () => {
    const results = await Promise.all([
      browser().startPublishing({ state: tournament('A'), code: CODE }),
      browser().startPublishing({ state: tournament('B'), code: CODE })
    ]);
    assert.deepEqual(results.map(r => r.slot).sort(), [1, 2]);
  });

  it('gives up after repeated refusals', async () => {
    // A logic whose writes the rules always refuse (someone else's uid).
    const refused = { ...logic, claimWrites: args => logic.claimWrites({ ...args, uid: 'someone-else' }) };
    const remote = browser({ logic: refused });
    await assert.rejects(remote.startPublishing({ state: tournament('X'), code: CODE }), { code: 'permission-denied' });
  });

  it('passes on errors other than a refusal', async () => {
    const broken = {
      ...logic,
      claimWrites: () => [{ op: 'set', path: 'not-a-document', data: {} }],
      publishWrites: () => [{ op: 'update', path: 'not-a-document', data: {} }]
    };
    const remote = browser({ logic: broken });
    await assert.rejects(remote.startPublishing({ state: tournament('X'), code: CODE }));
    await assert.rejects(remote.publish({ state: tournament('X') }));
  });
});

describe('taking over', () => {
  it('needs the right code, then moves publishing to the new browser', async () => {
    const alice = browser();
    const bob = browser();
    const week3 = tournament('Week 3');
    await alice.startPublishing({ state: week3, code: CODE });
    assert.deepEqual(await bob.takeOver({ id: week3.tournamentId, code: CODE2 }), {
      error: 'That publisher code is not right for this tournament.'
    });
    const taken = await bob.takeOver({ id: week3.tournamentId, code: CODE });
    assert.equal(taken.action, 'taken');
    assert.equal(taken.slot, 1);
    assert.equal(logic.parseTournamentExport(taken.exportText).tournament.tournamentName, 'Week 3');
    assert.deepEqual(await alice.publish({ state: week3 }), { error: 'moved' });
    assert.deepEqual(await bob.publish({ state: week3 }), { ok: true });
  });

  it('asks before giving up the slot this browser already publishes in', async () => {
    const alice = browser();
    const bob = browser();
    const week3 = tournament('Week 3');
    const bobs = tournament('Bob night');
    await alice.startPublishing({ state: week3, code: CODE });
    await bob.startPublishing({ state: bobs, code: CODE2 });
    assert.deepEqual(await bob.takeOver({ id: week3.tournamentId, code: CODE }), {
      action: 'ask-release',
      name: 'Bob night'
    });
    const taken = await bob.takeOver({ id: week3.tournamentId, code: CODE, releaseCurrent: true });
    assert.equal(taken.action, 'taken');
    assert.equal(await bob.fetchTournament(bobs.tournamentId), null);
    assert.deepEqual(
      (await bob.published()).map(t => t.name),
      ['Week 3']
    );
  });

  it('still asks when the tournament it publishes has vanished', async () => {
    const alice = browser();
    const bob = browser();
    const week3 = tournament('Week 3');
    const bobs = tournament('Bob night');
    await alice.startPublishing({ state: week3, code: CODE });
    await bob.startPublishing({ state: bobs, code: CODE2 });
    await adminRequest('DELETE', `tournaments/${bobs.tournamentId}`);
    assert.deepEqual(await bob.takeOver({ id: week3.tournamentId, code: CODE }), { action: 'ask-release', name: '' });
  });

  it('refuses tournaments that aren’t published or are already ours', async () => {
    const alice = browser();
    const week3 = tournament('Week 3');
    assert.deepEqual(await alice.takeOver({ id: week3.tournamentId, code: CODE }), {
      error: 'That tournament is no longer published.'
    });
    await alice.startPublishing({ state: week3, code: CODE });
    assert.deepEqual(await alice.takeOver({ id: week3.tournamentId, code: CODE }), {
      error: 'This browser already publishes that tournament.'
    });
  });

  it('passes on errors other than a refusal', async () => {
    const week3 = tournament('Week 3');
    await browser().startPublishing({ state: week3, code: CODE });
    const broken = { ...logic, takeOverWrites: () => [{ op: 'set', path: 'not-a-document', data: {} }] };
    await assert.rejects(browser({ logic: broken }).takeOver({ id: week3.tournamentId, code: CODE }));
  });
});

describe('listening', () => {
  it('follows a published tournament live, until it is removed', async () => {
    const alice = browser();
    const week3 = tournament('Week 3');
    await alice.startPublishing({ state: week3, code: CODE });
    const seen = [];
    let resolveRemoved;
    const removed = new Promise(resolve => (resolveRemoved = resolve));
    const stop = browser().subscribe(
      week3.tournamentId,
      t => {
        seen.push(t && t.name);
        if (t === null) resolveRemoved();
      },
      err => assert.fail(err)
    );
    await new Promise(resolve => setTimeout(resolve, 500));
    await alice.publish({ state: { ...week3, tournamentName: 'Week 3 live' } });
    await new Promise(resolve => setTimeout(resolve, 500));
    await alice.replacePublished({ state: tournament('Week 4'), code: CODE2, held: { slot: 1, ...week3 } });
    await removed;
    stop();
    assert.deepEqual(seen, ['Week 3', 'Week 3 live', null]);
  });

  it('can stop before it has connected', async () => {
    const calls = [];
    const stop = browser().subscribe(
      'x',
      t => calls.push(t),
      err => calls.push(err)
    );
    stop();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(calls, []);
  });

  it('reports a failure to connect', async () => {
    const failing = {
      initializeApp: () => {
        throw new Error('no network');
      }
    };
    const remote = browser({ firebase: failing });
    const error = await new Promise(resolve => remote.subscribe('x', () => {}, resolve));
    assert.equal(error.message, 'no network');
  });
});

describe('loading the SDK', () => {
  // A stand-in document whose <script> elements "load" by running onload.
  function fakeDocument({ fail = null } = {}) {
    const loaded = [];
    return {
      loaded,
      createElement: () => ({}),
      head: {
        appendChild(script) {
          loaded.push(script.src);
          setTimeout(() => (fail && script.src.includes(fail) ? script.onerror() : script.onload()));
        }
      }
    };
  }

  it('loads the pinned compat build in order on first use, without emulators', async () => {
    const doc = fakeDocument();
    const fakeDb = { doc: () => ({ get: async () => ({ exists: false }) }) };
    globalThis.firebase = {
      initializeApp: () => ({
        auth: () => ({ signInAnonymously: async () => ({ user: { uid: 'u1' } }) }),
        firestore: () => fakeDb
      })
    };
    try {
      const remote = FirebaseRemote.create({ config: { apiKey: 'k', projectId: PROJECT }, logic, doc });
      assert.equal(await remote.fetchTournament('x'), null);
      assert.deepEqual(
        doc.loaded,
        ['app', 'auth', 'firestore'].map(
          f => `https://www.gstatic.com/firebasejs/${FirebaseRemote.SDK_VERSION}/firebase-${f}-compat.js`
        )
      );
    } finally {
      delete globalThis.firebase;
    }
  });

  it('fails when a script can’t load', async () => {
    await assert.rejects(
      FirebaseRemote.loadSdk(fakeDocument({ fail: 'auth' })),
      /Could not load .*firebase-auth-compat/
    );
  });
});
