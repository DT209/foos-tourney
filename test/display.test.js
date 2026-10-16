const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, player, teams } = require('./helpers');

const [ann, bo, cy, di] = [player(1, 'Ann'), player(2, 'Bo'), player(3, 'Cy'), player(4, 'Di')];

describe('buildDisplayBoard', () => {
  const liveMonster = {
    id: 7,
    table: 1,
    status: 'LIVE',
    team1: [ann, bo],
    team2: [cy, di],
    games: [
      { t1: 5, t2: 3 },
      { t1: 2, t2: '' },
      { t1: '', t2: '' }
    ]
  };
  const bracket = L.generateBracketStructure(teams(4), 'single', 3);
  const semi = bracket.winnersRounds[0][1];
  semi.games[0] = { t1: 1, t2: 5 };
  const assignments = [null, null, { match: semi, section: 'winners', rIdx: 0, mIdx: 1 }];

  it('lists every table: live Monster matches, bracket matches and free tables', () => {
    const board = L.buildDisplayBoard({
      matches: [liveMonster, { ...liveMonster, id: 8, table: 2, status: 'DONE' }],
      bracketAssignments: assignments,
      tableCount: 3,
      players: [],
      completedMatches: []
    });
    assert.deepEqual(board.tables, [
      {
        table: 1,
        live: true,
        stage: 'Monster',
        label: 'Monster match',
        team1: 'Ann & Bo',
        team2: 'Cy & Di',
        games: [
          { t1: 5, t2: 3 },
          { t1: 2, t2: '' }
        ],
        wins: [1, 0]
      },
      { table: 2, live: false },
      {
        table: 3,
        live: true,
        stage: 'Playoffs',
        label: semi.label,
        team1: semi.team1.name,
        team2: semi.team2.name,
        games: [{ t1: 1, t2: 5 }],
        wins: [0, 1]
      }
    ]);
  });

  it('a live Monster match takes the table over a bracket assignment, and TBD fills unknown teams', () => {
    const pending = { ...semi, team2: null, games: [] };
    const board = L.buildDisplayBoard({
      matches: [{ ...liveMonster, table: 1 }],
      bracketAssignments: [{ match: semi, section: 'winners', rIdx: 0, mIdx: 1 }, { match: pending }],
      tableCount: 2,
      players: [],
      completedMatches: []
    });
    assert.equal(board.tables[0].stage, 'Monster');
    assert.deepEqual([board.tables[1].team2, board.tables[1].games, board.tables[1].wins], ['TBD', [], [0, 0]]);
  });

  it('works without bracket assignments', () => {
    const board = L.buildDisplayBoard({
      matches: [],
      bracketAssignments: [],
      tableCount: 1,
      players: [],
      completedMatches: []
    });
    assert.deepEqual(board.tables, [{ table: 1, live: false }]);
  });

  it('ranks the leaderboard like the standings, with paused players flagged', () => {
    const board = L.buildDisplayBoard({
      matches: [],
      bracketAssignments: [],
      tableCount: 0,
      players: [
        { ...ann, wins: 1, losses: 1, gf: 9, ga: 7 },
        { ...bo, wins: 2, losses: 0, gf: 10, ga: 4, active: false }
      ],
      completedMatches: []
    });
    assert.deepEqual(board.standings, [
      { rank: 1, name: 'Bo', wins: 2, losses: 0, winPct: '100.0', avgDiff: '3.0', active: false },
      { rank: 2, name: 'Ann', wins: 1, losses: 1, winPct: '50.0', avgDiff: '1.0', active: true }
    ]);
  });

  it('shows match history most recent first', () => {
    const done = (id, stage, winner) => ({
      uniqueId: id,
      stage,
      winner,
      team1: [ann],
      team2: [bo],
      games: [{ t1: 5, t2: 1 }],
      isHandicap: 'No'
    });
    const board = L.buildDisplayBoard({
      matches: [],
      bracketAssignments: [],
      tableCount: 0,
      players: [],
      completedMatches: [done('a', 'Monster', 1), done('b', 'Playoffs', 2)]
    });
    assert.deepEqual(board.history, [
      { id: 'b', stage: 'Playoffs', winTeamStr: 'Bo', loseTeamStr: 'Ann', games: [{ winScore: 1, loseScore: 5 }] },
      { id: 'a', stage: 'Monster', winTeamStr: 'Ann', loseTeamStr: 'Bo', games: [{ winScore: 5, loseScore: 1 }] }
    ]);
  });
});

