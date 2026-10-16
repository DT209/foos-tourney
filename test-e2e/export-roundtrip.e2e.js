// Exports from Saved Tournaments (CSV and JSON) and round trips: exported
// tournaments imported back must land in the Saved Tournaments list intact.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

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

const savedRows = () =>
  app.page.$$eval('[data-testid="saved-tournament"]', rows =>
    rows.map(r => ({ id: r.dataset.tournamentId, text: r.textContent }))
  );

async function importFile(text, choice = 'Add to Saved Tournaments') {
  if (!(await app.page.$(SAVED))) await app.click('Saved Tournaments');
  await app.click('Import', { within: SAVED });
  await app.chooseImportFile(text);
  await app.click(choice, { within: IMPORT });
}

describe('export options', () => {
  it('Export offers CSV and JSON for every saved tournament', async () => {
    app = await openApp();
    await app.type(NAME, 'Week One');
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    const weekOne = await app.currentTournamentId();
    await app.click('New Tournament');
    await app.click('Start New Tournament');

    const row = await app.openExportOptions(weekOne);
    const options = await app.page.$$eval(`${row} button`, bs => bs.map(b => b.textContent.trim()));
    assert.ok(options.includes('CSV') && options.includes('JSON'));

    const csv = await app.captureDownload('CSV', { within: row });
    assert.equal(csv.mimeType, 'text/csv');
    assert.match(csv.name, /^Week_One_\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(
      csv.text.split('\n')[1].startsWith(`"${weekOne}_MONSTER-`),
      'results of the saved, not the open, tournament'
    );

    await app.click('Export', { within: row });
    const json = await app.captureDownload('JSON', { within: row });
    assert.equal(json.mimeType, 'application/json');
    assert.equal(JSON.parse(json.text).tournament.tournamentName, 'Week One');
  });
});

describe('round trips', () => {
  it('several exported tournaments import into a fresh browser and appear in Saved Tournaments', async () => {
    app = await openApp();
    const exported = [];
    for (const [name, matches] of [
      ['Week One', 1],
      ['Week Two', 2]
    ]) {
      await app.type(NAME, name);
      await app.addAllLeaderboardPlayers();
      for (let i = 0; i < matches; i++) await app.playMonsterMatch();
      exported.push({
        id: await app.currentTournamentId(),
        name,
        players: await app.rosterCount(),
        matches,
        file: await app.exportFromSaved('JSON')
      });
      await app.click('New Tournament');
      await app.click('Start New Tournament');
    }
    await app.close();

    app = await openApp(); // fresh browser profile: only its own empty tournament
    assert.equal(
      (
        await (async () => {
          await app.click('Saved Tournaments');
          return savedRows();
        })()
      ).length,
      1
    );
    for (const t of exported) await importFile(t.file.text);

    const rows = await savedRows();
    assert.equal(rows.length, 3);
    for (const t of exported) {
      const row = rows.find(r => r.id === t.id);
      assert.ok(row, `${t.name} is listed`);
      assert.match(row.text, new RegExp(t.name));
      assert.match(row.text, new RegExp(`${t.players} players · ${t.matches} matches`));
    }

    // Opening an imported tournament restores its roster and history.
    await app.click('Open', { within: `[data-tournament-id="${exported[1].id}"]` });
    assert.equal(await app.page.$eval(NAME, e => e.value), 'Week Two');
    assert.equal(await app.rosterCount(), exported[1].players);
    assert.equal(await app.page.$$eval('[data-testid="match-history"] tbody tr', rs => rs.length), 2);
    const reexport = JSON.parse((await app.exportFromSaved('JSON')).text);
    const original = JSON.parse(exported[1].file.text);
    assert.deepEqual(reexport.tournament.players, original.tournament.players, 'nothing lost in the round trip');
    assert.deepEqual(reexport.tournament.matches, original.tournament.matches);
  });

  it('re-importing in the same browser with Keep Both lists both copies', async () => {
    app = await openApp();
    await app.type(NAME, 'Week One');
    await app.addAllLeaderboardPlayers();
    const id = await app.currentTournamentId();
    const file = await app.exportFromSaved('JSON');
    await importFile(file.text, 'Keep Both');
    const rows = await savedRows();
    assert.equal(rows.length, 2);
    assert.ok(rows.some(r => r.id === id && /Week One/.test(r.text) && !/copy/.test(r.text)));
    assert.ok(rows.some(r => r.id !== id && /Week One \(copy\)/.test(r.text)));
  });
});
