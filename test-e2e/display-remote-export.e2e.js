// Display Mode with publishing switched on: exporting from the tournament
// list, and importing from Firebase.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./display-remote-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { PICKER, OTHER_ID, waitFor, choices, ROW, publishOther, downloadFrom } = helpers(() => app);

describe('exporting from the Display Mode list', () => {
  it("Export JSON downloads this device's tournament like Saved Tournaments does, without showing it", async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const file = await downloadFrom('local');
    assert.ok(await app.page.$(PICKER), 'still on the list');
    await app.click('Exit Display');
    const saved = await app.exportFromSaved('JSON');
    assert.equal(file.name, saved.name);
    assert.deepEqual(JSON.parse(file.text).tournament, JSON.parse(saved.text).tournament);
  });

  it("Export CSV downloads this device's results like Saved Tournaments does", async () => {
    app = await openApp({ remote: true });
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 1);
    const file = await downloadFrom('local', 'csv');
    assert.ok(await app.page.$(PICKER), 'still on the list');
    await app.click('Exit Display');
    const saved = await app.exportFromSaved('CSV');
    assert.deepEqual(file, saved);
  });

  it('Export JSON downloads the published JSON exactly as Firebase holds it', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const file = await downloadFrom('remote');
    assert.ok(await app.page.$(PICKER), 'still on the list');
    const stored = (await app.remoteServer()).tournaments[OTHER_ID].exportText;
    assert.equal(file.text, stored, 'byte for byte, not rebuilt');
    assert.equal(file.mimeType, 'application/json');
    assert.match(file.name, /^Other_Night_\d{4}-\d{2}-\d{2}_99999999\.json$/);
    const parsed = await app.page.evaluate(t => window.TournamentLogic.parseTournamentExport(t), file.text);
    assert.equal(parsed.tournament.tournamentId, OTHER_ID);
    assert.deepEqual(
      parsed.tournament.players.map(p => p.name),
      ['Zed']
    );
    assert.ok((await app.remoteCalls()).some(c => c.method === 'fetchTournament' && c.id === OTHER_ID));
  });

  it('Export CSV builds the results from the published JSON', async () => {
    app = await openApp({ remote: true });
    await publishOther({ played: true });
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const file = await downloadFrom('remote', 'csv');
    assert.ok(await app.page.$(PICKER), 'still on the list');
    const expected = await app.page.evaluate(id => {
      const L = window.TournamentLogic;
      const server = JSON.parse(localStorage.getItem('__fakeRemote.server'));
      return L.tournamentCsv(L.parseTournamentExport(server.tournaments[id].exportText).tournament);
    }, OTHER_ID);
    assert.equal(file.text, expected.text);
    assert.equal(file.name, expected.fileName);
    assert.equal(file.mimeType, 'text/csv');
    assert.match(file.text, /_MONSTER-7",\d{4}-\d{2}-\d{2},1,5,2,/);
  });

  it('says when a published tournament is gone, unreachable or invalid', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const exportRemote = async (format = 'json') => {
      const before = app.dialogs.length;
      await app.page.$eval(`${ROW('remote')} [data-testid="display-choice-export-${format}"]`, b => b.click());
      await waitFor(async () => app.dialogs.length > before);
      return app.dialogs.at(-1);
    };

    assert.match(await exportRemote('csv'), /No completed match data available to export yet/);

    await app.page.evaluate(id => {
      const server = JSON.parse(localStorage.getItem('__fakeRemote.server'));
      server.tournaments[id].exportText = '{}';
      localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
    }, OTHER_ID);
    assert.match(await exportRemote(), /isn't a Foos Tourney tournament export/);
    assert.match(await exportRemote('csv'), /isn't a Foos Tourney tournament export/);

    await app.page.evaluate(() => localStorage.removeItem('__fakeRemote.server'));
    assert.match(await exportRemote(), /no longer published/);

    await app.setRemoteConfig({ unavailable: true });
    assert.match(await exportRemote(), /Can't reach Firebase/);
    assert.ok(await app.page.$(PICKER), 'still on the list');
  });
});

describe('importing from Firebase', () => {
  it('lists published tournaments and hands one to the review dialog', async () => {
    app = await openApp({ remote: true });
    await app.click('Saved Tournaments');
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => /Nothing is published right now/.test(await app.textOf('[data-testid="import-dialog"]')));
    await app.click('Cancel');

    await publishOther();
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="firebase-import-choice"]')));
    await app.click('Other Night');
    await waitFor(async () => /Add to Saved Tournaments/.test(await app.textOf('[data-testid="import-dialog"]')));
    assert.match(await app.textOf('[data-testid="import-dialog"]'), /1 players/);
    await app.click('View Read-only');
    assert.match(await app.textOf('[data-testid="read-only-banner"]'), /“Other Night” from Firebase/);
    await app.click('Close View');

    await app.click('Saved Tournaments');
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="firebase-import-choice"]')));
    await app.click('Other Night');
    await waitFor(async () => /Add to Saved Tournaments/.test(await app.textOf('[data-testid="import-dialog"]')));
    await app.click('Add to Saved Tournaments');
    assert.ok(await app.page.$(`[data-testid="saved-tournament"][data-tournament-id="${OTHER_ID}"]`));
  });

  it('copes with a tournament that vanished, and with Firebase being unreachable', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Saved Tournaments');
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="firebase-import-choice"]')));
    await app.page.evaluate(() => localStorage.removeItem('__fakeRemote.server'));
    await app.click('Other Night');
    await app.pause(100);
    assert.match(app.dialogs.at(-1), /no longer published/);

    await publishOther();
    await app.setRemoteConfig({ unavailable: true });
    await app.click('Other Night');
    await app.pause(100);
    assert.match(app.dialogs.at(-1), /Can't reach Firebase/);

    await app.click('Cancel');
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => /can't be reached/.test(await app.textOf('[data-testid="import-dialog"]')));

    // A published copy that doesn't parse is reported like a bad file.
    await app.setRemoteConfig({});
    await app.page.evaluate(id => {
      const server = JSON.parse(localStorage.getItem('__fakeRemote.server'));
      server.tournaments[id].exportText = '{}';
      localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
    }, OTHER_ID);
    await app.click('Cancel');
    await app.click('Import…');
    await app.click('From Firebase');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="firebase-import-choice"]')));
    await app.click('Other Night');
    await app.pause(100);
    assert.match(app.dialogs.at(-1), /isn't a Foos Tourney tournament export/);
  });
});
