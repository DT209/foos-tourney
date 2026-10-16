// Exporting tournaments to JSON files, importing them into saved
// tournaments (add / replace / keep both), and viewing a file read-only.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const RECORD_PREFIX = 'foosTourney.tournament.';
const NAME = 'input[placeholder="e.g. Friday Night Open"]';
const SAVED = '[data-testid="saved-tournaments"]';
const IMPORT = '[data-testid="import-dialog"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const currentId = () => app.page.evaluate(() => localStorage.getItem('foosTourney.currentTournament'));
const savedRows = () =>
  app.page.$$eval('[data-testid="saved-tournament"]', rows =>
    rows.map(r => ({ id: r.dataset.tournamentId, text: r.textContent }))
  );
const recordIds = async () =>
  (await app.storageKeys()).filter(k => k.startsWith(RECORD_PREFIX)).map(k => k.slice(RECORD_PREFIX.length));

// Builds a tournament with a roster and one finished match, exports it from
// the saved list, and returns the export.
async function exportedTournament() {
  await app.type(NAME, 'Week #3');
  await app.addAllLeaderboardPlayers();
  await app.playMonsterMatch();
  const id = await currentId();
  await app.click('Saved Tournaments');
  const file = await app.captureDownload('Export', { within: `[data-tournament-id="${id}"]` });
  await app.click('Close', { within: SAVED });
  return { id, file, roster: await app.rosterCount() };
}

async function openImport() {
  await app.click('Saved Tournaments');
  await app.click('Import', { within: SAVED });
}

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
    await app.click('Saved Tournaments');
    const file = await app.captureDownload('Export', { within: `[data-tournament-id="${olderId}"]` });
    assert.equal(JSON.parse(file.text).tournament.tournamentName, 'Older');
  });
});

describe('import dialog', () => {
  it('offers a file and Firebase (not yet available); Cancel closes it', async () => {
    app = await openApp();
    await openImport();
    const text = await app.textOf(IMPORT);
    assert.match(text, /From a file/);
    assert.match(text, /From Firebase/);
    assert.match(text, /Coming soon/);
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

describe('importing into saved tournaments', () => {
  it('adds a tournament from another browser without switching to it; it can then be opened', async () => {
    app = await openApp();
    const { id, file, roster } = await exportedTournament();
    await app.close();

    app = await openApp(); // a fresh browser profile
    const ownId = await currentId();
    await openImport();
    await app.chooseImportFile(file.text);
    await app.click('Add to Saved Tournaments', { within: IMPORT });
    assert.equal(await currentId(), ownId, 'still on our own tournament');
    assert.deepEqual((await recordIds()).sort(), [id, ownId].sort());
    const rows = await savedRows();
    assert.ok(
      rows.some(r => r.id === id && /Week #3/.test(r.text)),
      'the list refreshes'
    );

    await app.click('Open', { within: `[data-tournament-id="${id}"]` });
    assert.equal(await currentId(), id);
    assert.equal(await app.rosterCount(), roster);
    assert.match(await app.textOf('[data-testid="match-history"]'), /Monster/);
  });

  it('an already-saved tournament can be replaced', async () => {
    app = await openApp();
    const { id, file } = await exportedTournament();
    await app.type(NAME, 'Renamed Later');
    await openImport();
    await app.chooseImportFile(file.text);
    assert.match(await app.textOf(IMPORT), /already saved/);
    await app.click('Replace Saved Copy', { within: IMPORT });
    assert.deepEqual(await recordIds(), [id]);
    assert.equal(await app.page.$eval(NAME, e => e.value), 'Week #3', 'the open tournament shows the replaced data');
  });

  it('or kept alongside as a copy with a new id', async () => {
    app = await openApp();
    const { id, file } = await exportedTournament();
    await openImport();
    await app.chooseImportFile(file.text);
    await app.click('Keep Both', { within: IMPORT });
    const ids = await recordIds();
    assert.equal(ids.length, 2);
    const copyId = ids.find(x => x !== id);
    const copy = (await savedRows()).find(r => r.id === copyId);
    assert.match(copy.text, /Week #3 \(copy\)/);
    assert.equal(await currentId(), id);
  });

  it('reports when the browser cannot store the import', async () => {
    app = await openApp();
    const { file } = await exportedTournament();
    await app.close();
    app = await openApp({
      beforeLoad: () => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (sessionStorage.getItem('__fullStorage')) throw new Error('QuotaExceededError');
          return real.call(this, key, value);
        };
      }
    });
    await openImport();
    await app.chooseImportFile(file.text);
    await app.page.evaluate(() => sessionStorage.setItem('__fullStorage', '1'));
    await app.click('Add to Saved Tournaments', { within: IMPORT });
    assert.equal(app.dialogs.at(-1), 'Could not save the imported tournament in this browser.');
  });
});

describe('read-only view', () => {
  it('shows a file without saving it, with editing disabled, until closed', async () => {
    app = await openApp();
    const { id, file, roster } = await exportedTournament();
    await app.close();

    app = await openApp();
    await app.type(NAME, 'Mine');
    const ownId = await currentId();
    const keysBefore = (await app.storageKeys()).sort();
    await openImport();
    await app.chooseImportFile(file.text);
    await app.click('View Read-only', { within: IMPORT });

    assert.match(await app.textOf('[data-testid="read-only-banner"]'), /Week #3/);
    assert.equal(await app.rosterCount(), roster);
    assert.equal(await app.page.$eval(NAME, e => e.disabled), true);
    await assert.rejects(app.click('Draw New Match'), /No visible, enabled button/);
    await assert.rejects(app.click('Admin Lock'), /No visible, enabled button/);
    await assert.rejects(app.click('Saved Tournaments'), /No visible, enabled button/);
    await app.click('CSV Export'); // exporting results still works
    assert.deepEqual((await app.storageKeys()).sort(), keysBefore, 'nothing written to storage');
    assert.equal((await recordIds()).includes(id), false);

    await app.click('Close View');
    assert.equal(await app.page.$('[data-testid="read-only-banner"]'), null);
    assert.equal(await app.page.$eval(NAME, e => e.value), 'Mine');
    assert.equal(await currentId(), ownId);
  });

  it('a reload returns to your own tournament', async () => {
    app = await openApp();
    const { file } = await exportedTournament();
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    const ownId = await currentId();
    await openImport();
    await app.chooseImportFile(file.text);
    await app.click('View Read-only', { within: IMPORT });
    await app.reload();
    assert.equal(await app.page.$('[data-testid="read-only-banner"]'), null);
    assert.equal(await currentId(), ownId);
    assert.equal(await app.rosterCount(), 0);
  });
});
