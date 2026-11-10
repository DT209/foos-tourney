// Selectors and helpers shared by the display-remote*.e2e.js UI tests.
// getApp returns the test's current app (each file keeps its own).

module.exports = getApp => {
  const PICKER = '[data-testid="display-picker"]';
  const BOARD = '[data-testid="display-board"]';
  const MESSAGE = '[data-testid="display-message"]';
  const OTHER_ID = '99999999-9999-4999-8999-999999999999';

  const waitFor = async (check, ms = 5000) => {
    const end = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('timed out waiting');
      await getApp().pause(50);
    }
  };

  // Each row, and whether its Show button has focus (where Enter or a TV
  // remote's OK lands when the list opens).
  const choices = (page = getApp().page) =>
    page.$$eval('[data-testid="display-choice"]', els =>
      els.map(e => ({
        source: e.dataset.source,
        text: e.querySelector('.db-choice-text').textContent,
        focused: document.activeElement === e.querySelector('[data-testid="display-choice-show"]')
      }))
    );
  const ROW = source => `[data-testid="display-choice"][data-source="${source}"]`;

  // Publishes "Other Night" from another browser, with one player, as the fake
  // server. played: four players and one finished Monster match, for CSVs.
  async function publishOther({ name = 'Other Night', player = 'Zed', played = false, page = getApp().page } = {}) {
    await page.evaluate(
      (id, name, player, played) => {
        const L = window.TournamentLogic;
        let state = {
          ...L.newTournamentState(id, new Date()),
          tournamentName: name,
          players: [L.createPlayer(1, player)]
        };
        if (played) {
          const players = [1, 2, 3, 4].map(n => L.createPlayer(n, `${player}${n}`));
          const drawn = L.drawMonsterMatch({ players, matches: [], tableCount: 1, format: '2v2', maxGames: 1, id: 7 });
          let matches = L.updateMonsterGameScore(drawn.matches, 7, 0, 't1', 5);
          matches = L.updateMonsterGameScore(matches, 7, 0, 't2', 2);
          const done = L.completeMonsterMatch(drawn.players, matches, 7);
          state = { ...state, players: done.players, matches: done.matches };
        }
        const server = JSON.parse(localStorage.getItem('__fakeRemote.server') || 'null') || {
          slots: [null, null, null, null, null],
          tournaments: {},
          owners: {},
          codes: {}
        };
        server.slots[1] = { tournamentId: id, ownerUid: 'other' };
        server.tournaments[id] = {
          id,
          slot: 2,
          ownerUid: 'other',
          name,
          startedAt: state.startedAt,
          updatedAt: Date.now(),
          exportText: L.publishedExport(state)
        };
        localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
        if (window.__fakeRemoteNotify) window.__fakeRemoteNotify();
      },
      OTHER_ID,
      name,
      player,
      played
    );
  }

  // One click on a row's name shows it.
  const clickRow = async (source, page = getApp().page) => {
    await page.$eval(`${ROW(source)} .db-name`, e => e.click());
    await getApp().pause(100);
  };

  // Waits for the download a click started (remote exports fetch first).
  // format: 'json' or 'csv'.
  async function downloadFrom(source, format = 'json') {
    await getApp().page.evaluate(() => {
      window.__download = null;
      HTMLAnchorElement.prototype.click = function () {
        window.__download = { href: this.getAttribute('href'), name: this.getAttribute('download') };
      };
    });
    await getApp().page.$eval(`${ROW(source)} [data-testid="display-choice-export-${format}"]`, b => b.click());
    await waitFor(() => getApp().page.evaluate(() => window.__download !== null));
    const { href, name } = await getApp().page.evaluate(() => window.__download);
    return {
      name,
      mimeType: href.slice(5, href.indexOf(';')),
      text: decodeURIComponent(href.slice(href.indexOf(',') + 1))
    };
  }

  return { PICKER, BOARD, MESSAGE, OTHER_ID, waitFor, choices, ROW, publishOther, clickRow, downloadFrom };
};
