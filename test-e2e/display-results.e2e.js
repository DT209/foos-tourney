// Display Mode's results pop-up (issue 23): it opens by itself when the shown
// tournament's bracket completes or its champion changes, and View Results
// reopens it. Covers a followed published tournament and a ?display=1 window
// following this device's tournament.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');
const helpers = require('./display-remote-helpers');

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const { BOARD, OTHER_ID, waitFor, choices, clickRow } = helpers(() => app);
const DIALOG = '[data-testid="results-dialog"]';
const VIEW = '[data-testid="view-results-button"]';

// A tournament with a two-team bracket whose final `winner` (1 or 2) won, or
// unplayed when winner is null. Runs in the page.
function bracketTournament(id, winner) {
  const L = window.TournamentLogic;
  const team = (n, a, b) => ({
    id: `team-${n}`,
    name: `${a} & ${b}`,
    players: [L.createPlayer(n * 10, a), L.createPlayer(n * 10 + 1, b)]
  });
  let bracket = L.generateBracketStructure([team(1, 'Jes Herman', 'Burrito'), team(2, 'Zack', 'Jay')], 'single', 1);
  if (winner !== null) {
    L.listBracketMatches(bracket)[0].match.games = [winner === 1 ? { t1: 5, t2: 0 } : { t1: 0, t2: 5 }];
    bracket = L.confirmBracketMatch(bracket, 'grandFinals', 0, 0).bracket;
  }
  return {
    ...L.newTournamentState(id, new Date('2026-11-20T01:00:00Z')),
    tournamentName: 'Other Night',
    bracketData: bracket
  };
}

// Publishes "Other Night" from another browser, as the fake server.
async function publishBracket(winner) {
  await app.page.evaluate(
    (fn, id, winner) => {
      const state = new Function(`return (${fn})`)()(id, winner);
      const server = JSON.parse(localStorage.getItem('__fakeRemote.server') || 'null') || {
        slots: [null, null, null, null, null],
        tournaments: {},
        owners: {},
        codes: {}
      };
      server.slots[1] = { tournamentId: id, ownerUid: 'other' };
      server.tournaments[id] = {
        id,
        slot: 2,
        ownerUid: 'other',
        name: state.tournamentName,
        startedAt: state.startedAt,
        updatedAt: Date.now(),
        exportText: window.TournamentLogic.publishedExport(state)
      };
      localStorage.setItem('__fakeRemote.server', JSON.stringify(server));
      if (window.__fakeRemoteNotify) window.__fakeRemoteNotify();
    },
    bracketTournament.toString(),
    OTHER_ID,
    winner
  );
}

const followOther = async () => {
  await app.click('Display Mode');
  await waitFor(async () => (await choices()).length === 2);
  await clickRow('remote');
  await waitFor(async () => Boolean(await app.page.$(BOARD)));
};

const dialogText = async (page = app.page) => (await page.$(DIALOG)) && page.$eval(DIALOG, e => e.textContent);

describe('Display Mode results', () => {
  it('pops up when the followed bracket completes, and View Results reopens it', async () => {
    app = await openApp({ remote: true });
    await publishBracket(null);
    await followOther();
    assert.equal(await app.page.$(DIALOG), null);
    assert.equal(await app.page.$(VIEW), null, 'no View Results before the bracket is complete');

    await publishBracket(1);
    await waitFor(async () => Boolean(await app.page.$(DIALOG)));
    const text = await dialogText();
    assert.match(text, /Tournament Complete!/);
    assert.match(text, /Jes Herman & Burrito.*1st Place.*Zack & Jay.*2nd Place/);
    assert.doesNotMatch(text, /Is the tournament done\?|Export/, 'read-only: no finish question or exports');

    await app.click('Close Results');
    assert.equal(await app.page.$(DIALOG), null);
    await app.click('🏆 View Results', { within: BOARD });
    assert.match(await dialogText(), /Jes Herman & Burrito/);
    await app.click('Close Results');
    assert.equal(await app.page.$(DIALOG), null);
  });

  it('stays closed for a tournament that was already complete, and pops up again when a fix changes the champion', async () => {
    app = await openApp({ remote: true });
    await publishBracket(1);
    await followOther();
    await app.pause(150);
    assert.equal(await app.page.$(DIALOG), null);
    assert.ok(await app.page.$(VIEW));

    await publishBracket(2);
    await waitFor(async () => Boolean(await app.page.$(DIALOG)));
    assert.match(await dialogText(), /Zack & Jay.*1st Place/);
  });

  it("a ?display=1 window pops it up when this device's bracket completes", async () => {
    app = await openApp();
    const id = await app.currentTournamentId();
    const save = winner =>
      app.page.evaluate(
        (fn, id, winner) => {
          const state = new Function(`return (${fn})`)()(id, winner);
          window.TournamentLogic.saveTournament(localStorage, state);
        },
        bracketTournament.toString(),
        id,
        winner
      );
    await save(null);
    const screen = await app.openPage('?display=1');
    await screen.waitForSelector(BOARD);
    assert.equal(await screen.$(DIALOG), null);

    await save(1);
    await screen.waitForSelector(DIALOG);
    assert.match(await dialogText(screen), /Jes Herman & Burrito.*1st Place/);
    await screen.$eval('[data-testid="close-results"]', e => e.click());
    await screen.waitForSelector(DIALOG, { hidden: true });
    await screen.$eval(VIEW, e => e.click());
    await screen.waitForSelector(DIALOG);
    await screen.$eval('[data-testid="close-results"]', e => e.click());
    await screen.waitForSelector(DIALOG, { hidden: true });
    await app.flushCoverage(screen);
  });
});
