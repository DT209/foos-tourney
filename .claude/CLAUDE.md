# Foos Tourney: guidance for Claude

Calgary Foosball Club tournament manager. See `README.md` for layout, deploy and commands.
See `.claude/Flow.md` for diagrams of how `tournament-logic.js` and the page fit together. Keep it in sync
when the module's flow changes. See `.claude/TournamentRules.md` for the competition rules the code
enforces (matchmaking, scoring, standings, brackets) and their known gaps. Keep it in sync when a rule changes.

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
- After changing `tournament-logic.js`, `firebase-config.js` or `firebase-remote.js`, run `npm run stamp`.
  The page loads them as `name.js?v=<first 10 hex of SHA-256>`, because the club host lets browsers cache
  `.js` for 31 days and a new page with a cached old script crashes ("x is not a function"). The build
  fails while a stamp is stale (`scripts/script-stamps.js`).
- `firebase-remote.js` is the only code that talks to Firebase. Keep it thin: decisions and write plans
  belong in `tournament-logic.js` (the Publishing section), and the adapter just runs them. Change
  `firestore.rules` and its tests together: the rules are the only server-side protection.

## Hard constraints

- **Never transpile, bundle or minify.** `dist/` must be byte-identical to the source files. The only
  difference is a name: the build ships `TournamentManager.html` as `dist/index.html`, so hosts serve it at
  the folder's address. Links are built from the current address, so never hard-code either name.
- Keep 100% statement, branch, function and line coverage on `tournament-logic.js` (unit tests) and
  `firebase-remote.js` (emulator tests). Cover new branches with tests. Don't add `c8 ignore` comments.
- `npm run build` must pass before committing: ESLint with zero warnings (including the inline JSX),
  Prettier, html-validate, the module contract, the cross-browser check, unit and UI coverage, the
  Firestore rules and adapter tests, and `npm audit`.
- The build's cross-browser check fails on APIs or CSS the `browserslist` targets don't support, and on
  secure-context-only APIs (`crypto.randomUUID`, `navigator.clipboard`, ...), which are missing on
  plain-http LAN pages. Fix the code. If a use is guarded with a fallback, mark it with
  `eslint-disable-next-line no-restricted-properties -- guarded: <fallback>`. CSS exceptions go in
  `IGNORED` in `scripts/check-css-compat.js`, each with a reason.
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
- UI tests never reach the real Firebase project: the harness sets `window.foosRemoteForTests = null`
  (publishing off) unless a test uses `openApp({ remote: true })`, which installs `test-e2e/fake-remote.js`
  instead. Assert on `app.remoteCalls()` to check exactly what was sent and when.
- Resize handles are tested with Chrome's real mouse (`page.mouse`), since synthetic pointer events
  hid problems before. The no-mouse rule above is about inputs only.
- To test plain-http LAN behaviour, remove secure-page APIs before load with `beforeLoad` (see
  `test-e2e/insecure-page.e2e.js`). The test server is 127.0.0.1, which browsers treat as secure.
