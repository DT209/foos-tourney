# Foos Tourney

Calgary Foosball Club tournament manager: Monster/DYP open play with fair
matchmaking, then single, double or championship elimination brackets.

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

## Known issues

- Single elimination with exactly 2 teams throws during bracket generation
  (recorded as a `todo` test).
- Tournament state is in memory only. A page refresh loses it.
