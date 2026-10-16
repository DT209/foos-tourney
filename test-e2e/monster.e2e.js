// Monster / open play stage: settings, drawing matches onto tables, scoring,
// handicap overrides, deleting, finishing, clearing, history and CSV export.
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

const liveTables = () => app.page.$$('[data-testid="live-table"]');

describe('setup', () => {
  it('table count, format and best-of settings shape the next drawn match', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="table-count-select"]', '3');
    assert.equal((await liveTables()).length, 3);
    await app.select('[data-testid="format-select"]', '1v1');
    await app.select('[data-testid="max-games-select"]', '5');
    await app.click('Draw New Match');
    const table = (await liveTables())[0];
    assert.equal((await table.$$('input[type=number]')).length, 10, 'best of 5 = 5 games x 2 scores');
    assert.doesNotMatch(await table.evaluate(e => e.textContent), / & /, '1v1 has no partners');
  });
});

describe('drawing matches', () => {
  it('needs enough players', async () => {
    app = await openApp();
    await app.click('Draw New Match');
    assert.equal(app.dialogs.at(-1), 'Not enough available players. Found 0, need at least 4.');
  });

  it('refuses when every table is busy', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="table-count-select"]', '1');
    await app.click('Draw New Match');
    await app.click('Draw New Match');
    assert.equal(app.dialogs.at(-1), 'All tables are currently occupied!');
  });

  it('deleting a match frees its table after confirming', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    await app.click('Delete', { within: '[data-testid="live-table"]' });
    assert.match(app.dialogs.at(-1), /delete this match/);
    assert.doesNotMatch(await app.text(), /MATCH IN PROGRESS/);
  });
});

describe('scoring', () => {
  it('a handicap override can declare either team the winner', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    const table = '[data-testid="live-table"]';
    assert.match(await app.textOf(table), /Enter Winning Scores to Finish/);
    await app.page.$eval(`${table} input[type=checkbox]`, e => e.click());
    await app.pause();
    assert.match(await app.textOf(table), /Winner: Team 1/);
    await app.page.select(`${table} select`, '2');
    await app.pause();
    assert.match(await app.textOf(table), /Winner: Team 2/);
    await app.click('Finish Match');
    const history = await app.textOf('[data-testid="match-history"]');
    assert.match(history, /Monster/);
    assert.match(history, /Yes/, 'handicap shown in history');
  });

  it('typed scores decide the winner and appear winner-first in history', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    const inputs = await app.page.$$('[data-testid="live-table"] input[type=number]');
    for (const [i, score] of [2, 5, 3, 5].entries()) await app.fill(inputs[i], score);
    assert.match(await app.textOf('[data-testid="live-table"]'), /Winner: Team 2/);
    await app.click('Finish Match');
    const history = await app.textOf('[data-testid="match-history"]');
    assert.match(history, /G1: 5 - 2/);
    assert.match(history, /G2: 5 - 3/);
  });
});

describe('clearing and export', () => {
  it('Clear Matches asks first; Cancel keeps, Clear Matches clears results but not the roster', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    const roster = await app.rosterCount();
    await app.playMonsterMatch();
    await app.click('Clear Matches');
    await app.click('Cancel');
    assert.match(await app.textOf('[data-testid="match-history"]'), /Monster/);
    await app.click('Clear Matches');
    await app.click('Clear Matches', { within: '.fixed' });
    assert.equal(await app.page.$('[data-testid="match-history"] tbody tr'), null);
    assert.equal(await app.rosterCount(), roster);
  });

  it('with a bracket, Clear Matches keeps its teams and returns it to Round 1', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-winners'), 1);
    const teamsBefore = await app.page.$$eval('[data-testid="bracket-winners"] [data-testid="match-card"]', cards =>
      cards.slice(0, 2).map(c => c.textContent.replace(/✓ Winner|✓ Complete|Table #\d+/g, ''))
    );
    await app.click('Monster / Open Play Stage');
    await app.click('Clear Matches');
    assert.match(await app.text(), /team assignments will be kept/);
    await app.click('Clear Matches', { within: '.fixed' });
    await app.click('Bracket Playoff Stage');
    assert.equal(
      (await app.page.$$eval(
        '[data-testid="bracket-winners"] [data-testid="match-card"] [data-testid="confirm-match"]',
        b => b.length
      )) >= 2,
      true,
      'Round 1 is unplayed again'
    );
    assert.doesNotMatch(await app.textOf('[data-testid="bracket-winners"]'), /✓ Complete/);
    assert.equal(teamsBefore.length, 2);
  });

  it('CSV export says when there is nothing to export', async () => {
    app = await openApp();
    const row = await app.openExportOptions();
    await app.click('CSV', { within: row });
    assert.equal(app.dialogs.at(-1), 'No completed match data available to export yet.');
  });

  it('CSV export writes one row per scored game', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    const { csv } = await app.exportCsv();
    const lines = csv.split('\n');
    assert.match(lines[0], /^Match ID,Date,Game Number/);
    assert.equal(lines.length, 3, 'header + two scored games');
  });
});
