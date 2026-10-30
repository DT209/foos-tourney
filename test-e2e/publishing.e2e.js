// Publishing to Firebase from the control desk, with the recording fake
// remote (fake-remote.js): what is sent and when, the replace question, full
// slots, the publisher code, take-over, and failures.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openApp } = require('./harness');

const NAME_INPUT = 'input[placeholder="Search leaderboard or enter a guest name"]';
const DIALOG = '[data-testid="publishing-dialog"]';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_CODE = 'ABCD2345EFGH';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const methods = async (target = app.page) => (await app.remoteCalls(target)).map(c => c.method);
const writes = async () => (await app.remoteCalls()).filter(c => c.method === 'publish');
const row = name => `[data-testid="player-row"][data-player-name="${name}"]`;

async function addPlayer(name) {
  await app.type(NAME_INPUT, name);
  await app.page.evaluate(sel => document.querySelector(sel).form.requestSubmit(), NAME_INPUT);
  await app.pause();
  if (await app.page.$('[data-testid="guest-confirm"]')) await app.click('Add Anyway');
}

async function newTournament() {
  await app.click('New Tournament');
  await app.click('Start New Tournament');
  await app.pause(150);
}

const waitFor = async (check, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await app.pause(100);
  }
};

// A tournament published from another browser ("other"), in slot 1.
async function seedOther({ name = 'Other Night', updatedAt = Date.now(), uid = 'other', slot = 1 } = {}) {
  const exportText = await app.page.evaluate(
    (id, name) => {
      const L = window.TournamentLogic;
      return L.publishedExport({ ...L.newTournamentState(id, new Date()), tournamentName: name });
    },
    OTHER_ID,
    name
  );
  const slots = [null, null, null, null, null];
  slots[slot - 1] = { tournamentId: OTHER_ID, ownerUid: uid };
  await app.setRemoteServer({
    slots,
    tournaments: {
      [OTHER_ID]: {
        id: OTHER_ID,
        slot,
        ownerUid: uid,
        name,
        startedAt: new Date().toISOString(),
        updatedAt,
        exportText
      }
    },
    owners: { [uid]: { slot, tournamentId: OTHER_ID } },
    codes: { [OTHER_ID]: OTHER_CODE }
  });
}

function codeFile(text) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foos-')), 'x.publisher-code.txt');
  fs.writeFileSync(file, text);
  return file;
}

describe('publishing switched off', () => {
  it('shows no Publishing button and Firebase import says it is not set up', async () => {
    app = await openApp();
    assert.equal(await app.page.$('[data-testid="publishing-button"]'), null);
    await app.click('Saved Tournaments');
    await app.click('Import…');
    assert.match(await app.textOf('[data-testid="import-dialog"]'), /Publishing isn't set up on this page/);
    assert.equal(await app.page.$eval('[data-testid="import-source-firebase"]', b => b.disabled), true);
  });
});

describe('starting to publish', () => {
  it('sends nothing before New Tournament: the first-visit tournament stays local', async () => {
    app = await openApp({ remote: true });
    await addPlayer('Andrew');
    await app.click('Unpaid', { within: row('Andrew') });
    await app.pause(300);
    assert.deepEqual(await methods(), []);
    await app.click('Publishing');
    assert.match(await app.textOf(DIALOG), /This tournament isn't published/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /read-only live copy/);
    assert.match(await app.textOf(DIALOG), /Moves a tournament published from another browser/);
    assert.match(await app.textOf(DIALOG), /doesn't stop publishing/);
    await app.click('Close', { within: DIALOG });
  });

  it('publishes on New Tournament, without the PIN or lock, and shows the code and link', async () => {
    app = await openApp({ remote: true });
    await app.click('Admin Lock'); // lock, then unlock: the PIN is set
    await app.submitPin('1234');
    await app.click('View Only (Unlock)');
    await app.submitPin('1234');
    await newTournament();
    assert.deepEqual(await methods(), ['startPublishing']);
    const id = await app.currentTournamentId();
    const server = await app.remoteServer();
    const published = JSON.parse(server.tournaments[id].exportText);
    assert.equal(published.tournament.adminPin, null);
    assert.equal(published.tournament.isLocked, false);
    assert.match(await app.textOf('[data-testid="publishing-button"]'), /Live/);

    await app.click('Publishing');
    const dialog = await app.textOf(DIALOG);
    assert.match(dialog, /Live in slot 1/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /sent within 5 seconds/);
    assert.match(dialog, /Copy Link puts it on the clipboard/);
    assert.match(dialog, /Save Code to File downloads a text file/);
    assert.match(await app.textOf('[data-testid="viewer-link"]'), new RegExp(`\\?remote=${id}&layout=top-50-50$`));
    const code = await app.textOf('[data-testid="publisher-code"]');
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(server.codes[id], code.replace(/-/g, ''));

    await app.page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = text => {
        window.__copied.push(text);
        return Promise.resolve();
      };
    });
    await app.click('Copy Code');
    await app.click('Copy Link');
    assert.deepEqual(await app.page.evaluate(() => window.__copied), [
      code,
      await app.textOf('[data-testid="viewer-link"]')
    ]);

    const file = await app.captureDownload('Save Code to File');
    assert.match(file.name, /^Thursday_DYP_\d{4}-\d{2}-\d{2}\.publisher-code\.txt$/);
    assert.equal(file.mimeType, 'text/plain');
    assert.match(file.text, new RegExp(`Code: ${code}`));
    assert.match(file.text, new RegExp(`Tournament id: ${id}`));
    assert.deepEqual(await app.page.evaluate(t => window.TournamentLogic.parsePublisherCodeFile(t), file.text), {
      tournamentId: id,
      code: code.replace(/-/g, '')
    });

    await app.page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    });
    await app.click('Copy Code');
    assert.match(app.dialogs.at(-1), /Copying failed/);
  });
});

