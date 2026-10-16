const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, seq, zero, player, players, teams, BYE } = require('./helpers');

describe('getStandardBracketSeedPositions', () => {
  it('produces standard seed orderings', () => {
    assert.deepEqual(L.getStandardBracketSeedPositions(2), [1, 2]);
    assert.deepEqual(L.getStandardBracketSeedPositions(4), [1, 4, 2, 3]);
    assert.deepEqual(L.getStandardBracketSeedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('buildBracketTeams', () => {
  const ranked = players(8);
  const names = ts => ts.map(t => t.name);

  it('1v1 ranking seeding keeps Monster rank order', () => {
    const ts = L.buildBracketTeams(ranked, 3, '1v1', 'fair', 'ranking');
    assert.deepEqual(names(ts), ['P1', 'P2', 'P3']);
    assert.deepEqual(ts[0], { id: 'team-1', name: 'P1', players: [ranked[0]], monsterRank: 1, seedValue: Math.pow(2, 2 / 5) });
  });

  it('1v1 ELO seeding uses singles ELO, guests and unranked default to 1000', () => {
    const lb = [
      { name: 'P1', singlesElo: 900, doublesElo: 2000 },
      { name: 'P2', singlesElo: null },
      { name: 'P3', singlesElo: 1200 }
    ];
    const ts = L.buildBracketTeams(players(4), 4, '1v1', 'fair', 'elo', [], lb);
    assert.deepEqual(names(ts), ['P3', 'P2', 'P4', 'P1']);
    assert.deepEqual(ts.map(t => t.seedValue), [1200, 1000, 1000, 900]);
  });

  it('1v1 random seeding shuffles with the injected random', () => {
    const ts = L.buildBracketTeams(players(3), 3, '1v1', 'fair', 'random', [], [], seq(0.9, 0.1));
    assert.deepEqual(names(ts).sort(), ['P1', 'P2', 'P3']);
  });

  it('1v1 unknown seeding leaves rank order and missing seed is 0', () => {
    // Duplicate ids: the second P1 overwrites the seed map entry; both
    // still get a value. An id the map lacks falls back to 0.
    const ts = L.buildBracketTeams(players(2), 2, '1v1', 'fair', 'none');
    assert.deepEqual(names(ts), ['P1', 'P2']);
    const zeroSeed = L.buildBracketTeams([{ id: 1, name: 'Z' }], 1, '1v1', 'fair', 'elo', [], [{ name: 'Z', singlesElo: 0 }]);
    assert.equal(zeroSeed[0].seedValue, 0);
  });

  it('2v2 fair pairs 1st with last', () => {
    assert.deepEqual(names(L.buildBracketTeams(ranked, 4, '2v2', 'fair', 'ranking')), ['P1 & P8', 'P2 & P7', 'P3 & P6', 'P4 & P5']);
  });

  it('2v2 topBias pairs neighbours and drops an odd player', () => {
    assert.deepEqual(names(L.buildBracketTeams(ranked, 2, '2v2', 'topBias', 'ranking')), ['P1 & P2', 'P3 & P4']);
    assert.deepEqual(names(L.buildBracketTeams(players(3), 2, '2v2', 'topBias', 'ranking')), ['P1 & P2']);
  });

  it('2v2 topBottomRandom pairs each top-half player with a shuffled bottom-half one', () => {
    const ts = L.buildBracketTeams(ranked, 4, '2v2', 'topBottomRandom', 'none', [], [], zero);
    assert.deepEqual(ts.map(t => t.players[0].id), [1, 2, 3, 4]);
    assert.deepEqual(ts.map(t => t.players[1].id).sort(), [5, 6, 7, 8]);
    // Odd count: the top half is larger, so one top player goes unpaired.
    assert.equal(L.buildBracketTeams(players(3), 2, '2v2', 'topBottomRandom', 'none', [], [], zero).length, 1);
  });

  it('2v2 random pairs a shuffle and drops an odd player', () => {
    const ts = L.buildBracketTeams(ranked, 4, '2v2', 'random', 'none', [], [], seq(0.3, 0.8));
    assert.equal(ts.length, 4);
    assert.deepEqual(ts.flatMap(t => t.players.map(p => p.id)).sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(L.buildBracketTeams(players(3), 2, '2v2', 'random', 'none', [], [], zero).length, 1);
  });

  it('2v2 manual uses custom teams, tolerating empty slots', () => {
    const [a, b, c] = players(3);
    const ts = L.buildBracketTeams([a, b, c], 3, '2v2', 'manual', 'none', [
      { p1: a, p2: b }, { p1: c, p2: null }, { p1: null, p2: null }
    ]);
    assert.deepEqual(names(ts), ['P1 & P2', 'P3', 'TBD Team']);
    assert.deepEqual(ts.map(t => t.seedValue > 0), [true, true, false]);
  });

  it('2v2 manual players outside the qualified group seed at 0', () => {
    const outsider = player(50, 'Out');
    const ts = L.buildBracketTeams(players(2), 1, '2v2', 'manual', 'ranking', [{ p1: outsider, p2: outsider }]);
    assert.equal(ts[0].seedValue, 0);
  });

  it('unknown formation strategy yields no teams', () => {
    assert.deepEqual(L.buildBracketTeams(ranked, 4, '2v2', 'bogus', 'ranking'), []);
  });

  it('2v2 ELO team seed is 60% higher + 40% lower doubles ELO', () => {
    const lb = [{ name: 'P1', doublesElo: 1000 }, { name: 'P2', doublesElo: 1500 }, { name: 'P3', doublesElo: 1100 }, { name: 'P4', doublesElo: 1100 }];
    const ts = L.buildBracketTeams(players(4), 2, '2v2', 'topBias', 'elo', [], lb);
    assert.deepEqual(names(ts), ['P1 & P2', 'P3 & P4']);
    assert.equal(ts[0].seedValue, 0.6 * 1500 + 0.4 * 1000);
    // A single-player manual team in ELO mode sums instead.
    const solo = L.buildBracketTeams(players(4), 1, '2v2', 'manual', 'elo', [{ p1: player(1), p2: null }], lb);
    assert.equal(solo[0].seedValue, 1000);
  });

  it('2v2 random seeding shuffles teams; returned ids follow final order', () => {
    const ts = L.buildBracketTeams(ranked, 4, '2v2', 'fair', 'random', [], [], seq(0.9, 0.1, 0.5));
    assert.deepEqual(ts.map(t => t.id), ['team-1', 'team-2', 'team-3', 'team-4']);
    assert.equal(ts.length, 4);
  });

  it('defaults customTeams, leaderboard and random', () => {
    assert.equal(L.buildBracketTeams(ranked, 4, '2v2', 'fair', 'random').length, 4);
    assert.equal(L.buildBracketTeams(ranked, 4, '2v2', 'manual', 'ranking').length, 0);
  });
});

describe('manual team helpers', () => {
  const ranked = players(5);

  it('buildManualTeams pre-fills in rank order, null when short', () => {
    assert.deepEqual(L.buildManualTeams(ranked, 3, '2v2').map(t => [t.p1 && t.p1.id, t.p2 && t.p2.id]), [[1, 2], [3, 4], [5, null]]);
    assert.deepEqual(L.buildManualTeams(ranked, '6', '1v1').map(t => [t.p1 && t.p1.id, t.p2]), [[1, null], [2, null], [3, null], [4, null], [5, null], [null, null]]);
    assert.equal(L.buildManualTeams(ranked, 'abc', '2v2').length, 2);
    assert.deepEqual(L.buildManualTeams(ranked, 4, '2v2')[3], { p1: null, p2: null });
  });

  it('getManualTeamCandidates returns the top 2 x teamCount', () => {
    assert.equal(L.getManualTeamCandidates(players(10), '3').length, 6);
    assert.equal(L.getManualTeamCandidates(players(10), '').length, 4);
  });

  it('setManualTeamPlayer sets one slot immutably; blank clears it', () => {
    const tms = [{ p1: null, p2: null }, { p1: null, p2: null }];
    const updated = L.setManualTeamPlayer(tms, 1, 'p2', ranked, '3');
    assert.equal(updated[1].p2, ranked[2]);
    assert.equal(updated[0], tms[0]);
    assert.equal(tms[1].p2, null);
    assert.equal(L.setManualTeamPlayer(updated, 1, 'p2', ranked, '')[1].p2, undefined);
  });

  it('parseTeamCountInput', () => {
    assert.equal(L.parseTeamCountInput(''), null);
    assert.equal(L.parseTeamCountInput('x'), null);
    assert.equal(L.parseTeamCountInput('8'), 8);
  });
});

describe('generateBracketStructure', () => {
  const countRounds = rounds => rounds.map(r => r.length);

  it('single elimination, 8 teams: 2 winners rounds, final and 3rd place', () => {
    const b = L.generateBracketStructure(teams(8), 'single', 3);
    assert.deepEqual(countRounds(b.winnersRounds), [4, 2]);
    assert.equal(b.losersRounds, null);
    assert.equal(b.grandFinals[0].label, 'Grand Finals');
    assert.equal(b.thirdPlaceMatch.label, '3rd / 4th Place Match');
    assert.equal(b.winnersRounds[0][0].label, 'Match 1');
    assert.equal(b.winnersRounds[0][0].games.length, 3);
    assert.deepEqual(b.winnersRounds[0].map(m => [m.team1.name, m.team2.name]), [['T1', 'T8'], ['T4', 'T5'], ['T2', 'T7'], ['T3', 'T6']]);
    assert.ok(b.winnersRounds[0].every(m => m.status === 'READY'));
    assert.deepEqual({ type: b.type, maxGames: b.maxGames, isCompleted: b.isCompleted }, { type: 'single', maxGames: 3, isCompleted: false });
    assert.equal(b.originalTeams.length, 8);
  });

  it('single elimination with BYEs advances top seeds into round 2', () => {
    const b = L.generateBracketStructure(teams(6), 'single', 1);
    const r1 = b.winnersRounds[0];
    assert.deepEqual(r1.map(m => [m.status, m.winner]), [['DONE', 1], ['READY', null], ['DONE', 1], ['READY', null]]);
    assert.equal(b.winnersRounds[1][0].team1.name, 'T1');
    assert.equal(b.winnersRounds[1][1].team1.name, 'T2');
    assert.equal(b.winnersRounds[1][0].status, 'PENDING');
  });

  it('single elimination, 3 teams: the BYE winner goes straight to the final', () => {
    const b = L.generateBracketStructure(teams(3), 'single', 1);
    assert.deepEqual(countRounds(b.winnersRounds), [2]);
    assert.equal(b.grandFinals[0].team1.name, 'T1');
    assert.equal(b.grandFinals[0].status, 'PENDING');
  });

  it('a BYE in the team1 slot gives the win to team2, and two BYE winners make the next match READY', () => {
    // Hand-ordered teams so the BYE lands in slot 1 of a pairing.
    const ts = teams(5);
    const b = L.generateBracketStructure(ts, 'single', 1);
    // 5 teams in an 8 bracket: seeds 1-3 get BYEs; T2 and T3 meet in round 2.
    assert.equal(b.winnersRounds[1][1].team1.name, 'T2');
    assert.equal(b.winnersRounds[1][1].team2.name, 'T3');
    assert.equal(b.winnersRounds[1][1].status, 'READY');
    const flipped = [{ ...ts[0] }, ts[1]];
    // Seeding positions for size 2 are [1, 2]; put a BYE-shaped team first.
    flipped[0] = { id: 'b', name: 'BYE', isBye: true };
    const fb = L.generateBracketStructure(flipped, 'double', 1);
    assert.deepEqual([fb.winnersRounds[0][0].status, fb.winnersRounds[0][0].winner], ['DONE', 2]);
  });

  it('double elimination, 4 teams: losers rounds and a grand final', () => {
    const b = L.generateBracketStructure(teams(4), 'double', 3);
    assert.deepEqual(countRounds(b.winnersRounds), [2, 1]);
    assert.deepEqual(countRounds(b.losersRounds), [1, 1]);
    assert.equal(b.grandFinals[0].label, 'Grand Finals (Match 1)');
    assert.equal(b.thirdPlaceMatch, null);
    // Round 1 losers are unknown yet but their slots are marked as fed.
    const l1 = b.losersRounds[0][0];
    assert.deepEqual([l1.team1, l1.team2, l1.hasPropagatedT1, l1.hasPropagatedT2], [null, null, true, true]);
  });

  it('double elimination with BYEs drops BYEs into the losers bracket and auto-advances', () => {
    const b = L.generateBracketStructure(teams(6), 'double', 1);
    assert.deepEqual(countRounds(b.losersRounds), [2, 2, 1, 1]);
    // BYE losers of R1 matches 0 and 2 land in L1 slots; the opposing slot is
    // still unknown so nothing auto-advances yet.
    assert.equal(b.losersRounds[0][0].team1.isBye, true);
    assert.equal(b.losersRounds[0][0].team2, null);
    assert.equal(b.losersRounds[0][1].team1.isBye, true);
  });

  it('double elimination, 5 teams: BYE vs BYE in the losers bracket resolves automatically', () => {
    const b = L.generateBracketStructure(teams(5), 'double', 1);
    const l1 = b.losersRounds[0];
    // R1 matches 2 and 3 are both BYE wins, so L1 match 1 is BYE vs BYE;
    // its BYE "winner" moves on to L2 match 1.
    assert.deepEqual([l1[1].status, l1[1].winner], ['DONE', 1]);
    assert.deepEqual([l1[0].status, l1[0].team1.isBye, l1[0].team2], ['PENDING', true, null]);
    assert.equal(b.losersRounds[1][1].team2.isBye, true);
  });

  it('a BYE-shaped top seed loses Round 1 to team2, which advances and drops the BYE down', () => {
    const ts = teams(4);
    ts[0] = { id: 'b', name: 'BYE', isBye: true };
    const b = L.generateBracketStructure(ts, 'double', 1);
    const m0 = b.winnersRounds[0][0];
    assert.deepEqual([m0.status, m0.winner], ['DONE', 2]);
    assert.equal(b.winnersRounds[1][0].team1.name, 'T4');
    assert.equal(b.losersRounds[0][0].team1.isBye, true);
  });

  it('double elimination, 2 teams: no losers rounds', () => {
    const b = L.generateBracketStructure(teams(2), 'double', 1);
    assert.deepEqual(b.losersRounds, []);
    assert.equal(b.winnersRounds[0][0].status, 'READY');
  });

  it('championship, 4 teams: last winners round is the Grand Finals, losers final is 3rd place', () => {
    const b = L.generateBracketStructure(teams(4), 'championship', 1);
    assert.deepEqual(countRounds(b.winnersRounds), [2, 1]);
    assert.equal(b.winnersRounds[1][0].label, 'Grand Finals');
    assert.deepEqual(countRounds(b.losersRounds), [1]);
    assert.equal(b.losersRounds[0][0].label, '3rd Place Match');
    assert.equal(b.grandFinals, null);
  });

  it('championship, 2 teams: the only match is the final and nothing drops down', () => {
    const b = L.generateBracketStructure(teams(2), 'championship', 1);
    assert.deepEqual(b.losersRounds, []);
    assert.equal(b.winnersRounds[0][0].label, 'Grand Finals');
  });

  it('championship, 3 teams: the BYE loser drops into the 3rd place match', () => {
    const b = L.generateBracketStructure(teams(3), 'championship', 1);
    assert.equal(b.losersRounds[0][0].team1.isBye, true);
  });

  // Pre-existing bug carried over from the original: with 2 teams, single
  // elimination has zero winners rounds and Round 1 setup dereferences undefined.
  it.todo('single elimination with 2 teams (currently throws)');

  it('unknown elimination type builds winners rounds only', () => {
    const b = L.generateBracketStructure(teams(4), 'other', 1);
    assert.deepEqual(countRounds(b.winnersRounds), [2, 1]);
    assert.equal(b.grandFinals, null);
    assert.equal(b.losersRounds, null);
  });
});

describe('processLoserBracketByes / advanceLoserWinner', () => {
  const slot = (team1, team2, status = 'PENDING') => ({ team1, team2, status, winner: null });
  const real = teams(3);

  it('ignores a null bracket', () => {
    assert.doesNotThrow(() => L.processLoserBracketByes(null));
  });

  it('a real team2 beats a BYE in team1 and moves into the next drop-in slot', () => {
    const rounds = [[slot(BYE, real[0])], [slot(real[1], null)]];
    L.processLoserBracketByes(rounds);
    assert.deepEqual([rounds[0][0].status, rounds[0][0].winner], ['DONE', 2]);
    assert.equal(rounds[1][0].team2, real[0]);
    assert.equal(rounds[1][0].status, 'READY');
  });

  it('a real team1 beats a BYE; undecided and finished matches are left alone', () => {
    const done = slot(BYE, BYE, 'DONE');
    const rounds = [[slot(real[0], BYE), slot(real[1], null), done]];
    L.processLoserBracketByes(rounds);
    assert.deepEqual([rounds[0][0].winner, rounds[0][1].status, done.winner], [1, 'PENDING', null]);
  });

  it('odd (halving) rounds pair adjacent winners into team1/team2', () => {
    const rounds = [[], [slot(null, null), slot(null, null)], [slot(null, null)]];
    L.advanceLoserWinner(rounds, 1, 0, real[0]);
    assert.equal(rounds[2][0].status, 'PENDING');
    L.advanceLoserWinner(rounds, 1, 1, real[1]);
    assert.deepEqual([rounds[2][0].team1, rounds[2][0].team2, rounds[2][0].status], [real[0], real[1], 'READY']);
    assert.equal(rounds[2][0].hasPropagatedT1 && rounds[2][0].hasPropagatedT2, true);
  });

  it('does not mark READY against a BYE, and stops at the last round', () => {
    const rounds = [[slot(null, null)], [slot(BYE, null)]];
    L.advanceLoserWinner(rounds, 0, 0, real[0]);
    assert.equal(rounds[1][0].status, 'PENDING');
    assert.doesNotThrow(() => L.advanceLoserWinner(rounds, 1, 0, real[0]));
  });
});

describe('createBracket', () => {
  const opts = {
    rankedPlayers: players(8), teamCount: '4', format: '2v2', teamFormationStrategy: 'fair',
    seedingStrategy: 'ranking', customTeams: [], leaderboardPlayers: [], elimType: 'single', maxGames: 3, random: zero
  };

  it('rejects invalid team counts', () => {
    const msg = 'Please enter a valid number of teams (minimum 2).';
    assert.deepEqual(L.createBracket({ ...opts, teamCount: 'x' }), { error: msg });
    assert.deepEqual(L.createBracket({ ...opts, teamCount: '1' }), { error: msg });
  });

  it('rejects when there are too few ranked players', () => {
    assert.deepEqual(L.createBracket({ ...opts, teamCount: '5' }), {
      error: 'Not enough ranked players on the leaderboard. Need at least 10 players for 5 teams in 2v2 format.'
    });
    assert.match(L.createBracket({ ...opts, format: '1v1', teamCount: 9 }).error, /Need at least 9 players/);
  });

  it('builds teams and the bracket', () => {
    const { bracket } = L.createBracket(opts);
    assert.equal(bracket.originalTeams.length, 4);
    assert.equal(bracket.winnersRounds[0][0].team1.name, 'P1 & P8');
  });

  it('defaults to Math.random', () => {
    const { random, ...rest } = opts;
    assert.ok(L.createBracket({ ...rest, seedingStrategy: 'random' }).bracket);
  });
});

describe('resetBracket / clearMatchResults', () => {
  it('rebuilds an identical fresh bracket', () => {
    const b = L.generateBracketStructure(teams(4), 'double', 3);
    b.winnersRounds[0][0].winner = 1;
    b.winnersRounds[0][0].status = 'DONE';
    const fresh = L.resetBracket(b);
    assert.equal(fresh.winnersRounds[0][0].status, 'READY');
    assert.equal(fresh.type, 'double');
    assert.equal(fresh.maxGames, 3);
    assert.equal(fresh.originalTeams, b.originalTeams);
    assert.equal(L.resetBracket(null), null);
  });

  it('clears matches and stats, keeping the roster and bracket shape', () => {
    const roster = [{ ...player(1), wins: 2 }];
    const result = L.clearMatchResults(roster, null);
    assert.deepEqual(result, { matches: [], bracketData: null, players: [player(1)] });
    const b = L.generateBracketStructure(teams(4), 'single', 1);
    assert.deepEqual(L.clearMatchResults([], b).bracketData.winnersRounds[0].map(m => m.status), ['READY', 'READY']);
  });
});
