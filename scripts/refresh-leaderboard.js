#!/usr/bin/env node
// Usage: npm run refresh-leaderboard
// Updates the offline leaderboard snapshot in tournament-logic.js from the live site.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { refreshSnapshot } = require('./leaderboard-snapshot');

const ROOT = path.resolve(__dirname, '..');
const modulePath = path.join(ROOT, 'tournament-logic.js');

refreshSnapshot({
  fetchImpl: globalThis.fetch,
  readFile: file => fs.readFileSync(file, 'utf8'),
  writeFile: (file, text) => fs.writeFileSync(file, text),
  today: new Date().toISOString().split('T')[0],
  modulePath
})
  .then(players => {
    spawnSync('npx', ['--no-install', 'prettier', '--write', modulePath], { cwd: ROOT, stdio: 'inherit' });
    console.log(`Snapshot updated: ${players.length} players. Review with git diff, then npm run build.`);
  })
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
