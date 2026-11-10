// Selectors and helpers shared by the publishing*.e2e.js UI tests.
// getApp returns the test's current app (each file keeps its own).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = getApp => {
  const NAME_INPUT = 'input[placeholder="Search leaderboard or enter a guest name"]';
  const DIALOG = '[data-testid="publishing-dialog"]';
  const OTHER_ID = '99999999-9999-4999-8999-999999999999';
  const OTHER_CODE = 'ABCD2345EFGH';

  const methods = async (target = getApp().page) => (await getApp().remoteCalls(target)).map(c => c.method);
  const writes = async () => (await getApp().remoteCalls()).filter(c => c.method === 'publish');
  const row = name => `[data-testid="player-row"][data-player-name="${name}"]`;

  async function addPlayer(name) {
    await getApp().type(NAME_INPUT, name);
    await getApp().page.evaluate(sel => document.querySelector(sel).form.requestSubmit(), NAME_INPUT);
    await getApp().pause();
    if (await getApp().page.$('[data-testid="guest-confirm"]')) await getApp().click('Add Anyway');
  }

  async function newTournament() {
    await getApp().click('New Tournament');
    await getApp().click('Start New Tournament');
    await getApp().pause(150);
  }

  const waitFor = async (check, ms = 8000) => {
    const end = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('timed out waiting');
      await getApp().pause(100);
    }
  };

  // A tournament published from another browser ("other"), in slot 1.
  async function seedOther({ name = 'Other Night', updatedAt = Date.now(), uid = 'other', slot = 1 } = {}) {
    const exportText = await getApp().page.evaluate(
      (id, name) => {
        const L = window.TournamentLogic;
        return L.publishedExport({ ...L.newTournamentState(id, new Date()), tournamentName: name });
      },
      OTHER_ID,
      name
    );
    const slots = [null, null, null, null, null];
    slots[slot - 1] = { tournamentId: OTHER_ID, ownerUid: uid };
    await getApp().setRemoteServer({
      slots,
      tournaments: {
        [OTHER_ID]: {
          id: OTHER_ID,
          slot,
          ownerUid: uid,
          name,
          startedAt: new Date().toISOString(),
          updatedAt,
          exportText
        }
      },
      owners: { [uid]: { slot, tournamentId: OTHER_ID } },
      codes: { [OTHER_ID]: OTHER_CODE }
    });
  }

  function codeFile(text) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foos-')), 'x.publisher-code.txt');
    fs.writeFileSync(file, text);
    return file;
  }

  return {
    NAME_INPUT,
    DIALOG,
    OTHER_ID,
    OTHER_CODE,
    methods,
    writes,
    row,
    addPlayer,
    newTournament,
    waitFor,
    seedOther,
    codeFile
  };
};
