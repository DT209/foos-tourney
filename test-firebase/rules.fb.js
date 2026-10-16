// Firestore security rules, against the local emulator. Run through
// `npm run test:firebase`, which starts the emulator first.
const { describe, it, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
require('../tournament-logic.js');

const { newTournamentState, serializeTournamentExport } = globalThis.TournamentLogic;

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const CODE = 'ABCD2345EFGH';
const server = () => firebase.firestore.FieldValue.serverTimestamp();
const hoursAgo = h => firebase.firestore.Timestamp.fromMillis(Date.now() - h * 3600 * 1000);

let env;

// The Export JSON text, as a file would hold it.
function exportText(changes = {}) {
  const state = newTournamentState(ID, new Date('2026-10-16T19:00:00.000Z'));
  return serializeTournamentExport({ ...state, tournamentName: 'Week 3', adminPin: null, ...changes });
}

function tournamentDoc(ownerUid, slot, overrides = {}) {
  return {
    ownerUid,
    slot,
    updatedAt: server(),
    name: 'Week 3',
    startedAt: '2026-10-16T19:00:00.000Z',
    export: exportText(),
    ...overrides
  };
}

const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

// The batch a browser with no slot sends when it presses New Tournament.
function startBatch(store, uid, id, slot, { code = CODE, tournament = {}, extra } = {}) {
  const batch = store.batch();
  batch.set(store.doc(`tournaments/${id}`), tournamentDoc(uid, slot, tournament));
  batch.set(store.doc(`slots/${slot}`), { tournamentId: id, ownerUid: uid });
  batch.set(store.doc(`owners/${uid}`), { slot, tournamentId: id });
  batch.set(store.doc(`secrets/${id}`), { code });
  if (extra) extra(batch, store);
  return batch.commit();
}

// Seeds data as an admin (rules off), e.g. a tournament last changed 25 hours ago.
async function seed({ uid = 'alice', id = ID, slot = 1, updatedAt = hoursAgo(1), code = CODE } = {}) {
  await env.withSecurityRulesDisabled(async ctx => {
    const store = ctx.firestore();
    await store.doc(`tournaments/${id}`).set({ ...tournamentDoc(uid, slot), updatedAt });
    await store.doc(`slots/${slot}`).set({ tournamentId: id, ownerUid: uid });
    await store.doc(`owners/${uid}`).set({ slot, tournamentId: id });
    await store.doc(`secrets/${id}`).set({ code });
  });
}

function takeOverBatch(store, uid, id, slot, code, extra) {
  const batch = store.batch();
  batch.set(store.doc(`claims/${id}`), { uid, code });
  batch.update(store.doc(`tournaments/${id}`), { ownerUid: uid, updatedAt: server() });
  batch.set(store.doc(`slots/${slot}`), { tournamentId: id, ownerUid: uid });
  batch.set(store.doc(`owners/${uid}`), { slot, tournamentId: id });
  if (extra) extra(batch, store);
  return batch.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-foos-tourney',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') }
  });
});

after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe('reading', () => {
  it('lets anyone read tournaments, slots and owners', async () => {
    await seed();
    await assertSucceeds(db().doc(`tournaments/${ID}`).get());
    await assertSucceeds(db().doc('slots/1').get());
    await assertSucceeds(db().doc('owners/alice').get());
    await assertSucceeds(db().collection('slots').get());
  });

  it('never lets anyone read secrets or claims, not even the owner', async () => {
    await seed();
    await assertFails(db('alice').doc(`secrets/${ID}`).get());
    await assertFails(db('alice').doc(`claims/${ID}`).get());
    await assertFails(db().doc(`secrets/${ID}`).get());
  });
});

