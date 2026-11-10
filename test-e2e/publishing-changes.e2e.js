// Publishing: which changes are sent and when (the 5-second write throttle).
// Resuming a reopened tournament is in publishing-resume, so the two waits
// on the throttle run in parallel.
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

const { writes, row, addPlayer, newTournament, waitFor } = helpers(() => app);

describe('sending changes', () => {
  it('sends only watched changes, at most every 5 seconds, carrying the latest state', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    await addPlayer('Andrew'); // leaderboard changes: a write is due
    await addPlayer('Bob');
    await app.click('Unpaid', { within: row('Andrew') }); // unwatched: rides along
    assert.equal((await writes()).length, 0, 'held back until 5 s after the start');
    await waitFor(async () => (await writes()).length === 1);
    const [first] = await writes();
    const sent = JSON.parse(first.exportText).tournament;
    assert.deepEqual(
      sent.players.map(p => [p.name, p.paid]),
      [
        ['Andrew', true],
        ['Bob', false]
      ]
    );

    await app.click('Unpaid', { within: row('Bob') }); // unwatched alone: nothing
    await app.pause(5500);
    assert.equal((await writes()).length, 1);

    await app.select('[data-testid="table-count-select"]', 3); // a third table: watched
    await waitFor(async () => (await writes()).length === 2);
    const second = JSON.parse((await writes())[1].exportText).tournament;
    assert.equal(second.players.find(p => p.name === 'Bob').paid, true, 'the paid flag rode along');
  });
});
