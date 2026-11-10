#!/usr/bin/env node
// Runs the UI tests (test-e2e/*.e2e.js) in parallel: each file is its own Node
// process with its own Chrome and HTTP server, so files can't see each other's
// storage. Concurrency defaults to one less than the CPU count, capped at 8:
// more Chromes than cores slows every page and the longest files time out.
// Override with E2E_CONCURRENCY. Pass file paths to run only those files.
// E2E_SHARD=i/n runs only the i-th of n slices of the files (CI runs the
// slices as separate jobs, then merges their coverage-ui/ for the UI gate).
//
// Usage: node scripts/run-e2e.js [files...]

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAX_CONCURRENCY = 8;

function concurrency(env = process.env, cpus = os.availableParallelism()) {
  const requested = Number.parseInt(env.E2E_CONCURRENCY, 10);
  if (requested > 0) return requested;
  return Math.max(1, Math.min(MAX_CONCURRENCY, cpus - 1));
}

// Explicit file lists: Node 22+ treats --test arguments as globs and no longer
// accepts a bare directory, while Node 20 doesn't expand globs.
function e2eFiles() {
  return fs
    .readdirSync(path.join(ROOT, 'test-e2e'))
    .filter(f => f.endsWith('.e2e.js'))
    .sort()
    .map(f => path.join('test-e2e', f));
}

if (require.main === module) {
  const files = process.argv.slice(2);
  const n = concurrency();
  const shard = process.env.E2E_SHARD ? [`--test-shard=${process.env.E2E_SHARD}`] : [];
  console.log(`UI tests: ${n} files at a time${shard.length ? `, shard ${process.env.E2E_SHARD}` : ''}`);
  const result = spawnSync(
    process.execPath,
    ['--test', `--test-concurrency=${n}`, '--test-timeout=90000', ...shard, ...(files.length ? files : e2eFiles())],
    { cwd: ROOT, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

module.exports = { concurrency, e2eFiles, MAX_CONCURRENCY };
