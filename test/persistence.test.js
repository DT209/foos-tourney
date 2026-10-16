const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { L, player, teams } = require('./helpers');

// In-memory stand-in for window.localStorage, including key()/length.
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}

const throwingStorage = {
  get length() {
    throw new Error('SecurityError');
  },
  key() {
    throw new Error('SecurityError');
  },
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  }
};

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-17T01:30:00Z');
const opts = { id: ID, now: NOW };

function sampleState(overrides = {}) {
  return {
    ...L.newTournamentState(ID, new Date('2026-10-16T23:00:00Z')),
    tournamentName: 'Friday Open',
    players: [player(1, 'Ann'), player(2, 'Bo')],
    matches: [{ id: 5, status: 'DONE', team1: [player(1, 'Ann')], team2: [player(2, 'Bo')], games: [], winner: 1 }],
    bracketData: L.generateBracketStructure(teams(4), 'double', 3),
    bracketTeamCount: '6',
    isLocked: true,
    adminPin: '4321',
    ...overrides
  };
}

const recordKey = id => `${L.TOURNAMENT_KEY_PREFIX}${id}`;

describe('createTournamentId', () => {
  it('uses the injected UUID generator', () => {
    assert.equal(
      L.createTournamentId(() => ID),
      ID
    );
  });

  it('defaults to crypto.randomUUID', () => {
    assert.match(L.createTournamentId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('newTournamentState / restoreTournamentState', () => {
  it('a new tournament has an id, a start timestamp and defaults', () => {
    assert.deepEqual(L.newTournamentState(ID, NOW), {
      tournamentId: ID,
      startedAt: '2026-10-17T01:30:00.000Z',
      tournamentName: 'Thursday DYP',
      tableCount: 2,
      format: '2v2',
      maxGames: 3,
      activeTab: 'pool',
      players: [],
      matches: [],
      bracketData: null,
      bracketTeamCount: 4,
      bracketElimType: 'single',
      bracketMaxGames: 3,
      teamFormationStrategy: 'fair',
      seedingStrategy: 'ranking',
      customTeams: [],
      isLocked: false,
      adminPin: null
    });
  });

  it('restoring nothing starts a new tournament', () => {
    assert.deepEqual(L.restoreTournamentState(null, opts), L.newTournamentState(ID, NOW));
  });

  it('keeps every valid saved field, including the saved id and start time', () => {
    const saved = sampleState({ tournamentId: ID2 });
    assert.deepEqual(L.restoreTournamentState(saved, opts), saved);
  });

  it('falls back per field when a saved value has the wrong type', () => {
    const restored = L.restoreTournamentState(
      {
        tournamentId: '',
        startedAt: 'not a date',
        tournamentName: 7,
        tableCount: '3',
        players: {},
        matches: null,
        bracketData: 'nope',
        bracketTeamCount: null,
        isLocked: 'yes',
        adminPin: 1234,
        unknownField: 'ignored'
      },
      opts
    );
    assert.deepEqual(restored, L.newTournamentState(ID, NOW));
  });

  it('rejects a non-string id or start time', () => {
    const restored = L.restoreTournamentState({ tournamentId: 42, startedAt: 0 }, opts);
    assert.deepEqual([restored.tournamentId, restored.startedAt], [ID, NOW.toISOString()]);
  });

  it('falls back to defaults for malformed nested data in a saved tournament', () => {
    const restored = L.restoreTournamentState(
      {
        players: [null, { id: 1 }],
        matches: [{ id: 1 }],
        bracketData: { type: 'single' },
        tableCount: 1e9,
        maxGames: 4,
        customTeams: [null]
      },
      opts
    );
    assert.deepEqual(restored, L.newTournamentState(ID, NOW));
  });

  it('a saved tournament that is locked without a PIN loads unlocked', () => {
    assert.equal(L.restoreTournamentState({ isLocked: true, adminPin: null }, opts).isLocked, false);
    assert.equal(L.restoreTournamentState({ isLocked: true }, opts).isLocked, false);
    assert.equal(L.restoreTournamentState({ isLocked: true, adminPin: '2468' }, opts).isLocked, true);
  });

  it('accepts a numeric team count and an empty bracket', () => {
    const restored = L.restoreTournamentState({ bracketTeamCount: 8, bracketData: null }, opts);
    assert.equal(restored.bracketTeamCount, 8);
    assert.equal(restored.bracketData, null);
  });
});

describe('localIsoDate / tournamentDate', () => {
  it('uses the local calendar date, not UTC', () => {
    assert.equal(L.localIsoDate(new Date(2026, 9, 16, 23, 59)), '2026-10-16');
    assert.equal(L.localIsoDate(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
    assert.match(L.localIsoDate(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("a tournament's date is the local day it started, even after midnight", () => {
    const startedAt = new Date(2026, 9, 16, 19, 0).toISOString();
    assert.equal(L.tournamentDate(startedAt), '2026-10-16');
  });
});

describe('saveTournament / loadTournament', () => {
  it('stores each tournament under its own UUID key and marks it current', () => {
    const storage = memoryStorage();
    assert.equal(L.saveTournament(storage, sampleState(), NOW), true);
    assert.equal(L.saveTournament(storage, sampleState({ tournamentId: ID2, tournamentName: 'Other' }), NOW), true);
    const record = JSON.parse(storage.getItem(recordKey(ID)));
    assert.equal(record.version, 2);
    assert.equal(record.savedAt, NOW.toISOString());
    assert.equal(storage.getItem(L.CURRENT_TOURNAMENT_KEY), ID2);
    assert.equal(L.loadTournament(storage, ID).tournamentName, 'Friday Open');
    assert.equal(L.loadTournament(storage, ID2).tournamentName, 'Other');
  });

  it('round-trips the persisted fields only', () => {
    const storage = memoryStorage();
    const state = sampleState();
    L.saveTournament(storage, { ...state, showPinModal: true });
    assert.deepEqual(L.loadTournament(storage, ID), JSON.parse(JSON.stringify(state)));
  });

  it('a restored bracket can still be played after a reload', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, sampleState());
    const { bracketData } = L.loadTournament(storage, ID);
    bracketData.winnersRounds[0][0].games = [{ t1: 5, t2: 0 }];
    const result = L.confirmBracketMatch(bracketData, 'winners', 0, 0);
    assert.equal(result.bracket.winnersRounds[1][0].team1.name, 'T1');
    assert.equal(result.bracket.losersRounds[0][0].team1.name, 'T4');
  });

  it('loads null for a missing id, corrupt JSON, another version, or a non-object state', () => {
    const at = value => memoryStorage({ [recordKey(ID)]: value });
    assert.equal(L.loadTournament(memoryStorage(), ID), null);
    assert.equal(L.loadTournament(at('{not json'), ID), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 1, state: {} })), ID), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 2, state: null })), ID), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 2, state: [] })), ID), null);
    assert.equal(L.loadTournament(at('null'), ID), null);
  });

  it('never throws when storage is unavailable or full', () => {
    assert.equal(L.saveTournament(throwingStorage, sampleState()), false);
    assert.equal(L.loadTournament(throwingStorage, ID), null);
    assert.equal(L.saveTournament(null, sampleState()), false);
    assert.equal(L.loadTournament(undefined, ID), null);
  });
});

