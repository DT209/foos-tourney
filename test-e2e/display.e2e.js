// Display Mode: a view-only board for TVs and phones with every table, a
// scrolling leaderboard and scrolling match history, sized relative to the
// screen. Also the ?display second-screen window that follows live play.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const BOARD = '[data-testid="display-board"]';
const PHONE = { width: 390, height: 844 };
const TV = { width: 1920, height: 1080 };

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const tables = () =>
  app.page.$$eval('[data-testid="display-table"]', els =>
    els.map(e => ({ table: e.dataset.table, live: e.dataset.live === 'true', text: e.textContent }))
  );
const boxOf = (page, sel) => page.$eval(sel, e => e.getBoundingClientRect().toJSON());

describe('display mode', () => {
  it('replaces CSV Export in the header and opens a view-only board; Exit Display returns', async () => {
    app = await openApp();
    const header = await app.page.$eval('header', h => h.textContent);
    assert.match(header, /Display Mode/);
    assert.doesNotMatch(header, /CSV Export/);

    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    await app.click('Draw New Match');
    await app.fill('[data-testid="live-table"] input[type=number]', 4);
    await app.click('Display Mode');

    const board = await app.textOf(BOARD);
    assert.match(board, /Thursday DYP/);
    const [t1, t2] = await tables();
    assert.equal(t1.live, true);
    assert.match(t1.text, /Monster match/);
    assert.match(t1.text, / & .*vs.* & /, 'both pairs shown');
    assert.match(t1.text, /4/, 'current game score');
    assert.deepEqual([t2.table, t2.live], ['2', false]);
    assert.match(t2.text, /Free/);

    const standings = await app.page.$$eval('[data-testid="display-standing-row"]', rs => rs.map(r => r.textContent));
    assert.equal(
      standings.length,
      await app.page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('foosTourney.tournament.' + localStorage.getItem('foosTourney.currentTournament'))
          ).state.players.length
      )
    );
    assert.match(standings[0], /^1/);
    const history = await app.page.$$eval('[data-testid="display-history-row"]', rs => rs.map(r => r.textContent));
    assert.equal(history.length, 1);
    assert.match(history[0], /Monster/);

    assert.equal(await app.page.$('[data-testid="live-table"] input'), null, 'no edit controls');
    await app.click('Exit Display');
    assert.equal(await app.page.$(BOARD), null);
    assert.ok(await app.page.$('[data-testid="live-table"] input'));
  });

  it('shows bracket matches on their tables with their labels', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'single' });
    await app.click('Display Mode');
    const live = (await tables()).filter(t => t.live);
    assert.equal(live.length, 2);
    assert.ok(live.every(t => /Match \d/.test(t.text) && /vs/.test(t.text) && / & /.test(t.text)));
  });

  it('is available while locked', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    await app.click('Display Mode');
    assert.ok(await app.page.$(BOARD));
  });
});

describe('layout and sizing', () => {
  it('sizes are relative: text is larger on a TV than on a phone', async () => {
    app = await openApp({ viewport: PHONE });
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    const phoneSize = await app.page.$eval(BOARD, e => parseFloat(getComputedStyle(e).fontSize));
    await app.page.setViewport(TV);
    await app.pause(100);
    const tvSize = await app.page.$eval(BOARD, e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(tvSize > phoneSize * 1.5, `TV ${tvSize}px vs phone ${phoneSize}px`);
  });

  it('a TV shows tables on top with the leaderboard and history beside each other; a phone stacks them', async () => {
    app = await openApp({ viewport: TV });
    await app.addAllLeaderboardPlayers();
    await app.click('Display Mode');
    let tablesBox = await boxOf(app.page, '[data-testid="display-tables"]');
    let standingsBox = await boxOf(app.page, '[data-testid="display-standings"]');
    const historyBox = await boxOf(app.page, '[data-testid="display-history"]');
    assert.ok(standingsBox.top >= tablesBox.bottom - 1, 'tables on top on a TV');
    assert.ok(historyBox.left >= standingsBox.right - 1, 'leaderboard and history side by side');
    const board = await boxOf(app.page, BOARD);
    assert.ok(board.height <= TV.height + 1, 'fits the TV screen; panels scroll instead');

    await app.page.setViewport(PHONE);
    await app.pause(100);
    tablesBox = await boxOf(app.page, '[data-testid="display-tables"]');
    standingsBox = await boxOf(app.page, '[data-testid="display-standings"]');
    assert.ok(standingsBox.top >= tablesBox.bottom - 1, 'stacked on a phone');
    const pageWidth = await app.page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(pageWidth <= PHONE.width, 'no sideways scrolling on a phone');
  });
});

describe('auto-scroll', () => {
  it('a leaderboard too long for its panel scrolls by itself', async () => {
    app = await openApp({ viewport: PHONE });
    await app.addAllLeaderboardPlayers();
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    const panel = '[data-testid="display-standings"] [data-testid="auto-scroll"]';
    const overflow = await app.page.$eval(panel, e => e.scrollHeight - e.clientHeight);
    assert.ok(overflow > 0, 'the leaderboard overflows on a phone');
    await app.pause(3500); // past the pause at the top
    assert.ok((await app.page.$eval(panel, e => e.scrollTop)) > 0);
  });

  it('respects reduced motion: nothing moves on its own', async () => {
    app = await openApp({ viewport: PHONE });
    await app.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await app.addAllLeaderboardPlayers();
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    await app.pause(3500);
    assert.equal(
      await app.page.$eval('[data-testid="display-standings"] [data-testid="auto-scroll"]', e => e.scrollTop),
      0
    );
  });
});

describe('second screen', () => {
  it('?display opens a display-only window that follows live play and never saves', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    const id = await app.currentTournamentId();
    const savedAt = () =>
      app.page.evaluate(key => JSON.parse(localStorage.getItem(key)).savedAt, `foosTourney.tournament.${id}`);

    const second = await app.openPage('?display=1');
    await second.waitForSelector(BOARD);
    assert.equal(await second.$('header'), null, 'board only, no control desk');
    const before = await savedAt();

    await app.click('Draw New Match'); // on the control desk
    await second.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="display-table"]')].some(t => t.dataset.live === 'true'),
      { timeout: 5000 }
    );
    assert.notEqual(await savedAt(), before, 'the desk saved');
    const afterDesk = await savedAt();
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await savedAt(), afterDesk, 'the display window wrote nothing');

    // Exit Display in that window goes to the control desk.
    await app.flushCoverage(second);
    await second.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => /Exit Display/.test(b.textContent)).click()
    );
    await second.waitForSelector('header');
    assert.doesNotMatch(second.url(), /display/);
  });

  it('Open on Another Screen opens the display URL in a new window', async () => {
    app = await openApp();
    await app.click('Display Mode');
    await app.page.evaluate(() => {
      window.__opened = null;
      window.open = url => {
        window.__opened = url;
        return null;
      };
    });
    await app.click('Open on Another Screen');
    assert.match(await app.page.evaluate(() => window.__opened), /\?display=1&layout=top-50-50$/);
  });
});
