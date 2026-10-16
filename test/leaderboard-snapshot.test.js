const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L } = require('./helpers');
const { formatSnapshotEntries, replaceFallbackSnapshot, refreshSnapshot } = require('../scripts/leaderboard-snapshot');

const SOURCE = `  // Last refreshed from the live page: 2026-08-19.
  const FALLBACK_LEADERBOARD_DATE = '2026-08-19';
  const FALLBACK_LEADERBOARD_PLAYERS = [
    { name: 'Old', singlesElo: null, doublesElo: 1 }
  ];

  const LEADERBOARD_URL = 'x';
`;

const PAGE = `<html><script>
const playersData = [
  { name: "Zed", singlesElo: "Unranked", doublesElo: 1001.4 },
  { name: "O'Neil \\\\ Jr", singlesElo: 950, doublesElo: "Unranked" }
];
renderTable();
</script></html>`;

describe('the shipped fallback snapshot', () => {
  it('exposes its refresh date for the UI', () => {
    assert.match(L.FALLBACK_LEADERBOARD_DATE, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatSnapshotEntries', () => {
  it('writes one sorted, single-quoted entry per player, escaping quotes and backslashes', () => {
    assert.equal(
      formatSnapshotEntries([
        { name: 'Zed', singlesElo: null, doublesElo: 1001 },
        { name: "O'Neil \\ Jr", singlesElo: 950, doublesElo: null }
      ]),
      [
        "    { name: 'O\\'Neil \\\\ Jr', singlesElo: 950, doublesElo: null },",
        "    { name: 'Zed', singlesElo: null, doublesElo: 1001 }"
      ].join('\n')
    );
  });
});

describe('replaceFallbackSnapshot', () => {
  it('replaces the players, the date constant and the comment date', () => {
    const out = replaceFallbackSnapshot(SOURCE, [{ name: 'New', singlesElo: 1, doublesElo: null }], '2026-10-16');
    assert.equal(
      out,
      `  // Last refreshed from the live page: 2026-10-16.
  const FALLBACK_LEADERBOARD_DATE = '2026-10-16';
  const FALLBACK_LEADERBOARD_PLAYERS = [
    { name: 'New', singlesElo: 1, doublesElo: null }
  ];

  const LEADERBOARD_URL = 'x';
`
    );
  });

  it('throws when the source no longer has the expected markers', () => {
    assert.throws(() => replaceFallbackSnapshot('const x = 1;', [], '2026-10-16'), /snapshot markers not found/);
  });

  it('refuses an empty player list', () => {
    assert.throws(() => replaceFallbackSnapshot(SOURCE, [], '2026-10-16'), /no players/);
  });

  it('the result still loads and parses as the module', () => {
    const real = require('node:fs').readFileSync(require.resolve('../tournament-logic.js'), 'utf8');
    const out = replaceFallbackSnapshot(real, [{ name: 'Ann', singlesElo: null, doublesElo: 1000 }], '2026-10-16');
    const sandbox = {};
    new Function('globalThis', out)(sandbox);
    assert.deepEqual(sandbox.TournamentLogic.FALLBACK_LEADERBOARD_PLAYERS, [
      { name: 'Ann', singlesElo: null, doublesElo: 1000 }
    ]);
    assert.equal(sandbox.TournamentLogic.FALLBACK_LEADERBOARD_DATE, '2026-10-16');
  });
});

describe('refreshSnapshot', () => {
  const io = (page, status = 200) => {
    const written = {};
    return {
      written,
      fetchImpl: async url => {
        assert.equal(url, L.LEADERBOARD_URL);
        return { ok: status === 200, status, text: async () => page };
      },
      readFile: () => SOURCE,
      writeFile: (_path, text) => {
        written.text = text;
      }
    };
  };

  it('fetches the live page, parses playersData and rewrites the module', async () => {
    const deps = io(PAGE);
    const players = await refreshSnapshot({ ...deps, today: '2026-10-16' });
    assert.deepEqual(players, [
      { name: 'Zed', singlesElo: null, doublesElo: 1001 },
      { name: "O'Neil \\ Jr", singlesElo: 950, doublesElo: null }
    ]);
    assert.match(deps.written.text, /FALLBACK_LEADERBOARD_DATE = '2026-10-16'/);
    assert.match(deps.written.text, /name: 'Zed'/);
  });

  it('fails without writing on HTTP errors or an unparsable page', async () => {
    const httpError = io(PAGE, 503);
    await assert.rejects(refreshSnapshot({ ...httpError, today: 'd' }), /HTTP 503/);
    assert.equal(httpError.written.text, undefined);

    const noData = io('<html></html>');
    await assert.rejects(refreshSnapshot({ ...noData, today: 'd' }), /playersData not found/);
    assert.equal(noData.written.text, undefined);
  });
});
