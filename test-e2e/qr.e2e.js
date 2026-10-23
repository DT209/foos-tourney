// QR codes in Display Mode: a QR Code button on each row of the tournament
// list and in the board header opens a full-screen code for the tournament's
// viewer link, built from the address the page is open at. The code takes 80%
// of the screen's smaller side, with the title above and the URL below. Each
// test decodes the rendered code with jsQR, as a phone camera would.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openApp } = require('./harness');

const TV = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };
const DIALOG = '[data-testid="qr-dialog"]';
const CODE = '[data-testid="qr-code"]';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';
const ROW = source => `[data-testid="display-choice"][data-source="${source}"]`;
const JSQR = path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js');

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
const box = sel => app.page.$eval(sel, e => e.getBoundingClientRect().toJSON());

// "Other Night", published from another browser (fake server).
async function publishOther() {
  await app.page.evaluate(id => {
    const L = window.TournamentLogic;
    const state = { ...L.newTournamentState(id, new Date('2026-10-23T01:00:00Z')), tournamentName: 'Other Night' };
    const server = {
      slots: [null, { tournamentId: id, ownerUid: 'other' }, null, null, null],
      tournaments: {
        [id]: {
          id,
          slot: 2,
          ownerUid: 'other',
          name: 'Other Night',
          startedAt: state.startedAt,
          updatedAt: Date.now(),
          exportText: L.publishedExport(state)
        }
      },
      owners: {},
      codes: {}
    };
    localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
  }, OTHER_ID);
}

async function openList() {
  await app.click('Display Mode');
  await waitFor(async () => !(await app.textOf('[data-testid="display-picker"]')).includes('Looking for'));
}

// Draws the on-screen SVG into a canvas and decodes it, like a phone camera.
async function scan() {
  await app.page.addScriptTag({ path: JSQR });
  return app.page.$eval(
    CODE,
    svg =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 600;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 600, 600);
          const result = window.jsQR(ctx.getImageData(0, 0, 600, 600).data, 600, 600);
          resolve(result && result.data);
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      })
  );
}

const expectedUrl = id => `${new URL(app.url).origin}/TournamentManager.html?remote=${id}&layout=top-50-50`;

