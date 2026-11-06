// Corrections (admin): editing finished matches and substituting players.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, players, teams, scoreFor } = require('./helpers');

const NOW = new Date('2026-11-05T22:00:00.000Z');
const g = (t1, t2) => ({ t1, t2 });

// Confirms the first READY bracket match matching `pick`, scoring `winner`.
function play(bracket, id, winner) {
  const found = L.listBracketMatches(bracket).find(({ match }) => match.id === id);
  scoreFor(found.match, winner);
  return L.confirmBracketMatch(bracket, found.section, found.rIdx, found.mIdx).bracket;
}
const matchById = (bracket, id) => L.listBracketMatches(bracket).find(({ match }) => match.id === id).match;
const draftFor = (bracket, id) => L.editDraftFor({ kind: 'bracket', id }, [], bracket);
const winBy = (draft, winner) => ({ ...draft, games: [winner === 1 ? g(5, 1) : g(1, 5)] });

describe('authorizeAdminAction', () => {
  it('sets a PIN when there is none, otherwise checks it', () => {
    assert.deepEqual(L.authorizeAdminAction({ pin: null, input: '12' }), { error: 'Choose a PIN of 4 to 8 digits.' });
    assert.deepEqual(L.authorizeAdminAction({ pin: null, input: '2468' }), { pin: '2468' });
    assert.deepEqual(L.authorizeAdminAction({ pin: '2468', input: '1111' }), { error: 'Incorrect PIN!' });
    assert.deepEqual(L.authorizeAdminAction({ pin: '2468', input: '2468' }), { pin: '2468' });
  });
});

describe('recomputePlayerStats', () => {
  it('rebuilds W/L/GF/GA from finished matches and keeps draw counters', () => {
    const [a, b] = players(2);
    const roster = [
      { ...a, wins: 9, gf: 99, eligibleDrawsMissed: 2 },
      { ...b, losses: 4 }
    ];
    const matches = [
      { id: 1, status: 'DONE', winner: 1, team1: [a], team2: [b], games: [g(5, 2)] },
      { id: 2, status: 'DONE', winner: 2, team1: [a], team2: [b], games: [g(1, 5), g('3', '')] },
      { id: 3, status: 'LIVE', team1: [a], team2: [b], games: [g(5, 0)] },
      { id: 4, status: 'DONE', team1: [a], team2: [b], games: [g(5, 0)] }
    ];
    const [pa, pb] = L.recomputePlayerStats(roster, matches);
    assert.deepEqual([pa.wins, pa.losses, pa.gf, pa.ga, pa.eligibleDrawsMissed], [1, 1, 6, 7, 2]);
    assert.deepEqual([pb.wins, pb.losses, pb.gf, pb.ga], [1, 1, 7, 6]);
  });
});