- `test-firebase/` runs on the Firestore and Auth emulators (`npm run test:firebase`, Java 21+).
  `rules.fb.js` covers every allowed and denied rule case. `remote.fb.js` drives the adapter with the npm
  compat SDK. Use `--skip-firebase` where Java isn't available. The emulators use ports 8181 and 9199
  (`firebase.json`), so a local server on 8080 doesn't block them; tests read the addresses
  `emulators:exec` publishes.

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
- Display Mode renders `DisplayBoard` from `boardForTournament(state)`, for this device's tournament or
  one followed from Firebase. With publishing on it opens on `DisplayPicker` (`initialDisplaySource`): one
  click on a row shows it. **Export JSON** and **Export CSV** on a row download it without showing it: this
  device's through `exportTournament`, a published one through `publishedDownload`, which fetches it fresh and
  returns the stored JSON text unchanged (validated first) or a CSV built from it. The QR button (Lucide's
  `qr-code` icon, inlined with its ISC notice) on a row and in the board header appears only when
  `choiceViewerUrl` returns a link, and opens `QrDialog` for `choiceViewerUrl`, built from `window.location.href` (never a
  hard-coded host); `qrModules` and `qrSvgPath` turn the open-source `qrcode-generator` (pinned on
  jsDelivr with an SRI hash, `window.qrcode`) into SVG sized `80vmin`. UI tests decode the rendered code
  with `jsqr`. A
  window opened with `?display` or `?remote=<id>` must never save or publish: the auto-save and publish
  effects skip it, and it reloads the current tournament on `storage` events. Panel scrolling is the `nextAutoScroll` state machine, driven by a
  timer in `AutoScroll`. Display styles live in the `.db` CSS block in the HTML head and use only
  relative units (`em`, `vw`/`vh`); px appears only as the font-size floor and ceiling in `clamp()`.
  Keep them relative. `displayLayout` is `{ arrangement: 'top' | 'left' | 'stacked', tables, standings }`
  (`foosTourney.displayLayout`, a browser preference, not tournament data). Fractions reach the grid as CSS
  variables, and `data-arrangement` picks the grid. `splitDirections` says which way each handle drags.
  Other windows follow layout changes through `storage` events (`isDisplayLayoutKey`), and `?layout=`
  links (`layoutParam`, `layoutFromSearch`) carry it to other devices. Below 48em everything stacks.
- `finishedAt` (persisted, exported, published) marks a finished tournament. `tournamentEditLock` returns
  `'finished'` before `'readOnly'` or `'pin'`, so nothing on the page lifts it; the admin-lock buttons are hidden
  and only New Tournament, Saved Tournaments, Import, Take Over and the exports stay available. Gate any new
  editing control on `editingLocked`, and any "leave this tournament" control on `canLeaveTournament`.
- Publishing state is `foosTourney.publishing` (`{ tournamentId, slot, code }`, one per browser), never part of
  a tournament or its export. The published copy is the Export JSON text from `publishedExport`, with the PIN
  and lock blanked. Firestore can't store the bracket's nested arrays, so it is a string, not a map. Only
  `watchedSections` changes trigger a write.
- Downloads go through `downloadText`, which percent-encodes the whole payload. `encodeURI` leaves `#`,
  which truncates `data:` URLs.
- Saved state is JSON, so object identity isn't preserved across a reload. Compare players and teams
  by `id`, never by reference.

## Known limitations

These match the README's Tournaments, Admin lock and Club leaderboard sections. Keep both in sync.

Open bugs are tracked as GitHub issues (https://github.com/DT209/foos-tourney/issues); the README links
there. When you fix one, add a regression test and close the issue in the commit message (`Fixes #N`).

- Tournaments are saved in one browser's `localStorage` only. Publishing shares a read-only copy of the
  tournament started with New Tournament, but editing stays on one browser at a time (take-over moves it).
  Private browsing or blocked site data disables saving, and the footer says so.
- On a plain-http LAN address (e.g. `http://192.168.0.22:8080`) the browser has no clipboard, so **Copy**
  buttons report that copying failed. HTTPS hosting has no such limit.
- The admin PIN is stored in the browser and only guards against accidental edits. **Forgot PIN?**
  unlocks after a confirm.
- The live leaderboard only loads when the page is served from calgaryfoosballclub.com (CORS).
  Elsewhere the page uses the bundled snapshot and shows its date. `npm run refresh-leaderboard`
  updates it. Live data on another host needs the club site to send `Access-Control-Allow-Origin`
  for that host on `/leaderboard/`.
- Publishing uses the `foos-tourney` Firebase project (`firebase-config.js`, `.firebaserc`). Setting the
  config to `null` turns it off: no Firebase requests, Display Mode skips the tournament list, **From
  Firebase** is disabled. UI tests always run with it off or faked. After changing `firestore.rules`, deploy
  with `npx firebase-tools@15.32.1 deploy --only firestore:rules`. Published data is readable by anyone.
- Publishing has no CAPTCHA or App Check, so a script minting anonymous ids could hold slots. See the
  plan's risks.
- UI tests need Chrome and network access (React, Babel and Tailwind load from CDNs). Use
  `npm run build -- --skip-e2e` where either is missing.
