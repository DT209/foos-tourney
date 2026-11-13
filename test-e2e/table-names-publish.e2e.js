// Renaming a table is a watched change: it is published. Own file because it
// waits out the real 5-second publish throttle.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const publishing = require('./publishing-helpers');
const names = require('./table-names-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { writes, addPlayer, newTournament, waitFor } = publishing(() => app);
const { nameTables } = names(() => app);

describe('publishing table names', () => {
  it('a rename sends a write that carries the names', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    await addPlayer('Andrew');
    await waitFor(async () => (await writes()).length === 1);
    assert.deepEqual(JSON.parse((await writes())[0].exportText).tournament.tableNames, []);

    await nameTables('Center');
    await waitFor(async () => (await writes()).length === 2);
    assert.deepEqual(JSON.parse((await writes())[1].exportText).tournament.tableNames, ['Center']);
  });
});
