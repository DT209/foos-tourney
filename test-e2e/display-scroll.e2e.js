// Display Mode: auto-scrolling panels, and the ?display second-screen window
// that follows live play.
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

const { BOARD, PHONE } = helpers(() => app);

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
