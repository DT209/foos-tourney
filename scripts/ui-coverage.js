#!/usr/bin/env node
// Enforces 100% function coverage of the page's compiled UI script (the Babel
// output of the <script type="text/babel"> block) across all UI tests: every
// component, handler and inline callback must run in at least one test.
// Block coverage is reported for information. The UI tests write raw V8
// coverage to coverage-ui/.

const fs = require('node:fs');
const path = require('node:path');
const { summarize } = require('./coverage-merge');

const DIR = path.resolve(__dirname, '..', 'coverage-ui');

const runs = fs.existsSync(DIR)
  ? fs
      .readdirSync(DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))
  : [];

try {
  const s = summarize(runs, { startMarker: 'window.TournamentLogic' });
  console.log(`UI coverage across ${s.loads} page loads (compiled UI script):`);
  console.log(`  functions: ${s.functionsCovered}/${s.functions} (${s.functionPct.toFixed(2)}%)`);
  console.log(`  code (block): ${s.blockPct.toFixed(2)}%`);
  s.uncovered.forEach(u => console.log(`  never ran: line ${u.line}: ${u.snippet}`));
  if (s.functionPct < 100) {
    console.error(`UI function coverage ${s.functionPct.toFixed(2)}% is below 100%`);
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
