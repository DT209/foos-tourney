// Selectors and helpers shared by import-export.e2e.js and import-saved.e2e.js.
// getApp returns the test's current app (each file keeps its own).

module.exports = getApp => {
  const RECORD_PREFIX = 'foosTourney.tournament.';
  const NAME = 'input[placeholder="e.g. Friday Night Open"]';
  const SAVED = '[data-testid="saved-tournaments"]';
  const IMPORT = '[data-testid="import-dialog"]';

  const currentId = () => getApp().page.evaluate(() => localStorage.getItem('foosTourney.currentTournament'));
  const savedRows = () =>
    getApp().page.$$eval('[data-testid="saved-tournament"]', rows =>
      rows.map(r => ({ id: r.dataset.tournamentId, text: r.textContent }))
    );
  const recordIds = async () =>
    (await getApp().storageKeys()).filter(k => k.startsWith(RECORD_PREFIX)).map(k => k.slice(RECORD_PREFIX.length));

  // Builds a tournament with a roster and one finished match, exports it from
  // the saved list, and returns the export.
  async function exportedTournament() {
    await getApp().type(NAME, 'Week #3');
    await getApp().addAllLeaderboardPlayers();
    await getApp().playMonsterMatch();
    const id = await currentId();
    const file = await getApp().exportFromSaved('JSON', id);
    return { id, file, roster: await getApp().rosterCount() };
  }

  async function openImport() {
    await getApp().click('Saved Tournaments');
    await getApp().click('Import', { within: SAVED });
  }

  return { RECORD_PREFIX, NAME, SAVED, IMPORT, currentId, savedRows, recordIds, exportedTournament, openImport };
};
