// Display Mode with publishing switched on (recording fake remote): the
// tournament list, following a published tournament live, ?remote=<id>
// links and second-screen windows. See also display-remote-export.
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

const { PICKER, BOARD, MESSAGE, OTHER_ID, waitFor, choices, ROW, publishOther, clickRow } = helpers(() => app);

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