describe('loadCurrentTournament', () => {
  const newId = () => ID2;

  it('loads the tournament the current pointer names', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, sampleState());
    assert.equal(L.loadCurrentTournament(storage, { newId }).tournamentId, ID);
  });

  it('returns null with no pointer, or a pointer to a missing record', () => {
    assert.equal(L.loadCurrentTournament(memoryStorage(), { newId }), null);
    assert.equal(L.loadCurrentTournament(memoryStorage({ [L.CURRENT_TOURNAMENT_KEY]: ID }), { newId }), null);
  });

  it('migrates a v1 single-slot save into a UUID record and removes the old key', () => {
    const legacyState = { tournamentName: 'Legacy', startDate: '2026-10-09', players: [player(1, 'Ann')] };
    const storage = memoryStorage({
      [L.LEGACY_STORAGE_KEY]: JSON.stringify({ version: 1, state: legacyState })
    });
    const migrated = L.loadCurrentTournament(storage, { newId });
    assert.equal(migrated.tournamentId, ID2);
    assert.equal(migrated.tournamentName, 'Legacy');
    assert.equal(L.tournamentDate(migrated.startedAt), '2026-10-09');
    assert.equal('startDate' in migrated, false);
    assert.equal(storage.getItem(L.LEGACY_STORAGE_KEY), null);
    assert.equal(storage.getItem(L.CURRENT_TOURNAMENT_KEY), ID2);
    assert.equal(L.loadTournament(storage, ID2).players[0].name, 'Ann');
  });

  it('migrates a v1 save without a valid start date using the current time', () => {
    const storage = memoryStorage({
      [L.LEGACY_STORAGE_KEY]: JSON.stringify({ version: 1, state: { tournamentName: 'Old', startDate: 5 } })
    });
    const migrated = L.loadCurrentTournament(storage, { newId, now: NOW });
    assert.equal(migrated.startedAt, NOW.toISOString());
  });

  it('ignores an unreadable v1 save', () => {
    const storage = memoryStorage({ [L.LEGACY_STORAGE_KEY]: '{oops' });
    assert.equal(L.loadCurrentTournament(storage, { newId }), null);
    const wrongVersion = memoryStorage({ [L.LEGACY_STORAGE_KEY]: JSON.stringify({ version: 7, state: {} }) });
    assert.equal(L.loadCurrentTournament(wrongVersion, { newId }), null);
  });

  it('defaults to a random id and the current time, and never throws', () => {
    const storage = memoryStorage({
      [L.LEGACY_STORAGE_KEY]: JSON.stringify({ version: 1, state: { startDate: '2026-10-09' } })
    });
    assert.match(L.loadCurrentTournament(storage).tournamentId, /^[0-9a-f-]{36}$/);
    assert.equal(L.loadCurrentTournament(throwingStorage), null);
    assert.equal(L.loadCurrentTournament(null), null);
  });
});

