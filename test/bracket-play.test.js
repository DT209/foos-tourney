const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, teams, BYE, scoreFor } = require('./helpers');

// Confirms the first playable match with `pick(match)` (1 or 2) as winner,
// repeating until nothing is playable. Returns the final bracket and how
// many times the bracket reported itself finished.
function playOut(bracket, pick = () => 1) {
  let finishedCount = 0;
  for (let guard = 0; guard < 200; guard++) {
    const next = L.listBracketMatches(bracket).find(({ match }) => match.status === 'READY');
    if (!next) break;
    scoreFor(next.match, pick(next.match));
    const result = L.confirmBracketMatch(bracket, next.section, next.rIdx, next.mIdx);
    bracket = result.bracket;
    if (result.finished) finishedCount++;
  }
  return { bracket, finishedCount };
}

const names = standings => standings.map(s => [s.place, s.team.name]);

describe('getBracketMatch', () => {
  const b = L.generateBracketStructure(teams(4), 'single', 1);
  const d = L.generateBracketStructure(teams(4), 'double', 1);

  it('resolves each section', () => {
    assert.equal(L.getBracketMatch(b, 'winners', 0, 1), b.winnersRounds[0][1]);
    assert.equal(L.getBracketMatch(d, 'losers', 1, 0), d.losersRounds[1][0]);
    assert.equal(L.getBracketMatch(b, 'grandFinals', 0, 0), b.grandFinals[0]);
    assert.equal(L.getBracketMatch(b, 'thirdPlace', 0, 0), b.thirdPlaceMatch);
    assert.equal(L.getBracketMatch(b, 'nope', 0, 0), undefined);
  });
});

describe('bracket match edits', () => {
  it('updates a game score and returns a new bracket reference', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 3);
    const u = L.updateBracketGameScore(b, 'winners', 0, 0, 1, 't1', '7');
    assert.notEqual(u, b);
    assert.equal(u.winnersRounds[0][0].games[1].t1, 7);
    assert.equal(L.updateBracketGameScore(b, 'winners', 0, 0, 1, 't1', '').winnersRounds[0][0].games[1].t1, '');
  });

  it('toggles handicap (defaulting winner to Team 1) and sets the override', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 3);
    let u = L.setBracketHandicap(b, 'winners', 0, 0, true);
    assert.deepEqual([u.winnersRounds[0][0].isHandicap, u.winnersRounds[0][0].overrideWinner], [true, 1]);
    u = L.setBracketOverrideWinner(u, 'winners', 0, 0, '2');
    assert.equal(u.winnersRounds[0][0].overrideWinner, 2);
    u = L.setBracketHandicap(u, 'winners', 0, 0, false);
    assert.deepEqual([u.winnersRounds[0][0].isHandicap, u.winnersRounds[0][0].overrideWinner], [false, null]);
  });
});

