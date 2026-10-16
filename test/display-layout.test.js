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
  it('defaults: tables take 58% of the width, the leaderboard half the side column', () => {
    assert.deepEqual(L.DEFAULT_DISPLAY_LAYOUT, { columns: 0.58, rows: 0.5 });
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
    assert.equal(L.splitFromPointer(10, 0, 0), L.DEFAULT_DISPLAY_LAYOUT.columns, 'zero-size container');
  });

  it('nudgeSplit moves by 5% steps for keyboard resizing, clamped', () => {
    assert.equal(L.nudgeSplit(0.5, 1), 0.55);
    assert.equal(L.nudgeSplit(0.5, -1), 0.45);
    assert.equal(L.nudgeSplit(0.78, 1), 0.8);
    assert.equal(L.nudgeSplit(0.21, -1), 0.2);
  });
});

describe('display layout persistence', () => {
  it('round-trips through storage as a browser preference', () => {
    const storage = memoryStorage();
    assert.equal(L.saveDisplayLayout(storage, { columns: 0.7, rows: 0.3 }), true);
    assert.deepEqual(JSON.parse(storage.getItem(L.DISPLAY_LAYOUT_KEY)), { columns: 0.7, rows: 0.3 });
    assert.deepEqual(L.loadDisplayLayout(storage), { columns: 0.7, rows: 0.3 });
  });

  it('falls back to defaults per value for missing, invalid or out-of-range data', () => {
    const at = value => memoryStorage({ [L.DISPLAY_LAYOUT_KEY]: value });
    assert.deepEqual(L.loadDisplayLayout(memoryStorage()), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('{oops')), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('null')), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(at('{"columns":"wide","rows":0.6}')), { columns: 0.58, rows: 0.6 });
    assert.deepEqual(L.loadDisplayLayout(at('{"columns":0.99,"rows":-1}')), { columns: 0.8, rows: 0.2 });
  });

  it('never throws when storage is unavailable', () => {
    assert.deepEqual(L.loadDisplayLayout(throwingStorage), L.DEFAULT_DISPLAY_LAYOUT);
    assert.deepEqual(L.loadDisplayLayout(null), L.DEFAULT_DISPLAY_LAYOUT);
    assert.equal(L.saveDisplayLayout(throwingStorage, L.DEFAULT_DISPLAY_LAYOUT), false);
    assert.equal(L.saveDisplayLayout(null, L.DEFAULT_DISPLAY_LAYOUT), false);
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
