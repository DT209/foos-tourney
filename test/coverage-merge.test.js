const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { charCounts, summarize } = require('../scripts/coverage-merge');

const TEXT = 'f(){a()}\ng(){b()}\nh(){}';
const script = { functionName: '', ranges: [{ startOffset: 0, endOffset: TEXT.length, count: 1 }] };
const fn = (name, start, end, count, inner = []) => ({
  functionName: name,
  ranges: [{ startOffset: start, endOffset: end, count }, ...inner]
});

describe('charCounts', () => {
  it('lets inner ranges override outer ones and marks gaps as -1', () => {
    const counts = charCounts(10, [
      { ranges: [{ startOffset: 0, endOffset: 8, count: 1 }] },
      { ranges: [{ startOffset: 2, endOffset: 4, count: 0 }] }
    ]);
    assert.deepEqual([...counts], [1, 1, 0, 0, 1, 1, 1, 1, -1, -1]);
  });
});

describe('summarize', () => {
  it('requires at least one run', () => {
    assert.throws(() => summarize([]), /No UI coverage/);
  });

  it('rejects runs of different script text', () => {
    assert.throws(
      () =>
        summarize([
          { text: 'a', functions: [] },
          { text: 'b', functions: [] }
        ]),
      /differs between runs/
    );
  });

  it('merges runs: a function counts as covered if any run executed it', () => {
    const runA = { text: TEXT, functions: [script, fn('f', 0, 8, 1), fn('g', 9, 17, 0), fn('h', 18, 23, 0)] };
    const runB = { text: TEXT, functions: [script, fn('f', 0, 8, 0), fn('g', 9, 17, 2), fn('h', 18, 23, 0)] };
    const s = summarize([runA, runB]);
    assert.deepEqual(
      { loads: s.loads, functions: s.functions, functionsCovered: s.functionsCovered },
      { loads: 2, functions: 3, functionsCovered: 2 }
    );
    assert.equal(s.functionPct, (100 * 2) / 3);
    assert.deepEqual(s.uncovered, [{ line: 3, snippet: 'h(){}' }]);
    // 21 non-whitespace chars; h(){} (5 chars) never ran.
    assert.equal(s.blockPct, (100 * 16) / 21);
  });

  it('counts uncovered blocks inside executed functions', () => {
    const s = summarize([
      { text: TEXT, functions: [script, fn('f', 0, 8, 1, [{ startOffset: 4, endOffset: 7, count: 0 }])] }
    ]);
    assert.equal(s.functionPct, 100);
    assert.equal(s.blockPct, (100 * 18) / 21); // 3 chars of f's body never ran
  });

  it('reports 100% when there is nothing to measure', () => {
    const s = summarize([{ text: '  ', functions: [] }]);
    assert.deepEqual([s.functionPct, s.blockPct, s.uncovered], [100, 100, []]);
  });
});

describe('summarize with a start marker', () => {
  it('ignores functions and code before the marker (e.g. injected compiler helpers)', () => {
    const text = '_h(){}\nSTART\nf(){}';
    const s = summarize([{ text, functions: [script, fn('_h', 0, 6, 0), fn('f', 13, 18, 1)] }], {
      startMarker: 'START'
    });
    assert.deepEqual([s.functions, s.functionsCovered, s.uncovered], [1, 1, []]);
    assert.equal(s.blockPct, 100);
  });

  it('fails when the marker is missing', () => {
    assert.throws(
      () => summarize([{ text: 'x', functions: [] }], { startMarker: 'START' }),
      /marker "START" not found/
    );
  });
});
