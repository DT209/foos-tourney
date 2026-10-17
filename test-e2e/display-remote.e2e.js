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

const choices = (page = app.page) =>
  page.$$eval('[data-testid="display-choice"]', els =>
    els.map(e => ({ source: e.dataset.source, text: e.textContent, checked: e.querySelector('input').checked }))
  );

// Publishes "Other Night" from another browser, with one player, as the fake server.
async function publishOther({ name = 'Other Night', player = 'Zed', page = app.page } = {}) {
  await page.evaluate(
    (id, name, player) => {
      const L = window.TournamentLogic;
      const state = {
        ...L.newTournamentState(id, new Date()),
        tournamentName: name,
        players: [L.createPlayer(1, player)]
      };
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
    player
  );
}

const show = async (page = app.page) => {
  await page.evaluate(sel => document.querySelector(sel).querySelector('form').requestSubmit(), PICKER);
  await app.pause(100);
};

describe('the Display Mode list', () => {
  it('lists this device first and selected, then published tournaments; Show puts this device up', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    const [local, other] = await choices();
    assert.equal(local.source, 'local');
    assert.match(local.text, /This device.*Thursday DYP/);
    assert.equal(local.checked, true);
    assert.equal(other.source, 'remote');
    assert.match(other.text, /Other Night.*Updated/);
    await show();
    assert.match(await app.textOf(BOARD), /Thursday DYP/);
    await app.click('Switch tournament');
    assert.ok(await app.page.$(PICKER));
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
    await show();
    assert.match(await app.textOf(BOARD), /Thursday DYP/);
  });
});

describe('following a published tournament', () => {
  it('shows it live, then says when it is no longer published', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    await app.click('Display Mode');
    await waitFor(async () => (await choices()).length === 2);
    await app.page.$$eval('[data-testid="display-choice"] input', inputs => inputs[1].click());
    await show();
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

describe('second-screen windows', () => {
  it('show the same list with this device selected; Show puts the local board up', async () => {
    app = await openApp({ remote: true });
    await publishOther();
    const screen = await app.openPage('?display=1');
    await screen.waitForSelector(PICKER);
    await new Promise(r => setTimeout(r, 100));
    const listed = await choices(screen);
    assert.deepEqual(
      listed.map(c => [c.source, c.checked]),
      [
        ['local', true],
        ['remote', false]
      ]
    );
    await show(screen);
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