describe('confirmBracketMatch', () => {
  it('errors when the match has no winner', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 3);
    assert.deepEqual(L.confirmBracketMatch(b, 'winners', 0, 0), {
      error: 'Cannot complete match: No team has won enough games.'
    });
  });

  it('single elimination, 4 teams: semis feed final and 3rd place, finishes once', () => {
    const { bracket, finishedCount } = playOut(L.generateBracketStructure(teams(4), 'single', 1));
    assert.equal(finishedCount, 1);
    assert.equal(bracket.isCompleted, true);
    assert.deepEqual([bracket.grandFinals[0].team1.name, bracket.grandFinals[0].team2.name], ['T1', 'T2']);
    assert.deepEqual([bracket.thirdPlaceMatch.team1.name, bracket.thirdPlaceMatch.team2.name], ['T4', 'T3']);
    assert.equal(bracket.thirdPlaceMatch.hasPropagatedT1 && bracket.thirdPlaceMatch.hasPropagatedT2, true);
    assert.deepEqual(names(L.calculateBracketStandings(bracket)), [
      [1, 'T1'],
      [2, 'T2'],
      [3, 'T4'],
      [4, 'T3']
    ]);
  });

  it('single elimination, 8 teams: team2 winners advance into team2 slots', () => {
    const { bracket } = playOut(L.generateBracketStructure(teams(8), 'single', 1), () => 2);
    assert.equal(bracket.isCompleted, true);
    assert.equal(L.calculateBracketStandings(bracket)[0].team.name, 'T6');
  });

  it('single elimination, 3 teams: a BYE semi-final loser forfeits 3rd place', () => {
    const b = L.generateBracketStructure(teams(3), 'single', 1);
    // Semi 0 was T1 vs BYE (auto-done, never confirmed). Semi 1 is T2 vs T3.
    let r = L.confirmBracketMatch((scoreFor(b.winnersRounds[0][1], 1), b), 'winners', 0, 1);
    assert.equal(r.bracket.thirdPlaceMatch.team2.name, 'T3');
    // Confirming semi 0 manually drops the BYE into 3rd place: T3 wins it.
    const semi0 = r.bracket.winnersRounds[0][0];
    semi0.status = 'READY';
    scoreFor(semi0, 1);
    r = L.confirmBracketMatch(r.bracket, 'winners', 0, 0);
    assert.deepEqual([r.bracket.thirdPlaceMatch.status, r.bracket.thirdPlaceMatch.winner], ['DONE', 2]);
  });

  it('3rd place auto-resolves when team2 or both are BYEs', () => {
    const make = (t1, t2) => {
      const b = L.generateBracketStructure(teams(4), 'single', 1);
      b.thirdPlaceMatch.team1 = t1;
      scoreFor(b.winnersRounds[0][1], 1);
      b.winnersRounds[0][1].team2 = t2;
      return L.confirmBracketMatch(b, 'winners', 0, 1).bracket.thirdPlaceMatch;
    };
    const realVsBye = make(teams(1)[0], BYE);
    assert.deepEqual([realVsBye.status, realVsBye.winner], ['DONE', 1]);
    const byeVsBye = make(BYE, BYE);
    assert.deepEqual([byeVsBye.status, byeVsBye.winner], ['DONE', 1]);
  });

  it('semi-final losers beyond the first two matches are ignored for 3rd place', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 1);
    // A malformed 3-match final winners round: index 2 has no 3rd-place slot.
    const extra = { ...b.winnersRounds[0][0], team1: teams(5)[4], team2: teams(6)[5], status: 'READY' };
    b.winnersRounds[0].push(extra);
    scoreFor(extra, 1);
    const r = L.confirmBracketMatch(b, 'winners', 0, 2);
    assert.equal(r.bracket.thirdPlaceMatch.team1, null);
    assert.equal(r.bracket.thirdPlaceMatch.team2, null);
  });

  it('single elimination without a 3rd place match finishes on the final', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 1);
    b.thirdPlaceMatch = null;
    const { bracket, finishedCount } = playOut(b);
    assert.equal(finishedCount, 1);
    assert.deepEqual(names(L.calculateBracketStandings(bracket)), [
      [1, 'T1'],
      [2, 'T2'],
      [3, 'T4'],
      [3, 'T3']
    ]);
  });

  it('double elimination, 4 teams, no reset: winners champion takes it', () => {
    const { bracket, finishedCount } = playOut(L.generateBracketStructure(teams(4), 'double', 1));
    assert.equal(finishedCount, 1);
    assert.equal(bracket.grandFinals.length, 1);
    // Drop-ins: R1 losers fill L1; the R2 loser is mirrored into L2.
    assert.deepEqual([bracket.losersRounds[0][0].team1.name, bracket.losersRounds[0][0].team2.name], ['T4', 'T3']);
    assert.deepEqual([bracket.losersRounds[1][0].team1.name, bracket.losersRounds[1][0].team2.name], ['T2', 'T4']);
    assert.deepEqual(names(L.calculateBracketStandings(bracket)), [
      [1, 'T1'],
      [2, 'T2'],
      [3, 'T4']
    ]);
  });

  it('double elimination: losers champion winning the Grand Final forces a reset match', () => {
    const { bracket } = playOut(L.generateBracketStructure(teams(4), 'double', 3), m =>
      m.bracketType === 'grandFinal' && m.round === 1 ? 2 : 1
    );
    assert.equal(bracket.grandFinals.length, 2);
    const reset = bracket.grandFinals[1];
    assert.deepEqual(
      { id: reset.id, num: reset.num, label: reset.label, status: reset.status },
      {
        id: 'm-grandFinal-2-0',
        num: bracket.grandFinals[0].num + 1,
        label: 'Grand Finals Bracket Reset (Match 2)',
        status: 'DONE'
      }
    );
    assert.equal(bracket.isCompleted, true);
    assert.equal(L.calculateBracketStandings(bracket)[0].team.name, 'T1');
  });

  it('double elimination: the reset match is only added once', () => {
    const b = L.generateBracketStructure(teams(4), 'double', 3);
    const gf = b.grandFinals[0];
    Object.assign(gf, { team1: teams(1)[0], team2: teams(2)[1], status: 'READY' });
    scoreFor(gf, 2);
    let r = L.confirmBracketMatch(b, 'grandFinals', 0, 0);
    assert.equal(r.bracket.grandFinals.length, 2);
    assert.equal(r.bracket.grandFinals[1].games.length, 3, 'reset match is best-of maxGames');
    gf.status = 'READY';
    r = L.confirmBracketMatch(r.bracket, 'grandFinals', 0, 0);
    assert.equal(r.bracket.grandFinals.length, 2);
    // Team 2 winning the reset match itself doesn't add another.
    scoreFor(r.bracket.grandFinals[1], 2);
    r = L.confirmBracketMatch(r.bracket, 'grandFinals', 0, 1);
    assert.equal(r.bracket.grandFinals.length, 2);
    assert.equal(r.finished, true);
  });

  it('double elimination, 8 teams with BYEs plays to completion', () => {
    const { bracket, finishedCount } = playOut(L.generateBracketStructure(teams(6), 'double', 1), () => 2);
    assert.equal(finishedCount >= 1, true);
    assert.equal(bracket.isCompleted, true);
    assert.equal(L.calculateBracketStandings(bracket).length, 3);
  });

  it('double elimination, 8 teams: every losers round fills and the bracket finishes', () => {
    const { bracket } = playOut(L.generateBracketStructure(teams(8), 'double', 1));
    assert.ok(bracket.losersRounds.flat().every(m => m.status === 'DONE'));
    assert.equal(bracket.isCompleted, true);
  });

  it('double elimination, 2 teams: winners final seeds Grand Final team1 only', () => {
    const b = L.generateBracketStructure(teams(2), 'double', 1);
    scoreFor(b.winnersRounds[0][0], 1);
    const r = L.confirmBracketMatch(b, 'winners', 0, 0);
    assert.equal(r.bracket.grandFinals[0].team1.name, 'T1');
    assert.equal(r.bracket.grandFinals[0].status, 'PENDING');
  });

  it('championship, 4 teams: final decides 1st/2nd, losers final decides 3rd', () => {
    const { bracket, finishedCount } = playOut(L.generateBracketStructure(teams(4), 'championship', 1));
    assert.equal(finishedCount, 1);
    assert.deepEqual(names(L.calculateBracketStandings(bracket)), [
      [1, 'T1'],
      [2, 'T2'],
      [3, 'T4']
    ]);
    // The final's loser never drops down.
    assert.ok(bracket.losersRounds.flat().every(m => m.team1.name !== 'T2' && m.team2.name !== 'T2'));
  });

  it('championship, 8 teams plays to completion', () => {
    const { bracket } = playOut(L.generateBracketStructure(teams(8), 'championship', 1), () => 2);
    assert.equal(bracket.isCompleted, true);
    assert.equal(L.calculateBracketStandings(bracket).length, 3);
  });

  it('championship, 2 teams: one match finishes it', () => {
    const { bracket, finishedCount } = playOut(L.generateBracketStructure(teams(2), 'championship', 1));
    assert.equal(finishedCount, 1);
    assert.deepEqual(names(L.calculateBracketStandings(bracket)), [
      [1, 'T1'],
      [2, 'T2']
    ]);
  });

  it('drop-ins to a missing losers round or slot are skipped', () => {
    const b = L.generateBracketStructure(teams(8), 'double', 1);
    b.losersRounds = [b.losersRounds[0]];
    let r = playOut(b).bracket;
    assert.ok(r.winnersRounds[1].every(m => m.status === 'DONE'));
    // rIdx 0 with an empty first losers round.
    const c = L.generateBracketStructure(teams(4), 'double', 1);
    c.losersRounds[0] = [];
    scoreFor(c.winnersRounds[0][1], 1);
    r = L.confirmBracketMatch(c, 'winners', 0, 1).bracket;
    assert.deepEqual(r.losersRounds[0], []);
  });

  it('a losers-bracket final without a Grand Final (championship) adds nothing', () => {
    const b = L.generateBracketStructure(teams(4), 'championship', 1);
    Object.assign(b.losersRounds[0][0], { team1: teams(3)[2], team2: teams(4)[3], status: 'READY' });
    scoreFor(b.losersRounds[0][0], 1);
    const r = L.confirmBracketMatch(b, 'losers', 0, 0).bracket;
    assert.equal(r.grandFinals, null);
  });

  it('winners final with no Grand Finals (championship) only advances nothing', () => {
    const b = L.generateBracketStructure(teams(2), 'championship', 1);
    b.grandFinals = [];
    scoreFor(b.winnersRounds[0][0], 2);
    const r = L.confirmBracketMatch(b, 'winners', 0, 0);
    assert.equal(r.finished, true);
  });
});