describe('editing a Monster match', () => {
  const [a, b, c, d, e] = players(5);
  const done = {
    id: 7,
    table: 1,
    type: '2v2',
    status: 'DONE',
    winner: 1,
    team1: [a, b],
    team2: [c, d],
    games: [g(5, 1), g(5, 2), g('', '')],
    isHandicap: false,
    overrideWinner: null
  };
  const roster = L.recomputePlayerStats([a, b, c, d, e], [done]);
  const ref = { kind: 'monster', id: 7 };
  const options = L.draftPlayerOptions(L.editDraftFor(ref, [done], null), roster);
  const setPlayer = (draft, team, slot, value) => L.setDraftPlayer(draft, team, slot, value, options);

  it('builds a draft only for a finished match', () => {
    assert.equal(L.editDraftFor({ kind: 'monster', id: 99 }, [done], null), null);
    assert.equal(L.editDraftFor(ref, [{ ...done, status: 'LIVE' }], null), null);
    const draft = L.editDraftFor(ref, [done], null);
    assert.deepEqual(
      [draft.kind, draft.id, draft.label, draft.team1Ids, draft.team2Ids, draft.isHandicap, draft.overrideWinner],
      ['monster', 7, 'Monster match', [1, 2], [3, 4], false, null]
    );
    assert.notEqual(draft.games, done.games);
    assert.deepEqual(
      draft.teamPlayers.map(p => p.name),
      ['P1', 'P2', 'P3', 'P4']
    );
    const handicapped = L.editDraftFor(ref, [{ ...done, isHandicap: true, overrideWinner: null }], null);
    assert.equal(handicapped.overrideWinner, 1);
  });

  it('draft helpers change one thing each', () => {
    const draft = L.editDraftFor(ref, [done], null);
    assert.deepEqual(L.setDraftScore(draft, 2, 't1', '-4').games[2], g(0, ''));
    assert.deepEqual(draft.games[2], g('', ''));
    assert.deepEqual(
      [L.setDraftHandicap(draft, true).isHandicap, L.setDraftHandicap(draft, true).overrideWinner],
      [true, 1]
    );
    assert.equal(L.setDraftHandicap(draft, false).overrideWinner, null);
    assert.equal(L.setDraftOverrideWinner(draft, '2').overrideWinner, 2);
    assert.deepEqual(setPlayer(draft, 'team1Ids', 1, '5').team1Ids, [1, 5]);
    assert.deepEqual(setPlayer(draft, 'team2Ids', 0, '').team2Ids, [null, 4]);
    assert.equal(draft.note, null);
  });

  it('a player with a text id (from an imported file) can be picked', () => {
    const draft = L.editDraftFor(ref, [done], null);
    const textIds = [...options, { id: 'p9', name: 'P9' }];
    assert.deepEqual(L.setDraftPlayer(draft, 'team1Ids', 1, 'p9', textIds).team1Ids, [1, 'p9']);
  });

  it('refuses a missing match, an empty or repeated spot, and a result with no winner', () => {
    const draft = L.editDraftFor(ref, [done], null);
    assert.deepEqual(L.editMonsterMatch(roster, [], draft, NOW), { error: 'That match is no longer in the history.' });
    assert.deepEqual(L.editMonsterMatch(roster, [done], setPlayer(draft, 'team1Ids', 0, ''), NOW), {
      error: 'Pick a player for every spot.'
    });
    assert.deepEqual(L.editMonsterMatch(roster, [done], setPlayer(draft, 'team2Ids', 0, '1'), NOW), {
      error: 'P1 is on this match twice.'
    });
    assert.deepEqual(L.editMonsterMatch(roster, [done], { ...draft, games: [g(5, 1), g(1, 5), g('', '')] }, NOW), {
      error: 'No team has won enough games. Enter the winning scores or use the override.'
    });
  });

  it('a corrected score that flips the winner moves the win and goals', () => {
    const draft = { ...L.editDraftFor(ref, [done], null), games: [g(1, 5), g(2, 5), g('', '')] };
    const other = { ...done, id: 8, status: 'LIVE', winner: null };
    const result = L.editMonsterMatch(roster, [done, other], draft, NOW);
    const [edited, untouched] = result.matches;
    assert.equal(untouched, other);
    assert.deepEqual([edited.winner, edited.editedAt, edited.overrideWinner], [2, NOW.toISOString(), null]);
    const [pa, , pc] = result.players;
    assert.deepEqual([pa.wins, pa.losses, pa.gf, pa.ga], [0, 1, 3, 10]);
    assert.deepEqual([pc.wins, pc.losses, pc.gf, pc.ga], [1, 0, 10, 3]);
  });

  it('a corrected line-up credits the player who really played', () => {
    const draft = setPlayer(L.editDraftFor(ref, [done], null), 'team1Ids', 1, '5');
    const result = L.editMonsterMatch(
      roster,
      [done],
      L.setDraftOverrideWinner(L.setDraftHandicap(draft, true), 2),
      NOW
    );
    const [pa, pb, , , pe] = result.players;
    assert.deepEqual(
      result.matches[0].team1.map(p => p.name),
      ['P1', 'P5']
    );
    assert.deepEqual([result.matches[0].winner, result.matches[0].isHandicap], [2, true]);
    assert.deepEqual([pb.wins, pb.losses, pb.gf], [0, 0, 0]);
    assert.deepEqual([pa.losses, pe.losses, pe.gf, pe.ga], [1, 1, 10, 3]);
  });

  it('keeps a player who has since left the roster', () => {
    const draft = L.editDraftFor(ref, [done], null);
    const withoutB = roster.filter(p => p.id !== 2);
    assert.deepEqual(
      L.draftPlayerOptions(draft, withoutB).map(p => p.name),
      ['P1', 'P3', 'P4', 'P5', 'P2']
    );
    const result = L.editMonsterMatch(withoutB, [done], { ...draft, games: [g(5, 4), g(5, 4), g('', '')] }, NOW);
    assert.equal(result.matches[0].team1[1].name, 'P2');
    assert.equal(result.players.length, 4);
  });
});

