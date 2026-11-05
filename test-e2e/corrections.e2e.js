// Admin corrections: editing a finished match (open play and bracket) and
// substituting a player. Each asks for the admin PIN first, even unlocked.
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

const PIN_DIALOG = '[data-testid="admin-pin-dialog"]';
const EDITOR = '[data-testid="edit-match-dialog"]';
const SUB = '[data-testid="substitute-dialog"]';

const savedState = () =>
  app.page.evaluate(() => {
    const id = localStorage.getItem('foosTourney.currentTournament');
    return JSON.parse(localStorage.getItem(`foosTourney.tournament.${id}`)).state;
  });
const exists = sel => app.page.$(sel).then(Boolean);
const clickTestId = id => app.page.$eval(`[data-testid="${id}"]`, b => b.click()).then(() => app.pause());
const setConfirm = answer =>
  app.page.evaluate(a => {
    window.confirm = message => {
      window.__confirms = [...(window.__confirms || []), message];
      return a;
    };
  }, answer);

// Enters `pin` in the admin prompt and continues.
async function enterAdminPin(pin) {
  await app.fill(`${PIN_DIALOG} input[type=password]`, pin);
  await app.page.$eval(`${PIN_DIALOG} form`, f => f.requestSubmit());
  await app.pause();
}

async function fillEditorScores(scores) {
  const inputs = await app.page.$$(`${EDITOR} input[type=number]`);
  for (const [i, value] of scores.entries()) await app.fill(inputs[i], value);
}

describe('admin PIN for corrections', () => {
  it('sets a PIN on first use, refuses a wrong one later, and Cancel does nothing', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();

    await clickTestId('edit-history-match');
    assert.match(await app.textOf(PIN_DIALOG), /Choose a 4-8 digit PIN/);
    await app.click('Cancel', { within: PIN_DIALOG });
    assert.equal(await exists(PIN_DIALOG), false);
    assert.equal(await exists(EDITOR), false);

    await clickTestId('edit-history-match');
    await enterAdminPin('12');
    assert.equal(app.dialogs.at(-1), 'Choose a PIN of 4 to 8 digits.');
    await enterAdminPin('2468');
    assert.equal(await exists(EDITOR), true);
    assert.equal((await savedState()).adminPin, '2468');
    await app.click('Cancel', { within: EDITOR });
    assert.equal(await exists(EDITOR), false);

    await clickTestId('edit-history-match');
    assert.match(await app.textOf(PIN_DIALOG), /needs the admin PIN/);
    await enterAdminPin('1111');
    assert.equal(app.dialogs.at(-1), 'Incorrect PIN!');
    assert.equal(await exists(EDITOR), false);
  });

  it('works while the admin lock is on', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    assert.equal((await savedState()).isLocked, true);
    await clickTestId('edit-history-match');
    await enterAdminPin('2468');
    assert.equal(await exists(EDITOR), true);
  });
});

describe('editing an open-play match', () => {
  it('flips the result, swaps a player, and rebuilds the standings', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    const before = (await savedState()).matches[0];
    const [p1, p2] = before.team1;
    const [p3] = before.team2;
    const bench = (await savedState()).players.find(p => ![...before.team1, ...before.team2].some(t => t.id === p.id));

    await clickTestId('edit-history-match');
    await enterAdminPin('2468');
    assert.match(await app.textOf(EDITOR), /Edit Monster match/);

    // An empty spot is refused.
    const spots = await app.page.$$('[data-testid="edit-player"]');
    await spots[1].select('');
    await app.pause();
    await clickTestId('save-match-edit');
    assert.equal(app.dialogs.at(-1), 'Pick a player for every spot.');

    // Team 1's second player was really someone else, and Team 2 won both games.
    await spots[1].select(String(bench.id));
    await fillEditorScores([2, 5, 3, 5]);
    await app.page.$eval('[data-testid="edit-handicap"]', c => c.click());
    await app.pause();
    await app.page.select('[data-testid="edit-override"]', '1');
    await app.pause();
    await app.page.$eval('[data-testid="edit-handicap"]', c => c.click());
    await app.pause();
    await clickTestId('save-match-edit');
    assert.equal(await exists(EDITOR), false);

    const state = await savedState();
    const edited = state.matches[0];
    assert.deepEqual([edited.winner, edited.isHandicap, edited.team1.map(p => p.id)], [2, false, [p1.id, bench.id]]);
    assert.ok(edited.editedAt);
    const stats = id => {
      const p = state.players.find(x => x.id === id);
      return [p.wins, p.losses, p.gf, p.ga];
    };
    assert.deepEqual(stats(p1.id), [0, 1, 5, 10]);
    assert.deepEqual(stats(bench.id), [0, 1, 5, 10]);
    assert.deepEqual(stats(p2.id), [0, 0, 0, 0]);
    assert.deepEqual(stats(p3.id), [1, 0, 10, 5]);
    assert.equal(await exists('[data-testid="match-history"] [data-testid="edited-mark"]'), true);
  });

  it('a result with no winner is refused', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.playMonsterMatch();
    await clickTestId('edit-history-match');
    await enterAdminPin('2468');
    await fillEditorScores([5, 2, 2, 5]);
    await clickTestId('save-match-edit');
    assert.match(app.dialogs.at(-1), /No team has won enough games/);
    assert.equal((await savedState()).matches[0].winner, 1);
  });
});