describe('isBracketFinished', () => {
  it('single: needs the final, plus 3rd place if present', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 1);
    assert.equal(L.isBracketFinished(b), false);
    b.grandFinals[0].status = 'DONE';
    assert.equal(L.isBracketFinished(b), false);
    b.thirdPlaceMatch.status = 'DONE';
    assert.equal(L.isBracketFinished(b), true);
    assert.equal(L.isBracketFinished({ type: 'single', grandFinals: null, thirdPlaceMatch: null }), false);
  });

  it('championship: needs the winners final and the losers final', () => {
    assert.equal(L.isBracketFinished({ type: 'championship', winnersRounds: [], losersRounds: null }), false);
    assert.equal(L.isBracketFinished({ type: 'championship', winnersRounds: null }), false);
    assert.equal(
      L.isBracketFinished({ type: 'championship', winnersRounds: [[{ status: 'DONE' }]], losersRounds: [[]] }),
      false
    );
    assert.equal(
      L.isBracketFinished({
        type: 'championship',
        winnersRounds: [[{ status: 'DONE' }]],
        losersRounds: [[{ status: 'READY' }]]
      }),
      false
    );
    assert.equal(
      L.isBracketFinished({
        type: 'championship',
        winnersRounds: [[{ status: 'DONE' }]],
        losersRounds: [[{ status: 'DONE' }]]
      }),
      true
    );
    assert.equal(
      L.isBracketFinished({ type: 'championship', winnersRounds: [[{ status: 'DONE' }]], losersRounds: [] }),
      true
    );
  });

  it('double: needs the last Grand Final', () => {
    assert.equal(
      L.isBracketFinished({ type: 'double', grandFinals: [{ status: 'DONE' }, { status: 'READY' }] }),
      false
    );
    assert.equal(L.isBracketFinished({ type: 'double', grandFinals: [{ status: 'DONE' }] }), true);
    assert.equal(L.isBracketFinished({ type: 'double', grandFinals: [] }), false);
  });

  it('unknown types are never finished', () => {
    assert.equal(L.isBracketFinished({ type: 'other' }), false);
  });
});

