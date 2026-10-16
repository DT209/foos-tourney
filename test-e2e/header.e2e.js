// Header and navigation: desktop actions, the phone menu, the admin lock
// dialog, the club logo fallback, and the auto-save footer.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const PHONE = { width: 390, height: 844 };
const menu = '[data-testid="mobile-menu"]';

describe('phone menu', () => {
  it('opens and closes, and offers export, brackets and the lock', async () => {
    app = await openApp({ viewport: PHONE });
    await app.click('☰');
    assert.ok(await app.page.$(menu));
    await app.click('Close', { within: menu });
    assert.equal(await app.page.$(menu), null);
    await app.click('☰');
    await app.click('✕', { within: menu });
    assert.equal(await app.page.$(menu), null, 'the ✕ closes it');

    await app.click('☰');
    await app.click('CSV Export', { within: menu });
    assert.equal(app.dialogs.at(-1), 'No completed match data available to export yet.');
    assert.equal(await app.page.$(menu), null, 'menu closes after an action');

    await app.addAllLeaderboardPlayers();
    await app.click('☰');
    await app.click('Draw Brackets', { within: menu });
    assert.match(await app.text(), /Generate Bracket Stage/);
    await app.click('Cancel');

    await app.click('☰');
    await app.click('Admin Lock', { within: menu });
    await app.submitPin('2468');
    await app.click('☰');
    await app.click('View Only (Unlock)', { within: menu });
    await app.submitPin('2468');
    assert.doesNotMatch(await app.text(), /View Only Mode/);

    await app.click('☰');
    await app.click('☰');
    assert.equal(await app.page.$(menu), null, 'the toggle closes it too');
  });
});

describe('admin lock dialog', () => {
  it('Cancel closes without locking and clears the typed PIN', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await app.type('input[type=password]', '99');
    await app.click('Cancel');
    assert.doesNotMatch(await app.text(), /View Only Mode/);
    await app.click('Admin Lock');
    assert.equal(await app.page.$eval('input[type=password]', e => e.value), '');
  });

  it('locking disables editing controls', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    assert.equal(await app.page.$eval('input[placeholder="e.g. Friday Night Open"]', e => e.disabled), true);
    await assert.rejects(app.click('Draw New Match'), /No visible, enabled button/);
  });
});

describe('page icon', () => {
  it('uses the club site favicon', async () => {
    app = await openApp();
    const icon = await app.page.$eval('link[rel="icon"]', l => ({ href: l.getAttribute('href'), type: l.type }));
    assert.deepEqual(icon, { href: 'https://calgaryfoosballclub.com/favicon.ico', type: 'image/x-icon' });
  });
});

describe('club logo', () => {
  it('hides itself if the image fails to load', async () => {
    app = await openApp({ blockLogo: true });
    assert.equal(await app.page.$eval('header img', img => img.style.display), 'none');
  });
});
