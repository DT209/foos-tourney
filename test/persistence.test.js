const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { L, player, teams } = require('./helpers');

// In-memory stand-in for window.localStorage.
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}

const throwingStorage = {
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

const TODAY = '2026-10-16';

function sampleState() {
  return {
    ...L.restoreTournamentState(null, TODAY),
    tournamentName: 'Friday Open',
    players: [player(1, 'Ann'), player(2, 'Bo')],
    matches: [{ id: 5, status: 'DONE', team1: [player(1, 'Ann')], team2: [player(2, 'Bo')], games: [], winner: 1 }],
    bracketData: L.generateBracketStructure(teams(4), 'double', 3),
    bracketTeamCount: '6',
    isLocked: true,
    adminPin: '4321'
  };
}

describe('restoreTournamentState', () => {
  it('returns defaults when nothing was saved', () => {
    assert.deepEqual(L.restoreTournamentState(null, TODAY), {
      tournamentName: 'Thursday DYP',
      startDate: TODAY,
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

  it('keeps valid saved fields, including a numeric-string team count and a set PIN', () => {
    const saved = sampleState();
    assert.deepEqual(L.restoreTournamentState(saved, '2030-01-01'), saved);
  });

  it('falls back per field when a saved value has the wrong type', () => {
    const restored = L.restoreTournamentState(
      {
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
      TODAY
    );
    assert.deepEqual(restored, L.restoreTournamentState(null, TODAY));
  });

  it('accepts a numeric team count and an empty bracket', () => {
    const restored = L.restoreTournamentState({ bracketTeamCount: 8, bracketData: null }, TODAY);
    assert.equal(restored.bracketTeamCount, 8);
    assert.equal(restored.bracketData, null);
  });
});

describe('saveTournament / loadTournament', () => {
  it('round-trips state through storage under a versioned key', () => {
    const storage = memoryStorage();
    const state = sampleState();
    assert.equal(L.saveTournament(storage, state), true);
    const raw = JSON.parse(storage.getItem(L.STORAGE_KEY));
    assert.equal(raw.version, 1);
    assert.deepEqual(L.loadTournament(storage), JSON.parse(JSON.stringify(state)));
  });

  it('a restored bracket can still be played after a reload', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, sampleState());
    const { bracketData } = L.loadTournament(storage);
    bracketData.winnersRounds[0][0].games = [{ t1: 5, t2: 0 }];
    const result = L.confirmBracketMatch(bracketData, 'winners', 0, 0);
    assert.equal(result.bracket.winnersRounds[1][0].team1.name, 'T1');
    assert.equal(result.bracket.losersRounds[0][0].team1.name, 'T4');
  });

  it('only saves the persisted fields', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, { ...sampleState(), showPinModal: true, pinInput: '99' });
    const saved = L.loadTournament(storage);
    assert.equal('showPinModal' in saved, false);
    assert.equal('pinInput' in saved, false);
  });

  it('loads null when nothing is stored', () => {
    assert.equal(L.loadTournament(memoryStorage()), null);
  });

  it('loads null for corrupt JSON, another version, or a non-object payload', () => {
    const at = value => memoryStorage({ [L.STORAGE_KEY]: value });
    assert.equal(L.loadTournament(at('{not json')), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 2, state: {} }))), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 1, state: null }))), null);
    assert.equal(L.loadTournament(at(JSON.stringify({ version: 1, state: [] }))), null);
    assert.equal(L.loadTournament(at('null')), null);
  });

  it('never throws when storage is unavailable or full', () => {
    assert.equal(L.saveTournament(throwingStorage, sampleState()), false);
    assert.equal(L.loadTournament(throwingStorage), null);
    assert.equal(L.saveTournament(null, sampleState()), false);
    assert.equal(L.loadTournament(undefined), null);
  });
});

describe('clearTournament', () => {
  it('removes the saved state', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, sampleState());
    assert.equal(L.clearTournament(storage), true);
    assert.equal(L.loadTournament(storage), null);
  });

  it('never throws', () => {
    assert.equal(L.clearTournament(throwingStorage), false);
    assert.equal(L.clearTournament(null), false);
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
