// Core UI flows: a full tournament, input sanitizing, the admin lock, and
// auto-save across reloads.
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

describe('tournament flow', () => {
  it('runs a roster, Monster matches and a 4-team bracket to a champion', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    assert.ok((await app.rosterCount()) >= 8);

    await app.playMonsterMatch();
    await app.playMonsterMatch();

    await app.click('Draw Brackets');
    await app.click('Build Bracket');
    let confirmed = 0;
    for (let i = 0; i < 10; i++) {
      const inputs = await app.page.$$('.border-purple-600 input[type=number]');
      if (inputs.length === 0) break;
      for (const [idx, score] of [5, 1, 5, 1].entries()) await app.fill(inputs[idx], score);
      await app.click('Confirm (Winner');
      confirmed++;
    }
    assert.equal(confirmed, 4, 'two semis, the final and the 3rd place match');
    const text = await app.text();
    assert.match(text, /1st Place/);
    assert.ok(['🥇', '🥈', '🥉'].every(medal => text.includes(medal)));
  });

  it('the tournament name keeps spaces typed on the keyboard and drops angle brackets', async () => {
    app = await openApp();
    const input = 'input[placeholder="e.g. Friday Night Open"]';
    await app.page.$eval(input, e => e.select());
    await app.page.focus(input);
    await app.page.keyboard.type('Friday Night <Open>');
    assert.equal(await app.page.$eval(input, e => e.value), 'Friday Night Open');
  });
});

describe('admin lock', () => {
  const submitPin = pin => app.submitPin(pin);

  it('the first lock sets a PIN, which survives a reload; Forgot PIN unlocks', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    assert.match(await app.text(), /Set Admin PIN/);
    await submitPin('12');
    assert.deepEqual(app.dialogs, ['Choose a PIN of 4 to 8 digits.']);
    await submitPin('2468');
    assert.match(await app.text(), /View Only Mode/);

    await app.reload();
    assert.match(await app.text(), /View Only Mode/);
    await app.click('View Only (Unlock)');
    await submitPin('1111');
    assert.equal(app.dialogs.at(-1), 'Incorrect PIN!');
    await app.click('Forgot PIN?');
    assert.doesNotMatch(await app.text(), /View Only Mode/);

    await app.click('Admin Lock');
    assert.match(await app.text(), /Set Admin PIN/, 'a new PIN must be chosen');
  });

  it('once a PIN exists, Admin Lock asks for it instead of setting a new one', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await submitPin('2468');
    await app.click('View Only (Unlock)');
    await submitPin('2468');
    await app.click('Admin Lock');
    const text = await app.text();
    assert.match(text, /Enable Admin Lock/);
    assert.match(text, /Enter the tournament PIN to place the tool into View Only mode/);
    await submitPin('2468');
    assert.match(await app.text(), /View Only Mode/);
  });

  it('the correct PIN unlocks', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await submitPin('2468');
    await app.click('View Only (Unlock)');
    await submitPin('2468');
    assert.doesNotMatch(await app.text(), /View Only Mode/);
  });
});

describe('auto-save', () => {
  it('keeps the roster, a live match and typed scores across a reload', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    const roster = await app.rosterCount();
    await app.click('Draw New Match');
    await app.type('[data-testid="live-table"] input[type=number]', 4);

    await app.reload();
    assert.equal(await app.rosterCount(), roster);
    assert.match(await app.text(), /MATCH IN PROGRESS/);
    assert.equal(await app.page.$eval('[data-testid="live-table"] input[type=number]', e => e.value), '4');
    assert.match(await app.text(), /Auto-saved in this browser/);
  });

  it('warns but keeps working when browser storage is blocked', async () => {
    app = await openApp({
      beforeLoad: () => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('SecurityError');
          }
        });
      }
    });
    assert.match(await app.text(), /Auto-save unavailable/);
    await app.addAllLeaderboardPlayers();
    assert.ok((await app.rosterCount()) > 0);
  });
});