describe('editing a bracket match', () => {
  it('fixes a score, flips a winner downstream, warns before clearing typed scores, and locks once played', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 4, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-winners'), 1);
    await app.playCard(await app.playableCard('bracket-winners'), 1);
    const semi = (await savedState()).bracketData.winnersRounds[0][0];
    const editSemi = async () => {
      const buttons = await app.page.$$('[data-testid="bracket-winners"] [data-testid="edit-bracket-match"]');
      await buttons[0].click();
      await app.pause();
    };

    // Same winner, new score.
    await editSemi();
    await enterAdminPin('2468');
    assert.match(await app.textOf(EDITOR), new RegExp(`${semi.team1.name}[\\s\\S]*${semi.team2.name}`));
    assert.match(await app.textOf(EDITOR), /new winner and loser take the old ones' places/);
    await app.page.$eval('[data-testid="edit-handicap"]', c => c.click());
    await app.pause();
    await fillEditorScores([5, 4]);
    await clickTestId('save-match-edit');
    let gf = (await savedState()).bracketData.grandFinals[0];
    assert.equal(gf.team1.name, semi.team1.name);
    assert.equal(await exists('[data-testid="bracket-winners"] [data-testid="edited-mark"]'), true);

    // No winner: refused.
    await editSemi();
    await enterAdminPin('2468');
    await fillEditorScores(['', '']);
    await clickTestId('save-match-edit');
    assert.match(app.dialogs.at(-1), /No team has won enough games/);
    await app.click('Cancel', { within: EDITOR });

    // Type a score into the final, then flip the semi: asks before clearing it.
    const gfCard = await app.playableCard('bracket-grand-finals');
    const [gfInput] = await gfCard.$$('input[type=number]');
    await app.fill(gfInput, 3);
    await setConfirm(false);
    await editSemi();
    await enterAdminPin('2468');
    await fillEditorScores([1, 5]);
    await clickTestId('save-match-edit');
    const confirms = await app.page.evaluate(() => window.__confirms);
    assert.match(confirms.at(-1), /This changes who plays in Grand Finals/);
    assert.equal(await exists(EDITOR), true);
    assert.equal((await savedState()).bracketData.grandFinals[0].team1.name, semi.team1.name);
    await setConfirm(true);
    await clickTestId('save-match-edit');
    gf = (await savedState()).bracketData.grandFinals[0];
    assert.deepEqual([gf.team1.name, gf.games[0].t1], [semi.team2.name, '']);

    // Once the final is played, the semi can't be edited any more.
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    const before = app.dialogs.length;
    await editSemi();
    await enterAdminPin('2468');
    assert.equal(app.dialogs.length, before + 1);
    assert.match(app.dialogs.at(-1), /Grand Finals has already been played, so this match can no longer be edited/);
    assert.equal(await exists(EDITOR), false);
  });

  it('editing the final of a complete bracket shows the standings again', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.select('[data-testid="format-select"]', '1v1');
    await app.buildBracket({ teams: 2, elim: 'single' });
    await app.playCard(await app.playableCard('bracket-grand-finals'), 1);
    await app.click('Not Yet');
    await clickTestId('edit-bracket-match');
    await enterAdminPin('2468');
    // The harness confirmed it with the override ticked, so the editor starts that way.
    await app.page.select('[data-testid="edit-override"]', '2');
    await app.pause();
    await clickTestId('save-match-edit');
    assert.equal(await exists('[data-testid="finish-question"]'), true);
    assert.equal((await savedState()).bracketData.grandFinals[0].winner, 2);
  });
});

describe('substituting a player', () => {
  it('in open play: takes the leaving player’s spot on their table and pauses them', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.click('Draw New Match');
    const live = (await savedState()).matches[0];
    const leaving = live.team1[0];
    const bench = (await savedState()).players.find(p => ![...live.team1, ...live.team2].some(t => t.id === p.id));

    await clickTestId('substitute-button');
    await enterAdminPin('2468');
    await app.click('Cancel', { within: SUB });
    assert.equal(await exists(SUB), false);

    await clickTestId('substitute-button');
    await enterAdminPin('2468');
    await app.page.select('[data-testid="sub-outId"]', String(leaving.id));
    await app.page.select('[data-testid="sub-inId"]', String(leaving.id));
    await app.pause();
    await clickTestId('save-substitute');
    assert.equal(app.dialogs.at(-1), 'Pick two different players.');

    await app.page.select('[data-testid="sub-inId"]', String(bench.id));
    await app.pause();
    await clickTestId('save-substitute');
    assert.match(app.dialogs.at(-1), new RegExp(`${bench.name} replaces ${leaving.name} in the match on table 1`));
    assert.equal(await exists(SUB), false);
    const state = await savedState();
    assert.equal(state.matches[0].team1[0].id, bench.id);
    assert.equal(state.players.find(p => p.id === leaving.id).active, false);
    assert.match(await app.textOf('[data-testid="live-table"]'), new RegExp(bench.name));
  });

  it('in the bracket: the team plays on with the replacement', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 2, elim: 'single' });
    const gf = (await savedState()).bracketData.grandFinals[0];
    const leaving = gf.team1.players[1];
    const taken = new Set([...gf.team1.players, ...gf.team2.players].map(p => p.id));
    const bench = (await savedState()).players.find(p => !taken.has(p.id));

    await clickTestId('bracket-substitute-button');
    await enterAdminPin('2468');
    await app.page.select('[data-testid="sub-outId"]', String(leaving.id));
    await app.page.select('[data-testid="sub-inId"]', String(bench.id));
    await app.pause();
    await clickTestId('save-substitute');
    assert.match(app.dialogs.at(-1), /plays the rest of the bracket/);
    const team = (await savedState()).bracketData.grandFinals[0].team1;
    assert.deepEqual(
      team.players.map(p => p.id),
      [gf.team1.players[0].id, bench.id]
    );
    assert.match(await app.textOf('[data-testid="bracket-grand-finals"]'), new RegExp(bench.name));
  });
});
