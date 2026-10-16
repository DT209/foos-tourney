// Display Mode: resizing the areas with drag handles or the keyboard. Sizes
// are fractions (so they stay relative to the screen) and are remembered in
// this browser.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const TV = { width: 1600, height: 900 };
const COLS = '[data-testid="split-columns"]';
const ROWS = '[data-testid="split-rows"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const box = sel => app.page.$eval(sel, e => e.getBoundingClientRect().toJSON());
const widthShare = async () => {
  const tables = await box('[data-testid="display-tables"]');
  const board = await box('[data-testid="display-grid"]');
  return tables.width / board.width;
};
const heightShare = async () => {
  const standings = await box('[data-testid="display-standings"]');
  const history = await box('[data-testid="display-history"]');
  return standings.height / (standings.height + history.height);
};

// Drags a handle to (x, y) with pointer events (no real mouse).
async function drag(handle, to) {
  await app.page.evaluate(
    (sel, to) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const at = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, bubbles: true });
      el.dispatchEvent(new PointerEvent('pointerdown', at(r.left + r.width / 2, r.top + r.height / 2)));
      window.dispatchEvent(new PointerEvent('pointermove', at(to.x, to.y)));
      window.dispatchEvent(new PointerEvent('pointerup', at(to.x, to.y)));
    },
    handle,
    to
  );
  await app.pause(100);
}

async function openDisplay(options = {}) {
  app = await openApp({ viewport: TV, ...options });
  await app.addAllLeaderboardPlayers();
  await app.playMonsterMatch();
  await app.click('Display Mode');
}

describe('resizing display areas', () => {
  it('dragging the column handle resizes tables against the leaderboard and history', async () => {
    await openDisplay();
    assert.ok(Math.abs((await widthShare()) - 0.58) < 0.03, 'default split');
    const grid = await box('[data-testid="display-grid"]');
    await drag(COLS, { x: grid.left + grid.width * 0.4, y: grid.top + 50 });
    assert.ok(Math.abs((await widthShare()) - 0.4) < 0.03, `now ${await widthShare()}`);
    assert.equal(await app.page.$eval(COLS, e => e.getAttribute('aria-valuenow')), '40');
  });

  it('dragging the row handle resizes the leaderboard against match history', async () => {
    await openDisplay();
    const standings = await box('[data-testid="display-standings"]');
    const history = await box('[data-testid="display-history"]');
    const top = standings.top;
    const total = history.bottom - top;
    await drag(ROWS, { x: standings.left + 20, y: top + total * 0.75 });
    assert.ok(Math.abs((await heightShare()) - 0.75) < 0.04, `now ${await heightShare()}`);
  });

  it('areas never shrink below 20%', async () => {
    await openDisplay();
    const grid = await box('[data-testid="display-grid"]');
    await drag(COLS, { x: grid.left + 5, y: grid.top + 50 });
    assert.ok(Math.abs((await widthShare()) - 0.2) < 0.03);
  });

  it('the keyboard resizes in 5% steps and double-click resets', async () => {
    await openDisplay();
    await app.page.focus(COLS);
    await app.page.keyboard.press('ArrowLeft');
    await app.page.keyboard.press('ArrowLeft');
    assert.equal(await app.page.$eval(COLS, e => e.getAttribute('aria-valuenow')), '48');
    await app.page.focus(ROWS);
    await app.page.keyboard.press('ArrowDown');
    assert.equal(await app.page.$eval(ROWS, e => e.getAttribute('aria-valuenow')), '55');
    await app.page.keyboard.press('ArrowUp');
    await app.page.keyboard.press('ArrowUp');
    assert.equal(await app.page.$eval(ROWS, e => e.getAttribute('aria-valuenow')), '45');
    await app.page.keyboard.press('Enter'); // other keys do nothing
    assert.equal(await app.page.$eval(ROWS, e => e.getAttribute('aria-valuenow')), '45');
    await app.page.focus(COLS);
    await app.page.keyboard.press('ArrowRight');
    assert.equal(await app.page.$eval(COLS, e => e.getAttribute('aria-valuenow')), '53');

    await app.page.$eval(COLS, e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await app.page.$eval(ROWS, e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await app.pause();
    assert.equal(await app.page.$eval(COLS, e => e.getAttribute('aria-valuenow')), '58');
    assert.equal(await app.page.$eval(ROWS, e => e.getAttribute('aria-valuenow')), '50');
  });

  it('the layout is remembered in this browser, also by the second-screen window', async () => {
    await openDisplay();
    const grid = await box('[data-testid="display-grid"]');
    await drag(COLS, { x: grid.left + grid.width * 0.7, y: grid.top + 50 });
    await app.reload();
    await app.click('Display Mode');
    assert.ok(Math.abs((await widthShare()) - 0.7) < 0.03, 'restored after reload');

    const second = await app.openPage('?display=1');
    await second.waitForSelector('[data-testid="display-board"]');
    assert.equal(await second.$eval(COLS, e => e.getAttribute('aria-valuenow')), '70');
  });

  it('phones keep the stacked layout without handles', async () => {
    app = await openApp({ viewport: { width: 390, height: 844 } });
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    const visible = await app.page.$$eval(`${COLS}, ${ROWS}`, els => els.map(e => getComputedStyle(e).display));
    assert.deepEqual(visible, ['none', 'none']);
  });
});
