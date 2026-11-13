// Table names in files: Export JSON carries them, every import path (Add to
// Saved Tournaments, Replace Saved Copy, Keep Both) restores them, older files
// import with none, and invalid names are refused.
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

const { SAVED, values, nameTables, exportOf, importFile } = helpers(() => app);
const HEADING = '[data-testid="table-heading"]';
const COUNT = '[data-testid="table-count-select"]';
const headings = () => app.page.$$eval(HEADING, els => els.map(e => e.textContent));
const savedIds = () => app.page.$$eval(`${SAVED} [data-tournament-id]`, els => els.map(e => e.dataset.tournamentId));

describe('table names in files', () => {
  it('Export JSON contains them and importing the file restores them', async () => {
    app = await openApp();
    await nameTables('Center', 'Back');
    const id = await app.currentTournamentId();
    const file = await app.exportFromSaved('JSON', id);
    assert.deepEqual(JSON.parse(file.text).tournament.tableNames, ['Center', 'Back']);

    const copy = JSON.parse(file.text);
    copy.tournament.tournamentId = 'copy-1';
    await importFile(JSON.stringify(copy), 'Add to Saved Tournaments');
    await app.click('Open', { within: '[data-tournament-id="copy-1"]' });
    assert.deepEqual(await values(), ['Center', 'Back']);
  });

  it('an older file without names imports with none, and invalid names are refused', async () => {
    app = await openApp();
    await importFile(exportOf({ tournamentId: 'old-1', tournamentName: 'Old' }), 'Add to Saved Tournaments');
    await app.click('Open', { within: '[data-tournament-id="old-1"]' });
    assert.deepEqual(await values(), ['', '']);

    await app.click('Saved Tournaments');
    await app.click('Import', { within: SAVED });
    await app.chooseImportFile(exportOf({ tournamentId: 'bad-1', tableNames: ['x'.repeat(21)] }));
    assert.equal(app.dialogs.at(-1), 'This file has invalid tournament data (tableNames).');
  });
});

describe('table names through Replace Saved Copy and Keep Both', () => {
  it("Replace Saved Copy puts the file's names on screen", async () => {
    app = await openApp();
    await nameTables('Center', 'Back');
    const file = JSON.parse((await app.exportFromSaved('JSON', await app.currentTournamentId())).text);
    file.tournament.tableNames = ['North', ''];
    await importFile(JSON.stringify(file), 'Replace Saved Copy');
    assert.deepEqual(await values(), ['North', '']);
    assert.deepEqual(await headings(), ['North', 'Table 2']);
  });

  it('Keep Both gives the copy the same names, including ones above the table count', async () => {
    app = await openApp();
    await app.select(COUNT, 3);
    await nameTables('Center', 'Mid', 'Back');
    await app.select(COUNT, 2);
    const id = await app.currentTournamentId();
    const file = await app.exportFromSaved('JSON', id);
    assert.deepEqual(JSON.parse(file.text).tournament.tableNames, ['Center', 'Mid', 'Back'], 'hidden name exported');
    await importFile(file.text, 'Keep Both');
    const copyId = (await savedIds()).find(other => other !== id);
    await app.click('Open', { within: `[data-tournament-id="${copyId}"]` });
    assert.equal(await app.currentTournamentId(), copyId);
    assert.deepEqual(await values(), ['Center', 'Mid']);
    await app.select(COUNT, 3);
    assert.deepEqual(await values(), ['Center', 'Mid', 'Back']);
  });
});
