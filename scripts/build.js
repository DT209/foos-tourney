#!/usr/bin/env node
// Build pipeline: quality gates, then copy the app to dist/ byte-for-byte.
// No transpiling, bundling or minifying - the shipped JS is the source JS.
//
// Usage: node scripts/build.js [--skip-e2e] [--skip-firebase] [--skip-audit] [--check-only]

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PAGE = 'TournamentManager.html';
// Source file -> name in dist/. The page ships as index.html, so a host
// serves it at the folder's address (e.g. calgaryfoosballclub.com/dyp/).
const APP_FILES = {
  [PAGE]: 'index.html',
  'tournament-logic.js': 'tournament-logic.js',
  'firebase-config.js': 'firebase-config.js',
  'firebase-remote.js': 'firebase-remote.js'
};
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${result.status}`);
}

const npx =
  (...a) =>
  () =>
    run('npx', ['--no-install', ...a]);

// Every name the page destructures from window.TournamentLogic must exist,
// otherwise it is silently undefined at runtime (ESLint can't see this).
function checkModuleContract() {
  const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
  const match = html.match(/const\s*\{([^}]*)\}\s*=\s*window\.TournamentLogic/);
  if (!match) throw new Error(`${PAGE} does not import from window.TournamentLogic`);
  if (!html.includes('<script src="tournament-logic.js"></script>')) {
    throw new Error(`${PAGE} does not load tournament-logic.js`);
  }
  require(path.join(ROOT, 'tournament-logic.js'));
  const exported = new Set(Object.keys(globalThis.TournamentLogic));
  const imported = match[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const missing = imported.filter(name => !exported.has(name));
  if (missing.length) throw new Error(`Imported but not exported by tournament-logic.js: ${missing.join(', ')}`);
  console.log(`${imported.length} imports resolve against ${exported.size} exports`);
}

// Explicit file lists: Node 22+ treats --test arguments as globs and no
// longer accepts a bare directory, while Node 20 doesn't expand globs.
function testFiles(dir, suffix) {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith(suffix))
    .sort()
    .map(f => path.join(dir, f));
}

const e2eFiles = () => testFiles('test-e2e', '.e2e.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyToDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST);
  // { "index.html": { "source": "TournamentManager.html", "sha256": ... }, ... }
  const manifest = {};
  for (const [file, name] of Object.entries(APP_FILES)) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, name);
    fs.copyFileSync(src, dest);
    if (sha256(src) !== sha256(dest)) throw new Error(`${file} changed while copying`);
    manifest[name] = { source: file, sha256: sha256(dest) };
  }
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`dist/: ${Object.values(APP_FILES).join(', ')} (unmodified copies) + manifest.json`);
}

const steps = [
  ['Lint (ESLint, zero warnings)', npx('eslint', '--max-warnings', '0', '.')],
  ['Format check (Prettier)', npx('prettier', '--check', '.')],
  ['HTML validation (html-validate)', npx('html-validate', PAGE)],
  ['Module contract (HTML imports vs. exports)', checkModuleContract],
  [
    'Cross-browser check (target browsers, secure-context APIs, CSS)',
    () => run('npm', ['run', '--silent', 'check:browsers'])
  ],
  [
    'Tests + 100% coverage (node:test, c8)',
    npx(
      'c8',
      '--check-coverage',
      '--100',
      '--include',
      'tournament-logic.js',
      '--include',
      'scripts/leaderboard-snapshot.js',
      '--include',
      'scripts/coverage-merge.js',
      '--reporter',
      'text',
      '--reporter',
      'html',
      'node',
      '--test',
      ...testFiles('test', '.test.js')
    )
  ],
  [
    'UI tests (headless Chrome)',
    args.has('--skip-e2e')
      ? null
      : () => {
          fs.rmSync(path.join(ROOT, 'coverage-ui'), { recursive: true, force: true });
          run('node', ['--test', '--test-concurrency=1', '--test-timeout=90000', ...e2eFiles()]);
        }
  ],
  [
    'UI coverage (every UI function runs)',
    args.has('--skip-e2e') ? null : () => run('node', ['scripts/ui-coverage.js'])
  ],
  [
    'Firestore rules + adapter (emulator, 100% coverage)',
    args.has('--skip-firebase') ? null : () => run('npm', ['run', '--silent', 'test:firebase'])
  ],
  [
    'Dependency audit (npm audit, high+)',
    args.has('--skip-audit') ? null : () => run('npm', ['audit', '--audit-level=high'])
  ],
  ['Package dist/', args.has('--check-only') ? null : copyToDist]
];

let failed = false;
for (const [name, step] of steps) {
  console.log(`\n▶ ${name}`);
  if (!step) {
    console.log('  skipped');
    continue;
  }
  try {
    step();
    console.log(`✔ ${name}`);
  } catch (err) {
    console.error(`✖ ${name}: ${err.message}`);
    failed = true;
    break;
  }
}

console.log(failed ? '\nBUILD FAILED' : '\nBUILD PASSED');
process.exit(failed ? 1 : 0);
