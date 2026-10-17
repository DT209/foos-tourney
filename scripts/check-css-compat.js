#!/usr/bin/env node
// Cross-browser check for the page's own CSS (the <style> block in
// TournamentManager.html): reports features the browserslist targets in
// package.json don't support, as bugs. Tailwind classes are generated in the
// browser by the CDN script, so they aren't covered here.
//
// Usage: node scripts/check-css-compat.js

const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const doiuse = require('doiuse');
const browserslist = require('browserslist');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'TournamentManager.html');

// Features doiuse reports that don't break anything for these targets.
// Each needs a reason; anything else fails the build.
const IGNORED = {
  'viewport-unit-variants': '.db sets height: 100vh first; browsers without dvh keep that.',
  'css-touch-action': 'Only desktop Safari lacks it, and it has no touch input. iOS Safari supports it.',
  'css3-cursors': 'Resize cursors only matter with a mouse; touch screens have no cursor.',
  'css-scrollbar': 'Hidden scrollbars are cosmetic; older iOS shows its thin overlay scrollbar instead.'
};

function pageCss(html) {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

async function check() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const styleStart = html.slice(0, html.indexOf('<style>')).split('\n').length;
  const browsers = browserslist.loadConfig({ path: ROOT });
  const bugs = [];
  await postcss([
    doiuse({
      browsers,
      ignore: Object.keys(IGNORED),
      onFeatureUsage: usage => {
        const line = styleStart + usage.usage.source.start.line - 1;
        bugs.push(`TournamentManager.html:${line}: Cross-browser bug: ${usage.message}`);
      }
    })
  ]).process(pageCss(html), { from: undefined });
  return bugs;
}

check().then(bugs => {
  bugs.forEach(bug => console.error(bug));
  if (bugs.length) {
    console.error(`${bugs.length} cross-browser CSS bug(s)`);
    process.exit(1);
  }
  console.log('CSS supported by every target browser');
});
