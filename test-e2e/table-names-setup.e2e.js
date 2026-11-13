// Table names on the setup screen: one optional input per table, capped and
// cleaned, saved, and locked with the rest of the setup. Files: table-names-files.e2e.js.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./table-names-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { INPUT, input, inputCount, values, savedState, nameTables, exportOf, importFile } = helpers(() => app);

describe('table name inputs', () => {
  it('follow the Tables Available count, with a label and a placeholder', async () => {
    app = await openApp();
    assert.equal(await inputCount(), 2);
    assert.equal(await app.page.$eval(input(1), e => e.getAttribute('aria-label')), 'Table 1 name');
    assert.equal(await app.page.$eval(input(1), e => e.placeholder), 'Optional Name');
    assert.equal(await app.page.$eval(input(1), e => e.title), 'Optional Name');
    assert.equal(await app.page.$eval(input(1), e => e.maxLength), 20);
    await app.select('[data-testid="table-count-select"]', 5);
    assert.equal(await inputCount(), 5);
    assert.deepEqual(await app.page.$$eval('[data-testid="table-name-number"]', els => els.map(e => e.textContent)), [
      '1',
      '2',
      '3',
      '4',
      '5'
    ]);
    await app.select('[data-testid="table-count-select"]', 1);
    assert.equal(await inputCount(), 1);
  });

  it('cap a name at 20 characters and strip < and >', async () => {
    app = await openApp();
    await nameTables('a'.repeat(30), 'Ce<nt>er');
    assert.deepEqual(await values(), ['a'.repeat(20), 'Center']);
    assert.deepEqual((await savedState()).tableNames, ['a'.repeat(20), 'Center']);
  });

  it('are saved and come back after a reload; a cleared name goes back to unnamed', async () => {
    app = await openApp();
    await nameTables('Center', 'Back');
    await app.reload();
    assert.deepEqual(await values(), ['Center', 'Back']);
    await nameTables('');
    assert.deepEqual((await savedState()).tableNames, ['', 'Back']);
  });

  it('are kept when the table count is lowered, and return when it is raised', async () => {
    app = await openApp();
    await app.select('[data-testid="table-count-select"]', 3);
    await nameTables('One', 'Two', 'Three');
    await app.select('[data-testid="table-count-select"]', 2);
    assert.deepEqual(await values(), ['One', 'Two']);
    await app.select('[data-testid="table-count-select"]', 3);
    assert.deepEqual(await values(), ['One', 'Two', 'Three']);
  });

  it('are carried into a New Tournament', async () => {
    app = await openApp();
    await nameTables('Center');
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    assert.deepEqual(await values(), ['Center', '']);
  });

  it('are disabled while the admin lock is on', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    assert.deepEqual(await app.page.$$eval(INPUT, els => els.map(e => e.disabled)), [true, true]);
    await app.click('View Only (Unlock)');
    await app.submitPin('2468');
    assert.deepEqual(await app.page.$$eval(INPUT, els => els.map(e => e.disabled)), [false, false]);
  });

  it('are disabled once the tournament is finished', async () => {
    app = await openApp();
    const finished = exportOf({
      tournamentId: 'done-1',
      tournamentName: 'Done',
      tableNames: ['Center'],
      finishedAt: '2026-10-17T05:00:00.000Z'
    });
    await importFile(finished, 'Add to Saved Tournaments');
    await app.click('Open', { within: '[data-tournament-id="done-1"]' });
    assert.deepEqual(await values(), ['Center', '']);
    assert.deepEqual(await app.page.$$eval(INPUT, els => els.map(e => e.disabled)), [true, true]);
  });
});
