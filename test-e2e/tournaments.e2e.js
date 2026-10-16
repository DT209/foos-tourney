// Tournament identity and storage: UUIDs instead of dates, events that run
// past midnight, keeping and reopening past tournaments, and migrating the
// old single-slot save.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./harness');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_PREFIX = 'foosTourney.tournament.';

let app;
afterEach(async () => {
  if (!app) return;
  const { errors } = app;
  await app.close();
  app = null;
  assert.deepEqual(errors, [], 'no uncaught page errors');
});

const recordIds = async () =>
  (await app.storageKeys()).filter(k => k.startsWith(RECORD_PREFIX)).map(k => k.slice(RECORD_PREFIX.length));

const currentId = () => app.page.evaluate(() => localStorage.getItem('foosTourney.currentTournament'));

const savedRows = () =>
  app.page.$$eval('[data-testid="saved-tournament"]', rows =>
    rows.map(r => ({ id: r.dataset.tournamentId, text: r.textContent }))
  );

describe('tournament identity', () => {
  it('a new tournament gets a UUID and is stored under it', async () => {
    app = await openApp();
    const [id] = await recordIds();
    assert.match(id, UUID);
    assert.equal(await currentId(), id);
  });

  it('a tournament that runs past midnight stays one tournament with its start date', async () => {
    app = await openApp(); // America/Edmonton
    await app.setClock('2026-10-16T23:40:00-06:00');
    await app.reload();
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    const startedId = await currentId();
    assert.match(await app.page.$eval('[data-testid="tournament-started"]', e => e.textContent), /Oct 16/);

    await app.addAllLeaderboardPlayers();
    await app.setClock('2026-10-17T00:35:00-06:00');
    await app.reload();
    assert.equal(await currentId(), startedId, 'same tournament after midnight');
    await app.playMonsterMatch();

    const { name, csv } = await app.exportCsv();
    assert.equal(name, 'Thursday_DYP_2026-10-16.csv');
    const row = csv.split('\n')[1].split(',');
    assert.ok(row[0].startsWith(`"${startedId}_MONSTER-`), 'match ids are prefixed by the tournament UUID');
    assert.equal(row[1], '2026-10-16', 'export date is the local start day');
  });

  it('an evening start in Calgary is dated that evening, not the next UTC day', async () => {
    app = await openApp();
    await app.setClock('2026-10-16T19:00:00-06:00'); // 01:00 UTC on Oct 17
    await app.page.evaluate(() => localStorage.clear());
    await app.reload();
    assert.match(await app.page.$eval('[data-testid="tournament-started"]', e => e.textContent), /Oct 16/);
  });
});

describe('saved tournaments', () => {
  it('New Tournament keeps the previous one, which can be reopened', async () => {
    app = await openApp();
    await app.type('input[placeholder="e.g. Friday Night Open"]', 'Week One');
    await app.addAllLeaderboardPlayers();
    const weekOneRoster = await app.rosterCount();
    const weekOneId = await currentId();

    await app.click('New Tournament');
    assert.match(await app.text(), /stays saved/);
    await app.click('Start New Tournament');
    assert.equal(await app.rosterCount(), 0);
    const weekTwoId = await currentId();
    assert.notEqual(weekTwoId, weekOneId);
    assert.match(weekTwoId, UUID);
    assert.deepEqual((await recordIds()).sort(), [weekOneId, weekTwoId].sort());

    await app.click('Saved Tournaments');
    const rows = await savedRows();
    assert.deepEqual(
      rows.map(r => r.id),
      [weekTwoId, weekOneId],
      'most recent first'
    );
    assert.match(rows[0].text, /Current/);
    assert.match(rows[1].text, /Week One/);
    assert.match(rows[1].text, new RegExp(`${weekOneRoster} players`));

    await app.click('Open', { within: `[data-tournament-id="${weekOneId}"]` });
    assert.equal(await currentId(), weekOneId);
    assert.equal(await app.rosterCount(), weekOneRoster);
    assert.equal(await app.page.$eval('input[placeholder="e.g. Friday Night Open"]', e => e.value), 'Week One');

    await app.reload();
    assert.equal(await currentId(), weekOneId, 'the reopened tournament is resumed after a reload');
  });

  it('deletes a past tournament after confirming; the current one cannot be deleted', async () => {
    app = await openApp();
    const firstId = await currentId();
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    const secondId = await currentId();

    await app.click('Saved Tournaments');
    const deleteButtons = await app.page.$$eval(`[data-tournament-id="${secondId}"] button`, bs =>
      bs.map(b => b.textContent.trim())
    );
    assert.equal(deleteButtons.includes('Delete'), false, 'no delete for the current tournament');

    await app.click('Delete', { within: `[data-tournament-id="${firstId}"]` });
    assert.match(app.dialogs.at(-1), /Delete/);
    assert.deepEqual(await recordIds(), [secondId]);
    assert.deepEqual(
      (await savedRows()).map(r => r.id),
      [secondId]
    );
  });

  it('the lock disables New Tournament and Saved Tournaments', async () => {
    app = await openApp();
    await app.click('Admin Lock');
    await app.submitPin('2468');
    await assert.rejects(app.click('New Tournament'), /No visible, enabled button/);
    await assert.rejects(app.click('Saved Tournaments'), /No visible, enabled button/);
  });
});

