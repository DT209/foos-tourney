// Merges raw V8 script coverage from several page loads of the same script
// and summarizes function and block coverage. Used by scripts/ui-coverage.js
// for the page's compiled UI script.

// Per-character execution counts: V8 ranges nest, so apply the widest ranges
// first and let narrower (inner) ranges overwrite them. -1 = not in any range.
function charCounts(length, functions) {
  const counts = new Int32Array(length).fill(-1);
  const ranges = functions
    .flatMap(f => f.ranges)
    .sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
  for (const r of ranges) counts.fill(r.count, r.startOffset, r.endOffset);
  return counts;
}

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

// runs: [{ text, functions }] where functions is V8's ScriptCoverage.functions.
// startMarker: only code from its first occurrence on is measured (skips
// helpers a compiler injects ahead of the real code).
function summarize(runs, { startMarker } = {}) {
  if (runs.length === 0) throw new Error('No UI coverage found: run the UI tests first');
  const { text } = runs[0];
  const from = startMarker === undefined ? 0 : text.indexOf(startMarker);
  if (from < 0) throw new Error(`Coverage start marker "${startMarker}" not found`);
  const fnHits = new Map();
  const covered = new Uint8Array(text.length);
  const executable = new Uint8Array(text.length);

  for (const run of runs) {
    if (run.text !== text) throw new Error('UI script text differs between runs; clear coverage-ui/ and rerun');
    for (const f of run.functions) {
      const [whole] = f.ranges;
      // The script itself appears as an unnamed function starting at 0.
      if (whole.startOffset === 0 && f.functionName === '') continue;
      if (whole.startOffset < from) continue;
      const key = `${whole.startOffset}:${whole.endOffset}`;
      const entry = fnHits.get(key) || { start: whole.startOffset, count: 0 };
      entry.count += whole.count;
      fnHits.set(key, entry);
    }
    const counts = charCounts(text.length, run.functions);
    for (let i = from; i < text.length; i++) {
      if (counts[i] < 0 || /\s/.test(text[i])) continue;
      executable[i] = 1;
      if (counts[i] > 0) covered[i] = 1;
    }
  }

  const fns = [...fnHits.values()];
  const uncovered = fns
    .filter(f => f.count === 0)
    .sort((a, b) => a.start - b.start)
    .map(f => ({ line: lineOf(text, f.start), snippet: text.slice(f.start, f.start + 110).replace(/\s+/g, ' ') }));
  const executableChars = executable.reduce((n, v) => n + v, 0);
  const coveredChars = covered.reduce((n, v, i) => n + (v & executable[i]), 0);

  return {
    loads: runs.length,
    functions: fns.length,
    functionsCovered: fns.length - uncovered.length,
    functionPct: fns.length === 0 ? 100 : (100 * (fns.length - uncovered.length)) / fns.length,
    blockPct: executableChars === 0 ? 100 : (100 * coveredChars) / executableChars,
    uncovered
  };
}

module.exports = { charCounts, summarize };