describe('starting to publish', () => {
  it('claims a free slot in one batch', async () => {
    await assertSucceeds(startBatch(db('alice'), 'alice', ID, 1));
  });

  it('needs a signed-in browser', async () => {
    await assertFails(startBatch(db(), 'alice', ID, 1));
  });

  it('only uses slots 1 to 5', async () => {
    await assertFails(startBatch(db('alice'), 'alice', ID, 6));
    await assertFails(startBatch(db('alice'), 'alice', ID, 0));
  });

  it('cannot publish in someone else’s name', async () => {
    const store = db('mallory');
    const batch = store.batch();
    batch.set(store.doc(`tournaments/${ID}`), tournamentDoc('alice', 1));
    batch.set(store.doc('slots/1'), { tournamentId: ID, ownerUid: 'alice' });
    await assertFails(batch.commit());
  });

  it('cannot take a slot another browser is using', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(startBatch(db('bob'), 'bob', ID2, 1));
  });

  it('takes an expired slot, removing the old tournament, secret and claim', async () => {
    await seed({ uid: 'alice', slot: 1, updatedAt: hoursAgo(25) });
    await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(`claims/${ID}`).set({ uid: 'carol', code: CODE }));
    await assertSucceeds(
      startBatch(db('bob'), 'bob', ID2, 1, {
        extra: (batch, store) => {
          batch.delete(store.doc(`tournaments/${ID}`));
          batch.delete(store.doc(`secrets/${ID}`));
          batch.delete(store.doc(`claims/${ID}`));
        }
      })
    );
  });

  it('treats a slot whose tournament is gone as free', async () => {
    await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('slots/2').set({ tournamentId: ID, ownerUid: 'x' }));
    await assertSucceeds(startBatch(db('bob'), 'bob', ID2, 2));
  });

  it('allows only one slot per browser', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(startBatch(db('alice'), 'alice', ID2, 2));
  });

  it('ignores a stale owner record whose slot was claimed by someone else', async () => {
    await seed({ uid: 'bob', id: ID2, slot: 1 });
    await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('owners/alice').set({ slot: 1, tournamentId: ID }));
    await assertSucceeds(startBatch(db('alice'), 'alice', ID3, 2));
  });

  it('lets only one of two browsers win the same free slot', async () => {
    const results = await Promise.allSettled([
      startBatch(db('alice'), 'alice', ID, 3),
      startBatch(db('bob'), 'bob', ID2, 3)
    ]);
    const wins = results.filter(r => r.status === 'fulfilled').length;
    if (wins !== 1) throw new Error(`expected one winner, got ${wins}`);
  });

  it('rejects extra fields, a PIN and a client clock', async () => {
    await assertFails(startBatch(db('alice'), 'alice', ID, 1, { tournament: { note: 'x' } }));
    await assertFails(
      startBatch(db('alice'), 'alice', ID, 1, { tournament: { export: exportText({ adminPin: '1234' }) } })
    );
    await assertFails(
      startBatch(db('alice'), 'alice', ID, 1, { tournament: { updatedAt: firebase.firestore.Timestamp.now() } })
    );
    await assertFails(startBatch(db('alice'), 'alice', ID, 1, { tournament: { export: '{"format": "other"}' } }));
    await assertFails(startBatch(db('alice'), 'alice', ID, 1, { tournament: { export: { format: 'foos-tourney' } } }));
  });

  it('accepts names that look like a PIN field, since JSON escapes them', async () => {
    const players = [{ id: 1, name: 'x", "adminPin": "1234' }];
    await assertSucceeds(startBatch(db('alice'), 'alice', ID, 1, { tournament: { export: exportText({ players }) } }));
  });

  it('rejects a malformed publisher code', async () => {
    await assertFails(startBatch(db('alice'), 'alice', ID, 1, { code: 'ABCD-2345-EFGH' }));
    await assertFails(startBatch(db('alice'), 'alice', ID, 1, { code: 'ILOU2345EFGH' }));
  });
});

describe('owner records', () => {
  it('can only be written by their own browser, for a slot it holds', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(db('bob').doc('owners/alice').set({ slot: 2, tournamentId: ID2 }));
    await assertFails(db('bob').doc('owners/bob').set({ slot: 1, tournamentId: ID }));
    await assertSucceeds(db('alice').doc('owners/alice').set({ slot: 1, tournamentId: ID }));
  });

  it('cannot be deleted, so a browser can’t hide the slot it holds', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(db('alice').doc('owners/alice').delete());
  });
});

describe('replacing (same browser, New Tournament again)', () => {
  function replaceBatch(store, uid, { deleteOld = true } = {}) {
    const batch = store.batch();
    if (deleteOld) {
      batch.delete(store.doc(`tournaments/${ID}`));
      batch.delete(store.doc(`secrets/${ID}`));
    }
    batch.set(store.doc(`tournaments/${ID2}`), tournamentDoc(uid, 1));
    batch.set(store.doc(`secrets/${ID2}`), { code: 'ZZZZ2345EFGH' });
    batch.set(store.doc('slots/1'), { tournamentId: ID2, ownerUid: uid });
    batch.set(store.doc(`owners/${uid}`), { slot: 1, tournamentId: ID2 });
    return batch.commit();
  }

  it('swaps the new tournament into the same slot', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertSucceeds(replaceBatch(db('alice'), 'alice'));
  });

  it('must remove the old tournament', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(replaceBatch(db('alice'), 'alice', { deleteOld: false }));
  });

  it('is only for the browser that owns the slot', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(replaceBatch(db('bob'), 'bob'));
  });
});

