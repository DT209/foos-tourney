const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { seq, player } = require('./helpers');

const {
  PUBLISH_SLOTS,
  SLOT_TTL_MS,
  SERVER_TIME,
  PUBLISHING_KEY,
  newTournamentState,
  parseTournamentExport,
  buildDisplayBoard,
  watchedSections,
  watchedChanged,
  publishThrottle,
  publishedExport,
  publishedDocument,
  isSlotExpired,
  nextFreeSlot,
  heldSlot,
  publishDecision,
  claimWrites,
  replaceWrites,
  publishWrites,
  takeOverWrites,
  publishedList,
  displayChoices,
  generatePublisherCode,
  formatPublisherCode,
  normalizePublisherCode,
  publisherCodeFileName,
  publisherCodeFile,
  parsePublisherCodeFile,
  loadPublishing,
  savePublishing,
  copyToClipboard,
  remoteTournamentUrl,
  remoteIdFromSearch,
  boardForTournament,
  publishStartOutcome,
  takeOverOutcome,
  parsePublishedTournament,
  publishResultStatus,
  shouldRetryPublishing,
  initialDisplaySource,
  savedTournamentName,
  saveTournament
} = globalThis.TournamentLogic;

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-17T03:00:00Z');
const HOUR = 3600 * 1000;

function state(changes = {}) {
  return {
    ...newTournamentState(ID, new Date('2026-10-16T19:00:00Z')),
    tournamentName: 'Week 3',
    adminPin: '1234',
    isLocked: true,
    players: [player(1, 'Ann', { paid: true })],
    ...changes
  };
}

const emptySlots = () => Array(PUBLISH_SLOTS).fill(null);

describe('watched sections', () => {
  const board = changes =>
    buildDisplayBoard({
      matches: [],
      bracketAssignments: [],
      tableCount: 2,
      players: state().players,
      completedMatches: [],
      ...changes
    });

  it('changes only when tables, standings or history change', () => {
    const before = watchedSections(board());
    assert.equal(watchedChanged(before, watchedSections(board())), false);
    assert.equal(watchedChanged(before, watchedSections(board({ tableCount: 3 }))), true);
    const renamed = state().players.map(p => ({ ...p, name: 'Annie' }));
    assert.equal(watchedChanged(before, watchedSections(board({ players: renamed }))), true);
    // Paid flags aren't on the board, so they don't trigger a write.
    const unpaid = state().players.map(p => ({ ...p, paid: false }));
    assert.equal(watchedChanged(before, watchedSections(board({ players: unpaid }))), false);
  });

  it('counts the first board as a change', () => {
    assert.equal(watchedChanged(null, watchedSections(board())), true);
  });
});

describe('publishThrottle', () => {
  it('sends the first write at once', () => {
    assert.equal(publishThrottle(null, NOW), 0);
  });

  it('waits until 5 seconds after the last write', () => {
    assert.equal(publishThrottle(NOW, NOW + 1000), 4000);
    assert.equal(publishThrottle(NOW, NOW + 5000), 0);
    assert.equal(publishThrottle(NOW, NOW + 9000), 0);
    assert.equal(publishThrottle(NOW, NOW, 2000), 2000);
  });
});

describe('the published copy', () => {
  it('is the Export JSON without the PIN and lock, with paid flags', () => {
    const text = publishedExport(state(), new Date(NOW));
    const file = JSON.parse(text);
    assert.equal(file.format, 'foos-tourney');
    assert.equal(file.exportedAt, '2026-10-17T03:00:00.000Z');
    assert.equal(file.tournament.adminPin, null);
    assert.equal(file.tournament.isLocked, false);
    assert.equal(file.tournament.players[0].paid, true);
    assert.match(text, /"adminPin": null/);
    assert.equal(parseTournamentExport(text).tournament.tournamentId, ID);
  });

  it('defaults the export time to now', () => {
    assert.ok(JSON.parse(publishedExport(state())).exportedAt);
  });

  it('wraps the export in the tournament document', () => {
    const doc = publishedDocument({ state: state(), uid: 'alice', slot: 2, now: new Date(NOW) });
    assert.deepEqual(Object.keys(doc).sort(), ['export', 'name', 'ownerUid', 'slot', 'startedAt', 'updatedAt']);
    assert.equal(doc.ownerUid, 'alice');
    assert.equal(doc.slot, 2);
    assert.equal(doc.updatedAt, SERVER_TIME);
    assert.equal(doc.name, 'Week 3');
    assert.equal(doc.startedAt, '2026-10-16T19:00:00.000Z');
    assert.equal(JSON.parse(doc.export).tournament.adminPin, null);
    const long = publishedDocument({ state: state({ tournamentName: 'x'.repeat(300) }), uid: 'a', slot: 1 });
    assert.equal(long.name.length, 200);
  });
});

