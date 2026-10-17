const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L } = require('./helpers');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  }
};

describe('display layout splits', () => {
  it('defaults: tables on top with half the height, leaderboard and history sharing the rest equally', () => {
    assert.deepEqual(L.DEFAULT_DISPLAY_LAYOUT, { arrangement: 'top', tables: 0.5, standings: 0.5 });
  });

  it('clampSplit keeps every area at least 20% of its space', () => {
    assert.equal(L.clampSplit(0.5), 0.5);
    assert.equal(L.clampSplit(0.05), 0.2);
    assert.equal(L.clampSplit(0.95), 0.8);
  });

  it('splitFromPointer turns a pointer position into a clamped fraction of the container', () => {
    assert.equal(L.splitFromPointer(600, 100, 1000), 0.5);
    assert.equal(L.splitFromPointer(50, 100, 1000), 0.2);
    assert.equal(L.splitFromPointer(1200, 100, 1000), 0.8);
    assert.equal(L.splitFromPointer(10, 0, 0), L.DEFAULT_DISPLAY_LAYOUT.tables, 'zero-size container');
  });

  it('nudgeSplit moves by 5% steps for keyboard or TV remote resizing, clamped', () => {
    assert.equal(L.nudgeSplit(0.5, 1), 0.55);
    assert.equal(L.nudgeSplit(0.5, -1), 0.45);
    assert.equal(L.nudgeSplit(0.78, 1), 0.8);
    assert.equal(L.nudgeSplit(0.21, -1), 0.2);
  });
});

describe('display arrangements', () => {
  it('cycle top, left, stacked and back, each with a label', () => {
    assert.deepEqual(L.DISPLAY_ARRANGEMENTS, ['top', 'left', 'stacked']);
    assert.equal(L.nextArrangement('top'), 'left');
    assert.equal(L.nextArrangement('left'), 'stacked');
    assert.equal(L.nextArrangement('stacked'), 'top');
    assert.deepEqual(Object.keys(L.DISPLAY_ARRANGEMENT_LABELS), L.DISPLAY_ARRANGEMENTS);
  });

  it('say which way each handle drags', () => {
    assert.deepEqual(L.splitDirections('top'), { tables: 'y', standings: 'x' });
    assert.deepEqual(L.splitDirections('left'), { tables: 'x', standings: 'y' });
    assert.deepEqual(L.splitDirections('stacked'), { tables: 'y', standings: 'y' });
  });
});

describe('display layout persistence', () => {
  const layout = { arrangement: 'left', tables: 0.7, standings: 0.3 };

  it('round-trips through storage as a browser preference', () => {
    const storage = memoryStorage();
    assert.equal(L.saveDisplayLayout(storage, layout), true);
    assert.deepEqual(JSON.parse(storage.getItem(L.DISPLAY_LAYOUT_KEY)), layout);
    assert.deepEqual(L.loadDisplayLayout(storage), layout);
  });

  it('falls back to defaults per value for missing, invalid or out-of-range data', () => {
    const at = value => memoryStorage({ [L.DISPLAY_LAYOUT_KEY]: value });
    assert.deepEqual(L.loadDisplayLayout(memoryStorage()), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('{oops')), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('null')), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('{"arrangement":"diagonal","tables":"wide","standings":0.6}')), {
      arrangement: 'top',
      tables: 0.5,
      standings: 0.6
    });
    assert.deepEqual(L.loadDisplayLayout(at('{"arrangement":"stacked","tables":0.99,"standings":-1}')), {
      arrangement: 'stacked',
      tables: 0.8,
      standings: 0.2
    });
    // Sizes saved before arrangements existed fall back to the new defaults.
    assert.deepEqual(L.loadDisplayLayout(at('{"columns":0.7,"rows":0.3}')), L.DEFAULT_DISPLAY_LAYOUT);
  });

  it('never throws when storage is unavailable', () => {
    assert.deepEqual(L.loadDisplayLayout(throwingStorage), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(null), L.DEFAULT_DISPLAY_LAYOUT);
    assert.equal(L.saveDisplayLayout(throwingStorage, L.DEFAULT_DISPLAY_LAYOUT), false);
    assert.equal(L.saveDisplayLayout(null, L.DEFAULT_DISPLAY_LAYOUT), false);
  });

  it('a loaded default is a copy, so changing it never changes the default', () => {
    const loaded = L.loadDisplayLayout(throwingStorage);
    loaded.tables = 0.3;
    assert.equal(L.DEFAULT_DISPLAY_LAYOUT.tables, 0.5);
  });
});

describe('display layout links', () => {
  it('write and read ?layout=arrangement-tables-standings', () => {
    const layout = { arrangement: 'left', tables: 0.62, standings: 0.4 };
    assert.equal(L.layoutParam(layout), 'left-62-40');
    assert.deepEqual(L.layoutFromSearch('?display=1&layout=left-62-40'), layout);
    assert.deepEqual(L.layoutFromSearch('?layout=stacked-5-95'), {
      arrangement: 'stacked',
      tables: 0.2,
      standings: 0.8
    });
  });

  it('ignore missing or malformed layouts', () => {
    assert.equal(L.layoutFromSearch('?display=1'), null);
    assert.equal(L.layoutFromSearch('?layout=diagonal-50-50'), null);
    assert.equal(L.layoutFromSearch('?layout=top-50'), null);
  });

  it('ride along on second-screen and viewer links, and leave with Exit', () => {
    const layout = { arrangement: 'top', tables: 0.45, standings: 0.5 };
    assert.equal(L.displayModeUrl('https://x.org/t.html', layout), 'https://x.org/t.html?display=1&layout=top-45-50');
    assert.equal(
      L.remoteTournamentUrl('https://x.org/t.html?display=1', 'abc', layout),
      'https://x.org/t.html?remote=abc&layout=top-45-50'
    );
    assert.equal(L.controlDeskUrl('https://x.org/t.html?display=1&layout=top-45-50&a=1'), 'https://x.org/t.html?a=1');
  });

  it('isDisplayLayoutKey spots layout changes from other windows', () => {
    assert.equal(L.isDisplayLayoutKey(L.DISPLAY_LAYOUT_KEY), true);
    assert.equal(L.isDisplayLayoutKey(null), true, 'localStorage.clear()');
    assert.equal(L.isDisplayLayoutKey(L.CURRENT_TOURNAMENT_KEY), false);
  });
});

describe('isTournamentStorageKey', () => {
  it('is true for tournament records and the current pointer, false for other keys', () => {
    assert.equal(L.isTournamentStorageKey('foosTourney.tournament.abc'), true);
    assert.equal(L.isTournamentStorageKey(L.CURRENT_TOURNAMENT_KEY), true);
    assert.equal(L.isTournamentStorageKey(L.DISPLAY_LAYOUT_KEY), false);
    assert.equal(L.isTournamentStorageKey('other'), false);
    assert.equal(L.isTournamentStorageKey(null), true, 'localStorage.clear() reports a null key');
  });
});
