const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, seq, zero, player, players } = require('./helpers');

const match = (status, team1, team2) => ({ status, team1, team2 });

describe('buildHistoryMatrices / getPairCount', () => {
  it('counts partners and opponents from DONE and LIVE matches only', () => {
    const [a, b, c, d] = players(4);
    const { partnerHistory, opponentHistory } = L.buildHistoryMatrices([
      match('DONE', [a, b], [c, d]),
      match('LIVE', [b, a], [c]),
      match('PENDING', [a, b], [c, d]),
      null,
      { status: 'DONE' }
    ]);
    assert.equal(L.getPairCount(partnerHistory, 1, 2), 2);
    assert.equal(L.getPairCount(partnerHistory, 2, 1), 2);
    assert.equal(L.getPairCount(partnerHistory, 3, 4), 1);
    assert.equal(L.getPairCount(opponentHistory, 1, 3), 2);
    assert.equal(L.getPairCount(opponentHistory, 4, 2), 1);
    assert.equal(L.getPairCount(opponentHistory, 1, 2), 0);
  });
});

describe('drawFairMatch', () => {
  it('rejects non-array input', () => {
    assert.match(L.drawFairMatch(null, []).error, /must be arrays/);
    assert.match(L.drawFairMatch([], 'x').error, /must be arrays/);
  });

  it('requires 4 free active players for 2v2 and 2 for 1v1', () => {
    assert.equal(L.drawFairMatch(players(3), []).error, 'Not enough available players. Found 3, need at least 4.');
    assert.equal(L.drawFairMatch(players(1), [], '1v1').error, 'Not enough available players. Found 1, need at least 2.');
  });

  it('ignores invalid, paused and busy players; accepts legacy isActive', () => {
    assert.match(L.drawFairMatch([null, { name: 'no id' }], [], '1v1').error, /Found 0/);
    const roster = [
      player(1, 'Paused', { active: false }),
      { id: 2, name: 'Legacy', isActive: true },
      player(3, 'Busy'),
      player(4)
    ];
    // Busy-set building tolerates malformed LIVE entries (checked before
    // history is built, which expects well-formed teams).
    const messy = [match('LIVE', [player(3), null, { name: 'x' }], undefined), match('LIVE', undefined, []), null];
    assert.match(L.drawFairMatch(roster.slice(0, 3), messy, '1v1').error, /Found 1/);
    const live = [match('LIVE', [player(3)], [])];
    const result = L.drawFairMatch(roster, live, '1v1', zero);
    assert.deepEqual([result.team1[0].id, result.team2[0].id], [2, 4]);
  });

  it('1v1: prefers an opponent not yet faced', () => {
    const [a, b, c] = players(3);
    const history = [match('DONE', [a], [b])];
    // random=0 everywhere: p1 is the first player (a); b is a repeat opponent.
    const result = L.drawFairMatch([a, b, c], history, '1v1', zero);
    assert.deepEqual([result.team1, result.team2].map(t => t[0].id), [1, 3]);
  });

  it('prioritises players who have missed the most draws', () => {
    const roster = [player(1), player(2), player(3, 'Unlucky', { eligibleDrawsMissed: 2 })];
    const result = L.drawFairMatch(roster, [], '1v1', zero);
    assert.equal(result.team1[0].id, 3);
  });

  it('random noise breaks ties', () => {
    // First player's noise is high (49), second's is 0 -> second becomes p1.
    const result = L.drawFairMatch(players(2), [], '1v1', seq(0.99, 0, 0));
    assert.equal(result.team1[0].id, 2);
  });

  it('2v2: avoids repeat teammates and opponents', () => {
    const roster = players(6);
    const [a, b, c, d, e, f] = roster;
    const history = [
      match('DONE', [a, b], [c, d]),
      match('DONE', [a, e], [f, c])
    ];
    const result = L.drawFairMatch(roster, history, '2v2', zero);
    // p1 = a. Teammate: c, d, f are fresh partners; c first. Then opponents of
    // a & c: b (a faced? no; c faced b) ... the cheapest remaining pairings.
    const ids = [...result.team1, ...result.team2].map(p => p.id);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4);
    assert.equal(result.team1[0].id, 1);
    assert.notEqual(result.team1[1].id, 2);
    assert.notEqual(result.team1[1].id, 5);
  });

  it('updates draw-missed counters: drawn reset, idle eligible +1, others unchanged', () => {
    const roster = [
      player(1, 'A', { eligibleDrawsMissed: 3 }),
      player(2), player(3), player(4),
      player(5, 'Idle'),
      { id: 6, name: 'NoCounter', active: true },
      player(7, 'Paused', { active: false }),
      player(8, 'Busy')
    ];
    const live = [match('LIVE', [player(8)], [])];
    const result = L.drawFairMatch(roster, live, '2v2', zero);
    const byId = Object.fromEntries(result.updatedPlayers.map(p => [p.id, p]));
    const drawn = [...result.team1, ...result.team2].map(p => p.id);
    drawn.forEach(id => assert.equal(byId[id].eligibleDrawsMissed, 0));
    roster.filter(p => p.active && p.id !== 8 && !drawn.includes(p.id))
      .forEach(p => assert.equal(byId[p.id].eligibleDrawsMissed, (p.eligibleDrawsMissed || 0) + 1));
    assert.equal(byId[7], roster[6]);
    assert.equal(byId[8], roster[7]);
  });

  it('defaults to 2v2 and Math.random', () => {
    const result = L.drawFairMatch(players(4), []);
    assert.equal(result.team1.length, 2);
    assert.equal(result.team2.length, 2);
  });
});