describe('slots', () => {
  const live = { updatedAt: NOW - HOUR, name: 'Live' };
  const old = (hours, name = 'Old') => ({ updatedAt: NOW - hours * HOUR, name });

  it('expire 24 hours after the last published change', () => {
    assert.equal(isSlotExpired(NOW - SLOT_TTL_MS + 1, NOW), false);
    assert.equal(isSlotExpired(NOW - SLOT_TTL_MS, NOW), true);
  });

  it('prefers an empty slot, then a slot whose tournament is gone', () => {
    assert.deepEqual(nextFreeSlot(emptySlots(), {}, NOW), { slot: 1, expiredTournamentId: null });
    const slots = [{ tournamentId: 'a', ownerUid: 'u' }, { tournamentId: 'gone', ownerUid: 'v' }, null, null, null];
    assert.deepEqual(nextFreeSlot(slots, { a: live }, NOW), { slot: 2, expiredTournamentId: 'gone' });
  });

  it('then takes the oldest expired slot', () => {
    const slots = ['a', 'b', 'c', 'd', 'e'].map(id => ({ tournamentId: id, ownerUid: id }));
    const tournaments = { a: live, b: old(30), c: old(50), d: old(40), e: live };
    assert.deepEqual(nextFreeSlot(slots, tournaments, NOW), { slot: 3, expiredTournamentId: 'c' });
  });

  it('returns null when every slot is live', () => {
    const slots = ['a', 'b', 'c', 'd', 'e'].map(id => ({ tournamentId: id, ownerUid: id }));
    const tournaments = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, live]));
    assert.equal(nextFreeSlot(slots, tournaments, NOW), null);
  });

  it('know which slot this browser holds', () => {
    const slots = [null, { tournamentId: ID, ownerUid: 'alice' }, null, null, null];
    assert.deepEqual(heldSlot('alice', { slot: 2, tournamentId: ID }, slots), { slot: 2, tournamentId: ID });
    assert.equal(heldSlot('alice', null, slots), null);
    assert.equal(heldSlot('alice', { slot: 3, tournamentId: ID }, slots), null);
    // Stale: the slot was claimed by someone else.
    assert.equal(heldSlot('bob', { slot: 2, tournamentId: ID }, slots), null);
  });
});

describe('publishDecision', () => {
  const live = id => ({ updatedAt: NOW - HOUR, name: `T ${id}` });

  it('claims a free slot', () => {
    assert.deepEqual(publishDecision({ uid: 'alice', owner: null, slots: emptySlots(), tournaments: {}, now: NOW }), {
      action: 'claim',
      slot: 1,
      expiredTournamentId: null
    });
  });

  it('asks before replacing the tournament this browser publishes', () => {
    const slots = [{ tournamentId: ID, ownerUid: 'alice' }, null, null, null, null];
    const decision = publishDecision({
      uid: 'alice',
      owner: { slot: 1, tournamentId: ID },
      slots,
      tournaments: { [ID]: { updatedAt: NOW, name: 'Week 3' } },
      now: NOW
    });
    assert.deepEqual(decision, { action: 'ask-replace', slot: 1, tournamentId: ID, name: 'Week 3' });
    const gone = publishDecision({
      uid: 'alice',
      owner: { slot: 1, tournamentId: ID },
      slots,
      tournaments: {},
      now: NOW
    });
    assert.equal(gone.name, '');
  });

  it('reports when every slot is in use, with the next free time', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const slots = ids.map(id => ({ tournamentId: id, ownerUid: id }));
    const tournaments = Object.fromEntries(ids.map(id => [id, live(id)]));
    tournaments.c = { updatedAt: NOW - 20 * HOUR, name: 'C' };
    assert.deepEqual(publishDecision({ uid: 'alice', owner: null, slots, tournaments, now: NOW }), {
      action: 'full',
      nextFreeAt: NOW + 4 * HOUR
    });
  });
});