describe('QR codes on the Display Mode list', () => {
  it('show the title above, the code at 80% of the screen and the URL below; the code scans to that URL', async () => {
    app = await openApp({ remote: true, viewport: TV });
    await publishOther();
    await openList();
    const rowButton = await app.page.$eval(`${ROW('remote')} [data-testid="display-choice-qr"]`, b => ({
      text: b.textContent.trim(),
      label: b.getAttribute('aria-label'),
      icon: Boolean(b.querySelector('svg.db-icon'))
    }));
    assert.deepEqual(rowButton, { text: '', label: 'Show QR code for Other Night', icon: true });
    await app.page.$eval(`${ROW('remote')} [data-testid="display-choice-qr"]`, b => b.click());
    await app.page.waitForSelector(CODE);

    assert.equal(await app.textOf('[data-testid="qr-title"]'), 'Other Night');
    assert.match(await app.textOf(DIALOG), /Scan to open in Display Mode · Started/);
    const url = expectedUrl(OTHER_ID);
    assert.equal(await app.textOf('[data-testid="qr-url"]'), url, 'built from the address the page is open at');
    assert.equal(await scan(), url);

    const code = await box(CODE);
    const title = await box('[data-testid="qr-title"]');
    const link = await box('[data-testid="qr-url"]');
    assert.ok(Math.abs(code.width - 0.8 * TV.height) < 2, `80% of the smaller side: ${code.width}`);
    assert.ok(Math.abs(code.width - code.height) < 1, 'square');
    assert.ok(title.bottom <= code.top, 'title above the code');
    assert.ok(link.top >= code.bottom, 'URL below the code');
    assert.ok(link.bottom <= TV.height, 'everything fits on screen');
    assert.ok(
      await app.page.$('[data-testid="qr-local-warning"]'),
      'the test server is 127.0.0.1, which phones cannot reach'
    );
  });

  it('fits a phone screen too, and closes with Close, Escape or a click outside the code', async () => {
    app = await openApp({ remote: true, viewport: PHONE });
    await publishOther();
    await app.click('☰');
    await app.click('Display Mode', { within: '[data-testid="mobile-menu"]' });
    await waitFor(async () => Boolean(await app.page.$(ROW('remote'))));
    const open = () => app.page.$eval(`${ROW('remote')} [data-testid="display-choice-qr"]`, b => b.click());

    await open();
    await app.page.waitForSelector(CODE);
    const code = await box(CODE);
    assert.ok(Math.abs(code.width - 0.8 * PHONE.width) < 2, `80% of the phone's width: ${code.width}`);
    assert.ok(code.right <= PHONE.width && code.left >= 0, 'inside the screen');
    await app.page.$eval(CODE, svg => svg.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.ok(await app.page.$(DIALOG), 'a click on the code itself keeps it open');
    await app.click('Close', { within: DIALOG });
    assert.equal(await app.page.$(DIALOG), null);

    await open();
    await app.page.keyboard.press('Escape');
    await app.pause();
    assert.equal(await app.page.$(DIALOG), null, 'Escape (a TV remote Back) closes it');

    await open();
    await app.page.$eval(DIALOG, d => d.click());
    await app.pause();
    assert.equal(await app.page.$(DIALOG), null, 'a click outside the code closes it');
  });

  it("shows no button for this device's tournament until it is published", async () => {
    app = await openApp({ remote: true, viewport: TV });
    await openList();
    const local = `${ROW('local')} [data-testid="display-choice-qr"]`;
    assert.equal(await app.page.$(local), null, 'no QR code, so no button');
    await app.click('Exit Display');

    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.pause(150);
    const id = await app.currentTournamentId();
    await openList();
    await app.page.$eval(local, b => b.click());
    await app.page.waitForSelector(CODE);
    assert.equal(await app.textOf('[data-testid="qr-title"]'), 'Thursday DYP');
    assert.equal(await scan(), expectedUrl(id));
  });
});

describe('the QR Code button on the board', () => {
  it('sits just left of Layout and shows the code for the tournament on screen', async () => {
    app = await openApp({ remote: true, viewport: TV });
    await publishOther();
    await openList();
    await app.page.$eval(`${ROW('remote')} .db-name`, e => e.click());
    await app.page.waitForSelector('[data-testid="display-board"]');
    await waitFor(async () => /Other Night/.test(await app.textOf('[data-testid="display-board"]')));

    const qr = await box('[data-testid="board-qr-button"]');
    const layout = await box('[data-testid="layout-button"]');
    assert.ok(qr.right <= layout.left, 'left of Layout');
    const button = await app.page.$eval('[data-testid="board-qr-button"]', b => ({
      text: b.textContent.trim(),
      label: b.getAttribute('aria-label'),
      icon: Boolean(b.querySelector('svg.db-icon'))
    }));
    assert.deepEqual(button, { text: '', label: 'Show QR code', icon: true }, 'an icon, named for screen readers');
    assert.ok(Math.abs(qr.top - layout.top) < 2, 'on the same row');

    await app.page.$eval('[data-testid="board-qr-button"]', b => b.click());
    await app.page.waitForSelector(CODE);
    assert.equal(await app.textOf('[data-testid="qr-title"]'), 'Other Night');
    assert.equal(await scan(), expectedUrl(OTHER_ID));
  });

  it("is missing from this device's board until it is published, then shows its code", async () => {
    app = await openApp({ remote: true, viewport: TV });
    await openList();
    await app.page.$eval(`${ROW('local')} .db-name`, e => e.click());
    await app.page.waitForSelector('[data-testid="display-board"]');
    assert.equal(await app.page.$('[data-testid="board-qr-button"]'), null);
    await app.click('Exit Display');

    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.pause(150);
    const id = await app.currentTournamentId();
    await openList();
    await app.page.$eval(`${ROW('local')} .db-name`, e => e.click());
    await app.page.waitForSelector('[data-testid="display-board"]');
    await app.page.$eval('[data-testid="board-qr-button"]', b => b.click());
    await app.page.waitForSelector(CODE);
    assert.equal(await app.textOf('[data-testid="qr-title"]'), 'Thursday DYP');
    assert.equal(await scan(), expectedUrl(id));
  });

  it('is missing on a board without publishing set up', async () => {
    app = await openApp({ viewport: TV });
    await app.click('Display Mode');
    await app.page.waitForSelector('[data-testid="display-board"]');
    assert.equal(await app.page.$('[data-testid="board-qr-button"]'), null);
  });
});

describe('without the QR library', () => {
  it('says the code could not load and still shows the link', async () => {
    app = await openApp({
      remote: true,
      viewport: TV,
      blockRequests: ['https://cdn.jsdelivr.net/npm/qrcode-generator']
    });
    await publishOther();
    await openList();
    await app.page.$eval(`${ROW('remote')} [data-testid="display-choice-qr"]`, b => b.click());
    await app.page.waitForSelector(DIALOG);
    assert.equal(await app.page.$(CODE), null);
    assert.match(await app.textOf(DIALOG), /QR code generator couldn't load/);
    assert.equal(await app.textOf('[data-testid="qr-url"]'), expectedUrl(OTHER_ID));
  });
});
