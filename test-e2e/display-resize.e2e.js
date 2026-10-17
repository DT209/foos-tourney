// Display Mode layouts: three arrangements (tables on top by default), resize
// handles for height and width that work by mouse, keyboard or TV remote, a
// layout that follows other windows of this browser, and ?layout= links for
// screens that can't drag. Sizes are fractions of the screen.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const TV = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };
const TABLES = '[data-testid="split-tables"]';
const STANDINGS = '[data-testid="split-standings"]';
const GRID = '[data-testid="display-grid"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const box = (sel, page = app.page) => page.$eval(sel, e => e.getBoundingClientRect().toJSON());
const valueOf = (sel, page = app.page) => page.$eval(sel, e => Number(e.getAttribute('aria-valuenow')));
const arrangement = (page = app.page) => page.$eval(GRID, e => e.dataset.arrangement);
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.04, `${message}: ${actual.toFixed(3)} vs ${expected}`);

// Shares of the space each handle divides, measured from the panels.
async function shares(page = app.page) {
  const tables = await box('[data-testid="display-tables"]', page);
  const standings = await box('[data-testid="display-standings"]', page);
  const history = await box('[data-testid="display-history"]', page);
  const grid = await box(GRID, page);
  const across = (await arrangement(page)) === 'left';
  const sideBySide = (await arrangement(page)) === 'top';
  return {
    tables: across ? tables.width / grid.width : tables.height / grid.height,
    standings: sideBySide
      ? standings.width / (standings.width + history.width)
      : standings.height / (standings.height + history.height)
  };
}

// Drags a handle with Chrome's real mouse input.
async function drag(handle, to) {
  const b = await box(handle);
  await app.page.mouse.move(b.left + b.width / 2, b.top + b.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 8 });
  await app.page.mouse.up();
  await app.pause(100);
}

async function openDisplay(options = {}) {
  app = await openApp({ viewport: TV, ...options });
  await app.addAllLeaderboardPlayers();
  await app.playMonsterMatch();
  await app.click('Display Mode');
}

describe('the default layout on a TV', () => {
  it('puts tables on top, with the leaderboard beside match history underneath', async () => {
    await openDisplay();
    assert.equal(await arrangement(), 'top');
    const tables = await box('[data-testid="display-tables"]');
    const standings = await box('[data-testid="display-standings"]');
    const history = await box('[data-testid="display-history"]');
    assert.ok(standings.top >= tables.bottom - 1, 'leaderboard below the tables');
    assert.ok(Math.abs(standings.top - history.top) < 2, 'leaderboard and history side by side');
    assert.ok(history.left >= standings.right - 1, 'history right of the leaderboard');
    near((await shares()).tables, 0.5, 'tables take half the height');
    near((await shares()).standings, 0.5, 'leaderboard and history share the width');
    assert.match(await app.textOf('[data-testid="layout-button"]'), /Layout: Tables on top/);
  });

  it('resizes height and width with a real mouse drag', async () => {
    await openDisplay();
    assert.equal(await app.page.$eval(TABLES, e => e.dataset.direction), 'y');
    assert.equal(await app.page.$eval(STANDINGS, e => e.dataset.direction), 'x');
    const grid = await box(GRID);
    await drag(TABLES, { x: grid.left + grid.width / 2, y: grid.top + grid.height * 0.35 });
    near((await shares()).tables, 0.35, 'tables height');
    assert.equal(await valueOf(TABLES), 35);

    const standings = await box('[data-testid="display-standings"]');
    const history = await box('[data-testid="display-history"]');
    const span = history.right - standings.left;
    await drag(STANDINGS, { x: standings.left + span * 0.7, y: standings.top + 40 });
    near((await shares()).standings, 0.7, 'leaderboard width');
  });

  it('never lets an area go below 20%', async () => {
    await openDisplay();
    const grid = await box(GRID);
    await drag(TABLES, { x: grid.left + 50, y: grid.top + 5 });
    near((await shares()).tables, 0.2, 'clamped');
  });
});

