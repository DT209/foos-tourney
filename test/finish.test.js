const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, players } = require('./helpers');

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-30T05:00:00Z');
const opts = { id: ID, now: NOW };

// A finished single-elimination bracket between two teams.
function completedState(changes = {}) {
  const state = L.newTournamentState(ID, NOW);
  return {
    ...state,
    bracketData: {
      type: 'single',
      maxGames: 3,
      isCompleted: true,
      winnersRounds: [],
      losersRounds: null,
      grandFinals: null,
      thirdPlaceMatch: null,
      originalTeams: []
    },
    ...changes
  };
}

describe('finishing a tournament', () => {
  it('starts unfinished', () => {
    assert.equal(L.newTournamentState(ID, NOW).finishedAt, null);
  });

  it('is offered only once the bracket is complete, and only once', () => {
    assert.equal(L.canFinishTournament(completedState()), true);
    assert.equal(L.canFinishTournament(L.newTournamentState(ID, NOW)), false, 'no bracket');
    assert.equal(
      L.canFinishTournament(completedState({ bracketData: { type: 'single', isCompleted: false } })),
      false,
      'bracket still running'
    );
    assert.equal(L.canFinishTournament(completedState({ finishedAt: NOW.toISOString() })), false, 'already finished');
  });

  it('records when it finished', () => {
    assert.deepEqual(L.finishTournament(completedState(), NOW), { finishedAt: '2026-10-30T05:00:00.000Z' });
  });

  it('refuses a tournament whose bracket is not complete', () => {
    assert.deepEqual(L.finishTournament(L.newTournamentState(ID, NOW), NOW), {
      error: 'A tournament can only be finished once its bracket is complete.'
    });
  });
});

describe('finishedAt in saved and imported data', () => {
  it('keeps a valid finish time and drops anything else', () => {
    const finished = completedState({ finishedAt: '2026-10-30T05:00:00.000Z' });
    assert.equal(L.restoreTournamentState(finished, opts).finishedAt, '2026-10-30T05:00:00.000Z');
    assert.equal(L.restoreTournamentState({ ...finished, finishedAt: 'soon' }, opts).finishedAt, null);
    assert.equal(L.restoreTournamentState({ ...finished, finishedAt: 5 }, opts).finishedAt, null);
    const older = { ...finished };
    delete older.finishedAt;
    assert.equal(L.restoreTournamentState(older, opts).finishedAt, null, 'files from before finishing existed');
  });

  it('travels in Export JSON, so an edited file decides whether it is still finished', () => {
    const text = L.serializeTournamentExport(completedState({ finishedAt: '2026-10-30T05:00:00.000Z' }), NOW);
    assert.equal(L.parseTournamentExport(text).tournament.finishedAt, '2026-10-30T05:00:00.000Z');
    const reopened = text.replace('"finishedAt": "2026-10-30T05:00:00.000Z"', '"finishedAt": null');
    assert.equal(L.parseTournamentExport(reopened).tournament.finishedAt, null);
    assert.match(
      L.parseTournamentExport(text.replace('"finishedAt": "2026-10-30T05:00:00.000Z"', '"finishedAt": "nope"')).error,
      /invalid tournament data \(finishedAt\)/
    );
  });
});

describe('tournamentEditLock', () => {
  it('names why editing is off, finished first since nothing can lift it here', () => {
    const at = '2026-10-30T05:00:00.000Z';
    assert.equal(L.tournamentEditLock({ isLocked: false, readOnly: false, finishedAt: null }), null);
    assert.equal(L.tournamentEditLock({ isLocked: true, readOnly: false, finishedAt: null }), 'pin');
    assert.equal(L.tournamentEditLock({ isLocked: false, readOnly: true, finishedAt: null }), 'readOnly');
    assert.equal(L.tournamentEditLock({ isLocked: true, readOnly: true, finishedAt: at }), 'finished');
    assert.equal(L.tournamentEditLock({ isLocked: false, readOnly: false, finishedAt: at }), 'finished');
  });
});

describe('the Display Mode board', () => {
  it('says whether the tournament is finished, and finishing counts as a watched change', () => {
    const live = completedState({ players: players(2) });
    const done = { ...live, finishedAt: '2026-10-30T05:00:00.000Z' };
    assert.equal(L.boardForTournament(live).finished, false);
    assert.equal(L.boardForTournament(done).finished, true);
    assert.equal(
      L.watchedChanged(L.watchedSections(L.boardForTournament(live)), L.watchedSections(L.boardForTournament(done))),
      true
    );
  });
});