describe('listTournaments', () => {
  it('summarizes saved tournaments, most recently saved first, skipping other and corrupt keys', () => {
    const storage = memoryStorage({ unrelated: 'x', [recordKey('broken')]: '{nope' });
    L.saveTournament(storage, sampleState(), new Date('2026-10-17T02:00:00Z'));
    L.saveTournament(
      storage,
      sampleState({ tournamentId: ID2, tournamentName: 'Older', players: [], matches: [], bracketData: null }),
      new Date('2026-10-10T02:00:00Z')
    );
    assert.deepEqual(L.listTournaments(storage), [
      {
        id: ID,
        name: 'Friday Open',
        startedAt: '2026-10-16T23:00:00.000Z',
        savedAt: '2026-10-17T02:00:00.000Z',
        playerCount: 2,
        matchCount: 1,
        bracketType: 'double'
      },
      {
        id: ID2,
        name: 'Older',
        startedAt: '2026-10-16T23:00:00.000Z',
        savedAt: '2026-10-10T02:00:00.000Z',
        playerCount: 0,
        matchCount: 0,
        bracketType: null
      }
    ]);
  });

  it('is empty when storage is unavailable', () => {
    assert.deepEqual(L.listTournaments(throwingStorage), []);
    assert.deepEqual(L.listTournaments(null), []);
  });
});

describe('deleteTournament', () => {
  it('removes one tournament and clears the pointer if it was current', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, sampleState());
    L.saveTournament(storage, sampleState({ tournamentId: ID2 }));
    assert.equal(L.deleteTournament(storage, ID), true);
    assert.equal(L.loadTournament(storage, ID), null);
    assert.equal(storage.getItem(L.CURRENT_TOURNAMENT_KEY), ID2);
    assert.equal(L.deleteTournament(storage, ID2), true);
    assert.equal(storage.getItem(L.CURRENT_TOURNAMENT_KEY), null);
  });

  it('never throws', () => {
    assert.equal(L.deleteTournament(throwingStorage, ID), false);
    assert.equal(L.deleteTournament(null, ID), false);
  });
});

describe('getBrowserStorage', () => {
  const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (realLocalStorage) Object.defineProperty(globalThis, 'localStorage', realLocalStorage);
    else delete globalThis.localStorage;
  });

  it('returns window.localStorage when available', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    assert.equal(L.getBrowserStorage(), storage);
  });

  it('returns null when accessing localStorage throws (e.g. blocked site data)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
      configurable: true
    });
    assert.equal(L.getBrowserStorage(), null);
  });

  it('returns null when localStorage does not exist', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    assert.equal(L.getBrowserStorage(), null);
  });
});
