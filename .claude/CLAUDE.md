# Foos Tourney: guidance for Claude

Calgary Foosball Club tournament manager. See `README.md` for layout, deploy and commands.

## Architecture rules

- **All behaviour goes in `tournament-logic.js`.** `TournamentManager.html` only renders and wires
  events: each handler calls one module function and applies the returned state with `setState`.
  Don't add logic (sorting, filtering, scoring, validation) inline in the JSX.
- Module functions take state in and return new state, or `{ error }` for user-facing failures.
  The component shows errors with `alert()`. Bracket-play functions are the exception: they mutate
  match objects and return a shallow-copied bracket, matching the original behaviour.
- Pass non-determinism in as parameters: `random = Math.random`, ids from `Date.now()`,
  `fetchImpl`, `doc`. Tests must never depend on real randomness or time.
- `tournament-logic.js` is a classic browser script that sets `globalThis.TournamentLogic`.
  Don't convert it to ES modules or CommonJS: the page loads it with a plain `<script>` and has no build step.
- When you add an export, also add it to the destructuring list at the top of the Babel block in
  the HTML. The build's module-contract step fails if the page imports a name that isn't exported.

## Hard constraints

- **Never transpile, bundle or minify.** `dist/` must be byte-identical to the source files.
- Keep 100% statement, branch, function and line coverage on `tournament-logic.js`. Cover new
  branches with tests. Don't add `c8 ignore` comments.
- `npm run build` must pass before committing: ESLint with zero warnings (including the inline JSX),
  Prettier, html-validate, the module contract, coverage, and `npm audit`.
- Prettier formats JS, JSON and Markdown. The HTML is excluded on purpose, so don't reformat it wholesale.

## Testing

- `node:test` + `node:assert/strict`, shared fixtures in `test/helpers.js`
  (`seq()` for scripted randomness, `zero`, `players()`, `teams()`, `BYE`, `scoreFor()`).
- Bracket changes: use `playOut()` in `test/bracket-play.test.js` to drive a full tournament and
  assert on standings, not just single steps.
- For a refactor that should keep behaviour, compare the old and new functions on randomized
  inputs (seeded PRNG) as well as running the unit tests.
- The UI has no automated tests. After wiring changes, load the page in a browser (serve the folder
  over HTTP) and click through a roster, a Monster match and a bracket to completion.

## Known issues

- Single elimination with exactly 2 teams throws (`it.todo` in `test/bracket-setup.test.js`).
- State lives only in React memory. A refresh loses the tournament.
- The live leaderboard fetch only works same-origin on calgaryfoosballclub.com. Elsewhere it
  falls back to `FALLBACK_LEADERBOARD_PLAYERS`.
- The admin PIN is hardcoded client-side and only guards against accidental edits.

## Git

- Remote: `git@github.com:DT209/foos-tourney.git`. Commit in small, described steps.
