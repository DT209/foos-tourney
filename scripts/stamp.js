#!/usr/bin/env node
// Writes version stamps into TournamentManager.html's local <script> tags
// (see script-stamps.js). Run after changing any of those scripts; the build
// fails until the stamps match.
//
// Usage: npm run stamp

const fs = require('node:fs');
const path = require('node:path');
const { LOCAL_SCRIPTS, stampScripts } = require('./script-stamps');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'TournamentManager.html');

const files = Object.fromEntries(LOCAL_SCRIPTS.map(name => [name, fs.readFileSync(path.join(ROOT, name), 'utf8')]));
const before = fs.readFileSync(PAGE, 'utf8');
const after = stampScripts(before, files);
if (after !== before) fs.writeFileSync(PAGE, after);
console.log(after === before ? 'Script stamps already current' : 'Updated script stamps in TournamentManager.html');
