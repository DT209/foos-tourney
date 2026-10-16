const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, player } = require('./helpers');

const lb = [{ name: 'Ann', singlesElo: null, doublesElo: 1000 }, { name: 'Annabel' }, { name: 'bob' }];

describe('createPlayer / addPlayer', () => {
  it('creates an active, unpaid player with zeroed stats', () => {
    assert.deepEqual(L.createPlayer(7, 'Ann'), {
      id: 7,
      name: 'Ann',
      paid: false,
      active: true,
      wins: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      eligibleDrawsMissed: 0
    });
  });

  it('appends without mutating', () => {
    const before = [player(1)];
    const after = L.addPlayer(before, 2, 'Bo');
    assert.equal(before.length, 1);
    assert.deepEqual(
      after.map(p => p.name),
      ['P1', 'Bo']
    );
  });
});

describe('checkNewPlayerName', () => {
  it('rejects blank names after sanitizing', () => {
    assert.deepEqual(L.checkNewPlayerName('  <> ', [], lb), { error: 'Please enter a valid player name.' });
  });

  it('rejects case-insensitive duplicates', () => {
    assert.deepEqual(L.checkNewPlayerName('ann', [player(1, ' Ann ')], lb), {
      error: 'A player named "ann" already exists in the roster.'
    });
  });

  it('flags whether the name is an exact leaderboard match', () => {
    assert.deepEqual(L.checkNewPlayerName(' Ann ', [], lb), { name: 'Ann', onLeaderboard: true });
    assert.deepEqual(L.checkNewPlayerName('Guest', [], lb), { name: 'Guest', onLeaderboard: false });
  });

  it('truncates to 25 characters', () => {
    assert.equal(L.checkNewPlayerName('x'.repeat(30), [], lb).name.length, 25);
  });
});

describe('addPlayersByName', () => {
  it('skips names already on the roster and assigns sequential ids', () => {
    const result = L.addPlayersByName([player(1, 'Ann')], ['ann ', 'Bo', 'Cy'], 100);
    assert.deepEqual(
      result.map(p => [p.id, p.name]),
      [
        [1, 'Ann'],
        [100, 'Bo'],
        [101, 'Cy']
      ]
    );
  });
});

describe('player edits', () => {
  const roster = [player(1, 'Ann'), player(2, 'Bo')];

  it('toggles a boolean flag on one player', () => {
    const paid = L.togglePlayerFlag(roster, 2, 'paid');
    assert.equal(paid[1].paid, true);
    assert.equal(paid[0], roster[0]);
    assert.equal(L.togglePlayerFlag(roster, 1, 'active')[0].active, false);
  });

  it('renames with sanitizing, or leaves the roster alone when blank', () => {
    assert.equal(L.renamePlayer(roster, 1, ' <Al> ').players[0].name, 'Al');
    assert.equal(L.renamePlayer(roster, 1, ' ').players[0].name, 'Ann');
    assert.equal(L.renamePlayer(roster, 1, '').players, roster);
  });

  it('rename refuses a name another player already has (case-insensitive)', () => {
    assert.deepEqual(L.renamePlayer(roster, 1, ' bo '), {
      error: 'A player named "bo" already exists in the roster.'
    });
    assert.equal(L.renamePlayer(roster, 1, 'ANN').players[0].name, 'ANN', 'changing your own case is fine');
  });

  it('removes by id', () => {
    assert.deepEqual(
      L.removePlayer(roster, 1).map(p => p.id),
      [2]
    );
  });

  it('resets stats but keeps identity and flags', () => {
    const played = [{ ...player(1), wins: 3, losses: 1, gf: 20, ga: 9, eligibleDrawsMissed: 2, paid: true }];
    assert.deepEqual(L.resetPlayerStats(played)[0], { ...player(1), paid: true });
  });

  it('counts active and detects paused players', () => {
    const mixed = [player(1), player(2, 'B', { active: false })];
    assert.equal(L.countActivePlayers(mixed), 1);
    assert.equal(L.hasPausedPlayers(mixed), true);
    assert.equal(L.hasPausedPlayers([player(1)]), false);
  });
});

describe('computeStandings', () => {
  it('derives totals and sorts by win %, then average differential', () => {
    const roster = [
      player(1, 'Idle'),
      { ...player(2, 'Half'), wins: 1, losses: 1, gf: 10, ga: 10 },
      { ...player(3, 'HalfPlus'), wins: 1, losses: 1, gf: 14, ga: 10 },
      { ...player(4, 'Top'), wins: 2, losses: 0, gf: 10, ga: 0 }
    ];
    const s = L.computeStandings(roster);
    assert.deepEqual(
      s.map(p => p.name),
      ['Top', 'HalfPlus', 'Half', 'Idle']
    );
    assert.deepEqual([s[1].totalGames, s[1].winPct, s[1].diff, s[1].avgDiff], [2, '50.0', 4, '2.0']);
    assert.deepEqual([s[3].winPct, s[3].avgDiff, s[3].totalGames], ['0.0', '0.0', 0]);
  });
});

describe('leaderboard picker', () => {
  it('toggles names in and out of the selection', () => {
    assert.deepEqual(L.togglePickerSelection(['A'], 'B'), ['A', 'B']);
    assert.deepEqual(L.togglePickerSelection(['A', 'B'], 'A'), ['B']);
  });

  it('sorts the leaderboard and marks roster members as already added', () => {
    const view = L.getLeaderboardPickerView([player(1, ' ANN ')], lb, ['bob']);
    assert.deepEqual(
      view.rows.map(r => [r.player.name, r.alreadyAdded, r.checked]),
      [
        ['Ann', true, true],
        ['Annabel', false, false],
        ['bob', false, true]
      ]
    );
    assert.deepEqual(
      view.available.map(p => p.name),
      ['Annabel', 'bob']
    );
    assert.equal(view.allSelected, false);
    assert.deepEqual(L.toggleSelectAll(view), ['Annabel', 'bob']);
  });

  it('reports all selected, and Select All then clears', () => {
    const view = L.getLeaderboardPickerView([], lb, ['Ann', 'Annabel', 'bob']);
    assert.equal(view.allSelected, true);
    assert.deepEqual(L.toggleSelectAll(view), []);
  });

  it('is never "all selected" when nothing is available', () => {
    const view = L.getLeaderboardPickerView([player(1, 'Ann')], [{ name: 'Ann' }], []);
    assert.equal(view.allSelected, false);
  });
});

describe('getPlayerSuggestions', () => {
  it('returns nothing for a blank query', () => {
    assert.deepEqual(L.getPlayerSuggestions(lb, '   '), []);
  });

  it('matches case-insensitive substrings, capped at the limit', () => {
    assert.deepEqual(
      L.getPlayerSuggestions(lb, ' AN ').map(p => p.name),
      ['Ann', 'Annabel']
    );
    assert.deepEqual(
      L.getPlayerSuggestions(lb, 'an', 1).map(p => p.name),
      ['Ann']
    );
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `X${i}` }));
    assert.equal(L.getPlayerSuggestions(many, 'x').length, 8);
  });
});
