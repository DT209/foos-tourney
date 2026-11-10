// Display Mode: a view-only board for TVs and phones with every table, a
// scrolling leaderboard and scrolling match history, sized relative to the
// screen. Scrolling and the ?display window are in display-scroll.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./display-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { BOARD, PHONE, TV, tables, boxOf } = helpers(() => app);

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