describe('editing a bracket match', () => {
  it('only finished matches between two real teams can be edited', () => {
    const b = L.generateBracketStructure(teams(3), 'single', 1);
    assert.equal(L.editDraftFor({ kind: 'bracket', id: 'x' }, [], null), null);
    assert.equal(draftFor(b, 'nope'), null);
    assert.equal(draftFor(b, 'm-winners-1-1'), null);
    assert.equal(draftFor(b, 'm-winners-1-0'), null);
    const error = { error: "This match can't be edited." };
    assert.deepEqual(L.editBracketMatch(b, { id: 'm-winners-1-0' }, NOW), error);
    assert.deepEqual(L.editBracketMatch(b, { id: 'nope' }, NOW), error);
  });

  it('a score fix that keeps the winner changes only that match', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    b = play(b, 'm-winners-1-0', 1);
    b.winnersRounds[0][1].games[0] = g('4', '');
    b.winnersRounds[0][1].table = 2;
    const draft = { ...draftFor(b, 'm-winners-1-0'), games: [g(5, 3)] };
    assert.deepEqual([draft.label, draft.team1Name, draft.team2Name], ['Match 1', 'T1', 'T4']);
    assert.equal(draft.note, null);
    const result = L.editBracketMatch(b, draft, NOW);
    assert.deepEqual([result.cleared, result.confirm], [[], null]);
    assert.equal(result.finished, false);
    const edited = matchById(result.bracket, 'm-winners-1-0');
    assert.deepEqual(
      [edited.status, edited.winner, edited.games, edited.editedAt],
      ['DONE', 1, [g(5, 3)], NOW.toISOString()]
    );
    assert.equal(result.bracket.grandFinals[0].team1.name, 'T1');
    // Unconfirmed progress on another match carries over.
    const other = matchById(result.bracket, 'm-winners-1-1');
    assert.deepEqual([other.games, other.table], [[g('4', '')], 2]);
  });

  it('a flipped winner swaps the teams downstream and drops their typed scores', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    b = play(b, 'm-winners-1-0', 1);
    b = play(b, 'm-winners-1-1', 1);
    // The final and 3rd place have scores typed but aren't confirmed.
    b.grandFinals[0].games[0] = g('5', '');
    b.thirdPlaceMatch.isHandicap = true;
    const result = L.editBracketMatch(b, winBy(draftFor(b, 'm-winners-1-0'), 2), NOW);
    assert.deepEqual(result.cleared, ['Grand Finals', '3rd / 4th Place Match']);
    assert.equal(
      result.confirm,
      'This changes who plays in Grand Finals, 3rd / 4th Place Match. Scores or tables set there will be cleared. Save anyway?'
    );
    const gf = result.bracket.grandFinals[0];
    assert.deepEqual([gf.team1.name, gf.team2.name, gf.games, gf.status], ['T4', 'T2', [g('', '')], 'READY']);
    const tpm = result.bracket.thirdPlaceMatch;
    assert.deepEqual([tpm.team1.name, tpm.team2.name, tpm.isHandicap], ['T1', 'T3', false]);
  });

  it('once a match fed by the result is played, scores can be fixed but the winner cannot change', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    b = play(b, 'm-winners-1-0', 1);
    b = play(b, 'm-winners-1-1', 1);
    b = play(b, 'm-grandFinal-2-0', 1);
    const draft = draftFor(b, 'm-winners-1-0');
    assert.equal(
      draft.note,
      'A dependent match has been played, so the winner can no longer change. You can still fix scores.'
    );
    assert.deepEqual(L.editBracketMatch(b, winBy(draft, 2), NOW), {
      error:
        'Grand Finals has already been played, so the winner of this match can no longer change. You can still fix scores.'
    });
    const fixed = L.editBracketMatch(b, { ...draft, games: [g(5, 4)] }, NOW);
    assert.deepEqual(matchById(fixed.bracket, 'm-winners-1-0').games, [g(5, 4)]);
    assert.equal(matchById(fixed.bracket, 'm-grandFinal-2-0').status, 'DONE');
    // A played match that the edit doesn't feed leaves the winner open.
    assert.equal(draftFor(b, 'm-grandFinal-2-0').note, null);
  });

  it('a saved result with no winner refuses the edit instead of crashing', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    b = play(b, 'm-winners-1-0', 1);
    b = play(b, 'm-winners-1-1', 1);
    // As if imported from a hand-edited file: Match 2 is DONE but its score was blanked.
    b.winnersRounds[0][1].games[0] = g('', '');
    assert.deepEqual(L.editBracketMatch(b, winBy(draftFor(b, 'm-winners-1-0'), 1), NOW), {
      error:
        "Match 2 has a saved result with no winner, so the bracket can't be rebuilt. Edit Match 2 and give it a winner first."
    });
    // Giving Match 2 a winner repairs it.
    const repaired = L.editBracketMatch(b, winBy(draftFor(b, 'm-winners-1-1'), 1), NOW);
    assert.equal(matchById(repaired.bracket, 'm-winners-1-1').winner, 1);
  });

  it('a match already called to a table is listed when its teams change', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    b = play(b, 'm-winners-1-0', 1);
    b = play(b, 'm-winners-1-1', 1);
    b.grandFinals[0].table = 2;
    const result = L.editBracketMatch(b, winBy(draftFor(b, 'm-winners-1-0'), 2), NOW);
    assert.deepEqual(result.cleared, ['Grand Finals']);
    assert.equal(result.bracket.grandFinals[0].table, null);
  });

  it('a score fix on a finished bracket that keeps the champion is not a new finish', () => {
    let b = L.generateBracketStructure(teams(4), 'single', 1);
    for (const id of ['m-winners-1-0', 'm-winners-1-1', 'm-grandFinal-2-0', 'm-thirdPlace-2-1']) b = play(b, id, 1);
    const result = L.editBracketMatch(b, { ...draftFor(b, 'm-thirdPlace-2-1'), games: [g(5, 4)] }, NOW);
    assert.equal(result.finished, false);
  });

  it('refuses a result with no winner', () => {
    const b = play(L.generateBracketStructure(teams(2), 'single', 1), 'm-grandFinal-1-0', 1);
    assert.deepEqual(L.editBracketMatch(b, { ...draftFor(b, 'm-grandFinal-1-0'), games: [g('', '')] }, NOW), {
      error: 'No team has won enough games. Enter the winning scores or use the override.'
    });
  });

  it('editing the final of a finished bracket updates the champion and reports finished', () => {
    const b = play(L.generateBracketStructure(teams(2), 'single', 1), 'm-grandFinal-1-0', 1);
    const draft = L.setDraftOverrideWinner(L.setDraftHandicap(draftFor(b, 'm-grandFinal-1-0'), true), 2);
    const result = L.editBracketMatch(b, draft, NOW);
    assert.equal(result.finished, true);
    assert.equal(result.bracket.isCompleted, true);
    assert.deepEqual(
      L.calculateBracketStandings(result.bracket).map(s => s.team.name),
      ['T2', 'T1']
    );
  });

  it('double elimination: flipping Grand Final 1 adds or removes the reset match', () => {
    // T2 (losers champion) wins GF1: a reset is added.
    let b = L.generateBracketStructure(teams(2), 'double', 1);
    b = play(b, 'm-winners-1-0', 1);
    b = play(b, 'm-grandFinal-1-0', 2);
    assert.equal(b.grandFinals.length, 2);
    b.grandFinals[1].games[0] = g('3', '');
    const removed = L.editBracketMatch(b, winBy(draftFor(b, 'm-grandFinal-1-0'), 1), NOW);
    assert.equal(removed.bracket.grandFinals.length, 1);
    assert.deepEqual(removed.cleared, ['Grand Finals Bracket Reset (Match 2)']);
    assert.equal(removed.finished, true);

    const added = L.editBracketMatch(removed.bracket, winBy(draftFor(removed.bracket, 'm-grandFinal-1-0'), 2), NOW);
    assert.equal(added.bracket.grandFinals.length, 2);
    assert.deepEqual([added.finished, added.cleared], [false, []]);
    // A played reset blocks editing Grand Final 1.
    const reset = play(added.bracket, 'm-grandFinal-2-0', 1);
    assert.match(
      L.editBracketMatch(reset, winBy(draftFor(reset, 'm-grandFinal-1-0'), 1), NOW).error,
      /Bracket Reset \(Match 2\) has already been played/
    );
  });

  it('double elimination with BYEs: an early edit replays the rest, keeping earlier edit marks', () => {
    let b = L.generateBracketStructure(teams(5), 'double', 1);
    const r1 = b.winnersRounds[0].find(m => m.status === 'READY');
    b = play(b, r1.id, 1);
    const first = L.editBracketMatch(b, winBy(draftFor(b, r1.id), 1), NOW).bracket;
    const later = new Date('2026-11-05T23:00:00.000Z');
    const flipped = L.editBracketMatch(first, winBy(draftFor(first, r1.id), 2), later);
    assert.deepEqual(flipped.cleared, []);
    const edited = matchById(flipped.bracket, r1.id);
    assert.deepEqual([edited.winner, edited.editedAt], [2, later.toISOString()]);
    // The new loser dropped into the Losers Bracket in the old loser's place.
    const loser = edited.team1;
    const dropped = L.listBracketMatches(flipped.bracket).some(
      ({ section, match }) => section === 'losers' && [match.team1, match.team2].some(t => t && t.id === loser.id)
    );
    assert.equal(dropped, true);
  });
});

