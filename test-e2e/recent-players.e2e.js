// Adding players from the previous 3 tournaments who aren't on the club
// leaderboard (e.g. guests): picker section, autocomplete, and no guest prompt.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const NAME_INPUT = 'input[placeholder="Search leaderboard or enter a guest name"]';
const RECENT = '[data-testid="picker-recent"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const rosterNames = () => app.page.$$eval('[data-testid="player-row"]', rows => rows.map(r => r.dataset.playerName));
const submitName = async name => {
  await app.type(NAME_INPUT, name);
  await app.page.evaluate(sel => document.querySelector(sel).form.requestSubmit(), NAME_INPUT);
  await app.pause();
};
const addGuest = async name => {
  await submitName(name);
  await app.click('Add Anyway');
};
const newTournament = async () => {
  await app.click('New Tournament');
  await app.click('Start New Tournament');
};
const recentNames = () =>
  app.page.$$eval(`${RECENT} [data-testid="picker-option"]`, els => els.map(e => e.dataset.name));

describe('recent players', () => {
  it('the picker lists guests from previous tournaments, and they can be added', async () => {
    app = await openApp();
    await addGuest('Guesty');
    await submitName('Andrew'); // on the leaderboard: stays in the leaderboard list
    await newTournament();

    await app.click('Add from Leaderboard');
    assert.match(await app.textOf(RECENT), /Recent players/);
    assert.deepEqual(await recentNames(), ['Guesty']);
    await app.page.$eval(`${RECENT} [data-name="Guesty"] input`, e => e.click());
    await app.click('Selected');
    assert.deepEqual(await rosterNames(), ['Guesty']);
  });

  it('only the previous 3 tournaments count', async () => {
    app = await openApp();
    for (const guest of ['Gone', 'Second', 'Third', 'Fourth']) {
      await addGuest(guest);
      await newTournament();
    }
    await app.click('Add from Leaderboard');
    assert.deepEqual((await recentNames()).sort(), ['Fourth', 'Second', 'Third']);
  });

  it('autocomplete suggests recent players, and typing one adds them without the guest prompt', async () => {
    app = await openApp();
    await addGuest('Guesty');
    await newTournament();
    const promptsBefore = app.dialogs.length;

    await app.page.focus(NAME_INPUT);
    await app.page.type(NAME_INPUT, 'gue');
    const suggestions = await app.page.$$eval('[data-testid="player-suggestion"]', els => els.map(e => e.textContent));
    assert.ok(suggestions.includes('Guesty'));
    await app.page.evaluate(sel => document.querySelector(sel).form.requestSubmit(), NAME_INPUT);
    await app.pause();
    assert.match(await app.page.$eval(NAME_INPUT, e => e.value), /^gue$/i, 'partial name still prompts');
    await app.click('Cancel');

    await submitName('Guesty');
    assert.equal(await app.page.$('[data-testid="guest-confirm"]'), null, 'no "add anyway" prompt');
    assert.deepEqual(await rosterNames(), ['Guesty']);
    assert.equal(app.dialogs.length, promptsBefore);
  });

  it('a recent player already on the roster shows as added', async () => {
    app = await openApp();
    await addGuest('Guesty');
    await newTournament();
    await submitName('Guesty');
    await app.click('Add from Leaderboard');
    const row = `${RECENT} [data-name="Guesty"]`;
    assert.match(await app.textOf(row), /On roster/);
    assert.equal(await app.page.$eval(`${row} input`, e => e.disabled && e.checked), true);
  });

  it('there is no recent section before any previous tournament', async () => {
    app = await openApp();
    await app.click('Add from Leaderboard');
    assert.equal(await app.page.$(RECENT), null);
  });
});
