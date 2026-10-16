// Refreshes the offline leaderboard snapshot bundled in tournament-logic.js.
//
// Browsers only let the page read calgaryfoosballclub.com/leaderboard/ when
// the page is served from that site (CORS). Node has no such restriction, so
// this fetches the live leaderboard and rewrites FALLBACK_LEADERBOARD_PLAYERS
// and FALLBACK_LEADERBOARD_DATE in place. CLI: scripts/refresh-leaderboard.js.

require('../tournament-logic.js');

const { LEADERBOARD_URL, parsePlayersDataScript } = globalThis.TournamentLogic;

const COMMENT_DATE = /(\/\/ Last refreshed from the live page: )\d{4}-\d{2}-\d{2}(\.)/;
const DATE_CONST = /(const FALLBACK_LEADERBOARD_DATE = ')[^']*(';)/;
const PLAYERS_CONST = /(const FALLBACK_LEADERBOARD_PLAYERS = \[\n)[\s\S]*?(\n {2}\];)/;

function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatSnapshotEntries(players) {
  return [...players]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `    { name: ${quote(p.name)}, singlesElo: ${p.singlesElo}, doublesElo: ${p.doublesElo} }`)
    .join(',\n');
}

function replaceFallbackSnapshot(source, players, isoDate) {
  if (![COMMENT_DATE, DATE_CONST, PLAYERS_CONST].every(re => re.test(source))) {
    throw new Error('Leaderboard snapshot markers not found in tournament-logic.js');
  }
  if (players.length === 0) throw new Error('Refusing to write a snapshot with no players');
  return source
    .replace(COMMENT_DATE, `$1${isoDate}$2`)
    .replace(DATE_CONST, `$1${isoDate}$2`)
    .replace(PLAYERS_CONST, (_m, open, close) => `${open}${formatSnapshotEntries(players)}${close}`);
}

// Fetches, parses and rewrites the module. Nothing is written on failure.
async function refreshSnapshot({ fetchImpl, readFile, writeFile, today, modulePath = 'tournament-logic.js' }) {
  const res = await fetchImpl(LEADERBOARD_URL);
  if (!res.ok) throw new Error(`Leaderboard request failed: HTTP ${res.status}`);
  const players = parsePlayersDataScript(await res.text());
  if (!players || players.length === 0) throw new Error('Leaderboard playersData not found or empty');
  writeFile(modulePath, replaceFallbackSnapshot(readFile(modulePath), players, today));
  return players;
}

module.exports = { formatSnapshotEntries, replaceFallbackSnapshot, refreshSnapshot };
