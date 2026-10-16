# Foos Tourney

Calgary Foosball Club tournament manager: Monster/DYP open play with fair
matchmaking, then single, double or championship elimination brackets.

## Working with Claude Code

Project conventions for AI-assisted changes (architecture rules, coverage and
build constraints, testing approach, known issues) are in
[`.claude/CLAUDE.md`](.claude/CLAUDE.md). Read it before changing the code.

## Layout

| File                     | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `TournamentManager.html` | The page: React UI, compiled in the browser by Babel. No build step.    |
| `tournament-logic.js`    | All tournament behaviour as plain functions (`window.TournamentLogic`). |
| `test/`                  | `node:test` suites for every function in `tournament-logic.js`.         |
| `scripts/build.js`       | Quality gates, then copies the app to `dist/` unchanged.                |

Deploy by serving `TournamentManager.html` and `tournament-logic.js` from the
same directory (e.g. `calgaryfoosballclub.com/dyp/`). The live leaderboard
fetch only works same-origin with calgaryfoosballclub.com; elsewhere the page
falls back to a bundled snapshot.

## Development

Requires Node 20+.

```sh
npm install
npm test            # run tests
npm run coverage    # tests + 100% coverage gate (HTML report in coverage/)
npm run check       # every quality gate, no dist/
npm run build       # every quality gate, then dist/
npm run format      # apply Prettier to JS/JSON/Markdown
```

`npm run build` stops at the first failing step:

1. ESLint, zero warnings, covering the JS files and the inline JSX in the HTML
2. Prettier format check
3. html-validate
4. Module contract: every name the page imports from `TournamentLogic` exists
5. Tests with 100% statement, branch, function and line coverage
6. `npm audit` at high severity (`--skip-audit` when offline)
7. Copy `TournamentManager.html` and `tournament-logic.js` to `dist/` byte-for-byte, with a SHA-256 `manifest.json`

The JavaScript is never transpiled, bundled or minified.

## Persistence and admin lock

- The tournament auto-saves to this browser's `localStorage` after every change and restores on
  load. Use **Full Reset** to start the next event. Private browsing or blocked site data disables
  auto-save, and the footer says so.
- The first **Admin Lock** asks for a 4-8 digit PIN. The lock prevents accidental edits on a shared
  screen. It isn't security: **Forgot PIN?** unlocks after a confirm.

## Club leaderboard

The page fetches `calgaryfoosballclub.com/leaderboard/` live. Browsers only allow that when the page
is served from the same site (CORS), so hosting anywhere else, or opening the file locally, uses the
bundled snapshot. The UI shows the snapshot's date. To update it:

```sh
npm run refresh-leaderboard   # fetches from Node (no CORS), rewrites the snapshot
git diff tournament-logic.js  # review, then npm run build
```

To get live data on another host, the club site must send an `Access-Control-Allow-Origin` header for
that host on `/leaderboard/`.
