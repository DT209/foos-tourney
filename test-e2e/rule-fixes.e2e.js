// UI checks for the rule fixes: bracket cards wait for both teams (#1) and
// label Team 1 / Team 2, manual pairings are validated (#3), lowering Tables
// Available asks before moving bracket matches (#4), and New Tournament keeps
// the settings (#10).
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

const savedState = () =>
  app.page.evaluate(() => {
    const id = localStorage.getItem('foosTourney.currentTournament');
    return JSON.parse(localStorage.getItem(`foosTourney.tournament.${id}`)).state;
  });

const cardInfo = sel =>
  app.page.$eval(sel, c => ({
    inputs: c.querySelectorAll('input').length,
    confirm: Boolean(c.querySelector('[data-testid="confirm-match"]')),
    waiting: Boolean(c.querySelector('[data-testid="waiting-for-teams"]')),
    badges: [...c.querySelectorAll('[data-testid="team-badge"]')].map(b => b.textContent)
  }));

describe('bracket match cards', () => {
  it('a card with a TBD team waits for both teams: no scores, handicap or Confirm', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'single' });
    const final = '[data-testid="bracket-grand-finals"] [data-testid="match-card"]';
    assert.deepEqual(await cardInfo(final), { inputs: 0, confirm: false, waiting: true, badges: ['Team 1', 'Team 2'] });

    const semi = await app.playableCard('bracket-winners');
    const labels = await semi.$$eval('input[type=number]', els => els.map(e => e.getAttribute('aria-label')));
    assert.deepEqual(labels, ['Game 1 Team 1 score', 'Game 1 Team 2 score']);
    assert.match(await semi.evaluate(c => c.textContent), /Team 1.*Team 2.*Game #1/);
  });
});

describe('manual pairings', () => {
  it('refuses a player picked for two teams', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw Brackets');
    await app.fill('[data-testid="team-count-input"]', 2);
    await app.select('[data-testid="formation-select"]', 'manual');
    const selects = await app.page.$$('[data-testid="manual-team"] select');
    const first = await selects[0].evaluate(s => s.value);
    await selects[2].select(first);
    await app.click('Build Bracket');
    assert.match(app.dialogs.at(-1), /is picked more than once/);
    assert.equal((await savedState()).bracketData, null);
  });
});

describe('Tables Available', () => {
  it('refuses to remove a table with a live open-play match', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="table-count-select"]', 3);
    for (let i = 0; i < 3; i++) await app.click('Draw New Match');
    await app.select('[data-testid="table-count-select"]', 2);
    assert.match(app.dialogs.at(-1), /Table 3 has an open-play match in progress/);
    assert.equal((await savedState()).tableCount, 3);
    assert.equal(await app.page.$eval('[data-testid="table-count-select"]', s => s.value), '3');
    assert.equal((await app.page.$$('[data-testid="live-table"]')).length, 3);
  });

  it('asks before moving a bracket match off a removed table; Cancel keeps it', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="table-count-select"]', 4);
    await app.buildBracket({ teams: 8, elim: 'single' });
    const tableOf = async () => (await savedState()).bracketData.winnersRounds[0].map(m => m.table);
    assert.deepEqual(await tableOf(), [1, 2, 3, 4]);
    await app.click('Monster / Open Play Stage');

    await app.page.evaluate(() => {
      window.confirm = () => false;
    });
    await app.select('[data-testid="table-count-select"]', 2);
    assert.equal((await savedState()).tableCount, 4);
    assert.equal(await app.page.$eval('[data-testid="table-count-select"]', s => s.value), '4');

    await app.page.evaluate(() => {
      window.confirm = message => {
        window.__lastConfirm = message;
        return true;
      };
    });
    await app.select('[data-testid="table-count-select"]', 2);
    const message = await app.page.evaluate(() => window.__lastConfirm);
    assert.match(message, /bracket match is drawn on a table you're removing/);
    assert.match(message, /Table 3: .*\nTable 4: /);
    const state = await savedState();
    assert.equal(state.tableCount, 2);
    assert.deepEqual(
      state.bracketData.winnersRounds[0].map(m => m.table),
      [1, 2, null, null]
    );

    // Raising the count never asks.
    await app.select('[data-testid="table-count-select"]', 3);
    assert.equal((await savedState()).tableCount, 3);
  });
});

describe('New Tournament', () => {
  it('keeps the name, tables, format, best-of, bracket options and PIN; clears the rest', async () => {
    app = await openApp();
    await app.page.evaluate(() => {
      const name = [...document.querySelectorAll('input[type=text]')].find(i => i.value === 'Thursday DYP');
      name.setAttribute('data-test-name', '');
    });
    await app.fill('[data-test-name]', 'Friday Singles');
    await app.select('[data-testid="table-count-select"]', 4);
    await app.select('[data-testid="format-select"]', '1v1');
    await app.select('[data-testid="max-games-select"]', 5);
    await app.addAllLeaderboardPlayers();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    await app.click('View Only (Unlock)');
    await app.submitPin('2468');
    const before = await savedState();
    assert.notEqual(before.adminPin, null);
    assert.equal(before.isLocked, false);

    await app.click('New Tournament');
    await app.click('Start New Tournament');
    const after = await savedState();
    assert.notEqual(after.tournamentId, before.tournamentId);
    assert.deepEqual(
      [after.tournamentName, after.tableCount, after.format, after.maxGames, after.adminPin, after.isLocked],
      ['Friday Singles', 4, '1v1', 5, before.adminPin, false]
    );
    assert.deepEqual([after.players, after.matches, after.bracketData], [[], [], null]);
  });
});
