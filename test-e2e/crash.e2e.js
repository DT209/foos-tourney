// A page that hits an error shows the message (and the browser, for
// reporting it) instead of going blank: a crash while drawing gets the crash
// screen with Reload; an error before the app starts gets a plain message.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

let app;
afterEach(async () => {
  if (!app) return;
  await app.close();
  app = null;
});

// The page's own errors are expected here; check them, then clear them.
function expectPageError(pattern) {
  assert.ok(
    app.errors.some(e => pattern.test(e)),
    `expected a page error matching ${pattern}: ${app.errors}`
  );
  app.errors.length = 0;
}

describe('errors', () => {
  it('a crash while drawing shows the error and the browser, with Reload, instead of a blank page', async () => {
    const crashWhileDrawing = () => {
      Date.prototype.toLocaleString = () => {
        throw new Error('test crash while drawing');
      };
    };
    app = await openApp({ beforeLoad: crashWhileDrawing, readySelector: '[data-testid="crash-screen"]' });
    const message = await app.textOf('[data-testid="crash-message"]');
    assert.match(message, /test crash while drawing/);
    assert.match(message, /Mozilla\/5\.0/, 'the browser, for reporting it');
    assert.match(await app.textOf('[data-testid="crash-screen"]'), /Something went wrong/);

    // Reloading drops the coverage recorded since the last flush, so the first
    // click is cancelled at the "leave page?" prompt (the harness stays on the
    // page): the prompt shows Reload ran, and the page stays to save coverage.
    // The second click reloads for real. Real mouse clicks, since the prompt
    // needs a user gesture.
    const { page } = app;
    await page.evaluate(() => {
      window.__stayOnPage = true;
      window.addEventListener('beforeunload', e => {
        if (window.__stayOnPage) e.preventDefault();
      });
    });
    await page.click('[data-testid="crash-reload"]');
    await app.pause(300);
    assert.equal(app.leavePrompts, 1, 'Reload tried to leave the page');
    await app.flushCoverage();

    await page.evaluate(() => {
      window.__stayOnPage = false;
    });
    await Promise.all([page.waitForNavigation(), page.click('[data-testid="crash-reload"]')]);
    await page.waitForSelector('[data-testid="crash-screen"]');
    expectPageError(/test crash while drawing/);
  });

  it('a crash that throws something other than an Error shows what was thrown', async () => {
    const throwString = () => {
      Date.prototype.toLocaleString = () => {
        throw 'plain string crash';
      };
    };
    app = await openApp({ beforeLoad: throwString, readySelector: '[data-testid="crash-screen"]' });
    assert.match(await app.textOf('[data-testid="crash-message"]'), /^plain string crash\n/);
    app.errors.length = 0;
  });

  it('an error before the app starts shows its message instead of a blank page', async () => {
    app = await openApp({ blockRequests: ['/tournament-logic.js'], readySelector: '[data-testid="start-error"]' });
    const text = await app.textOf('[data-testid="start-error"]');
    assert.match(text, /^The page could not start: /);
    assert.match(text, /Mozilla\/5\.0/);
    expectPageError(/./);
  });
});
