# Foos Tourney: guidance for Claude

Calgary Foosball Club tournament manager. See `README.md` for layout, deploy and commands.
See `.claude/Flow.md` for diagrams of how `tournament-logic.js` and the page fit together. Keep it in sync
when the module's flow changes.

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
- UI tests live in `test-e2e/` (puppeteer-core + `node:test`). `harness.js` serves the repo, drives
  the page, freezes the clock with `setClock()` (e.g. to cross midnight), and captures CSV downloads.
  Add a UI test for any user-visible change. Prefer `data-testid` hooks over styling classes.
- The build requires 100% UI function coverage: every component, handler and inline callback in the
  Babel block must run in some UI test. `npm run test:e2e && npm run coverage:ui` lists any that never
  ran, by line in the compiled script.
- Fill inputs with `app.fill()` (sets the value and fires `input`, the way React sees typing). Don't
  use Puppeteer mouse clicks on inputs: they can hang when a card re-renders. Use real keyboard typing
  only when keystroke behaviour is what's under test.
- The page renders in `React.StrictMode`, so effects mount, clean up and mount again in development.
  Effects must be safe to run twice.

## Tournaments and persistence

- Tournaments are identified by `tournamentId` (UUID from `createTournamentId`), never by date. Events
  run past midnight. Display and export dates come from `tournamentDate(startedAt)`, which uses local
  time. Don't use `toISOString()` dates for this, because they're UTC.
- Each tournament is stored at `foosTourney.tournament.<uuid>`, and `foosTourney.currentTournament`
  points at the active one. `foosTourney.tournament` (no suffix) is the legacy v1 slot, migrated by
  `loadCurrentTournament`.
- To add persisted state: add the field and its default to `newTournamentState`, add a validator to
  `FIELD_VALIDATORS` if its type differs from the default's, add it to `applyTournament` and the
  auto-save effect (object and dependency list) in the component, and cover it in `test/persistence.test.js`.
- Bump `STORAGE_VERSION` only for incompatible shape changes, and add a migration when you do.
- Export files use `EXPORT_FORMAT`/`EXPORT_VERSION` (`serializeTournamentExport`,
  `parseTournamentExport`). Bump `EXPORT_VERSION` for incompatible changes. Newer files are rejected,
  older ones must keep importing.
- Imports never switch the current tournament (`storeImportedTournament` writes the record only). The
  read-only view swaps the on-screen state, pauses auto-save, and restores the previous state on Close
  View.
- Downloads go through `downloadText`, which percent-encodes the whole payload. `encodeURI` leaves `#`,
  which truncates `data:` URLs.
- Saved state is JSON, so object identity isn't preserved across a reload. Compare players and teams
  by `id`, never by reference.

## Known limitations

These match the README's Tournaments, Admin lock and Club leaderboard sections. Keep both in sync.

Open bugs are tracked as GitHub issues (https://github.com/DT209/foos-tourney/issues); the README links
there. When you fix one, add a regression test and close the issue in the commit message (`Fixes #N`).

- Tournaments are saved in one browser's `localStorage` only, not shared across devices or
  organizers. Private browsing or blocked site data disables saving, and the footer says so.
- The admin PIN is stored in the browser and only guards against accidental edits. **Forgot PIN?**
  unlocks after a confirm.
- The live leaderboard only loads when the page is served from calgaryfoosballclub.com (CORS).
  Elsewhere the page uses the bundled snapshot and shows its date. `npm run refresh-leaderboard`
  updates it. Live data on another host needs the club site to send `Access-Control-Allow-Origin`
  for that host on `/leaderboard/`.
- Importing from Firebase is a placeholder: the import dialog lists it, disabled, as "coming soon".
  Reading a tournament from remote storage in read-only mode is also not built yet. Today a file
  plays that role.
- UI tests need Chrome and network access (React, Babel and Tailwind load from CDNs). Use
  `npm run build -- --skip-e2e` where either is missing.
