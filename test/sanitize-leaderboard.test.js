const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { L } = require('./helpers');

describe('sanitizeInput', () => {
  it('returns empty string for non-strings', () => {
    assert.equal(L.sanitizeInput(42), '');
    assert.equal(L.sanitizeInput(null), '');
  });

  it('strips angle brackets, trims and truncates (default 35)', () => {
    assert.equal(L.sanitizeInput('  <b>Bob</b>  '), 'bBob/b');
    assert.equal(L.sanitizeInput('x'.repeat(50)).length, 35);
    assert.equal(L.sanitizeInput('abcdef', 3), 'abc');
  });
});

describe('sanitizeTypedText', () => {
  it('strips angle brackets and truncates but keeps spaces, so typing "Friday Night" works', () => {
    assert.equal(L.sanitizeTypedText('Friday '), 'Friday ');
    assert.equal(L.sanitizeTypedText(' <b>Fri</b> Night '), ' bFri/b Night ');
    assert.equal(L.sanitizeTypedText('x'.repeat(50)).length, 35);
    assert.equal(L.sanitizeTypedText('abcdef', 3), 'abc');
  });

  it('returns empty string for non-strings', () => {
    assert.equal(L.sanitizeTypedText(undefined), '');
  });
});

describe('sanitizeInt', () => {
  it('parses integers and clamps negatives to 0', () => {
    assert.equal(L.sanitizeInt('7'), 7);
    assert.equal(L.sanitizeInt('-3'), 0);
  });

  it('returns the fallback for non-numeric input', () => {
    assert.equal(L.sanitizeInt('abc'), 0);
    assert.equal(L.sanitizeInt('abc', 9), 9);
  });
});

describe('normalizeScoreInput', () => {
  it('keeps blank as blank, otherwise sanitizes', () => {
    assert.equal(L.normalizeScoreInput(''), '');
    assert.equal(L.normalizeScoreInput('5'), 5);
    assert.equal(L.normalizeScoreInput('-1'), 0);
  });
});

describe('findLeaderboardPlayer / getLeaderboardInfo', () => {
  const lb = [{ name: 'Ann', singlesElo: 1100, doublesElo: null }];

  it('finds by exact name or returns null', () => {
    assert.equal(L.findLeaderboardPlayer(lb, 'Ann'), lb[0]);
    assert.equal(L.findLeaderboardPlayer(lb, 'ann'), null);
  });

  it('reports format-specific ELO and label', () => {
    assert.deepEqual(L.getLeaderboardInfo(lb, 'Ann', '1v1'), { elo: 1100, label: 'Singles' });
    assert.deepEqual(L.getLeaderboardInfo(lb, 'Ann', '2v2'), { elo: null, label: 'Doubles' });
    assert.equal(L.getLeaderboardInfo(lb, 'Zed', '2v2'), null);
  });

  it('ships a fallback snapshot with unique names', () => {
    const names = L.FALLBACK_LEADERBOARD_PLAYERS.map(p => p.name);
    assert.ok(names.length > 0);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('parsePlayersDataScript', () => {
  it('returns null when there is no playersData array', () => {
    assert.equal(L.parsePlayersDataScript('const other = [];'), null);
  });

  it('returns an empty list for an empty array', () => {
    assert.deepEqual(L.parsePlayersDataScript('const playersData = [];'), []);
  });

  it('parses names, numeric ELOs (rounded) and Unranked', () => {
    const src = `
      const playersData = [
        { name: "Ann", singlesElo: 1000.6, doublesElo: "Unranked" },
        { name: "Quote \\"Q\\" Back\\\\slash", singlesElo: -5, doublesElo: 900 },
        { noName: true, singlesElo: 1 },
        { name: "NoElo" }
      ];
      renderTable();`;
    assert.deepEqual(L.parsePlayersDataScript(src), [
      { name: 'Ann', singlesElo: 1001, doublesElo: null },
      { name: 'Quote "Q" Back\\slash', singlesElo: -5, doublesElo: 900 },
      { name: 'NoElo', singlesElo: null, doublesElo: null }
    ]);
  });
});

describe('fetchLeaderboardPlayers', () => {
  const okResponse = html => async () => ({ ok: true, text: async () => html });
  // Minimal stand-in for DOMParser output: inline scripts by textContent.
  const fakeParse = scripts => () => ({
    querySelectorAll: sel => {
      assert.equal(sel, 'script:not([src])');
      return scripts.map(textContent => ({ textContent }));
    }
  });

  const realFetch = globalThis.fetch;
  const realDOMParser = globalThis.DOMParser;
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.DOMParser = realDOMParser;
  });

  it('requests the leaderboard without caching and returns parsed players', async () => {
    let call;
    const fetchImpl = async (url, opts) => {
      call = { url, opts };
      return { ok: true, text: async () => '<html>' };
    };
    const result = await L.fetchLeaderboardPlayers(
      fetchImpl,
      fakeParse(['console.log(1)', 'const playersData = [{ name: "Ann", singlesElo: 1, doublesElo: 2 }];'])
    );
    assert.deepEqual(call, { url: L.LEADERBOARD_URL, opts: { cache: 'no-store' } });
    assert.deepEqual(result, [{ name: 'Ann', singlesElo: 1, doublesElo: 2 }]);
  });

  it('throws on HTTP errors', async () => {
    await assert.rejects(
      L.fetchLeaderboardPlayers(async () => ({ ok: false, status: 503 }), fakeParse([])),
      /Leaderboard request failed: 503/
    );
  });

  it('throws when no playersData script exists', async () => {
    await assert.rejects(
      L.fetchLeaderboardPlayers(okResponse(''), fakeParse(['var x = 1;'])),
      /Could not locate playersData/
    );
  });

  it('throws when playersData is unparsable or empty', async () => {
    await assert.rejects(
      L.fetchLeaderboardPlayers(okResponse(''), fakeParse(['const playersData = 5;'])),
      /empty or unparsable/
    );
    await assert.rejects(
      L.fetchLeaderboardPlayers(okResponse(''), fakeParse(['const playersData = [];'])),
      /empty or unparsable/
    );
  });

  it('defaults to the global fetch and DOMParser', async () => {
    globalThis.fetch = okResponse('<script>const playersData = [{ name: "Bo" }];</script>');
    globalThis.DOMParser = class {
      parseFromString(html, type) {
        assert.equal(type, 'text/html');
        const text = html.replace(/<\/?script>/g, '');
        return { querySelectorAll: () => [{ textContent: text }] };
      }
    };
    assert.deepEqual(await L.fetchLeaderboardPlayers(), [{ name: 'Bo', singlesElo: null, doublesElo: null }]);
  });
});
