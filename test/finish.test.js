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

describe('play duration', () => {
  const START = '2026-10-30T18:00:00.000Z';

  it('starts unset', () => {
    const state = L.newTournamentState(ID, NOW);
    assert.equal(state.playStartedAt, null);
    assert.equal(state.playEndedAt, null);
  });

  it('markPlayStarted sets the first draw time and keeps it after that', () => {
    assert.equal(L.markPlayStarted(null, NOW), NOW.toISOString());
    assert.equal(L.markPlayStarted(START, NOW), START);
  });

  it('playDurationMinutes needs both times and a sane order', () => {
    assert.equal(L.playDurationMinutes(null, null), null);
    assert.equal(L.playDurationMinutes(START, null), null);
    assert.equal(L.playDurationMinutes(null, START), null);
    assert.equal(L.playDurationMinutes(START, '2026-10-30T17:00:00.000Z'), null, 'end before start');
    assert.equal(L.playDurationMinutes(START, '2026-10-30T18:45:20.000Z'), 45);
    assert.equal(L.playDurationMinutes(START, START), 0);
  });

  it('formatDuration shows minutes, or hours and padded minutes', () => {
    assert.equal(L.formatDuration(45), '45 min');
    assert.equal(L.formatDuration(125), '2 h 05 min');
    assert.equal(L.formatDuration(60), '1 h 00 min');
  });

  it('is saved, restored, exported and re-imported', () => {
    const end = '2026-10-30T20:10:00.000Z';
    const state = completedState({ playStartedAt: START, playEndedAt: end });
    const restored = L.restoreTournamentState(state, opts);
    assert.equal(restored.playStartedAt, START);
    assert.equal(restored.playEndedAt, end);
    const text = L.serializeTournamentExport(state, NOW);
    const file = JSON.parse(text).tournament;
    assert.equal(file.playStartedAt, START);
    assert.equal(file.playEndedAt, end);
    const parsed = L.parseTournamentExport(text).tournament;
    assert.equal(parsed.playStartedAt, START);
    assert.equal(parsed.playEndedAt, end);
  });

  it('falls back to null for invalid values and for files from before it existed', () => {
    const bad = L.restoreTournamentState({ ...completedState(), playStartedAt: 'soon', playEndedAt: 7 }, opts);
    assert.equal(bad.playStartedAt, null);
    assert.equal(bad.playEndedAt, null);
    const older = completedState();
    delete older.playStartedAt;
    delete older.playEndedAt;
    const restored = L.restoreTournamentState(older, opts);
    assert.equal(restored.playStartedAt, null);
    assert.equal(restored.playEndedAt, null);
    const text = L.serializeTournamentExport(completedState(), NOW);
    assert.match(
      L.parseTournamentExport(text.replace('"playEndedAt": null', '"playEndedAt": "nope"')).error,
      /invalid tournament data \(playEndedAt\)/
    );
  });
});
