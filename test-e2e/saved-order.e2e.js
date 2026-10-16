// Regression: Saved Tournaments reordered itself on every Open (it sorted by
// save time, and opening re-saves), so pressing Open in the same row
// alternated between two tournaments and some could never be reached there.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const NAME = 'input[placeholder="e.g. Friday Night Open"]';
const SAVED = '[data-testid="saved-tournaments"]';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const listNames = () =>
  app.page.$$eval('[data-testid="saved-tournament"]', rows => rows.map(r => r.querySelector('.font-bold').textContent));

async function threeTournaments() {
  // A week apart, so start times differ.
  const starts = ['2026-10-01T19:00:00-06:00', '2026-10-08T19:00:00-06:00', '2026-10-15T19:00:00-06:00'];
  for (const [i, name] of ['Week 1', 'Week 2', 'Week 3'].entries()) {
    await app.setClock(starts[i]);
    // The first tournament must be created under the frozen clock too.
    if (i === 0) await app.page.evaluate(() => localStorage.clear());
    await app.reload();
    if (i > 0) {
      await app.click('New Tournament');
      await app.click('Start New Tournament');
    }
    await app.type(NAME, name);
    await app.addAllLeaderboardPlayers();
    if (i === 0) await app.playMonsterMatch(); // Week 1 has a result to check after opening
  }
  // Back to the real, moving clock, so each Open saves with a later time (as in real use).
  await app.page.evaluate(() => sessionStorage.removeItem('__fakeNow'));
  await app.reload();
}

describe('saved tournaments order', () => {
  it('stays newest-first by start time when tournaments are opened', async () => {
    app = await openApp();
    await threeTournaments();
    await app.click('Saved Tournaments');
    assert.deepEqual(await listNames(), ['Week 3', 'Week 2', 'Week 1']);
    for (const target of ['Week 1', 'Week 2', 'Week 1', 'Week 3']) {
      const row = `[data-testid="saved-tournament"]:nth-child(${['Week 3', 'Week 2', 'Week 1'].indexOf(target) + 1})`;
      await app.click('Open', { within: row });
      assert.equal(await app.page.$eval(NAME, e => e.value), target, `Open on ${target}'s row opens ${target}`);
      await app.click('Saved Tournaments');
      assert.deepEqual(await listNames(), ['Week 3', 'Week 2', 'Week 1'], `order unchanged after opening ${target}`);
    }
  });

  it('pressing Open in the same row keeps opening the same tournament, loaded from storage', async () => {
    app = await openApp();
    await threeTournaments(); // current: Week 3
    for (let i = 0; i < 3; i++) {
      await app.click('Saved Tournaments');
      // Row 3 is Week 1 every time. Click it with the real mouse, as a person would.
      const open = await app.page.$(`${SAVED} [data-testid="saved-tournament"]:nth-child(3) button:nth-of-type(3)`);
      if (!open) {
        // Week 1 is already current (no Open button): its row shows the badge.
        assert.match(await app.textOf(`${SAVED} [data-testid="saved-tournament"]:nth-child(3)`), /Week 1.*Current/s);
        await app.click('Close', { within: SAVED });
        continue;
      }
      assert.equal(await open.evaluate(b => b.textContent.trim()), 'Open');
      const box = await open.boundingBox();
      await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await app.pause(150);
      assert.equal(await app.page.$eval(NAME, e => e.value), 'Week 1', `click ${i + 1} opened Week 1`);
      assert.equal(
        await app.page.$$eval('[data-testid="match-history"] tbody tr', r => r.length),
        1,
        'its result is there'
      );
    }
  });
});