describe('editMatch', () => {
  const [a, b, c, d] = players(4);
  const done = { id: 7, status: 'DONE', winner: 1, team1: [a, b], team2: [c, d], games: [g(5, 1)] };
  const roster = L.recomputePlayerStats([a, b, c, d], [done]);

  it('saves a Monster edit and leaves the bracket alone', () => {
    const state = { players: roster, matches: [done], bracketData: null };
    const draft = { ...L.editDraftFor({ kind: 'monster', id: 7 }, [done], null), games: [g(1, 5)] };
    const result = L.editMatch(state, draft, NOW);
    assert.deepEqual(
      [result.matches[0].winner, result.bracketData, result.confirm, result.finished],
      [2, null, null, false]
    );
    assert.equal(result.players[0].losses, 1);
    assert.deepEqual(L.editMatch({ ...state, matches: [] }, draft, NOW), {
      error: 'That match is no longer in the history.'
    });
  });

  it('saves a bracket edit and leaves players and matches alone', () => {
    let bracket = L.generateBracketStructure(teams(4), 'single', 1);
    bracket = play(bracket, 'm-winners-1-0', 1);
    bracket = play(bracket, 'm-winners-1-1', 1);
    bracket.grandFinals[0].games[0] = g('5', '');
    const state = { players: roster, matches: [done], bracketData: bracket };
    const result = L.editMatch(state, winBy(draftFor(bracket, 'm-winners-1-0'), 2), NOW);
    assert.deepEqual([result.players, result.matches, result.finished], [roster, [done], false]);
    assert.equal(result.bracketData.grandFinals[0].team1.name, 'T4');
    assert.match(result.confirm, /Grand Finals/);
    assert.deepEqual(L.editMatch(state, { kind: 'bracket', id: 'nope' }, NOW), {
      error: "This match can't be edited."
    });
  });
});