describe('arrangements', () => {
  it('the Layout button cycles Tables left and Stacked, with handles that follow', async () => {
    await openDisplay();
    await app.click('Layout: Tables on top');
    assert.equal(await arrangement(), 'left');
    const tables = await box('[data-testid="display-tables"]');
    const standings = await box('[data-testid="display-standings"]');
    const history = await box('[data-testid="display-history"]');
    assert.ok(standings.left >= tables.right - 1, 'leaderboard right of the tables');
    assert.ok(history.top >= standings.bottom - 1, 'history below the leaderboard');
    assert.equal(await app.page.$eval(TABLES, e => e.dataset.direction), 'x');
    assert.equal(await app.page.$eval(STANDINGS, e => e.dataset.direction), 'y');
    const grid = await box(GRID);
    await drag(TABLES, { x: grid.left + grid.width * 0.6, y: grid.top + 50 });
    near((await shares()).tables, 0.6, 'tables width in Tables left');

    await app.click('Layout: Tables left');
    assert.equal(await arrangement(), 'stacked');
    const s = await box('[data-testid="display-standings"]');
    const h = await box('[data-testid="display-history"]');
    assert.ok(h.top >= s.bottom - 1, 'history below the leaderboard');
    assert.ok(Math.abs(s.width - h.width) < 2, 'full-width rows');
    assert.equal(await app.page.$eval(STANDINGS, e => e.dataset.direction), 'y');

    await app.click('Layout: Stacked');
    assert.equal(await arrangement(), 'top');
  });

  it('a TV remote can do it all: OK on Layout, arrows on a focused handle', async () => {
    await openDisplay();
    await app.page.focus('[data-testid="layout-button"]');
    await app.page.keyboard.press('Enter');
    await app.pause();
    assert.equal(await arrangement(), 'left');
    await app.page.focus(TABLES);
    await app.page.keyboard.press('ArrowLeft');
    await app.page.keyboard.press('ArrowLeft');
    assert.equal(await valueOf(TABLES), 40);
    await app.page.keyboard.press('ArrowUp'); // the other direction does nothing here
    assert.equal(await valueOf(TABLES), 40);
    await app.page.focus(STANDINGS);
    await app.page.keyboard.press('ArrowDown');
    assert.equal(await valueOf(STANDINGS), 55);
    await app.page.keyboard.press('Enter'); // other keys do nothing
    assert.equal(await valueOf(STANDINGS), 55);

    await app.page.$eval(TABLES, e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await app.page.$eval(STANDINGS, e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await app.pause();
    assert.equal(await valueOf(TABLES), 50, 'double-click resets');
    assert.equal(await valueOf(STANDINGS), 50);
  });

  it('phones stack tables, leaderboard, then history, without handles or the Layout button', async () => {
    app = await openApp({ viewport: PHONE });
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    const hidden = await app.page.$$eval(`${TABLES}, ${STANDINGS}, [data-testid="layout-button"]`, els =>
      els.map(e => getComputedStyle(e).display)
    );
    assert.deepEqual(hidden, ['none', 'none', 'none']);
    const tables = await box('[data-testid="display-tables"]');
    const standings = await box('[data-testid="display-standings"]');
    const history = await box('[data-testid="display-history"]');
    assert.ok(standings.top >= tables.bottom - 1, 'leaderboard below tables');
    assert.ok(history.top >= standings.bottom - 1, 'history below leaderboard');
  });
});

describe('the layout across windows and devices', () => {
  it('is remembered in this browser', async () => {
    await openDisplay();
    await app.click('Layout: Tables on top');
    const grid = await box(GRID);
    await drag(TABLES, { x: grid.left + grid.width * 0.7, y: grid.top + 50 });
    await app.reload();
    await app.click('Display Mode');
    assert.equal(await arrangement(), 'left');
    near((await shares()).tables, 0.7, 'restored after reload');
  });

  it('follows changes from the laptop at once in a TV window (HDMI)', async () => {
    await openDisplay();
    const tv = await app.openPage('?display=1');
    await tv.waitForSelector(GRID);
    assert.equal(await arrangement(tv), 'top');
    await app.click('Layout: Tables on top');
    await app.page.focus(TABLES);
    await app.page.keyboard.press('ArrowRight');
    await new Promise(r => setTimeout(r, 200));
    assert.equal(await arrangement(tv), 'left');
    assert.equal(await valueOf(TABLES, tv), 55);
  });

  it('opens a second screen or viewer link with the current layout (?layout=)', async () => {
    await openDisplay();
    await app.click('Layout: Tables on top');
    await app.page.evaluate(() => {
      window.__opened = [];
      window.open = url => window.__opened.push(url);
    });
    await app.click('Open on Another Screen');
    const [url] = await app.page.evaluate(() => window.__opened);
    assert.match(url, /\?display=1&layout=left-50-50$/);
  });

  it('a ?layout= link sets the layout on a screen that cannot drag', async () => {
    app = await openApp({ viewport: TV });
    const tv = await app.openPage('?display=1&layout=stacked-30-60');
    await tv.waitForSelector(GRID);
    assert.equal(await arrangement(tv), 'stacked');
    assert.equal(await valueOf(TABLES, tv), 30);
    assert.equal(await valueOf(STANDINGS, tv), 60);
  });
});
