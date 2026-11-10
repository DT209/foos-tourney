// Importing files into saved tournaments (add / replace / keep both), and
// viewing a file read-only.
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

const { NAME, IMPORT, currentId, savedRows, recordIds, exportedTournament, openImport } = helpers(() => app);

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
    await app.click('Display Mode'); // a read-only file can go on a TV
    assert.ok(await app.page.$('[data-testid="display-board"]'));
    await app.click('Exit Display');
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
