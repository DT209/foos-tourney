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
    assert.equal(await app.page.$$eval(`${menu} button`, bs => bs.some(b => /CSV Export/.test(b.textContent))), false);
    await app.click('Display Mode', { within: menu });
    assert.ok(await app.page.$('[data-testid="display-board"]'));
    assert.equal(await app.page.$(menu), null, 'menu closes after an action');
    await app.click('Exit Display');

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

describe('header on narrow phones', () => {
  // A wide fallback font (as on Ubuntu CI and some phones) must not push the
  // menu button off-screen: the title truncates instead.
  for (const width of [390, 320]) {
    it(`fits at ${width}px with a wide font, keeping the menu button on screen`, async () => {
      app = await openApp({ viewport: { width, height: 800 } });
      await app.page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
      await app.pause(100);
      const menuButton = await app.page.$eval('header button[aria-label="Toggle Navigation Menu"]', b =>
        b.getBoundingClientRect().toJSON()
      );
      assert.ok(menuButton.right <= width, `menu button right edge ${menuButton.right}px > ${width}px`);
      assert.ok(
        (await app.page.evaluate(() => document.documentElement.scrollWidth)) <= width,
        'no sideways scrolling'
      );
    });
  }
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

describe('hover help', () => {
  // Visible buttons with no title, outside dialogs (the phone menu counts as the page).
  const untitled = () =>
    app.page.$$eval('button', bs =>
      bs
        .filter(b => b.offsetParent !== null && !b.title)
        .filter(b => !b.closest('.fixed.inset-0') || b.closest('[data-testid="mobile-menu"]'))
        .map(b => b.textContent.trim())
    );

  it('explains every control-desk button', async () => {
    app = await openApp({ remote: true });
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    await app.click('✏️');
    assert.deepEqual(await untitled(), []);
    assert.match(
      await app.page.$eval('[data-testid="publishing-button"]', b => b.title),
      /live viewer link and publisher code/
    );
    assert.match(await app.page.$eval('button[title*="empty tournament"]', b => b.title), /publishes it live/);

    await app.click('Bracket Playoff Stage');
    assert.deepEqual(await untitled(), []);
    await app.click('Monster / Open Play Stage');
    await app.buildBracket({ teams: 2 });
    assert.deepEqual(await untitled(), []);

    await app.click('Admin Lock');
    await app.submitPin('1234');
    assert.match(await app.page.$eval('button[title*="PIN"]', b => b.title), /turns editing back on/);
    assert.deepEqual(await untitled(), []);
  });

  it('explains the phone menu and player options', async () => {
    app = await openApp({ viewport: PHONE });
    await app.addAllLeaderboardPlayers();
    await app.click('⋮');
    assert.deepEqual(await untitled(), []);
    await app.click('☰');
    assert.deepEqual(await untitled(), []);
    assert.match(
      await app.page.$eval(`${menu} button[title*="full-screen"]`, b => b.title),
      /Exit Display returns here/
    );
  });
});
