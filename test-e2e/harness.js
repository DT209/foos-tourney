// UI test harness: serves the repo over HTTP and drives TournamentManager.html
// in headless Chrome via puppeteer-core. The page loads React, Babel and
// Tailwind from CDNs, so these tests need network access.
//
// Every page load's V8 coverage of the compiled UI script is written to
// coverage-ui/ for scripts/ui-coverage.js (set NO_UI_COVERAGE=1 to skip).
// Chrome is found via CHROME_PATH or the usual install locations.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const puppeteer = require('puppeteer-core');
const { installFakeRemote } = require('./fake-remote');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'coverage-ui');
const LEADERBOARD_URL = 'https://calgaryfoosballclub.com/leaderboard/';
const LOGO_URL = 'https://calgaryfoosballclub.com/assets/cfc-logo-wide.png';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

function findChrome() {
  return CHROME_CANDIDATES.find(p => fs.existsSync(p)) || null;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Freezes Date at the epoch millis stored in sessionStorage.__fakeNow (if set)
// for each page load, so tests can move the clock across midnight.
const FAKE_CLOCK = `(() => {
  const raw = sessionStorage.getItem('__fakeNow');
  if (!raw) return;
  const fixed = Number(raw);
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  window.Date = FakeDate;
})();`;

// A leaderboard page in the shape the club site serves (players in an inline script).
function leaderboardPage(players) {
  const rows = players
    .map(p => `{ name: ${JSON.stringify(p.name)}, singlesElo: ${p.singlesElo}, doublesElo: ${p.doublesElo} }`)
    .join(',\n');
  return `<html><body><script>const playersData = [\n${rows}\n];\nrenderTable();</script></body></html>`;
}

// Saves raw V8 coverage of the compiled UI script (one entry per page load).
// The Babel output is the script that defines FoosballApp.
async function saveUiCoverage(page) {
  const entries = await page.coverage.stopJSCoverage();
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  for (const entry of entries) {
    if (!entry.text.includes('function FoosballApp(') || !entry.rawScriptCoverage) continue;
    const file = path.join(COVERAGE_DIR, `${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify({ text: entry.text, functions: entry.rawScriptCoverage.functions }));
  }
}

const COVERAGE_OPTIONS = { resetOnNavigation: false, reportAnonymousScripts: true, includeRawScriptCoverage: true };

const PUBLISHING_OFF = () => {
  window.foosRemoteForTests = null;
};

const pause = (ms = 50) => new Promise(r => setTimeout(r, ms));

async function openApp({
  timezone = 'America/Edmonton',
  viewport = { width: 1280, height: 900 },
  beforeLoad,
  liveLeaderboard,
  blockLogo = false,
  blockRequests = [],
  remote = false
} = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found: set CHROME_PATH or run the build with --skip-e2e');
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/TournamentManager.html`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const collectCoverage = !process.env.NO_UI_COVERAGE;
  await page.setViewport(viewport);
  if (collectCoverage) {
    await page.coverage.startJSCoverage(COVERAGE_OPTIONS);
  }
  await page.emulateTimezone(timezone);
  await page.evaluateOnNewDocument(FAKE_CLOCK);
  if (beforeLoad) await page.evaluateOnNewDocument(beforeLoad);
  // Publishing is off unless remote: true installs the recording fake
  // (fake-remote.js). Tests never reach the real Firebase project.
  const installRemote = target => target.evaluateOnNewDocument(remote ? installFakeRemote : PUBLISHING_OFF);
  await installRemote(page);

  // Stub the club site: a live leaderboard (with CORS allowed) and/or a broken
  // logo. blockRequests: URL prefixes to fail, as if a CDN were unreachable.
  if (liveLeaderboard || blockLogo || blockRequests.length) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (liveLeaderboard && req.url() === LEADERBOARD_URL) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: leaderboardPage(liveLeaderboard)
        });
      } else if ((blockLogo && req.url() === LOGO_URL) || blockRequests.some(prefix => req.url().startsWith(prefix))) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  const extraPages = [];
  const app = {
    page,
    url,
    errors: [],
    dialogs: [],
    pause,
    // Opens another page in the same browser (sharing localStorage), e.g. a
    // ?display window. Its coverage and page errors count like the main page's.
    async openPage(search = '') {
      const extra = await browser.newPage();
      await extra.setViewport(viewport);
      if (collectCoverage) await extra.coverage.startJSCoverage(COVERAGE_OPTIONS);
      extra.on('pageerror', e => app.errors.push(e.message));
      await installRemote(extra);
      extraPages.push(extra);
      await extra.goto(`${url}${search}`, { waitUntil: 'networkidle0' });
      return extra;
    },
    // Saves a page's coverage so far, before it navigates (navigation drops it).
    async flushCoverage(target = page) {
      if (!collectCoverage) return;
      await saveUiCoverage(target);
      await target.coverage.startJSCoverage(COVERAGE_OPTIONS);
    },
    async close() {
      if (collectCoverage) {
        for (const extra of extraPages) await saveUiCoverage(extra).catch(() => {});
        await saveUiCoverage(page).catch(() => {});
      }
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    },
    async load() {
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForSelector('footer');
    },
    // Coverage is saved per page load, so flush it before reloading.
    async reload() {
      if (collectCoverage) {
        await saveUiCoverage(page);
        await page.coverage.startJSCoverage(COVERAGE_OPTIONS);
      }
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('footer');
    },
    // Sets the frozen clock used from the next page load on.
    async setClock(isoInstant) {
      await page.evaluate(ms => sessionStorage.setItem('__fakeNow', String(ms)), Date.parse(isoInstant));
    },
    text() {
      return page.evaluate(() => document.querySelector('#root').textContent);
    },
    textOf(selector) {
      return page.$eval(selector, e => e.textContent);
    },
    // Clicks the first visible, enabled button whose text includes `label`.
    async click(label, { within } = {}) {
      const clicked = await page.evaluate(
        (label, within) => {
          const scope = within ? document.querySelector(within) : document;
          if (!scope) return false;
          const button = [...scope.querySelectorAll('button')].find(
            b => b.textContent.includes(label) && !b.disabled && b.offsetParent !== null
          );
          if (button) button.click();
          return Boolean(button);
        },
        label,
        within
      );
      if (!clicked) throw new Error(`No visible, enabled button labelled "${label}"`);
      await pause();
    },
    // Sets an input's value the way React sees typing (no mouse, can't hang).
    async fill(target, value) {
      const handle = typeof target === 'string' ? await page.$(target) : target;
      if (!handle) throw new Error(`No element ${target}`);
      await handle.evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, String(value));
      await pause(20);
    },
    async type(selector, value) {
      await this.fill(selector, value);
    },
    async select(selector, value) {
      await page.select(selector, String(value));
      await pause();
    },
    async submitPin(pin) {
      await this.fill('input[type=password]', pin);
      await page.evaluate(() => document.querySelector('input[type=password]').form.requestSubmit());
      await pause();
    },
    async rosterCount() {
      return Number((await this.text()).match(/Player Roster \((\d+)\)/)[1]);
    },
    async addAllLeaderboardPlayers() {
      await this.click('Add from Leaderboard');
      await this.click('Select All');
      await this.click('Selected');
    },
    // Draws a Monster match and records a 2-0 win for team 1 on the first live table.
    async playMonsterMatch() {
      await this.click('Draw New Match');
      const inputs = await page.$$('[data-testid="live-table"] input[type=number]');
      for (const [i, score] of [5, 2, 5, 3].entries()) await this.fill(inputs[i], score);
      await this.click('Finish Match');
    },
    // Opens the bracket modal, applies the options given, and builds.
    async buildBracket({ teams = 4, elim = 'single', games = 1, formation, seeding } = {}) {
      await this.click('Draw Brackets');
      if (await page.$('[data-testid="paused-warning"]')) await this.click('Continue');
      await this.fill('[data-testid="team-count-input"]', teams);
      await this.select('[data-testid="elim-select"]', elim);
      await this.select('[data-testid="bracket-games-select"]', games);
      if (formation) await this.select('[data-testid="formation-select"]', formation);
      if (seeding) await this.select('[data-testid="seeding-select"]', seeding);
      await this.click('Build Bracket');
    },
    // First match card in a section that still takes scores and has two known teams.
    async playableCard(section) {
      for (const card of await page.$$(`[data-testid="${section}"] [data-testid="match-card"]`)) {
        const playable = await card.evaluate(
          c => c.querySelector('input[type=number]') !== null && !c.textContent.includes('TBD')
        );
        if (playable) return card;
      }
      return null;
    },
    // Scores game 1, switches on the handicap override for `winner`, and confirms.
    // Exercises every control on a match card.
    async playCard(card, winner) {
      const [t1, t2] = await card.$$('input[type=number]');
      await this.fill(t1, winner === 1 ? 5 : 2);
      await this.fill(t2, winner === 1 ? 2 : 5);
      await card.$eval('input[type=checkbox]', c => c.click());
      await pause(20);
      await card.$eval(
        'select',
        (s, w) => {
          s.value = String(w);
          s.dispatchEvent(new Event('change', { bubbles: true }));
        },
        winner
      );
      await pause(20);
      await card.$eval('[data-testid="confirm-match"]', b => b.click());
      await pause();
    },
    // Clicks `label` and captures the file the page tries to download.
    async captureDownload(label, options) {
      await page.evaluate(() => {
        window.__download = null;
        HTMLAnchorElement.prototype.click = function () {
          window.__download = { href: this.getAttribute('href'), name: this.getAttribute('download') };
        };
      });
      await this.click(label, options);
      const download = await page.evaluate(() => window.__download);
      if (!download) throw new Error(`Clicking "${label}" did not download anything`);
      const comma = download.href.indexOf(',');
      return {
        name: download.name,
        mimeType: download.href.slice(5, download.href.indexOf(';')),
        text: decodeURIComponent(download.href.slice(comma + 1))
      };
    },
    currentTournamentId() {
      return page.evaluate(() => localStorage.getItem('foosTourney.currentTournament'));
    },
    // Opens Saved Tournaments and returns the selector of a tournament's row
    // (the current one by default), which has Export CSV / Export JSON buttons.
    async openExportOptions(id) {
      const tournamentId = id || (await this.currentTournamentId());
      if (!(await page.$('[data-testid="saved-tournaments"]'))) await this.click('Saved Tournaments');
      return `[data-tournament-id="${tournamentId}"]`;
    },
    // Exports a saved tournament (default: current) as 'CSV' or 'JSON'.
    async exportFromSaved(format, id) {
      const row = await this.openExportOptions(id);
      const file = await this.captureDownload(`Export ${format}`, { within: row });
      await this.click('Close', { within: '[data-testid="saved-tournaments"]' });
      return file;
    },
    async exportCsv() {
      const { name, text } = await this.exportFromSaved('CSV');
      return { name, csv: text };
    },
    // Writes `text` to a temp file and picks it in the import dialog's file input.
    async chooseImportFile(text) {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foos-')), 'import.json');
      fs.writeFileSync(file, text);
      const input = await page.$('[data-testid="import-file-input"]');
      await input.uploadFile(file); // fires the input's change event
      await pause(150);
    },
    storageKeys() {
      return page.evaluate(() => Object.keys(localStorage));
    },
    // The fake remote (remote: true): calls made from a page, and the shared server.
    remoteCalls(target = page) {
      return target.evaluate(() => window.__remoteCalls);
    },
    remoteServer() {
      return page.evaluate(() => JSON.parse(localStorage.getItem('__fakeRemote.server') || 'null'));
    },
    setRemoteServer(server) {
      return page.evaluate(s => localStorage.setItem('__fakeRemote.server', JSON.stringify(s)), server);
    },
    setRemoteConfig(config) {
      return page.evaluate(c => localStorage.setItem('__fakeRemote.config', JSON.stringify(c)), config);
    }
  };

  page.on('pageerror', e => app.errors.push(e.message));
  page.on('dialog', d => {
    app.dialogs.push(d.message());
    d.accept();
  });
  try {
    await app.load();
  } catch (err) {
    await app.close();
    throw err;
  }
  return app;
}

module.exports = { openApp, findChrome, leaderboardPage };
