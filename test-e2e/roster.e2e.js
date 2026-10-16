// Roster panel: adding players (typed, autocomplete, guest, leaderboard
// picker), editing, pausing, payment, removal, and the narrow-screen menu.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const NAME_INPUT = 'input[placeholder="Search leaderboard or enter a guest name"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const rosterNames = () => app.page.$$eval('[data-testid="player-row"]', rows => rows.map(r => r.dataset.playerName));
const row = name => `[data-testid="player-row"][data-player-name="${name}"]`;
const submitName = async name => {
  await app.type(NAME_INPUT, name);
  await app.page.evaluate(sel => document.querySelector(sel).form.requestSubmit(), NAME_INPUT);
  await app.pause();
};

describe('adding players', () => {
  it('adds an exact leaderboard name directly and shows its ELO', async () => {
    app = await openApp();
    await submitName('Andrew');
    assert.deepEqual(await rosterNames(), ['Andrew']);
    assert.match(await app.textOf(row('Andrew')), /Doubles ELO: \d+/);
  });

  it('shows Singles ELO (or Unranked) in 1v1 format', async () => {
    app = await openApp();
    await submitName('Andrew');
    await app.select('[data-testid="format-select"]', '1v1');
    assert.match(await app.textOf(row('Andrew')), /Singles ELO: Unranked/);
  });

  it('rejects blank and duplicate names', async () => {
    app = await openApp();
    await submitName('   ');
    assert.equal(app.dialogs.at(-1), 'Please enter a valid player name.');
    await submitName('Andrew');
    await submitName('andrew');
    assert.equal(app.dialogs.at(-1), 'A player named "andrew" already exists in the roster.');
    assert.deepEqual(await rosterNames(), ['Andrew']);
  });

  it('asks before adding a guest; Cancel skips, Add Anyway adds', async () => {
    app = await openApp();
    await submitName('Guesty');
    assert.match(await app.text(), /Guesty/);
    await app.click('Cancel');
    assert.deepEqual(await rosterNames(), []);
    await submitName('Guesty');
    await app.click('Add Anyway');
    assert.deepEqual(await rosterNames(), ['Guesty']);
  });

  it('suggests leaderboard names while typing; picking one fills the input', async () => {
    app = await openApp();
    await app.page.focus(NAME_INPUT);
    await app.page.type(NAME_INPUT, 'mik');
    const suggestions = await app.page.$$eval('[data-testid="player-suggestion"]', els => els.map(e => e.textContent));
    assert.ok(suggestions.length > 0 && suggestions.every(s => /mik/i.test(s)));
    await app.page.evaluate(() =>
      document
        .querySelector('[data-testid="player-suggestion"]')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    );
    await app.pause();
    assert.equal(await app.page.$eval(NAME_INPUT, e => e.value), suggestions[0]);
    // Blurring hides the list after a short delay.
    await app.page.type(NAME_INPUT, 'x');
    await app.page.$eval(NAME_INPUT, e => e.blur());
    await app.pause(250);
    assert.equal(await app.page.$('[data-testid="player-suggestion"]'), null);
  });

  it('leaderboard picker: toggle, clear, select/deselect all, cancel, add', async () => {
    app = await openApp();
    await submitName('Andrew');
    await app.click('Add from Leaderboard');
    assert.match(await app.text(), /Club leaderboard: offline snapshot from \d{4}-\d{2}-\d{2}/);
    await app.page.$eval('[data-testid="picker-option"][data-name="Fred"] input', e => e.click());
    await app.pause();
    await app.page.$eval('[data-testid="picker-option"][data-name="Ivor"] input', e => e.click());
    await app.pause();
    await app.page.$eval('[data-testid="picker-option"][data-name="Ivor"] input', e => e.click());
    await app.pause();
    assert.match(await app.text(), /1 selected/);
    await app.click('Clear');
    assert.match(await app.text(), /0 selected/);
    await app.click('Select All');
    await app.click('Deselect All');
    assert.match(await app.text(), /0 selected/);
    await app.page.$eval('[data-testid="picker-option"][data-name="Fred"] input', e => e.click());
    await app.pause();
    await app.click('Cancel');
    assert.deepEqual(await rosterNames(), ['Andrew']);

    await app.click('Add from Leaderboard');
    await app.page.$eval('[data-testid="picker-option"][data-name="Fred"] input', e => e.click());
    await app.pause();
    await app.click('Selected');
    assert.deepEqual(await rosterNames(), ['Andrew', 'Fred']);
  });

  it('uses the live leaderboard when the club site responds', async () => {
    app = await openApp({ liveLeaderboard: [{ name: 'Live Larry', singlesElo: 1111, doublesElo: 1222 }] });
    await app.click('Add from Leaderboard');
    assert.match(await app.text(), /Club leaderboard: live/);
    assert.deepEqual(await app.page.$$eval('[data-testid="picker-option"]', els => els.map(e => e.dataset.name)), [
      'Live Larry'
    ]);
  });
});

