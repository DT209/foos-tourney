// Bracket stage: the bracket modal and its options, and the paused-player
// warning. Formats played to completion are in bracket-formats.
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

describe('bracket modal', () => {
  it('warns about paused players; Cancel stays, Continue opens the modal', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Active', { within: '[data-testid="player-row"]' });
    await app.click('Draw Brackets');
    assert.match(await app.text(), /Paused Players Detected/);
    await app.click('Cancel');
    assert.doesNotMatch(await app.text(), /Paused Players Detected/);
    await app.click('Draw Brackets');
    await app.click('Continue');
    assert.match(await app.text(), /Generate Bracket Stage/);
    await app.click('Cancel');
    assert.doesNotMatch(await app.text(), /Generate Bracket Stage/);
  });

  it('rejects a team count below 2 or above the roster', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw Brackets');
    await app.type('[data-testid="team-count-input"]', '1');
    await app.click('Build Bracket');
    assert.equal(app.dialogs.at(-1), 'Please enter a valid number of teams (minimum 2).');
    await app.type('[data-testid="team-count-input"]', '64');
    await app.click('Build Bracket');
    assert.match(app.dialogs.at(-1), /Not enough ranked players/);
    await app.type('[data-testid="team-count-input"]', '');
    await app.click('Build Bracket');
    assert.equal(app.dialogs.at(-1), 'Please enter a valid number of teams (minimum 2).');
  });

  it('manual pairings: pick players for each team, with any seeding', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw Brackets');
    await app.type('[data-testid="team-count-input"]', '2');
    await app.select('[data-testid="formation-select"]', 'manual');
    await app.select('[data-testid="seeding-select"]', 'elo');
    const [p1, p2, p3, p4] = await app.page.$$('[data-testid="manual-team"] select');
    const options = await p1.$$eval('option', os => os.map(o => o.value).filter(Boolean));
    // Swap the pre-filled pairs: Team 1 takes players 4 and 3, Team 2 players 1 and 2.
    await p1.select(options[3]);
    await p2.select(options[2]);
    await p3.select(options[0]);
    await p4.select(options[1]);
    await app.pause();
    // Clearing a slot shows the placeholder again.
    await p2.select('');
    await app.pause();
    assert.equal(await p2.evaluate(s => s.value), '');
    await p2.select(options[2]);
    await app.pause();
    await app.click('Build Bracket');
    assert.match(await app.text(), /Live Table Matches/i);
  });

  it('each formation and seeding option builds a bracket', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    for (const formation of ['fair', 'topBias', 'topBottomRandom', 'random']) {
      for (const seeding of ['ranking', 'random', 'elo']) {
        await app.buildBracket({ teams: 4, elim: 'single', formation, seeding });
        assert.equal(
          await app.page.$$eval('[data-testid="bracket-winners"] [data-testid="match-card"]', c => c.length),
          2
        );
      }
    }
  });
});
