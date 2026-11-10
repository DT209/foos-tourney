// Exporting tournaments to JSON files, the import dialog, and validating
// imported files. See also import-saved.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./import-export-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { NAME, IMPORT, currentId, exportedTournament, openImport } = helpers(() => app);

describe('export', () => {
  it('downloads the full tournament as a versioned JSON file', async () => {
    app = await openApp();
    const { id, file, roster } = await exportedTournament();
    assert.equal(file.mimeType, 'application/json');
    assert.match(file.name, new RegExp(`^Week__3_\\d{4}-\\d{2}-\\d{2}_${id.slice(0, 8)}\\.json$`));
    const parsed = JSON.parse(file.text);
    assert.equal(parsed.format, 'foos-tourney');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.tournament.tournamentId, id);
    assert.equal(parsed.tournament.tournamentName, 'Week #3', 'a # in the name survives the download');
    assert.equal(parsed.tournament.players.length, roster);
    assert.equal(parsed.tournament.matches[0].status, 'DONE');
  });

  it('any saved tournament can be exported, not just the current one', async () => {
    app = await openApp();
    await app.type(NAME, 'Older');
    const olderId = await currentId();
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    const file = await app.exportFromSaved('JSON', olderId);
    assert.equal(JSON.parse(file.text).tournament.tournamentName, 'Older');
  });
});

describe('import dialog', () => {
  it('offers a file and Firebase (off until publishing is set up); Cancel closes it', async () => {
    app = await openApp();
    await openImport();
    const text = await app.textOf(IMPORT);
    assert.match(text, /From a file/);
    assert.match(text, /From Firebase/);
    assert.match(text, /Publishing isn't set up on this page/);
    const firebaseDisabled = await app.page.$eval('[data-testid="import-source-firebase"]', b => b.disabled);
    assert.equal(firebaseDisabled, true);
    await app.click('From a file', { within: IMPORT }); // opens the OS picker; nothing to choose headless
    await app.click('Cancel', { within: IMPORT });
    assert.equal(await app.page.$(IMPORT), null);
  });

  it('rejects files that are not tournament exports', async () => {
    app = await openApp();
    await openImport();
    await app.chooseImportFile('{"hello": "world"}');
    assert.equal(app.dialogs.at(-1), "This file isn't a Foos Tourney tournament export.");
    await app.chooseImportFile('not json at all');
    assert.equal(app.dialogs.at(-1), "This file isn't a Foos Tourney tournament export.");
  });

  it('shows what the file contains before importing', async () => {
    app = await openApp();
    const { file, roster } = await exportedTournament();
    await openImport();
    await app.chooseImportFile(file.text);
    const text = await app.textOf(IMPORT);
    assert.match(text, /Week #3/);
    assert.match(text, new RegExp(`${roster} players`));
    assert.match(text, /1 matches/);
  });
});

describe('import validation', () => {
  const exportOf = tournament => JSON.stringify({ format: 'foos-tourney', version: 1, tournament });

  it('rejects a file with malformed data instead of crashing', async () => {
    app = await openApp();
    await openImport();
    await app.chooseImportFile(exportOf({ tournamentId: 'abc', players: [null] }));
    assert.equal(app.dialogs.at(-1), 'This file has invalid tournament data (players).');
    await app.chooseImportFile(exportOf({ tournamentId: 'abc', tableCount: 1000000000 }));
    assert.equal(app.dialogs.at(-1), 'This file has invalid tournament data (tableCount).');
  });

  it('a file that is locked without a PIN opens unlocked', async () => {
    app = await openApp();
    await openImport();
    await app.chooseImportFile(exportOf({ tournamentId: 'locked-no-pin', tournamentName: 'Locked', isLocked: true }));
    await app.click('Add to Saved Tournaments', { within: IMPORT });
    await app.click('Open', { within: '[data-tournament-id="locked-no-pin"]' });
    assert.doesNotMatch(await app.text(), /View Only Mode/);
    assert.equal(await app.page.$eval(NAME, e => e.disabled), false);
  });
});
