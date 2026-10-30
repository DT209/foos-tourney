// Finishing a tournament: when the bracket completes, the Tournament Complete
// dialog asks whether it is done. Finishing makes it read-only on this page for
// good (no PIN lifts it), offers Export CSV and JSON, and shows it as Final in
// Display Mode. An edited JSON imported with Replace Saved Copy can reopen it.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const QUESTION = '[data-testid="finish-question"]';
const EXPORTS = '[data-testid="finished-exports"]';
const BANNER = '[data-testid="finished-banner"]';
const NAME_INPUT = 'input[placeholder="Search leaderboard or enter a guest name"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

// Plays a 2-team, single-elimination 1v1 bracket to the end: one match.
async function completeBracket() {
  app = await openApp();
  await app.addAllLeaderboardPlayers();
  await app.select('[data-testid="format-select"]', '1v1');
  await app.buildBracket({ teams: 2, elim: 'single' });
  await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
  await app.page.waitForSelector(QUESTION);
}

const disabled = sel => app.page.$eval(sel, e => e.disabled);
const buttonDisabled = label =>
  app.page.evaluate(
    label => [...document.querySelectorAll('button')].find(b => b.textContent.includes(label)).disabled,
    label
  );

// The bracket has its own tab; the roster, setup and Saved Tournaments are on
// the Monster tab.
const monsterTab = () => app.click('Monster / Open Play Stage');
const bracketTab = () => app.click('Bracket Playoff Stage');

async function finish() {
  await app.click('Finish Tournament', { within: QUESTION });
  await app.page.waitForSelector(EXPORTS);
}

describe('finishing a tournament', () => {
  it('asks whether it is done when the bracket completes; Not Yet keeps it editable and Standings asks again', async () => {
    await completeBracket();
    assert.match(await app.text(), /Tournament Complete!/);
    assert.match(await app.textOf(QUESTION), /Is the tournament done\?/);
    assert.match(await app.textOf(QUESTION), /admin PIN can't undo it/);

    await app.click('Not Yet', { within: QUESTION });
    assert.equal(await app.page.$(QUESTION), null);
    assert.equal(await app.page.$(BANNER), null);
    await monsterTab();
    assert.equal(await disabled(NAME_INPUT), false, 'still editable');

    await bracketTab();
    await app.click('Standings');
    await app.page.waitForSelector(QUESTION);
  });

  it('Finish makes it read-only for good, offers the final exports, and survives a reload', async () => {
    await completeBracket();
    await finish();

    const csv = await app.captureDownload('Export CSV', { within: EXPORTS });
    assert.equal(csv.mimeType, 'text/csv');
    assert.match(csv.text, /^Match ID,/);
    const json = await app.captureDownload('Export JSON', { within: EXPORTS });
    assert.match(JSON.parse(json.text).tournament.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
    await app.click('Close Results');

    assert.match(await app.textOf(BANNER), /Final · Finished .*read-only here/);
    await monsterTab();
    assert.equal(await disabled(NAME_INPUT), true, 'roster');
    assert.equal(await buttonDisabled('Draw Brackets'), true);
    assert.equal(await buttonDisabled('Clear Matches'), true);
    assert.doesNotMatch(await app.textOf('header'), /Admin Lock|View Only/, 'no PIN control to lift it');
    assert.equal(await buttonDisabled('New Tournament'), false, 'the next tournament can still start');
    assert.equal(await buttonDisabled('Saved Tournaments'), false);

    const bannerCsv = await app.captureDownload('Export CSV', { within: BANNER });
    assert.equal(bannerCsv.text, csv.text);
    const bannerJson = await app.captureDownload('Export JSON', { within: BANNER });
    assert.equal(JSON.parse(bannerJson.text).tournament.finishedAt, JSON.parse(json.text).tournament.finishedAt);

    await app.reload();
    assert.ok(await app.page.$(BANNER), 'still finished after a reload');
    await monsterTab();
    assert.equal(await disabled(NAME_INPUT), true);
    await bracketTab();
    await app.click('Standings');
    assert.equal(await app.page.$(QUESTION), null, 'not asked again');
    assert.ok(await app.page.$(EXPORTS));
  });

  it('shows Final in Display Mode', async () => {
    await completeBracket();
    await finish();
    await app.click('Close Results');
    await app.click('Display Mode');
    assert.equal(await app.textOf('[data-testid="display-final"]'), 'Final');
  });

  it('is not offered while the admin lock is on', async () => {
    await completeBracket();
    await app.click('Not Yet', { within: QUESTION });
    await app.click('Admin Lock');
    await app.submitPin('1234');
    await app.click('Standings');
    assert.equal(await app.page.$(QUESTION), null);
    assert.equal(await app.page.$(EXPORTS), null);
    await app.click('Close Results');
  });

  it('reopens when an edited JSON with "finishedAt": null replaces the saved copy', async () => {
    await completeBracket();
    await finish();
    const json = await app.captureDownload('Export JSON', { within: EXPORTS });
    await app.click('Close Results');

    const edited = JSON.parse(json.text);
    edited.tournament.finishedAt = null;
    await monsterTab();
    await app.click('Saved Tournaments');
    await app.click('Import…');
    await app.chooseImportFile(JSON.stringify(edited));
    await app.click('Replace Saved Copy');
    assert.equal(await app.page.$(BANNER), null, 'editable again');
    await monsterTab();
    assert.equal(await disabled(NAME_INPUT), false);

    // Importing the finished file again finishes it again.
    await monsterTab();
    await app.click('Saved Tournaments');
    await app.click('Import…');
    await app.chooseImportFile(json.text);
    await app.click('Replace Saved Copy');
    assert.ok(await app.page.$(BANNER));
  });
});
