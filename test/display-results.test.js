const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, teams, scoreFor } = require('./helpers');

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-20T05:00:00Z');

// A two-team single-elimination bracket, with its final won by `winner`
// (1 or 2), or unplayed when winner is null.
function bracket(winner) {
  const b = L.generateBracketStructure(teams(2), 'single', 1);
  if (winner === null) return b;
  // Two teams play a single final.
  scoreFor(L.listBracketMatches(b)[0].match, winner);
  return L.confirmBracketMatch(b, 'grandFinals', 0, 0).bracket;
}

const tournament = (winner, id = ID) => ({ ...L.newTournamentState(id, NOW), bracketData: bracket(winner) });

describe('bracketResults', () => {
  it('lists the top places only once the bracket is complete', () => {
    assert.equal(L.bracketResults(null), null);
    assert.equal(L.bracketResults(bracket(null)), null);
    assert.deepEqual(
      L.bracketResults(bracket(2)).map(r => [r.place, r.team.name]),
      [
        [1, 'T2'],
        [2, 'T1']
      ]
    );
    const empty = { ...bracket(1), winnersRounds: [], grandFinals: null, thirdPlaceMatch: null };
    assert.equal(L.bracketResults(empty), null, 'complete but with nobody placed');
  });

  it('is on the Display Mode board', () => {
    assert.equal(L.boardForTournament(tournament(null)).results, null);
    assert.equal(L.boardForTournament(tournament(1)).results[0].team.name, 'T1');
  });
});

describe('displayedTournament', () => {
  const local = tournament(null);
  const remoteView = { tournament: tournament(1, ID2) };
  it('is the tournament on the board, or null', () => {
    assert.equal(L.displayedTournament(false, { source: 'local' }, remoteView, local), null);
    assert.equal(L.displayedTournament(true, null, remoteView, local), null);
    assert.equal(L.displayedTournament(true, { source: 'local' }, remoteView, local), local);
    assert.equal(L.displayedTournament(true, { source: 'remote', id: ID2 }, remoteView, local), remoteView.tournament);
    assert.equal(L.displayedTournament(true, { source: 'remote', id: ID2 }, { loading: true }, local), null);
  });
});

describe('displayResultsStep', () => {
  // Feeds the tournaments in turn, as the board would show them, and returns
  // each call's `show`.
  const run = (...shown) => {
    let seen = null;
    return shown.map(t => {
      const step = L.displayResultsStep(seen, t);
      seen = step.seen;
      return step.show;
    });
  };

  it('opens when the shown bracket becomes complete', () => {
    assert.deepEqual(run(tournament(null), tournament(null), tournament(1), tournament(1)), [null, null, true, null]);
  });

  it('does not open for a tournament that was already complete when shown', () => {
    assert.deepEqual(run(tournament(1), tournament(1)), [null, null]);
    assert.deepEqual(run(tournament(null, ID2), tournament(1)), [null, false]);
  });

  it('opens again when a fix changes the champion', () => {
    assert.deepEqual(run(tournament(null), tournament(1), tournament(2)), [null, true, true]);
  });

  it('closes when the board leaves the tournament or its results go away', () => {
    assert.deepEqual(run(tournament(1), null, null), [null, false, null]);
    assert.deepEqual(run(tournament(null), tournament(1), tournament(null)), [null, true, false]);
  });

  it('remembers what it saw', () => {
    assert.deepEqual(L.displayResultsStep(null, tournament(2)).seen, { id: ID, champion: 'team-2' });
    assert.deepEqual(L.displayResultsStep(null, tournament(null)).seen, { id: ID, champion: null });
  });
});