describe('sending changes', () => {
  it('sends only watched changes, at most every 5 seconds, carrying the latest state', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    await addPlayer('Andrew'); // leaderboard changes: a write is due
    await addPlayer('Bob');
    await app.click('Unpaid', { within: row('Andrew') }); // unwatched: rides along
    assert.equal((await writes()).length, 0, 'held back until 5 s after the start');
    await waitFor(async () => (await writes()).length === 1);
    const [first] = await writes();
    const sent = JSON.parse(first.exportText).tournament;
    assert.deepEqual(
      sent.players.map(p => [p.name, p.paid]),
      [
        ['Andrew', true],
        ['Bob', false]
      ]
    );

    await app.click('Unpaid', { within: row('Bob') }); // unwatched alone: nothing
    await app.pause(5500);
    assert.equal((await writes()).length, 1);

    await app.select('[data-testid="table-count-select"]', 3); // a third table: watched
    await waitFor(async () => (await writes()).length === 2);
    const second = JSON.parse((await writes())[1].exportText).tournament;
    assert.equal(second.players.find(p => p.name === 'Bob').paid, true, 'the paid flag rode along');
  });

  it('resumes when a published tournament is reopened, and never publishes the others', async () => {
    app = await openApp({ remote: true });
    const firstId = await app.currentTournamentId();
    await newTournament();
    const publishedId = await app.currentTournamentId();
    await app.click('Saved Tournaments');
    await app.click('Open', { within: `[data-tournament-id="${firstId}"]` });
    await addPlayer('Andrew');
    await app.pause(5500);
    assert.equal((await writes()).length, 0, 'the local tournament is not published');
    await app.click('Publishing');
    assert.match(await app.textOf(DIALOG), /This browser publishes “Thursday DYP”/);
    assert.match(await app.textOf('[data-testid="publishing-help"]'), /asks whether to replace/);
    await app.click('Close', { within: DIALOG });

    await app.click('Saved Tournaments');
    await app.click('Open', { within: `[data-tournament-id="${publishedId}"]` });
    await addPlayer('Bob');
    await waitFor(async () => (await writes()).length === 1);
    assert.equal((await writes())[0].id, publishedId);
  });
});

