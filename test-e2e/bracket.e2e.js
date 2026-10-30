// Bracket stage: the bracket modal and its options, paused-player warning,
// every bracket format played to completion through every section's match
// cards, standings, and redraws.
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

// Plays every playable card in `section` (one at a time, since confirming
// re-renders), alternating which team wins. Returns how many were played.
async function playSection(section, { winner = () => 1, limit = 20 } = {}) {
  let played = 0;
  while (played < limit) {
    const card = await app.playableCard(section);
    if (!card) break;
    await app.playCard(card, winner(played));
    played++;
  }
  return played;
}

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
    const [p1, p2] = await app.page.$$('[data-testid="manual-team"] select');
    const options = await p1.$$eval('option', os => os.map(o => o.value).filter(Boolean));
    await p1.select(options[3]);
    await p2.select(options[2]);
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

describe('single elimination', () => {
  it('plays semis, 3rd place and final to standings; reopens results; redraws', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'single', games: 3 });
    assert.match(await app.text(), /Single Elimination/);

    // One semi via the live tables, one via the bracket view.
    await app.playCard(await app.playableCard('bracket-live'), 1);
    assert.equal(await playSection('bracket-winners'), 1);
    assert.equal(await playSection('bracket-third-place', { winner: () => 2 }), 1);
    assert.equal(await playSection('bracket-grand-finals'), 1);

    const results = await app.text();
    assert.match(results, /Final Playoff Standings/);
    assert.match(results, /1st Place/);
    assert.match(results, /2nd Place/);
    assert.match(results, /3rd Place/);
    // Not Yet closes the results and leaves the tournament editable (see finish.e2e.js).
    await app.click('Not Yet');
    assert.doesNotMatch(await app.text(), /Final Playoff Standings/);
    await app.click('Standings');
    assert.match(await app.text(), /Final Playoff Standings/);
    await app.click('Not Yet');

    await app.click('Monster / Open Play Stage');
    assert.match(await app.textOf('[data-testid="match-history"]'), /Playoffs/, 'bracket results join the history');
    await app.click('Bracket Playoff Stage');
    await app.click('Reset / Redraw Brackets');
    assert.match(await app.text(), /Generate Bracket Stage/);
  });

  it('a bracket match needs a winner before it can be confirmed', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'single', games: 3 });
    const card = await app.playableCard('bracket-winners');
    const confirmDisabled = await card.$eval('button', b => b.disabled);
    assert.equal(confirmDisabled, true);
    assert.match(await card.evaluate(e => e.textContent), /Enter Winner Scores/);
  });

  it('1v1 brackets use single players', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    assert.equal(await playSection('bracket-grand-finals'), 1);
    assert.match(await app.text(), /1st Place/);
  });
});

describe('double elimination', () => {
  it('plays winners, losers and a Grand Final bracket reset to completion', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'double' });
    assert.match(await app.text(), /Double Elimination/);
    for (let round = 0; round < 6; round++) {
      await playSection('bracket-winners');
      await playSection('bracket-losers');
    }
    // The losers champion (team 2) wins the first Grand Final, forcing a reset.
    assert.equal(await playSection('bracket-grand-finals', { winner: () => 2, limit: 1 }), 1);
    assert.match(await app.text(), /Bracket Reset/);
    assert.equal(await playSection('bracket-grand-finals'), 1);
    assert.match(await app.text(), /Final Playoff Standings/);
  });
});

describe('championship', () => {
  it('plays winners, the 3rd place losers final and the Grand Final', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'championship' });
    assert.match(await app.text(), /Championship/);
    assert.equal(await playSection('bracket-winners'), 2);
    assert.equal(await playSection('bracket-losers'), 1);
    assert.equal(await playSection('bracket-champ-final'), 1);
    assert.match(await app.text(), /Final Playoff Standings/);
  });
});

describe('bracket tab', () => {
  it('shows a call to action before any bracket exists, and switches tabs', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Bracket Playoff Stage');
    assert.match(await app.text(), /Draw Bracket Stage/);
    await app.click('Draw Bracket Stage');
    assert.match(await app.text(), /Generate Bracket Stage/);
    await app.click('Cancel');
    await app.click('Monster / Open Play Stage');
    assert.match(await app.text(), /Draw New Match/);
  });
});