describe('planned writes', () => {
  const document = { export: '{}', name: 'Week 3', updatedAt: SERVER_TIME };

  it('claim a free slot', () => {
    assert.deepEqual(claimWrites({ uid: 'alice', slot: 2, expiredTournamentId: null, document, id: ID, code: 'C' }), [
      { op: 'set', path: `tournaments/${ID}`, data: document },
      { op: 'set', path: `secrets/${ID}`, data: { code: 'C' } },
      { op: 'set', path: 'slots/2', data: { tournamentId: ID, ownerUid: 'alice' } },
      { op: 'set', path: 'owners/alice', data: { slot: 2, tournamentId: ID } }
    ]);
  });

  it('claim an expired slot, removing its tournament', () => {
    const writes = claimWrites({ uid: 'alice', slot: 2, expiredTournamentId: ID2, document, id: ID, code: 'C' });
    assert.deepEqual(writes.slice(0, 3), [
      { op: 'delete', path: `tournaments/${ID2}` },
      { op: 'delete', path: `secrets/${ID2}` },
      { op: 'delete', path: `claims/${ID2}` }
    ]);
    assert.equal(writes.length, 7);
  });

  it('replace the published tournament in the same slot', () => {
    const writes = replaceWrites({ uid: 'alice', slot: 1, oldId: ID2, document, id: ID, code: 'C' });
    assert.deepEqual(
      writes.map(w => `${w.op} ${w.path}`),
      [
        `delete tournaments/${ID2}`,
        `delete secrets/${ID2}`,
        `delete claims/${ID2}`,
        `set tournaments/${ID}`,
        `set secrets/${ID}`,
        'set slots/1',
        'set owners/alice'
      ]
    );
  });

  it('publish a change: the JSON, name and server time only', () => {
    const now = new Date(NOW);
    assert.deepEqual(publishWrites({ state: state(), now }), [
      {
        op: 'update',
        path: `tournaments/${ID}`,
        data: { export: publishedExport(state(), now), name: 'Week 3', updatedAt: SERVER_TIME }
      }
    ]);
    assert.equal(JSON.parse(publishWrites({ state: state() })[0].data.export).tournament.adminPin, null);
  });

  it('take over, optionally releasing the slot this browser held', () => {
    const plain = takeOverWrites({ uid: 'bob', id: ID, slot: 1, code: 'C', release: null });
    assert.deepEqual(plain, [
      { op: 'set', path: `claims/${ID}`, data: { uid: 'bob', code: 'C' } },
      { op: 'update', path: `tournaments/${ID}`, data: { ownerUid: 'bob', updatedAt: SERVER_TIME } },
      { op: 'set', path: 'slots/1', data: { tournamentId: ID, ownerUid: 'bob' } },
      { op: 'set', path: 'owners/bob', data: { slot: 1, tournamentId: ID } }
    ]);
    const releasing = takeOverWrites({
      uid: 'bob',
      id: ID,
      slot: 1,
      code: 'C',
      release: { slot: 4, tournamentId: ID2 }
    });
    assert.deepEqual(
      releasing.slice(0, 4).map(w => `${w.op} ${w.path}`),
      ['delete slots/4', `delete tournaments/${ID2}`, `delete secrets/${ID2}`, `delete claims/${ID2}`]
    );
  });
});

describe('published lists', () => {
  const tournaments = {
    [ID]: { id: ID, name: 'Week 3', startedAt: 's1', updatedAt: NOW - HOUR, ownerUid: 'alice' },
    [ID2]: { id: ID2, name: 'Old', startedAt: 's2', updatedAt: NOW - 30 * HOUR, ownerUid: 'bob' }
  };
  const slots = [null, { tournamentId: ID, ownerUid: 'alice' }, { tournamentId: 'gone' }, null, { tournamentId: ID2 }];

  it('list slot holders with their expiry', () => {
    assert.deepEqual(publishedList(slots, tournaments, NOW), [
      { id: ID, slot: 2, name: 'Week 3', startedAt: 's1', updatedAt: NOW - HOUR, ownerUid: 'alice', expired: false },
      { id: ID2, slot: 5, name: 'Old', startedAt: 's2', updatedAt: NOW - 30 * HOUR, ownerUid: 'bob', expired: true }
    ]);
  });

  it('put this device first and drop its published copy', () => {
    const published = publishedList(slots, tournaments, NOW);
    assert.deepEqual(displayChoices({ id: ID, name: 'Week 3 (local)' }, published), [
      { key: 'local', source: 'local', id: ID, name: 'Week 3 (local)' },
      { key: ID2, source: 'remote', id: ID2, name: 'Old', startedAt: 's2', updatedAt: NOW - 30 * HOUR }
    ]);
    assert.equal(displayChoices({ id: 'other', name: 'Mine' }, published).length, 3);
  });
});

