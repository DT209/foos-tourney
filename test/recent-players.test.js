const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, player } = require('./helpers');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
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
  }
};

// Saves a tournament started on `day` (October 2026) with the given player names.
function save(storage, id, day, names, tournamentName = `Week ${day}`) {
  L.saveTournament(storage, {
    ...L.newTournamentState(id, new Date(2026, 9, day, 19, 0)),
    tournamentName,
    players: names.map((name, i) => player(i + 1, name))
  });
}

describe('recentTournamentPlayers', () => {
  it('collects players from the 3 most recently started tournaments, excluding the current one', () => {
    const storage = memoryStorage();
    save(storage, 'oldest', 1, ['TooOld']);
    save(storage, 'w2', 8, ['Cy', 'ann']);
    save(storage, 'w3', 15, ['Bo', 'Ann']);
    save(storage, 'w4', 22, ['Ann', 'Dee']);
    save(storage, 'current', 29, ['Zed']);
    assert.deepEqual(L.recentTournamentPlayers(storage, 'current'), [
      { name: 'Ann', lastPlayed: new Date(2026, 9, 22, 19, 0).toISOString(), tournamentName: 'Week 22' },
      { name: 'Dee', lastPlayed: new Date(2026, 9, 22, 19, 0).toISOString(), tournamentName: 'Week 22' },
      { name: 'Bo', lastPlayed: new Date(2026, 9, 15, 19, 0).toISOString(), tournamentName: 'Week 15' },
      { name: 'Cy', lastPlayed: new Date(2026, 9, 8, 19, 0).toISOString(), tournamentName: 'Week 8' }
    ]);
  });

  it('uses start time, not save order, to pick the previous tournaments', () => {
    const storage = memoryStorage();
    save(storage, 'recent', 20, ['New']);
    save(storage, 'a', 1, ['A']);
    save(storage, 'b', 2, ['B']);
    save(storage, 'c', 3, ['C']); // saved last but started earliest of the four
    assert.deepEqual(
      L.recentTournamentPlayers(storage, 'none').map(p => p.name),
      ['New', 'C', 'B']
    );
  });

  it('takes a custom count, and ignores blank names and corrupt records', () => {
    const storage = memoryStorage({ [`${L.TOURNAMENT_KEY_PREFIX}broken`]: '{nope' });
    save(storage, 'w1', 1, ['  ', 'Ann']);
    save(storage, 'w2', 2, ['Bo']);
    assert.deepEqual(
      L.recentTournamentPlayers(storage, 'none', 1).map(p => p.name),
      ['Bo']
    );
    assert.deepEqual(
      L.recentTournamentPlayers(storage, 'none').map(p => p.name),
      ['Bo', 'Ann']
    );
  });

  it('is empty without storage or saved tournaments', () => {
    assert.deepEqual(L.recentTournamentPlayers(memoryStorage(), 'x'), []);
    assert.deepEqual(L.recentTournamentPlayers(null, 'x'), []);
    assert.deepEqual(L.recentTournamentPlayers(throwingStorage, 'x'), []);
  });
});

describe('withRecentPlayers', () => {
  const leaderboard = [{ name: 'Ann', singlesElo: null, doublesElo: 1100 }];
  const recent = [
    { name: 'ann', lastPlayed: '2026-10-22T01:00:00.000Z', tournamentName: 'W' },
    { name: 'Guesty', lastPlayed: '2026-10-15T01:00:00.000Z', tournamentName: 'V' }
  ];

  it('appends recent players who are not on the leaderboard (case-insensitive), flagged as recent', () => {
    assert.deepEqual(L.withRecentPlayers(leaderboard, recent), [
      leaderboard[0],
      {
        name: 'Guesty',
        singlesElo: null,
        doublesElo: null,
        recent: true,
        lastPlayed: '2026-10-15T01:00:00.000Z',
        tournamentName: 'V'
      }
    ]);
  });

  it('returns the leaderboard unchanged when there are no recent players', () => {
    assert.deepEqual(L.withRecentPlayers(leaderboard, []), leaderboard);
  });

  it('recent players show up in suggestions, the picker, and skip the guest prompt', () => {
    const known = L.withRecentPlayers(leaderboard, recent);
    assert.deepEqual(
      L.getPlayerSuggestions(known, 'gue').map(p => p.name),
      ['Guesty']
    );
    assert.deepEqual(L.checkNewPlayerName('Guesty', [], known), { name: 'Guesty', onLeaderboard: true });
    const view = L.getLeaderboardPickerView([], known, []);
    assert.deepEqual(
      view.rows.filter(r => r.player.recent).map(r => r.player.name),
      ['Guesty']
    );
  });
});
