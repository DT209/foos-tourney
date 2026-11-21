// Play duration (issue #17): the tournament starts at the first Draw New Match
// and ends when the final results are shown. Both times are saved, exported and
// shown with the duration in the Tournament Complete dialog.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const QUESTION = '[data-testid="finish-question"]';
const DURATION = '[data-testid="play-duration"]';
const START = '2026-10-30T18:00:00.000Z';
const END = '2026-10-30T19:35:00.000Z';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const savedState = () =>
  app.page.evaluate(() => {
    const id = localStorage.getItem('foosTourney.currentTournament');
    return JSON.parse(localStorage.getItem(`foosTourney.tournament.${id}`)).state;
  });

const ENDED = '[data-testid="tournament-ended"]';
const clickTestId = id => app.page.$eval(`[data-testid="${id}"]`, b => b.click()).then(() => app.pause());

describe('play duration', () => {
  it('starts at the first draw, ends at the final results, and is saved and exported', async () => {
    app = await openApp();
    await app.setClock(START);
    await app.reload();
    await app.addAllLeaderboardPlayers();
    assert.equal((await savedState()).playStartedAt, null, 'not started before a draw');

    await app.click('Draw New Match');
    assert.equal((await savedState()).playStartedAt, START);

    await app.setClock(END);
    await app.reload();
    await app.click('Draw New Match');
    assert.equal((await savedState()).playStartedAt, START, 'a later draw keeps the first start');
    assert.equal((await savedState()).playEndedAt, null, 'not ended before the results');

    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    await app.page.waitForSelector(QUESTION);

    const shown = await app.textOf(DURATION);
    assert.match(shown, /Start: /);
    assert.match(shown, /End: /);
    assert.match(shown, /Duration: 1 h 35 min/);
    await app.click('Not Yet', { within: QUESTION });
    await app.click('Monster / Open Play Stage');
    const started = await app.textOf('[data-testid="tournament-started"]');
    const ended = await app.textOf('[data-testid="tournament-ended"]');
    assert.match(started, /^Started /);
    assert.match(ended, /^Ended /);
    await app.click('Bracket Playoff Stage');
    await app.click('Standings');
    await app.page.waitForSelector(QUESTION);
    const saved = await savedState();
    assert.equal(saved.playStartedAt, START);
    assert.equal(saved.playEndedAt, END);

    await app.click('Finish Tournament', { within: QUESTION });
    await app.page.waitForSelector('[data-testid="finished-exports"]');
    const json = await app.captureDownload('Export JSON', { within: '[data-testid="finished-exports"]' });
    const file = JSON.parse(json.text).tournament;
    assert.equal(file.playStartedAt, START);
    assert.equal(file.playEndedAt, END);

    await app.reload();
    const again = await savedState();
    assert.equal(again.playStartedAt, START, 'retrieved after a reload');
    assert.equal(again.playEndedAt, END);
  });

  it('Clear Matches resets the play times', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    assert.notEqual((await savedState()).playStartedAt, null);
    await app.click('Clear Matches');
    await app.click('Clear Matches', { within: '.fixed' });
    assert.equal(await app.page.$('[data-testid="tournament-ended"]'), null);
    assert.equal((await savedState()).playStartedAt, null);
    assert.equal((await savedState()).playEndedAt, null);
  });

  it('a bracket-only tournament starts at Build Bracket; Ended appears only once the final is shown', async () => {
    app = await openApp();
    await app.setClock(START);
    await app.reload();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    assert.equal((await savedState()).playStartedAt, START);
    assert.equal((await savedState()).playEndedAt, null);
    await app.click('Monster / Open Play Stage');
    assert.equal(await app.page.$(ENDED), null, 'no Ended before the final');
    await app.click('Bracket Playoff Stage');

    await app.setClock(END);
    await app.reload();
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    await app.page.waitForSelector(QUESTION);
    assert.match(await app.textOf(DURATION), /Duration: 1 h 35 min/);
  });

  it('redrawing the bracket clears the end time', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    await app.click('Not Yet', { within: QUESTION });
    assert.notEqual((await savedState()).playEndedAt, null);
    await app.buildBracket({ teams: 2, elim: 'single' });
    assert.equal((await savedState()).playEndedAt, null);
    assert.notEqual((await savedState()).playStartedAt, null, 'the start is kept');
    await app.click('Monster / Open Play Stage');
    assert.equal(await app.page.$(ENDED), null);
  });

  it('correcting the final keeps the first end time', async () => {
    app = await openApp();
    await app.setClock(START);
    await app.reload();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    await app.click('Not Yet', { within: QUESTION });
    const first = (await savedState()).playEndedAt;
    assert.equal(first, START);

    await app.setClock(END);
    await app.reload();
    await clickTestId('edit-bracket-match');
    const PIN_DIALOG = '[data-testid="admin-pin-dialog"]';
    await app.fill(`${PIN_DIALOG} input[type=password]`, '2468');
    await app.page.$eval(`${PIN_DIALOG} form`, f => f.requestSubmit());
    await app.pause();
    await app.page.select('[data-testid="edit-override"]', '2');
    await app.pause();
    await clickTestId('save-match-edit');
    await app.page.waitForSelector(QUESTION);
    assert.equal((await savedState()).bracketData.grandFinals[0].winner, 2, 'the correction was saved');
    assert.equal((await savedState()).playEndedAt, first);
  });
});