describe('publisher codes', () => {
  it('are 12 Crockford base32 characters', () => {
    assert.equal(generatePublisherCode(seq(0, 0.999)), '0Z0Z0Z0Z0Z0Z');
    const code = generatePublisherCode();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('show in groups of four', () => {
    assert.equal(formatPublisherCode('ABCD2345EFGH'), 'ABCD-2345-EFGH');
  });

  it('accept loose typing', () => {
    assert.equal(normalizePublisherCode(' abcd-2345 efgh '), 'ABCD2345EFGH');
    assert.equal(normalizePublisherCode('ABCD-O1IL-EFGH'), 'ABCD0111EFGH');
    assert.equal(normalizePublisherCode('ABCD-2345-EFG'), null);
    assert.equal(normalizePublisherCode('ABCD-2345-EFGU'), null);
    assert.equal(normalizePublisherCode(null), null);
  });

  it('save to a file that reads back', () => {
    const s = state();
    assert.equal(publisherCodeFileName(s), 'Week_3_2026-10-16.publisher-code.txt');
    assert.equal(publisherCodeFileName(state({ tournamentName: ' ' })), 'tournament_2026-10-16.publisher-code.txt');
    const text = publisherCodeFile({ state: s, code: 'ABCD2345EFGH', viewerUrl: 'https://x/?remote=1' });
    assert.match(text, /Code: ABCD-2345-EFGH/);
    assert.match(text, /Viewer link: https:\/\/x\/\?remote=1/);
    assert.deepEqual(parsePublisherCodeFile(text), { tournamentId: ID, code: 'ABCD2345EFGH' });
  });

  it('reject files that aren’t code files', () => {
    const error = { error: "This file isn't a Foos Tourney publisher code file." };
    assert.deepEqual(parsePublisherCodeFile('hello'), error);
    assert.deepEqual(parsePublisherCodeFile('Tournament id: a/b\nCode: ABCD2345EFGH'), error);
    assert.deepEqual(parsePublisherCodeFile(`Tournament id: ${ID}\nCode: nope`), error);
  });
});

describe('the publishing record', () => {
  const storage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: k => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: k => data.delete(k)
    };
  };
  const record = { tournamentId: ID, slot: 3, code: 'ABCD2345EFGH' };

  it('round-trips and clears', () => {
    const s = storage();
    assert.equal(loadPublishing(s), null);
    assert.equal(savePublishing(s, record), true);
    assert.deepEqual(loadPublishing(s), record);
    assert.equal(savePublishing(s, null), true);
    assert.equal(s.data.has(PUBLISHING_KEY), false);
  });

  it('ignores damaged records', () => {
    assert.equal(loadPublishing(storage({ [PUBLISHING_KEY]: '{bad' })), null);
    assert.equal(loadPublishing(storage({ [PUBLISHING_KEY]: '[]' })), null);
    for (const broken of [
      { ...record, tournamentId: 1 },
      { ...record, slot: '3' },
      { ...record, code: 'abcd2345efgh' }
    ]) {
      assert.equal(loadPublishing(storage({ [PUBLISHING_KEY]: JSON.stringify(broken) })), null);
    }
  });

  it('reports storage that refuses writes', () => {
    const broken = {
      setItem: () => {
        throw new Error('Quota');
      },
      removeItem: () => {
        throw new Error('x');
      }
    };
    assert.equal(savePublishing(broken, record), false);
    assert.equal(savePublishing(broken, null), false);
  });
});

describe('remote view links', () => {
  it('open a published tournament with ?remote=<id>', () => {
    assert.equal(remoteTournamentUrl('https://x/t.html?display=1#a', ID), `https://x/t.html?remote=${ID}#a`);
    assert.equal(remoteIdFromSearch(`?remote=${ID}`), ID);
    assert.equal(remoteIdFromSearch('?remote=a/b'), null);
    assert.equal(remoteIdFromSearch('?display=1'), null);
  });
});