describe('one slot per browser', () => {
  it('asks before replacing: Keep Current leaves the new tournament local, Replace swaps it in', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    const firstPublished = await app.currentTournamentId();
    await newTournament();
    assert.match(await app.textOf('[data-testid="replace-prompt"]'), /already publishing “Thursday DYP”/);
    await app.click('Keep Current');
    assert.equal(await app.page.$('[data-testid="replace-prompt"]'), null);
    assert.ok((await app.remoteServer()).tournaments[firstPublished], 'the old one keeps publishing');
    assert.doesNotMatch(await app.textOf('[data-testid="publishing-button"]'), /Live/);

    await newTournament();
    await app.click('Replace');
    await app.pause(100);
    const id = await app.currentTournamentId();
    const server = await app.remoteServer();
    assert.equal(server.tournaments[firstPublished], undefined);
    assert.equal(server.slots[0].tournamentId, id);
    assert.ok((await methods()).includes('replacePublished'));
    assert.match(await app.textOf('[data-testid="publishing-button"]'), /Live/);

    await newTournament();
    await app.setRemoteConfig({ unavailable: true });
    await app.click('Replace');
    await app.pause(100);
    assert.match(await app.textOf('[data-testid="publish-status"]'), /this tournament isn't published/);
  });

  it('runs unpublished when all 5 slots are in use, then retries once one frees', async () => {
    app = await openApp({ remote: true });
    const almostExpired = Date.now() - 24 * 3600 * 1000 + 2500;
    await app.page.evaluate(
      (soon, ids) => {
        const now = Date.now();
        const server = { slots: [], tournaments: {}, owners: {}, codes: {} };
        ids.forEach((id, i) => {
          server.slots.push({ tournamentId: id, ownerUid: `u${i}` });
          server.tournaments[id] = {
            id,
            slot: i + 1,
            ownerUid: `u${i}`,
            name: `T${i}`,
            startedAt: '',
            updatedAt: i === 2 ? soon : now,
            exportText: ''
          };
        });
        localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
      },
      almostExpired,
      ['a', 'b', 'c', 'd', 'e']
    );
    await newTournament();
    assert.match(
      await app.textOf('[data-testid="publish-status"]'),
      /All 5 publishing slots are in use\. The next one frees at/
    );
    await app.pause(3000);
    await addPlayer('Andrew'); // the next watched change after the free time
    await waitFor(async () => (await methods()).filter(m => m === 'startPublishing').length === 2);
    await waitFor(async () => /Live/.test(await app.textOf('[data-testid="publishing-button"]')));
    assert.equal((await app.remoteServer()).slots[2].tournamentId, await app.currentTournamentId());
    assert.equal(await app.page.$('[data-testid="publish-status"]'), null, 'the full notice clears');
  });
});

describe('failures', () => {
  it('says so when publishing moved to another device, and stops sending', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    const id = await app.currentTournamentId();
    const server = await app.remoteServer();
    server.tournaments[id].ownerUid = 'elsewhere';
    await app.setRemoteServer(server);
    await addPlayer('Andrew');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="publish-status"]')));
    assert.match(await app.textOf('[data-testid="publish-status"]'), /Publishing moved to another device/);
    assert.doesNotMatch(await app.textOf('[data-testid="publishing-button"]'), /Live/);
    assert.equal(await app.page.evaluate(() => localStorage.getItem('foosTourney.publishing')), null);
    await app.click('Dismiss');
    assert.equal(await app.page.$('[data-testid="publish-status"]'), null);
  });

  it('runs normally when Firebase is unreachable at the start', async () => {
    app = await openApp({ remote: true });
    await app.setRemoteConfig({ unavailable: true });
    await newTournament();
    assert.match(await app.textOf('[data-testid="publish-status"]'), /this tournament isn't published/);
  });

  it('says a change is waiting when a write fails', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    await app.setRemoteConfig({ unavailable: true });
    await addPlayer('Andrew');
    await waitFor(async () => Boolean(await app.page.$('[data-testid="publish-status"]')));
    assert.match(await app.textOf('[data-testid="publish-status"]'), /latest change isn't published yet/);
  });
});

