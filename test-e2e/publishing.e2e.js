// Publishing to Firebase from the control desk, with the recording fake
// remote (fake-remote.js): switched off, and starting to publish. See also the
// other publishing-*.e2e.js files.
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

const { DIALOG, methods, row, addPlayer, newTournament } = helpers(() => app);

describe('publishing switched off', () => {
  it('shows no Publishing button and Firebase import says it is not set up', async () => {
    app = await openApp();
    assert.equal(await app.page.$('[data-testid="publishing-button"]'), null);
    await app.click('Saved Tournaments');
    await app.click('Import…');
    assert.match(await app.textOf('[data-testid="import-dialog"]'), /Publishing isn't set up on this page/);
    assert.equal(await app.page.$eval('[data-testid="import-source-firebase"]', b => b.disabled), true);
  });
});

describe('starting to publish', () => {
  it('sends nothing before New Tournament: the first-visit tournament stays local', async () => {
    app = await openApp({ remote: true });
    await addPlayer('Andrew');
    await app.click('Unpaid', { within: row('Andrew') });
    await app.pause(300);
    assert.deepEqual(await methods(), []);
    await app.click('Publishing');
    assert.match(await app.textOf(DIALOG), /This tournament isn't published/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /read-only live copy/);
    assert.match(await app.textOf(DIALOG), /Moves a tournament published from another browser/);
    assert.match(await app.textOf(DIALOG), /doesn't stop publishing/);
    await app.click('Close', { within: DIALOG });
  });

  it('publishes on New Tournament, without the PIN or lock, and shows the code and link', async () => {
    app = await openApp({ remote: true });
    await app.click('Admin Lock'); // lock, then unlock: the PIN is set
    await app.submitPin('1234');
    await app.click('View Only (Unlock)');
    await app.submitPin('1234');
    await newTournament();
    assert.deepEqual(await methods(), ['startPublishing']);
    const id = await app.currentTournamentId();
    const server = await app.remoteServer();
    const published = JSON.parse(server.tournaments[id].exportText);
    assert.equal(published.tournament.adminPin, null);
    assert.equal(published.tournament.isLocked, false);
    assert.match(await app.textOf('[data-testid="publishing-button"]'), /Live/);

    await app.click('Publishing');
    const dialog = await app.textOf(DIALOG);
    assert.match(dialog, /Live in slot 1/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /sent within 5 seconds/);
    assert.match(dialog, /Copy Link puts it on the clipboard/);
    assert.match(dialog, /Save Code to File downloads a text file/);
    assert.match(await app.textOf('[data-testid="viewer-link"]'), new RegExp(`\\?remote=${id}&layout=top-50-50$`));
    const code = await app.textOf('[data-testid="publisher-code"]');
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(server.codes[id], code.replace(/-/g, ''));

    await app.page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = text => {
        window.__copied.push(text);
        return Promise.resolve();
      };
    });
    await app.click('Copy Code');
    await app.click('Copy Link');
    assert.deepEqual(await app.page.evaluate(() => window.__copied), [
      code,
      await app.textOf('[data-testid="viewer-link"]')
    ]);

    const file = await app.captureDownload('Save Code to File');
    assert.match(file.name, /^Thursday_DYP_\d{4}-\d{2}-\d{2}\.publisher-code\.txt$/);
    assert.equal(file.mimeType, 'text/plain');
    assert.match(file.text, new RegExp(`Code: ${code}`));
    assert.match(file.text, new RegExp(`Tournament id: ${id}`));
    assert.deepEqual(await app.page.evaluate(t => window.TournamentLogic.parsePublisherCodeFile(t), file.text), {
      tournamentId: id,
      code: code.replace(/-/g, '')
    });

    await app.page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    });
    await app.click('Copy Code');
    assert.match(app.dialogs.at(-1), /Copying failed/);
  });
});
