// Table names on every screen that shows a table: the pool and bracket
// headers, match cards, Display Mode (in the page, in a ?display window and
// when following a published tournament), a read-only view, and alerts.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./table-names-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { BOARD, IMPORT, OTHER_ID, values, texts, nameTables, exportOf, importFile, publishNamed } = helpers(() => app);
const HEADING = '[data-testid="table-heading"]';
const DISPLAY_HEADING = '[data-testid="display-table-heading"]';
const titles = selector => app.page.$$eval(selector, els => els.map(e => e.title));

describe('pool and bracket screens', () => {
  it('the pool header shows only the name when set; an unnamed table shows Table N', async () => {
    app = await openApp();
    await nameTables('Center');
    assert.deepEqual(await texts(HEADING), ['Center', 'Table 2']);
    assert.deepEqual(await titles(HEADING), ['Table 1', 'Table 2'], 'hover shows the number');
    await nameTables('');
    assert.deepEqual(await texts(HEADING), ['Table 1', 'Table 2']);
  });

  it('the bracket header shows only the name, and the match card badge shows number and name', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await nameTables('Center');
    await app.buildBracket({ teams: 4, elim: 'single' });
    assert.deepEqual(await texts(HEADING), ['Center', 'Table 2']);
    assert.deepEqual(await titles(HEADING), ['Table 1', 'Table 2']);
    const cards = await texts('[data-testid="match-card"]');
    assert.ok(
      cards.some(t => t.includes('Table 1 · Center')),
      'a card is badged with the name'
    );
    assert.ok(
      cards.some(t => /Table 2(?! ·)/.test(t)),
      'an unnamed table is just its number'
    );
  });

  it('the lower-table-count alert names the table', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="table-count-select"]', 3);
    await nameTables('', '', 'Back');
    for (let i = 0; i < 3; i++) await app.click('Draw New Match');
    await app.select('[data-testid="table-count-select"]', 2);
    assert.match(app.dialogs.at(-1), /^Table 3 · Back has an open-play match in progress/);
  });
});

describe('Display Mode', () => {
  it('shows the name in place of Table N, and Table N for an unnamed table', async () => {
    app = await openApp();
    await nameTables('Center');
    await app.click('Display Mode');
    await app.page.waitForSelector(BOARD);
    assert.deepEqual(await texts(DISPLAY_HEADING), ['Center', 'Table 2']);
    assert.deepEqual(await titles(DISPLAY_HEADING), ['Table 1', 'Table 2'], 'hover shows the number');
    assert.doesNotMatch(await app.textOf('[data-testid="display-table"][data-table="1"]'), /Table 1/);
  });

  it('a ?display window shows the name and follows a rename', async () => {
    app = await openApp();
    await nameTables('Center');
    const second = await app.openPage('?display=1');
    await second.waitForSelector(BOARD);
    assert.deepEqual(await texts(DISPLAY_HEADING, second), ['Center', 'Table 2']);
    await nameTables('Front');
    await second.waitForFunction(
      () => document.querySelector('[data-testid="display-table-heading"]')?.textContent === 'Front',
      {
        timeout: 5000
      }
    );
  });

  it('a followed published tournament shows its names', async () => {
    app = await openApp({ remote: true });
    await publishNamed(['Center', '', 'Back']);
    const viewer = await app.openPage(`?remote=${OTHER_ID}`);
    await viewer.waitForSelector(BOARD);
    assert.deepEqual(await texts(DISPLAY_HEADING, viewer), ['Center', 'Table 2']);
  });
});

describe('read-only view', () => {
  it('shows the names of the file, and Close View restores your own', async () => {
    app = await openApp();
    await nameTables('Mine');
    const file = exportOf({ tournamentId: 'file-1', tournamentName: 'File', tableNames: ['Theirs', 'Also'] });
    await importFile(file, 'View Read-only');
    assert.ok(await app.page.$('[data-testid="read-only-banner"]'));
    assert.deepEqual(await values(), ['Theirs', 'Also']);
    assert.deepEqual(await texts(HEADING), ['Theirs', 'Also']);
    assert.deepEqual(await app.page.$$eval('[data-testid="table-name-input"]', els => els.map(e => e.disabled)), [
      true,
      true
    ]);
    await app.click('Close View');
    assert.deepEqual(await values(), ['Mine', '']);
    assert.equal(await app.page.$(IMPORT), null);
  });
});