describe('editing players (wide screen)', () => {
  it('toggles paid and paused, renames, and removes after confirming', async () => {
    app = await openApp();
    await submitName('Andrew');
    await app.click('Unpaid', { within: row('Andrew') });
    assert.match(await app.textOf(row('Andrew')), /Paid/);
    await app.click('Active', { within: row('Andrew') });
    assert.match(await app.textOf(row('Andrew')), /Paused/);
    assert.match(await app.text(), /Active: 0/);

    await app.click('✏️', { within: row('Andrew') });
    await app.type(`${row('Andrew')} input`, 'Drew <B>');
    await app.click('✓', { within: row('Andrew') });
    assert.deepEqual(await rosterNames(), ['Drew B']);

    await app.click('✏️', { within: row('Drew B') });
    await app.type(`${row('Drew B')} input`, '   ');
    await app.click('✓', { within: row('Drew B') });
    assert.deepEqual(await rosterNames(), ['Drew B'], 'a blank rename is ignored');

    await app.click('🗑️', { within: row('Drew B') });
    assert.match(app.dialogs.at(-1), /remove this player/);
    assert.deepEqual(await rosterNames(), []);
  });
});

describe('editing players (narrow screen menu)', () => {
  it('the ⋮ menu offers paid, pause, rename and delete, and closes on outside click', async () => {
    app = await openApp({ viewport: { width: 800, height: 900 } });
    await submitName('Andrew');
    const openMenu = () => app.click('⋮', { within: row('Andrew') });

    await openMenu();
    await app.page.$eval('[data-testid="action-menu-backdrop"]', e => e.click());
    await app.pause();
    assert.equal(await app.page.$('[data-testid="action-menu-backdrop"]'), null);

    await openMenu();
    await app.page.$eval(`${row('Andrew')} [title="Player options"]`, b => b.click());
    await app.pause();
    assert.equal(await app.page.$('[data-testid="action-menu-backdrop"]'), null, '⋮ again closes it');

    await openMenu();
    await app.click('Unpaid', { within: row('Andrew') });
    assert.match(await app.textOf(row('Andrew')), /Andrew/);
    await openMenu();
    await app.click('Paid', { within: row('Andrew') });
    await openMenu();
    await app.click('Active', { within: row('Andrew') });
    assert.match(await app.text(), /Active: 0/);
    await openMenu();
    await app.click('Edit Name', { within: row('Andrew') });
    await app.type(`${row('Andrew')} input`, 'Andy');
    await app.click('✓', { within: row('Andrew') });
    assert.deepEqual(await rosterNames(), ['Andy']);
    await app.click('⋮', { within: row('Andy') });
    await app.click('Delete Player', { within: row('Andy') });
    assert.deepEqual(await rosterNames(), []);
  });
});