describe('saved tournaments dialogs', () => {
  it("the list shows each tournament's bracket format", async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    await app.buildBracket({ teams: 4, elim: 'double' });
    await app.click('Monster / Open Play Stage');
    await app.click('Saved Tournaments');
    assert.match((await savedRows())[0].text, /double bracket/);
  });

  it('Cancel keeps the current tournament; Close dismisses the saved list', async () => {
    app = await openApp();
    await app.addAllLeaderboardPlayers();
    const id = await currentId();
    await app.click('New Tournament');
    await app.click('Cancel');
    assert.equal(await currentId(), id);
    assert.ok((await app.rosterCount()) > 0);

    await app.click('Saved Tournaments');
    assert.equal((await savedRows()).length, 1);
    await app.click('Close', { within: '[data-testid="saved-tournaments"]' });
    assert.equal(await app.page.$('[data-testid="saved-tournaments"]'), null);
  });

  it('reports a tournament whose saved data has disappeared, and refreshes the list', async () => {
    app = await openApp();
    const firstId = await currentId();
    await app.click('New Tournament');
    await app.click('Start New Tournament');
    await app.click('Saved Tournaments');
    await app.page.evaluate(key => localStorage.removeItem(key), RECORD_PREFIX + firstId);
    await app.click('Open', { within: `[data-tournament-id="${firstId}"]` });
    assert.equal(app.dialogs.at(-1), 'That tournament could not be loaded.');
    assert.deepEqual(
      (await savedRows()).map(r => r.id),
      [await currentId()]
    );
  });

  it('explains when saving is unavailable', async () => {
    app = await openApp({
      beforeLoad: () => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('SecurityError');
          }
        });
      }
    });
    await app.click('Saved Tournaments');
    assert.match(await app.text(), /Saving is unavailable in this browser/);
  });
});

describe('migration', () => {
  it('a save from the previous version is moved into a UUID record', async () => {
    app = await openApp({
      beforeLoad: () => {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem(
          'foosTourney.tournament',
          JSON.stringify({
            version: 1,
            state: {
              tournamentName: 'Last Week',
              startDate: '2026-10-09',
              players: [
                {
                  id: 1,
                  name: 'Ann',
                  paid: false,
                  active: true,
                  wins: 0,
                  losses: 0,
                  gf: 0,
                  ga: 0,
                  eligibleDrawsMissed: 0
                }
              ]
            }
          })
        );
      }
    });
    assert.equal(await app.rosterCount(), 1);
    assert.equal(await app.page.$eval('input[placeholder="e.g. Friday Night Open"]', e => e.value), 'Last Week');
    assert.match(await app.page.$eval('[data-testid="tournament-started"]', e => e.textContent), /Oct 9/);
    const keys = await app.storageKeys();
    assert.equal(keys.includes('foosTourney.tournament'), false);
    assert.match(await currentId(), UUID);
  });
});
