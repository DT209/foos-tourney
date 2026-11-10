// Publishing failures: publishing moved to another device, Firebase
// unreachable at the start, and a write that fails.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./publishing-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { addPlayer, newTournament, waitFor } = helpers(() => app);

describe('failures', () => {
  it('says so when publishing moved to another device, and stops sending', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    const id = await app.currentTournamentId();
    const server = await app.remoteServer();
    server.tournaments[id].ownerUid = 'elsewhere';
    await app.setRemoteServer(server);
    await addPlayer('Andrew');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="publish-status"]')));
    assert.match(await app.textOf('[data-testid="publish-status"]'), /Publishing moved to another device/);
    assert.doesNotMatch(await app.textOf('[data-testid="publishing-button"]'), /Live/);
    assert.equal(await app.page.evaluate(() => localStorage.getItem('foosTourney.publishing')), null);
    await app.click('Dismiss');
    assert.equal(await app.page.$('[data-testid="publish-status"]'), null);
  });

  it('runs normally when Firebase is unreachable at the start', async () => {
    app = await openApp({ remote: true });
    await app.setRemoteConfig({ unavailable: true });
    await newTournament();
    assert.match(await app.textOf('[data-testid="publish-status"]'), /this tournament isn't published/);
  });

  it('says a change is waiting when a write fails', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    await app.setRemoteConfig({ unavailable: true });
    await addPlayer('Andrew');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="publish-status"]')));
    assert.match(await app.textOf('[data-testid="publish-status"]'), /latest change isn't published yet/);
  });
});