describe('calculateBracketStandings', () => {
  const [A, B, C, D] = teams(4);
  const m = (team1, team2, winner) => ({ team1, team2, winner });

  it('is empty without a bracket or a decided final', () => {
    assert.deepEqual(L.calculateBracketStandings(null), []);
    assert.deepEqual(L.calculateBracketStandings({ type: 'single', grandFinals: null }), []);
    assert.deepEqual(L.calculateBracketStandings({ type: 'single', grandFinals: [m(A, B, null)] }), []);
    assert.deepEqual(L.calculateBracketStandings({ type: 'double', grandFinals: [m(A, B, null)] }), []);
    assert.deepEqual(L.calculateBracketStandings({ type: 'double', grandFinals: [] }), []);
  });

  it('single: skips empty slots and falls back to semi-final losers', () => {
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'single',
          grandFinals: [m(A, null, 1)],
          thirdPlaceMatch: m(null, C, 2),
          winnersRounds: []
        })
      ),
      [
        [1, 'T1'],
        [3, 'T3']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'single',
          grandFinals: [m(A, B, 2)],
          thirdPlaceMatch: m(C, D, 1)
        })
      ),
      [
        [1, 'T2'],
        [2, 'T1'],
        [3, 'T3'],
        [4, 'T4']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'single',
          grandFinals: [m(A, B, 1)],
          thirdPlaceMatch: m(C, D, null),
          winnersRounds: [[m(A, D, 1), m(C, B, 2), m(null, null, null), m(null, A, 2)]]
        })
      ),
      [
        [1, 'T1'],
        [2, 'T2'],
        [3, 'T4'],
        [3, 'T3']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'single',
          grandFinals: [m(A, B, 1)],
          thirdPlaceMatch: null,
          winnersRounds: null
        })
      ),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
  });

  it('championship: tolerates missing rounds', () => {
    assert.deepEqual(
      L.calculateBracketStandings({ type: 'championship', winnersRounds: null, losersRounds: null }),
      []
    );
    assert.deepEqual(L.calculateBracketStandings({ type: 'championship', winnersRounds: [], losersRounds: [] }), []);
    assert.deepEqual(
      L.calculateBracketStandings({ type: 'championship', winnersRounds: [[m(A, B, null)]], losersRounds: [[]] }),
      []
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'championship',
          winnersRounds: [[m(A, B, 2)]],
          losersRounds: [[m(C, D, 2)]]
        })
      ),
      [
        [1, 'T2'],
        [2, 'T1'],
        [3, 'T4']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'championship',
          winnersRounds: [[m(A, B, 1)]],
          losersRounds: [[m(C, null, 2)]]
        })
      ),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
  });

  it('double: 3rd is the losers final loser; missing data is skipped', () => {
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'double',
          grandFinals: [m(A, B, 1)],
          losersRounds: [[m(B, C, 2)]]
        })
      ),
      [
        [1, 'T1'],
        [2, 'T2'],
        [3, 'T2']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({
          type: 'double',
          grandFinals: [m(A, B, 1)],
          losersRounds: [[m(B, C, 1)]]
        })
      ),
      [
        [1, 'T1'],
        [2, 'T2'],
        [3, 'T3']
      ]
    );
    assert.deepEqual(
      names(L.calculateBracketStandings({ type: 'double', grandFinals: [m(A, B, 1)], losersRounds: null })),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
    assert.deepEqual(
      names(L.calculateBracketStandings({ type: 'double', grandFinals: [m(A, B, 1)], losersRounds: [] })),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
    assert.deepEqual(
      names(L.calculateBracketStandings({ type: 'double', grandFinals: [m(A, B, 1)], losersRounds: [[]] })),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
    assert.deepEqual(
      names(
        L.calculateBracketStandings({ type: 'double', grandFinals: [m(A, B, 1)], losersRounds: [[m(B, C, null)]] })
      ),
      [
        [1, 'T1'],
        [2, 'T2']
      ]
    );
  });
});

