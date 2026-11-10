// Publishing: resuming when a published tournament is reopened, and never
// publishing the others.
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

const { DIALOG, writes, addPlayer, newTournament, waitFor } = helpers(() => app);

describe('resuming publishing', () => {
  it('resumes when a published tournament is reopened, and never publishes the others', async () => {
    app = await openApp({ remote: true });
    const firstId = await app.currentTournamentId();
    await newTournament();
    const publishedId = await app.currentTournamentId();
    await app.click('Saved Tournaments');
    await app.click('Open', { within: `[data-tournament-id="${firstId}"]` });
    await addPlayer('Andrew');
    await app.pause(5500);
    assert.equal((await writes()).length, 0, 'the local tournament is not published');
    await app.click('Publishing');
    assert.match(await app.textOf(DIALOG), /This browser publishes “Thursday DYP”/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /asks whether to replace/);
    await app.click('Close', { within: DIALOG });

    await app.click('Saved Tournaments');
    await app.click('Open', { within: `[data-tournament-id="${publishedId}"]` });
    await addPlayer('Bob');
    await waitFor(async () => (await writes()).length === 1);
    assert.equal((await writes())[0].id, publishedId);
  });
});