describe('boardForTournament', () => {
  it('builds the Display Mode board from a tournament state', () => {
    const board = boardForTournament(state({ tableCount: 3 }));
    assert.equal(board.tables.length, 3);
    assert.deepEqual(
      board.standings.map(p => p.name),
      ['Ann']
    );
    assert.deepEqual(board.history, []);
  });
});

describe('page outcomes', () => {
  it('map startPublishing results', () => {
    const ids = { tournamentId: ID, code: 'ABCD2345EFGH' };
    assert.deepEqual(publishStartOutcome({ action: 'published', slot: 2 }, ids), {
      record: { tournamentId: ID, slot: 2, code: 'ABCD2345EFGH' },
      status: { kind: 'live' }
    });
    const ask = { action: 'ask-replace', slot: 1, tournamentId: ID2, name: 'Week 2' };
    assert.deepEqual(publishStartOutcome(ask, ids), { prompt: ask });
    assert.deepEqual(publishStartOutcome({ action: 'full', nextFreeAt: NOW }, ids), {
      status: { kind: 'full', nextFreeAt: NOW, tournamentId: ID }
    });
  });

  it('map takeOver results', () => {
    const ids = { id: ID, code: 'ABCD2345EFGH' };
    assert.deepEqual(takeOverOutcome({ error: 'nope' }, ids), { error: 'nope' });
    assert.deepEqual(takeOverOutcome({ action: 'ask-release', name: 'Mine' }, ids), { askRelease: 'Mine' });
    const taken = takeOverOutcome({ action: 'taken', slot: 4, exportText: publishedExport(state()) }, ids);
    assert.equal(taken.tournament.tournamentName, 'Week 3');
    assert.deepEqual(taken.record, { tournamentId: ID, slot: 4, code: 'ABCD2345EFGH' });
    assert.match(takeOverOutcome({ action: 'taken', slot: 4, exportText: 'junk' }, ids).error, /isn't a Foos Tourney/);
  });

  it('parse a published tournament, or notice it is gone', () => {
    assert.deepEqual(parsePublishedTournament(null), { gone: true });
    assert.equal(parsePublishedTournament({ exportText: publishedExport(state()) }).tournament.tournamentId, ID);
    assert.ok(parsePublishedTournament({ exportText: '{}' }).error);
  });
});

describe('page decisions', () => {
  it('turn a publish result into a status', () => {
    assert.deepEqual(publishResultStatus({ ok: true }), { kind: 'live' });
    assert.deepEqual(publishResultStatus({ error: 'moved' }), { kind: 'moved' });
  });

  it('retry a full publish only for the same tournament, once a slot frees', () => {
    const full = { kind: 'full', nextFreeAt: NOW, tournamentId: ID };
    assert.equal(shouldRetryPublishing(full, ID, NOW), true);
    assert.equal(shouldRetryPublishing(full, ID, NOW - 1), false);
    assert.equal(shouldRetryPublishing(full, ID2, NOW), false);
    assert.equal(shouldRetryPublishing({ kind: 'live' }, ID, NOW), false);
    assert.equal(shouldRetryPublishing(null, ID, NOW), false);
  });

  it('open Display Mode on a remote link, the list, or this device', () => {
    assert.deepEqual(initialDisplaySource(ID, false), { source: 'remote', id: ID });
    assert.equal(initialDisplaySource(null, true), null);
    assert.deepEqual(initialDisplaySource(null, false), { source: 'local' });
  });

  it('name a saved tournament', () => {
    const data = new Map();
    const storage = {
      get length() {
        return data.size;
      },
      key: i => [...data.keys()][i] ?? null,
      getItem: k => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: k => data.delete(k)
    };
    saveTournament(storage, state());
    assert.equal(savedTournamentName(storage, ID), 'Week 3');
    assert.equal(savedTournamentName(storage, ID2), '');
  });
});

describe('copyToClipboard', () => {
  it('writes through navigator.clipboard', async () => {
    const written = [];
    await copyToClipboard('ABCD', { clipboard: { writeText: async t => written.push(t) } });
    assert.deepEqual(written, ['ABCD']);
  });

  it('rejects on plain-http pages, which have no clipboard', async () => {
    await assert.rejects(copyToClipboard('ABCD', {}), /Clipboard unavailable/);
  });

  it('defaults to the global navigator', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    try {
      await assert.rejects(copyToClipboard('ABCD'), /Clipboard unavailable/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete globalThis.navigator;
    }
  });
});
