// Plain-http pages on a LAN address (http://192.168.x.x) aren't secure
// contexts, so browsers leave out crypto.randomUUID and navigator.clipboard.
// The test server is 127.0.0.1 (secure), so this removes both before load.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const insecurePage = () => {
  delete Crypto.prototype.randomUUID;
  Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
};

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

describe('a plain-http LAN address', () => {
  it('loads and starts tournaments without crypto.randomUUID', async () => {
    app = await openApp({ beforeLoad: insecurePage, remote: true });
    assert.equal(await app.page.evaluate(() => typeof crypto.randomUUID), 'undefined');
    const firstId = await app.currentTournamentId();
    assert.match(firstId, UUID_V4);
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.pause(150);
    const secondId = await app.currentTournamentId();
    assert.match(secondId, UUID_V4);
    assert.notEqual(secondId, firstId);
  });

  it('explains that copying failed when there is no clipboard', async () => {
    app = await openApp({ beforeLoad: insecurePage, remote: true });
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.pause(150);
    await app.click('Publishing');
    await app.click('Copy Code');
    assert.match(app.dialogs.at(-1), /Copying failed/);
  });
});
