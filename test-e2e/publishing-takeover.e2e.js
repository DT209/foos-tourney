// Publishing: one slot per browser (the replace question, full slots) and
// taking over with the publisher code.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./publishing-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { DIALOG, OTHER_ID, OTHER_CODE, methods, addPlayer, newTournament, waitFor, seedOther, codeFile } = helpers(
  () => app
);

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
