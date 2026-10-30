// Version stamps on the page's own <script> tags: tournament-logic.js?v=<hash>.
// Hosts may let browsers cache scripts for weeks (calgaryfoosballclub.com sends
// max-age=2678400 for .js), so without a stamp a browser can pair a new page
// with an old tournament-logic.js and crash ("x is not a function"). A stamp is
// the start of the file's SHA-256, so any change gives the script a new URL.
// `npm run stamp` writes them; the build fails if one is stale.

const crypto = require('node:crypto');

const LOCAL_SCRIPTS = ['tournament-logic.js', 'firebase-config.js', 'firebase-remote.js'];

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagPattern = name => new RegExp(`<script src="${escape(name)}(?:\\?v=([0-9a-f]+))?"></script>`, 'g');

function stampFor(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
}

// html with each local script's tag stamped for its current text.
// files: { name: text }. Throws if the page doesn't load one of them.
function stampScripts(html, files) {
  return Object.entries(files).reduce((page, [name, text]) => {
    if (!tagPattern(name).test(page)) throw new Error(`The page doesn't load ${name} with a plain <script> tag`);
    return page.replace(tagPattern(name), `<script src="${name}?v=${stampFor(text)}"></script>`);
  }, html);
}

// Names whose tag is missing, unstamped or stamped for other content.
function staleStamps(html, files) {
  return Object.entries(files)
    .filter(([name, text]) => {
      const tags = [...html.matchAll(tagPattern(name))];
      return tags.length !== 1 || tags[0][1] !== stampFor(text);
    })
    .map(([name]) => name);
}

module.exports = { LOCAL_SCRIPTS, stampFor, stampScripts, staleStamps };
