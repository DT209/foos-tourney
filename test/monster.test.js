const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, zero, player, players } = require('./helpers');

describe('createGameSlots', () => {
  it('creates independent blank games', () => {
    const slots = L.createGameSlots(3);
    assert.deepEqual(slots, [
      { t1: '', t2: '' },
      { t1: '', t2: '' },
      { t1: '', t2: '' }
    ]);
    assert.notEqual(slots[0], slots[1]);
  });
});

describe('findFreeTable / findLiveMatchAtTable', () => {
  const matches = [
    { id: 1, table: 1, status: 'LIVE' },
    { id: 2, table: 2, status: 'DONE' }
  ];

  it('returns the lowest table without a LIVE match', () => {
    assert.equal(L.findFreeTable(matches, 2), 2);
    assert.equal(L.findFreeTable([], 3), 1);
  });

  it('returns null when every table is busy', () => {
    assert.equal(L.findFreeTable(matches, 1), null);
  });

  it('finds the LIVE match on a table', () => {
    assert.equal(L.findLiveMatchAtTable(matches, 1).id, 1);
    assert.equal(L.findLiveMatchAtTable(matches, 2), undefined);
  });
});

describe('drawMonsterMatch', () => {
  const base = { players: players(4), matches: [], tableCount: 1, format: '2v2', maxGames: 3, id: 99, random: zero };

  it('errors when all tables are occupied', () => {
    const busy = [{ id: 1, table: 1, status: 'LIVE', team1: [], team2: [] }];
    assert.deepEqual(L.drawMonsterMatch({ ...base, matches: busy }), { error: 'All tables are currently occupied!' });
  });

  it('passes through matchmaking errors', () => {
    assert.match(L.drawMonsterMatch({ ...base, players: players(3) }).error, /Not enough available players/);
  });

  it('appends a LIVE match on the free table and updates players', () => {
    const result = L.drawMonsterMatch(base);
    assert.equal(result.matches.length, 1);
    const m = result.matches[0];
    assert.deepEqual(
      {
        id: m.id,
        table: m.table,
        type: m.type,
        status: m.status,
        isHandicap: m.isHandicap,
        overrideWinner: m.overrideWinner
      },
      { id: 99, table: 1, type: '2v2', status: 'LIVE', isHandicap: false, overrideWinner: null }
    );
    assert.equal(m.games.length, 3);
    assert.equal(m.team1.length + m.team2.length, 4);
    assert.equal(result.players.length, 4);
  });

  it('defaults to Math.random', () => {
    const { random: _random, ...noRandom } = base;
    assert.equal(L.drawMonsterMatch(noRandom).matches.length, 1);
  });
});

describe('monster match edits', () => {
  const m = {
    id: 1,
    games: [
      { t1: '', t2: '' },
      { t1: 1, t2: 2 }
    ],
    isHandicap: false,
    overrideWinner: null
  };
  const other = { id: 2, games: [] };
  const matches = [m, other];

  it('deletes by id', () => {
    assert.deepEqual(L.deleteMatch(matches, 1), [other]);
  });

  it('updates one game score immutably, sanitizing input', () => {
    const updated = L.updateMonsterGameScore(matches, 1, 0, 't2', '-4');
    assert.deepEqual(updated[0].games[0], { t1: '', t2: 0 });
    assert.equal(updated[0].games[1], m.games[1]);
    assert.equal(updated[1], other);
    assert.deepEqual(m.games[0], { t1: '', t2: '' });
    assert.equal(L.updateMonsterGameScore(matches, 1, 1, 't1', '')[0].games[1].t1, '');
  });

  it('handicap on defaults the winner to Team 1; off clears it', () => {
    assert.deepEqual(L.setMonsterHandicap(matches, 1, true)[0], { ...m, isHandicap: true, overrideWinner: 1 });
    assert.deepEqual(L.setMonsterHandicap(matches, 1, false)[0], { ...m, isHandicap: false, overrideWinner: null });
  });

  it('sets the override winner as a number', () => {
    assert.equal(L.setMonsterOverrideWinner(matches, 1, '2')[0].overrideWinner, 2);
    assert.equal(L.setMonsterOverrideWinner(matches, 1, '2')[1], other);
  });
});

describe('getMatchWinner', () => {
  const g = (t1, t2) => ({ t1, t2 });

  it('uses the handicap override when set', () => {
    assert.equal(L.getMatchWinner({ isHandicap: true, overrideWinner: 2, games: [] }), 2);
  });

  it('ignores a handicap with no override winner', () => {
    assert.equal(L.getMatchWinner({ isHandicap: true, overrideWinner: null, games: [g(5, 0)] }), 1);
  });

  it('needs a majority of games', () => {
    assert.equal(L.getMatchWinner({ games: [g(5, 3), g(5, 1), g('', '')] }), 1);
    assert.equal(L.getMatchWinner({ games: [g(1, 5), g('3', '5'), g('', '')] }), 2);
    assert.equal(L.getMatchWinner({ games: [g(5, 3), g(1, 5), g('', '')] }), null);
  });

  it('ignores ties and incomplete games', () => {
    assert.equal(L.getMatchWinner({ games: [g(4, 4)] }), null);
    assert.equal(L.getMatchWinner({ games: [g(5, '')] }), null);
  });
});

describe('completeMonsterMatch', () => {
  const [a, b, c, d, bystander] = players(5);
  const live = {
    id: 1,
    team1: [a, b],
    team2: [c, d],
    status: 'LIVE',
    isHandicap: false,
    games: [
      { t1: 5, t2: 3 },
      { t1: '5', t2: 4 },
      { t1: '', t2: '' }
    ]
  };
  const other = { id: 2, status: 'LIVE' };

  it('returns null for an unknown match', () => {
    assert.equal(L.completeMonsterMatch([a], [live], 404), null);
  });

  it('errors when no team has enough wins', () => {
    const undecided = {
      ...live,
      games: [
        { t1: 5, t2: 3 },
        { t1: '', t2: '' },
        { t1: '', t2: '' }
      ]
    };
    assert.deepEqual(L.completeMonsterMatch([a], [undecided], 1), {
      error: 'Cannot complete match: No team has secured enough game wins.'
    });
  });

  it('credits wins, losses and goals and marks the match DONE', () => {
    const result = L.completeMonsterMatch([a, b, c, d, bystander], [live, other], 1);
    const [pa, pb, pc, pd, pe] = result.players;
    assert.deepEqual([pa.wins, pa.losses, pa.gf, pa.ga], [1, 0, 10, 7]);
    assert.deepEqual([pb.wins, pb.losses], [1, 0]);
    assert.deepEqual([pc.wins, pc.losses, pc.gf, pc.ga], [0, 1, 7, 10]);
    assert.deepEqual([pd.wins, pd.losses], [0, 1]);
    assert.equal(pe, bystander);
    assert.deepEqual([result.matches[0].status, result.matches[0].winner], ['DONE', 1]);
    assert.equal(result.matches[1], other);
  });

  it('credits Team 2 when it wins (via handicap override)', () => {
    const forced = { ...live, isHandicap: true, overrideWinner: 2 };
    const result = L.completeMonsterMatch([a, c], [forced], 1);
    assert.deepEqual(
      result.players.map(p => p.wins),
      [0, 1]
    );
  });
});

describe('teamLabel', () => {
  it('joins player names', () => {
    assert.equal(L.teamLabel([player(1, 'A'), player(2, 'B')]), 'A & B');
  });
});
