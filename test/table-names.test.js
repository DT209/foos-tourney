const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L } = require('./helpers');

describe('setTableName', () => {
  it('sets a name, padding missing tables with empty names', () => {
    assert.deepEqual(L.setTableName([], 3, 'Center'), ['', '', 'Center']);
    assert.deepEqual(L.setTableName(['A', 'B'], 2, 'Back'), ['A', 'Back']);
  });

  it('keeps names above the table count', () => {
    assert.deepEqual(L.setTableName(['A', 'B', 'C'], 1, 'Z'), ['Z', 'B', 'C']);
  });

  it('strips < and >, caps the length and keeps typed spaces', () => {
    assert.deepEqual(L.setTableName([], 1, 'a<b>c '), ['abc ']);
    assert.equal(L.TABLE_NAME_MAX_LENGTH, 20);
    assert.equal(L.setTableName([], 1, 'x'.repeat(30))[0], 'x'.repeat(20));
  });

  it('clears a name', () => {
    assert.deepEqual(L.setTableName(['A', 'B'], 1, ''), ['', 'B']);
    assert.deepEqual(L.setTableName(['A'], 1, 5), ['']);
  });

  it('refuses a table outside 1 to 10 or a non-integer', () => {
    for (const table of [0, 11, -1, 1.5, '2', NaN, undefined]) {
      assert.ok(L.setTableName([], table, 'x').error, String(table));
    }
    assert.equal(L.setTableName([], 10, 'x').length, 10);
  });

  it('never changes its input', () => {
    const names = ['A'];
    const next = L.setTableName(names, 2, 'B');
    assert.deepEqual(names, ['A']);
    assert.notEqual(next, names);
    assert.notEqual(L.setTableName(names, 1, 'A'), names);
  });
});

describe('formatTableLabel', () => {
  it('shows the number and the name', () => {
    assert.equal(L.formatTableLabel(['', '', 'Center'], 3), 'Table 3 · Center');
    assert.equal(L.formatTableLabel(['  Back '], 1), 'Table 1 · Back');
  });

  it('shows just the number without a usable name', () => {
    assert.equal(L.formatTableLabel(['', '   '], 1), 'Table 1');
    assert.equal(L.formatTableLabel(['', '   '], 2), 'Table 2');
    assert.equal(L.formatTableLabel([], 4), 'Table 4');
  });
});

describe('tableHeading', () => {
  it('shows the name alone when one is set', () => {
    assert.equal(L.tableHeading(['', '', 'Center'], 3), 'Center');
    assert.equal(L.tableHeading(['  Back '], 1), 'Back');
  });

  it('shows Table N without a usable name', () => {
    assert.equal(L.tableHeading(['', '   '], 1), 'Table 1');
    assert.equal(L.tableHeading(['', '   '], 2), 'Table 2');
    assert.equal(L.tableHeading([], 4), 'Table 4');
  });
});

describe('tableNumberLabel', () => {
  it('is Table N, the hover text on a heading', () => {
    assert.equal(L.tableNumberLabel(3), 'Table 3');
  });
});