describe('tournamentCsv', () => {
  const state = {
    ...L.newTournamentState('11111111-2222-4333-8444-555555555555', new Date(2026, 9, 16, 19)),
    tournamentName: 'Week 3',
    matches: [{ id: 9, status: 'DONE', winner: 1, team1: [ann], team2: [bo], games: [{ t1: 5, t2: 2 }] }]
  };

  it('builds the results CSV and file name for any tournament state', () => {
    const csv = L.tournamentCsv(state);
    assert.equal(csv.fileName, 'Week_3_2026-10-16.csv');
    assert.equal(
      csv.text.split('\n')[1],
      '"11111111-2222-4333-8444-555555555555_MONSTER-9",2026-10-16,1,5,2,"Ann","","Bo","","No"'
    );
  });

  it('is null when there are no completed matches', () => {
    assert.equal(L.tournamentCsv({ ...state, matches: [] }), null);
  });
});

describe('nextAutoScroll', () => {
  const opts = { pauseTicks: 2, speed: 0.01 };
  const box = (scrollTop, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });

  it('stays idle at the top when everything fits', () => {
    assert.deepEqual(L.nextAutoScroll(box(30, 400, 400), { phase: 'scroll', pause: 0 }, opts), {
      scrollTop: 0,
      phase: 'top',
      pause: 2
    });
  });

  it('pauses at the top, scrolls by a step relative to the panel height, pauses at the bottom, then restarts', () => {
    let state = L.initialAutoScroll(opts);
    assert.deepEqual(state, { phase: 'top', pause: 2 });
    state = L.nextAutoScroll(box(0), state, opts);
    assert.deepEqual(state, { scrollTop: 0, phase: 'top', pause: 1 });
    state = L.nextAutoScroll(box(0), state, opts);
    state = L.nextAutoScroll(box(0), state, opts);
    assert.deepEqual(state, { scrollTop: 0, phase: 'scroll', pause: 0 });
    state = L.nextAutoScroll(box(0), state, opts);
    assert.deepEqual(state, { scrollTop: 4, phase: 'scroll', pause: 0 }, '1% of a 400px panel');
    state = L.nextAutoScroll(box(598), state, opts);
    assert.deepEqual(state, { scrollTop: 600, phase: 'bottom', pause: 2 }, 'clamped to the bottom');
    state = L.nextAutoScroll(box(600), { ...state, pause: 0 }, opts);
    assert.deepEqual(state, { scrollTop: 0, phase: 'top', pause: 2 });
  });

  it('always moves at least 1px, and has sensible defaults', () => {
    assert.equal(L.nextAutoScroll(box(0, 100, 20), { phase: 'scroll', pause: 0 }).scrollTop, 1);
    assert.deepEqual(L.initialAutoScroll(), { phase: 'top', pause: 40 });
  });
});

describe('display mode URL', () => {
  it('detects ?display, ignoring display=0', () => {
    assert.equal(L.isDisplayModeUrl('?display=1'), true);
    assert.equal(L.isDisplayModeUrl('?x=1&display'), true);
    assert.equal(L.isDisplayModeUrl('?display=0'), false);
    assert.equal(L.isDisplayModeUrl(''), false);
  });

  it('builds the display URL and the control desk URL from the current one', () => {
    assert.equal(
      L.displayModeUrl('https://x.org/dyp/TournamentManager.html?a=1#t'),
      'https://x.org/dyp/TournamentManager.html?a=1&display=1#t'
    );
    assert.equal(
      L.controlDeskUrl('https://x.org/dyp/TournamentManager.html?a=1&display=1'),
      'https://x.org/dyp/TournamentManager.html?a=1'
    );
  });
});
