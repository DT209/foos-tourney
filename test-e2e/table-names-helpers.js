// Selectors and helpers shared by the table-names*.e2e.js UI tests.
// getApp returns the test's current app (each file keeps its own).

module.exports = getApp => {
  const INPUT = '[data-testid="table-name-input"]';
  const input = n => `${INPUT}[data-table="${n}"]`;
  const BOARD = '[data-testid="display-board"]';
  const SAVED = '[data-testid="saved-tournaments"]';
  const IMPORT = '[data-testid="import-dialog"]';
  const OTHER_ID = '99999999-9999-4999-8999-999999999999';

  const inputCount = () => getApp().page.$$eval(INPUT, els => els.length);
  const values = () => getApp().page.$$eval(INPUT, els => els.map(e => e.value));
  const savedState = () =>
    getApp().page.evaluate(() => {
      const id = localStorage.getItem('foosTourney.currentTournament');
      return JSON.parse(localStorage.getItem(`foosTourney.tournament.${id}`)).state;
    });
  const texts = (selector, page = getApp().page) => page.$$eval(selector, els => els.map(e => e.textContent));

  async function nameTables(...names) {
    for (const [i, name] of names.entries()) await getApp().fill(input(i + 1), name);
  }

  const exportOf = tournament => JSON.stringify({ format: 'foos-tourney', version: 1, tournament });

  async function importFile(text, button) {
    await getApp().click('Saved Tournaments');
    await getApp().click('Import', { within: SAVED });
    await getApp().chooseImportFile(text);
    await getApp().click(button, { within: IMPORT });
  }

  // Publishes a tournament with named tables from "another browser".
  async function publishNamed(tableNames) {
    await getApp().page.evaluate(
      (id, tableNames) => {
        const L = window.TournamentLogic;
        const state = { ...L.newTournamentState(id, new Date()), tournamentName: 'Other Night', tableNames };
        const server = { slots: [null, null, null, null, null], tournaments: {}, owners: {}, codes: {} };
        server.slots[0] = { tournamentId: id, ownerUid: 'other' };
        server.tournaments[id] = {
          id,
          slot: 1,
          ownerUid: 'other',
          name: state.tournamentName,
          startedAt: state.startedAt,
          updatedAt: Date.now(),
          exportText: L.publishedExport(state)
        };
        server.owners.other = { slot: 1, tournamentId: id };
        server.codes[id] = 'ABCD2345EFGH';
        localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
        if (window.__fakeRemoteNotify) window.__fakeRemoteNotify();
      },
      OTHER_ID,
      tableNames
    );
  }

  return {
    INPUT,
    input,
    BOARD,
    SAVED,
    IMPORT,
    OTHER_ID,
    inputCount,
    values,
    savedState,
    texts,
    nameTables,
    exportOf,
    importFile,
    publishNamed
  };
};
