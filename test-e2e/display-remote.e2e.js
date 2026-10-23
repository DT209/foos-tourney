// Display Mode with publishing switched on (recording fake remote): the
// tournament list, following a published tournament live, ?remote=<id>
// links, second-screen windows, and importing from Firebase.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const PICKER = '[data-testid="display-picker"]';
const BOARD = '[data-testid="display-board"]';
const MESSAGE = '[data-testid="display-message"]';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const waitFor = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await app.pause(50);
  }
};

// Each row, and whether its Show button has focus (where Enter or a TV
// remote's OK lands when the list opens).
const choices = (page = app.page) =>
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
async function publishOther({ name = 'Other Night', player = 'Zed', played = false, page = app.page } = {}) {
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
const clickRow = async (source, page = app.page) => {
  await page.$eval(`${ROW(source)} .db-name`, e => e.click());
  await app.pause(100);
};

// Waits for the download a click started (remote exports fetch first).
// format: 'json' or 'csv'.
async function downloadFrom(source, format = 'json') {
  await app.page.evaluate(() => {
    window.__download = null;
    HTMLAnchorElement.prototype.click = function () {
      window.__download = { href: this.getAttribute('href'), name: this.getAttribute('download') };
    };
  });
  await app.page.$eval(`${ROW(source)} [data-testid="display-choice-export-${format}"]`, b => b.click());
  await waitFor(() => app.page.evaluate(() => window.__download !== null));
  const { href, name } = await app.page.evaluate(() => window.__download);
  return {
    name,
    mimeType: href.slice(5, href.indexOf(';')),
    text: decodeURIComponent(href.slice(href.indexOf(',') + 1))
  };
}

describe('the Display Mode list', () => {
  it('lists this device first with its Show focused, then published tournaments; one click shows', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const [local, other] = await choices();
    assert.equal(local.source, 'local');
    assert.match(local.text, /This device.*Thursday DYP/);
    assert.equal(local.focused, true);
    assert.equal(other.source, 'remote');
    assert.match(other.text, /Other Night.*Updated/);
    assert.equal(await app.page.$(`${PICKER} button[type="submit"]`), null, 'no Show button at the bottom');
    await clickRow('local');
    assert.match(await app.textOf(BOARD), /Thursday DYP/);
    await app.click('Switch tournament');
    assert.ok(await app.page.$(PICKER));
    await app.click('Show', { within: ROW('local') });
    assert.match(await app.textOf(BOARD), /Thursday DYP/, "the row's Show button too");
    await app.click('Switch tournament');
    await app.click('Exit Display');
    assert.equal(await app.page.$(PICKER), null);
  });

  it('lists this device once, even when it is also published', async () => {
    app = await openApp({ remote: true });
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.pause(150);
    await app.click('Display Mode');
    await waitFor(async () => !(await app.textOf(PICKER)).includes('Looking for'));
    assert.deepEqual(
      (await choices()).map(c => c.source),
      ['local']
    );
  });

  it('still offers this device when Firebase cannot be reached', async () => {
    app = await openApp({ remote: true });
    await app.setRemoteConfig({ unavailable: true });
    await app.click('Display Mode');
    await waitFor(async () => /can't be reached/.test(await app.textOf(PICKER)));
    assert.equal((await choices()).length, 1);
    await clickRow('local');
    assert.match(await app.textOf(BOARD), /Thursday DYP/);
  });
});

describe('following a published tournament', () => {
  it('shows it live, then says when it is no longer published', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    await clickRow('remote');
    await waitFor(async () => Boolean(await app.page.$(BOARD)));
    assert.match(await app.textOf(BOARD), /Other Night/);
    assert.match(await app.textOf('[data-testid="display-standings"]'), /Zed/);

    await publishOther({ player: 'Yolanda' });
    await waitFor(async () => /Yolanda/.test(await app.textOf('[data-testid="display-standings"]')));

    await app.page.evaluate(() => {
      window.__opened = [];
      window.open = url => window.__opened.push(url);
    });
    await app.click('Open on Another Screen');
    assert.match(
      (await app.page.evaluate(() => window.__opened))[0],
      new RegExp(`\\?remote=${OTHER_ID}&layout=top-50-50$`)
    );

    await app.page.evaluate(id => {
      const server = JSON.parse(localStorage.getItem('__fakeRemote.server'));
      delete server.tournaments[id];
      localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
      window.__fakeRemoteNotify();
    }, OTHER_ID);
    await waitFor(async () => Boolean(await app.page.$(MESSAGE)));
    assert.match(await app.textOf(MESSAGE), /no longer published/);
    await app.click('Switch tournament');
    assert.ok(await app.page.$(PICKER));
    assert.ok((await app.remoteCalls()).some(c => c.method === 'unsubscribe'));
  });

  it('opens straight to a ?remote=<id> link, and Exit returns to the control desk', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    const viewer = await app.openPage(`?remote=${OTHER_ID}`);
    await viewer.waitForSelector(BOARD);
    assert.match(await viewer.$eval(BOARD, e => e.textContent), /Other Night/);
    assert.doesNotMatch(await viewer.$eval(BOARD, e => e.textContent), /Open on Another Screen/);
    await app.flushCoverage(viewer);
    await Promise.all([
      viewer.waitForNavigation(),
      viewer.evaluate(() =>
        [...document.querySelectorAll('button')].find(b => b.textContent === 'Exit Display').click()
      )
    ]);
    assert.doesNotMatch(viewer.url(), /remote=/);
    await viewer.waitForSelector('footer');
  });

  it('says when a ?remote link cannot be followed', async () => {
    app = await openApp({ remote: true });
    await app.setRemoteConfig({ unavailable: true });
    const viewer = await app.openPage(`?remote=${OTHER_ID}`);
    await viewer.waitForSelector(MESSAGE);
    await new Promise(r => setTimeout(r, 100));
    assert.match(await viewer.$eval(MESSAGE, e => e.textContent), /Can't reach the published tournament/);
  });

  it('says when publishing is not set up for a ?remote link', async () => {
    app = await openApp();
    const viewer = await app.openPage(`?remote=${OTHER_ID}`);
    await viewer.waitForSelector(MESSAGE);
    const text = await viewer.$eval(MESSAGE, e => e.textContent);
    assert.match(text, /Publishing isn't set up on this page/);
    assert.doesNotMatch(text, /Switch tournament/);
  });
});

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

describe('second-screen windows', () => {
  it("show the same list; Enter (a TV remote's OK) on the focused Show puts the local board up", async () => {
    app = await openApp({ remote: true });
    await publishOther();
    const screen = await app.openPage('?display=1');
    await screen.waitForSelector(PICKER);
    await new Promise(r => setTimeout(r, 100));
    const listed = await choices(screen);
    assert.deepEqual(
      listed.map(c => [c.source, c.focused]),
      [
        ['local', true],
        ['remote', false]
      ]
    );
    await screen.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 100));
    assert.match(await screen.$eval(BOARD, e => e.textContent), /Thursday DYP/);
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