describe('substitutePlayer', () => {
  const roster = players(6);
  const [a, b, c, d, e, f] = roster;
  const live = { id: 1, table: 2, status: 'LIVE', team1: [a, b], team2: [c, d], games: [g('', '')] };
  const state = extra => ({ players: roster, matches: [live], bracketData: null, ...extra });

  it('refuses unknown, identical or busy players', () => {
    const pick = { error: 'Pick the player who is leaving and their replacement.' };
    assert.deepEqual(L.substitutePlayer(state(), 1, 99), pick);
    assert.deepEqual(L.substitutePlayer(state(), 99, 1), pick);
    assert.deepEqual(L.substitutePlayer(state(), 1, 1), { error: 'Pick two different players.' });
    assert.deepEqual(L.substitutePlayer(state(), 5, 3), { error: 'P3 is playing on table 2 right now.' });
  });

  it('accepts ids as the text a dropdown gives, including text ids', () => {
    assert.equal(L.substitutePlayer(state(), '2', '5').matches[0].team1[1].name, 'P5');
    const withText = [...roster, { ...f, id: 'p9', name: 'P9' }];
    assert.equal(L.substitutePlayer(state({ players: withText }), '2', 'p9').matches[0].team1[1].name, 'P9');
  });

  it('takes the leaving player’s place in a live match, pausing them', () => {
    const result = L.substitutePlayer(
      state({ players: roster.map(p => (p.id === 5 ? { ...p, active: false } : p)) }),
      2,
      5
    );
    assert.deepEqual(
      result.matches[0].team1.map(p => p.name),
      ['P1', 'P5']
    );
    assert.deepEqual(
      result.players.map(p => p.active),
      [true, false, true, true, true, true]
    );
    assert.deepEqual(result.summary, [
      'P5 replaces P2 in the match on table 2.',
      "P2 is paused and won't be drawn again."
    ]);
    assert.equal(result.bracketData, null);
  });

  it('a player in no live match or bracket is just paused', () => {
    const done = { ...live, status: 'DONE', winner: 1 };
    const result = L.substitutePlayer(state({ matches: [done] }), 6, 5);
    assert.equal(result.matches[0], done);
    assert.deepEqual(result.summary, ["P6 is paused and won't be drawn again."]);
    assert.equal(f.active, true);
  });

  it('on a bracket team, replaces them for every match still to come only', () => {
    const t = [
      { id: 'team-1', name: 'P1 & P2', players: [a, b] },
      { id: 'team-2', name: 'P3 & P4', players: [c, d] }
    ];
    let bracket = L.generateBracketStructure(
      [...t, { id: 'team-3', name: 'P5', players: [e] }, teams(4)[3]],
      'single',
      1
    );
    bracket = play(bracket, 'm-winners-1-0', 1);
    // team-1 (P1 & P2) won its semi and waits in the final.
    const result = L.substitutePlayer({ players: roster, matches: [], bracketData: bracket }, 2, 6);
    const nb = result.bracketData;
    assert.notEqual(nb, bracket);
    assert.equal(matchById(nb, 'm-grandFinal-2-0').team1.name, 'P1 & P6');
    assert.equal(nb.originalTeams[0].name, 'P1 & P6');
    assert.deepEqual(
      matchById(nb, 'm-winners-1-0').team1.players.map(p => p.name),
      ['P1', 'P2']
    );
    assert.equal(bracket.originalTeams[0].name, 'P1 & P2');
    assert.deepEqual(result.summary, [
      'P1 & P6 plays the rest of the bracket (was P1 & P2).',
      "P2 is paused and won't be drawn again."
    ]);

    // A replacement whose team is still in the bracket is refused...
    assert.deepEqual(L.substitutePlayer({ players: roster, matches: [], bracketData: nb }, 1, 3), {
      error: 'P3 is still playing in the bracket (P3 & P4).'
    });
    // ...but one whose team is out may step in (P5's semi-final is lost here).
    const semi2 = play(nb, 'm-winners-1-1', 2);
    const out = matchById(semi2, 'm-winners-1-1');
    const loser = out.winner === 1 ? out.team2 : out.team1;
    assert.equal(loser.name, 'P3 & P4');
  });

  it('a 1v1 bracket swaps the whole team; teams without a players list are skipped', () => {
    const bracket = L.generateBracketStructure(
      [
        { id: 'team-1', name: 'P1', players: [a] },
        { id: 'team-2', name: 'P2', players: [b] },
        { id: 'odd', name: 'Odd' }
      ],
      'single',
      1
    );
    const result = L.substitutePlayer({ players: roster, matches: [], bracketData: bracket }, 1, 5);
    assert.equal(result.bracketData.originalTeams[0].name, 'P5');
    assert.equal(matchById(result.bracketData, 'm-grandFinal-2-0').team1.name, 'P5');
    // The automatic BYE win stays with the player who had it.
    assert.equal(matchById(result.bracketData, 'm-winners-1-0').team1.name, 'P1');
  });

  it('teams that are already out are left alone', () => {
    let bracket = L.generateBracketStructure(teams(2), 'single', 1);
    bracket.originalTeams[0].players = [a];
    bracket = play(bracket, 'm-grandFinal-1-0', 2);
    const result = L.substitutePlayer({ players: roster, matches: [], bracketData: bracket }, 1, 5);
    assert.equal(result.bracketData, bracket);
  });
});