describe('place helpers', () => {
  it('labels and medals', () => {
    assert.deepEqual([1, 2, 3, 4].map(L.placeLabel), ['1st Place', '2nd Place', '3rd Place', '4th Place']);
    assert.deepEqual([1, 2, 3, 4].map(L.placeMedal), ['🥇', '🥈', '🥉', null]);
  });
});

describe('assignBracketTables', () => {
  it('returns [] without a bracket', () => {
    assert.deepEqual(L.assignBracketTables(null, 2), []);
  });

  it('assigns free tables to playable matches and keeps sticky tables', () => {
    const b = L.generateBracketStructure(teams(8), 'single', 1);
    b.winnersRounds[0][2].table = 1;
    const tables = L.assignBracketTables(b, 2);
    assert.deepEqual(
      tables.map(t => [t.section, t.rIdx, t.mIdx]),
      [
        ['winners', 0, 2],
        ['winners', 0, 0]
      ]
    );
    assert.equal(b.winnersRounds[0][1].table, null);
  });

  it('treats a non-READY match with two real teams as playable; skips DONE and BYE matches', () => {
    const b = L.generateBracketStructure(teams(3), 'single', 1);
    b.grandFinals[0].team2 = teams(2)[1];
    b.thirdPlaceMatch.team1 = BYE;
    b.thirdPlaceMatch.team2 = teams(3)[2];
    const tables = L.assignBracketTables(b, 3);
    assert.deepEqual(
      tables.map(t => t && t.section),
      ['winners', 'grandFinals', null]
    );
  });

  it('ignores tables beyond the current count and done matches holding tables', () => {
    const b = L.generateBracketStructure(teams(4), 'double', 1);
    b.winnersRounds[0][0].table = 5;
    b.winnersRounds[0][1].status = 'DONE';
    b.winnersRounds[0][1].table = 1;
    const tables = L.assignBracketTables(b, 1);
    assert.deepEqual(tables, [null]);
    assert.equal(b.winnersRounds[0][1].table, 1);
  });
});

describe('match card helpers', () => {
  it('derives visual state', () => {
    assert.equal(L.getMatchCardState({ status: 'DONE', table: 1 }), 'done');
    assert.equal(L.getMatchCardState({ status: 'READY', table: 2 }), 'tabled');
    assert.equal(L.getMatchCardState({ status: 'READY', table: null }), 'ready');
    assert.equal(L.getMatchCardState({ status: 'PENDING', table: null }), 'pending');
  });

  it('names a slot or TBD', () => {
    assert.equal(L.bracketTeamName({ name: 'X' }), 'X');
    assert.equal(L.bracketTeamName(null), 'TBD');
  });
});