describe('publishing a change', () => {
  const change = (uid, fields) =>
    db(uid)
      .doc(`tournaments/${ID}`)
      .update({ updatedAt: server(), ...fields });

  it('lets the owner replace the JSON and name', async () => {
    await seed();
    await assertSucceeds(
      change('alice', { name: 'Week 3 finals', export: exportText({ tournamentName: 'Week 3 finals' }) })
    );
  });

  it('refuses everyone else', async () => {
    await seed();
    await assertFails(change('bob', { name: 'hijacked' }));
    await assertFails(db().doc(`tournaments/${ID}`).update({ name: 'x', updatedAt: server() }));
  });

  it('keeps the slot, start time and owner fixed', async () => {
    await seed();
    await assertFails(change('alice', { slot: 2 }));
    await assertFails(change('alice', { startedAt: '2020-01-01T00:00:00.000Z' }));
    await assertFails(change('alice', { ownerUid: 'bob' }));
  });

  it('must stamp the server time', async () => {
    await seed();
    await assertFails(
      db('alice')
        .doc(`tournaments/${ID}`)
        .update({ updatedAt: hoursAgo(0) })
    );
    await assertFails(db('alice').doc(`tournaments/${ID}`).update({ name: 'no stamp' }));
  });

  it('cannot add a PIN', async () => {
    await seed();
    await assertFails(change('alice', { export: exportText({ adminPin: '1234' }) }));
  });

  it('stops once the slot belongs to another tournament', async () => {
    await seed({ uid: 'alice', updatedAt: hoursAgo(25) });
    await env.withSecurityRulesDisabled(ctx =>
      ctx.firestore().doc('slots/1').set({ tournamentId: ID2, ownerUid: 'bob' })
    );
    await assertFails(change('alice', { name: 'too late' }));
  });
});

describe('taking over with the publisher code', () => {
  it('moves the tournament and slot to the new browser', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertSucceeds(takeOverBatch(db('bob'), 'bob', ID, 1, CODE));
    await assertSucceeds(db('bob').doc(`tournaments/${ID}`).update({ name: 'mine now', updatedAt: server() }));
    await assertFails(db('alice').doc(`tournaments/${ID}`).update({ name: 'still mine?', updatedAt: server() }));
  });

  it('fails with the wrong code', async () => {
    await seed({ uid: 'alice', slot: 1 });
    await assertFails(takeOverBatch(db('bob'), 'bob', ID, 1, 'WRNG2345EFGH'));
  });

  it('fails without a claim', async () => {
    await seed({ uid: 'alice', slot: 1 });
    const store = db('bob');
    const batch = store.batch();
    batch.update(store.doc(`tournaments/${ID}`), { ownerUid: 'bob', updatedAt: server() });
    batch.set(store.doc('slots/1'), { tournamentId: ID, ownerUid: 'bob' });
    await assertFails(batch.commit());
  });

  it('must give up the slot the browser already holds', async () => {
    await seed({ uid: 'alice', id: ID, slot: 1 });
    await seed({ uid: 'bob', id: ID2, slot: 2, code: 'ZZZZ2345EFGH' });
    await assertFails(takeOverBatch(db('bob'), 'bob', ID, 1, CODE));
    await assertSucceeds(
      takeOverBatch(db('bob'), 'bob', ID, 1, CODE, (batch, store) => {
        batch.delete(store.doc('slots/2'));
        batch.delete(store.doc(`tournaments/${ID2}`));
        batch.delete(store.doc(`secrets/${ID2}`));
      })
    );
  });
});

describe('cleaning up', () => {
  it('lets anyone remove an expired tournament only once its slot has moved on', async () => {
    await seed({ uid: 'alice', updatedAt: hoursAgo(25) });
    await assertFails(db('bob').doc(`tournaments/${ID}`).delete());
    await env.withSecurityRulesDisabled(ctx =>
      ctx.firestore().doc('slots/1').set({ tournamentId: ID2, ownerUid: 'bob' })
    );
    await assertSucceeds(db('bob').doc(`tournaments/${ID}`).delete());
    await assertSucceeds(db('bob').doc(`secrets/${ID}`).delete());
  });

  it('keeps a live tournament and its secret', async () => {
    await seed({ uid: 'alice' });
    await assertFails(db('bob').doc(`tournaments/${ID}`).delete());
    await assertFails(db('bob').doc(`secrets/${ID}`).delete());
    await assertFails(db('bob').doc('slots/1').delete());
  });

  it('never lets the code be changed after the tournament exists', async () => {
    await seed({ uid: 'alice' });
    await assertFails(db('alice').doc(`secrets/${ID}`).set({ code: 'ZZZZ2345EFGH' }));
  });
});