describe('taking over', () => {
  it('explains that the admin lock blocks taking over', async () => {
    app = await openApp({ remote: true });
    await app.click('Admin Lock');
    await app.submitPin('1234');
    await app.click('Publishing');
    assert.match(await app.textOf(DIALOG), /Unlock Admin Lock to take over publishing/);
    await app.click('Close', { within: DIALOG });
  });

  it('needs the right code, then opens the tournament and publishes from here', async () => {
    app = await openApp({ remote: true });
    await seedOther();
    await app.click('Publishing');
    await app.click('Take Over Publishing');
    await waitFor(async () => (await app.page.$$('[data-testid="take-over-choice"]')).length === 1);
    assert.match(await app.textOf('[data-testid="take-over"]'), /Other Night/);
    assert.match(await app.textOf('[data-testid="take-over-help"]'), /opens it here, and publishes its changes/);
    await app.page.$eval('[data-testid="take-over-choice"] input', i => i.click());
    await app.fill('[data-testid="take-over-code"]', 'WRNG-2345-EFGH');
    await app.click('Take Over', { within: '[data-testid="take-over"]' });
    await app.pause(100);
    assert.match(app.dialogs.at(-1), /publisher code is not right/);

    await app.fill('[data-testid="take-over-code"]', 'abcd 2345 efgh');
    await app.click('Take Over', { within: '[data-testid="take-over"]' });
    await app.pause(150);
    assert.equal(await app.currentTournamentId(), OTHER_ID);
    assert.equal(await app.page.$eval('input[placeholder="e.g. Friday Night Open"]', i => i.value), 'Other Night');
    assert.match(await app.textOf(DIALOG), /Live in slot 1/);
    assert.equal((await app.remoteServer()).tournaments[OTHER_ID].ownerUid, 'desk');
    assert.ok((await app.storageKeys()).includes(`foosTourney.tournament.${OTHER_ID}`));
  });

  it('reads the tournament and code from a saved code file', async () => {
    app = await openApp({ remote: true });
    await seedOther();
    await app.click('Publishing');
    await app.click('Take Over Publishing');
    await app.click('Choose Code File'); // opens the OS picker; nothing to choose headless
    const input = await app.page.$('[data-testid="code-file-input"]');
    await input.uploadFile(codeFile('not a code file'));
    await app.pause(150);
    assert.match(app.dialogs.at(-1), /isn't a Foos Tourney publisher code file/);
    await input.uploadFile(codeFile(`Tournament id: ${OTHER_ID}\nCode: ABCD-2345-EFGH\n`));
    await app.pause(150);
    assert.equal(await app.page.$eval('[data-testid="take-over-code"]', i => i.value), 'ABCD-2345-EFGH');
    assert.equal(await app.page.$eval('[data-testid="take-over-choice"] input', i => i.checked), true);
    await app.click('Take Over', { within: '[data-testid="take-over"]' });
    await app.pause(150);
    assert.equal(await app.currentTournamentId(), OTHER_ID);
  });

  it('asks before giving up the slot this browser already holds', async () => {
    app = await openApp({ remote: true });
    await newTournament();
    const mine = await app.currentTournamentId();
    const server = await app.remoteServer();
    await seedOther({ slot: 2 });
    const other = await app.remoteServer();
    other.slots[0] = server.slots[0];
    Object.assign(other.tournaments, server.tournaments);
    Object.assign(other.owners, server.owners);
    Object.assign(other.codes, server.codes);
    await app.setRemoteServer(other);

    await app.click('Publishing');
    await app.click('Take Over Publishing');
    await waitFor(async () => (await app.page.$$('[data-testid="take-over-choice"]')).length === 2);
    await app.page.$$eval('[data-testid="take-over-choice"]', labels =>
      labels
        .find(l => l.textContent.includes('Other Night'))
        .querySelector('input')
        .click()
    );
    await app.fill('[data-testid="take-over-code"]', OTHER_CODE);
    await app.click('Take Over', { within: '[data-testid="take-over"]' });
    await waitFor(async () => (await app.currentTournamentId()) === OTHER_ID);
    assert.ok(app.dialogs.includes('Taking over stops publishing "Thursday DYP". Continue?'));
    const after = await app.remoteServer();
    assert.equal(after.tournaments[mine], undefined);
    assert.equal(after.slots[0], null);
  });

  it('copes with Firebase being unreachable', async () => {
    app = await openApp({ remote: true });
    await seedOther();
    await app.setRemoteConfig({ unavailable: true });
    await app.click('Publishing');
    await app.click('Take Over Publishing');
    await waitFor(async () => /can't be reached/.test(await app.textOf('[data-testid="take-over"]')));
    await app.setRemoteConfig({});
    await app.click('Back');
    await app.click('Take Over Publishing');
    await waitFor(async () => (await app.page.$$('[data-testid="take-over-choice"]')).length === 1);
    await app.page.$eval('[data-testid="take-over-choice"] input', i => i.click());
    await app.fill('[data-testid="take-over-code"]', OTHER_CODE);
    await app.setRemoteConfig({ unavailable: true });
    await app.click('Take Over', { within: '[data-testid="take-over"]' });
    await app.pause(100);
    assert.match(app.dialogs.at(-1), /Can't reach Firebase/);
    await app.click('Close', { within: DIALOG });
    assert.equal(await app.page.$(DIALOG), null);
  });
});
