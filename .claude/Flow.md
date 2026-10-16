# Flow: how `tournament-logic.js` works

For developers and AI assistants. Update this file when the module's flow changes. Conventions
are in [`CLAUDE.md`](CLAUDE.md), user-facing features in [`../README.md`](../README.md).

## 1. Architecture

```mermaid
flowchart LR
    subgraph Browser
        H["TournamentManager.html"] -->|"script tag"| M["tournament-logic.js"]
        M -->|"sets globalThis.TournamentLogic"| G["window.TournamentLogic"]
        G -->|"destructured at top of Babel block"| A["FoosballApp state (useState)"]
        A -->|"user event"| HD["Handler"]
        HD -->|"calls pure function"| F["Module function"]
        F -->|"new state or error"| HD
        HD -->|"setState"| A
        A -->|"render"| UI["UI"]
        A -->|"auto-save effect"| LS[("localStorage")]
    end
    T["Node tests in test/"] -->|"require the same file"| M
```

The module is a classic script, not an ES module. Non-determinism (`random`, ids, `fetchImpl`,
`doc`, `now`) is passed in as parameters, so tests control it.

## 2. Page load

```mermaid
sequenceDiagram
    participant C as FoosballApp
    participant M as TournamentLogic
    participant S as localStorage
    C->>M: getBrowserStorage()
    M-->>C: storage or null
    C->>M: loadCurrentTournament(storage)
    M->>S: getItem(foosTourney.currentTournament)
    alt pointer set
        M->>S: read foosTourney.tournament.uuid
        M-->>C: saved state or null
    else no pointer
        M->>S: read legacy foosTourney.tournament (v1)
        M-->>C: migrated state, or null
    end
    C->>M: restoreTournamentState(saved, id, now)
    Note over M: each field kept only if isValidField, else default from newTournamentState
    M-->>C: full state
    C->>C: useState initial values from restored
    C->>M: recentTournamentPlayers(storage, tournamentId) in useMemo
    M->>S: read saved records, 3 most recently started, not the current one
    M-->>C: recent players
    C->>M: fetchLeaderboardPlayers() in an effect
    alt fetch succeeds
        M-->>C: live players, status live
    else fails (CORS, offline)
        C->>C: keep FALLBACK_LEADERBOARD_PLAYERS, status cached
    end
    C->>M: withRecentPlayers(leaderboardPlayers, recentPlayers) on each render
    M-->>C: knownPlayers
```

`migrateLegacyTournament` assigns a new UUID, turns `startDate` into a local-midnight
`startedAt`, saves under the new key and removes the legacy key.

## 3. Handler pattern

```mermaid
flowchart TD
    E["User event"] --> H["Handler in FoosballApp"]
    H --> F["Module function with current state"]
    F --> R{"Result"}
    R -- "{ error }" --> AL["alert(result.error)"]
    R -- "new state" --> SS["setPlayers, setMatches, setBracketData"]
    SS --> RN["Re-render"]
    RN --> AS["Auto-save effect"]
```

Exceptions to know about:

```mermaid
flowchart TD
    B1["updateBracketGameScore, setBracketHandicap, setBracketOverrideWinner, confirmBracketMatch"] --> B2["Mutate match objects inside the bracket"]
    B2 --> B3["Return a shallow copy: { ...bracket }"]
    B3 --> B4["setBracketData(copy) triggers render"]
    R1["Render body"] --> R2["assignBracketTables(bracketData, tableCount)"]
    R2 --> R3["Mutates match.table during render, sticky once set"]
    R3 --> R4["Auto-save persists the tables"]
```

## 4. Matchmaking: `drawFairMatch`

`drawMonsterMatch` finds a table with `findFreeTable`, calls `drawFairMatch`, then builds the match
with `createGameSlots`.

```mermaid
flowchart TD
    S["drawFairMatch(players, matches, format, random)"] --> V{"Arrays valid?"}
    V -- No --> E1["{ error }"]
    V -- Yes --> BZ["busyPlayerIds: players in LIVE matches"]
    BZ --> AV["Available pool: active and not busy"]
    AV --> N{"Enough players? 4 for 2v2, 2 for 1v1"}
    N -- No --> E2["{ error: Not enough available players }"]
    N -- Yes --> HM["buildHistoryMatrices: partner and opponent counts"]
    HM --> P1["p1: pickLowestPenalty with no pair penalty"]
    P1 --> FM{"format"}
    FM -- "1v1" --> Q1["p2: opponent penalty vs p1"]
    FM -- "2v2" --> Q2["p2: teammate penalty vs p1"]
    Q2 --> Q3["p3: opponent penalty vs p1 and p2"]
    Q3 --> Q4["p4: teammate penalty vs p3 plus opponent penalty vs p1 and p2"]
    Q1 --> UP["Update eligibleDrawsMissed"]
    Q4 --> UP
    UP --> OUT["{ team1, team2, updatedPlayers }"]
```

`pickLowestPenalty` scores each candidate:

```mermaid
flowchart LR
    C["Candidate"] --> T["pair penalty: count squared times weight"]
    T --> SC["total"]
    U["minus eligibleDrawsMissed times W_UNLUCKY (80)"] --> SC
    RN["plus random noise below MAX_RANDOM_NOISE (50)"] --> SC
    SC --> LW["Lowest total wins"]
```

Weights: `W_TEAMMATE` 300, `W_OPPONENT` 100. Drawn players reset `eligibleDrawsMissed` to 0. Active,
idle, undrawn players gain 1.

## 5. Bracket lifecycle

```mermaid
flowchart TD
    CB["createBracket(...)"] --> VAL{"teamCount at least 2 and enough ranked players?"}
    VAL -- No --> ER["{ error }"]
    VAL -- Yes --> BT["buildBracketTeams: formation, then seeding"]
    BT --> GS["generateBracketStructure(teams, elimType, maxGames)"]
    GS --> SP["getStandardBracketSeedPositions, BYE slots for missing teams"]
    SP --> ST["winnersRounds, plus losersRounds, grandFinals, thirdPlaceMatch by type"]
    ST --> PLAY["Play: confirmBracketMatch(bracket, section, rIdx, mIdx)"]
    PLAY --> W{"getMatchWinner"}
    W -- none --> ER2["{ error }"]
    W -- winner --> SEC{"section"}
    SEC -- winners --> AW["advanceWinnersBracket"]
    SEC -- losers --> AL["advanceLosersBracket"]
    SEC -- grandFinals --> GR["addGrandFinalResetIfNeeded"]
    AW --> FIN["isBracketFinished"]
    AL --> FIN
    GR --> FIN
    FIN -- No --> PLAY
    FIN -- Yes --> CS["isCompleted = true, calculateBracketStandings"]
```

`advanceWinnersBracket` runs three steps:

```mermaid
flowchart LR
    AW["advanceWinnersBracket"] --> U["advanceWinnerUpward: next Winners round or Grand Finals"]
    AW --> TP["dropToThirdPlace: single elimination semi-final losers"]
    AW --> LB["dropToLosersBracket: double and championship losers"]
    LB --> BY["processLoserBracketByes"]
```

`advanceLosersBracket` calls `advanceLoserWinner`, sends the Losers champion to Grand Finals
(double only), then calls `processLoserBracketByes`. `resetBracket` rebuilds from
`originalTeams` for **Clear Matches**.

## 6. Persistence and import/export

```mermaid
flowchart TD
    subgraph Keys
        K1["foosTourney.tournament.uuid: one record per tournament"]
        K2["foosTourney.currentTournament: pointer to the active uuid"]
        K3["foosTourney.tournament: legacy v1 slot, migrated then removed"]
    end
    AE["Auto-save effect"] -->|"skipped while readOnlyView is set"| SV["saveTournament"]
    SV --> WR["writeTournamentRecord: version, savedAt, persistedFields"]
    SV --> PT["set currentTournament pointer"]
    WR --> K1
    PT --> K2
    RR["readTournamentRecords: skips corrupt records"] --> K1
    LT["listTournaments"] --> RR
    RP["recentTournamentPlayers"] --> RR
    DT["deleteTournament"] --> K1
    DT -->|"if current"| K2
    EXP["serializeTournamentExport, tournamentExportFileName, downloadText"] --> FILE[".json file"]
    FILE --> PARSE["parseTournamentExport: format, version, id, invalidFields"]
    PARSE -->|"any invalid field"| REJ["{ error } naming the field"]
    PARSE --> RV{"Import dialog"}
    RV -- "importIntoSaved(add, replace, copy)" --> ST["storeImportedTournament: writeTournamentRecord only"]
    ST --> K1
    RV -- "viewReadOnly" --> RO["applyTournament(imported), readOnlyView = { name, previous }"]
    RO -->|"closeReadOnlyView"| PR["applyTournament(previous)"]
```

`restoreTournamentState` falls back to the default for an invalid saved field, and loads a tournament
that is locked without a PIN as unlocked. `storeImportedTournament` never changes the current pointer. Replacing the open tournament calls
`applyTournament` so the next auto-save doesn't overwrite the import. `saveTournament` returns
`false` when storage throws, and the footer then shows that saving is off.

## 7. Adding players

```mermaid
flowchart TD
    LB["leaderboardPlayers: live fetch or fallback snapshot"] --> KP["knownPlayers = withRecentPlayers(leaderboard, recent)"]
    RC["recentPlayers: recentTournamentPlayers, memoized"] --> KP
    KP -->|"recent players not on the leaderboard get recent: true"| USE{"Where"}
    USE -- "typing" --> SUG["getPlayerSuggestions(knownPlayers, text)"]
    USE -- "Add Player submit" --> CHK["checkNewPlayerName(text, players, knownPlayers)"]
    CHK -->|"blank or duplicate"| ERR["alert(error)"]
    CHK -->|"onLeaderboard true: leaderboard or recent"| ADD["addPlayer(players, Date.now(), name)"]
    CHK -->|"onLeaderboard false"| GC["Guest confirm: Add Anyway"]
    GC --> ADD
    USE -- "Add from Leaderboard" --> PV["getLeaderboardPickerView(players, knownPlayers, selection)"]
    PV --> ROWS["Leaderboard rows, then a Recent players section (rows with recent)"]
    ROWS --> APN["addPlayersByName(players, selection, Date.now())"]
```

Renames go through `renamePlayer`, which returns `{ error }` for a name another player already has,
so the roster never holds two players with the same name (case-insensitive).

## 8. Display Mode

```mermaid
flowchart TD
    BTN["Display Mode button: setDisplayMode(true)"] --> RENDER
    URL["Page opened with ?display: isDisplayModeUrl"] --> DW["isDisplayWindow: auto-save skipped"]
    DW --> RENDER["FoosballApp returns DisplayBoard early"]
    RENDER --> BB["buildDisplayBoard(matches, assignBracketTables result, tableCount, players, completed matches)"]
    BB --> T["tables: live Monster match first, else bracket assignment, else Free"]
    BB --> S["standings: computeStandings ranks"]
    BB --> H["history: getCompletedMatchesList, newest first, formatHistoryRow"]
    T --> AS["AutoScroll panels: nextAutoScroll every 50 ms"]
    S --> AS
    H --> AS
    DW --> SE["storage event for a tournament key (isTournamentStorageKey): reload and applyTournament"]
    SE --> RENDER
    RENDER --> SP["Splitter handles: splitFromPointer on drag, nudgeSplit on arrow keys, default on double-click"]
    SP --> LY["displayLayout state, fractions clamped to 20-80%"]
    LY -->|"--db-left / --db-right / --db-top / --db-bottom CSS variables"| RENDER
    LY --> SV["saveDisplayLayout: foosTourney.displayLayout, a browser preference"]
```

The layout is loaded with `loadDisplayLayout` (invalid values fall back per value). Drag listeners
attach to `window`, so a drag keeps going outside the handle. Portrait screens hide the handles and
stack the panels.

`nextAutoScroll` cycles top pause, scroll, bottom pause, back to top. The step is 0.4% of the panel's
height per tick, so speed scales with the screen. Content that fits never moves, and
`prefers-reduced-motion` disables the timer.

## Module sections and main functions

| Section in `tournament-logic.js` | Main functions                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security and sanitization        | `sanitizeInput`, `sanitizeTypedText`, `sanitizeInt`, `normalizeScoreInput`                                                                                                                                                                |
| Admin lock                       | `submitPin`, `forgetPin`                                                                                                                                                                                                                  |
| Tournaments and persistence      | `newTournamentState`, `restoreTournamentState`, `saveTournament`, `loadCurrentTournament`, `listTournaments`, `recentTournamentPlayers`, `withRecentPlayers`, `deleteTournament`                                                          |
| Export and import                | `serializeTournamentExport`, `parseTournamentExport`, `storeImportedTournament`, `getBrowserStorage`                                                                                                                                      |
| Display mode                     | `buildDisplayBoard`, `initialAutoScroll`, `nextAutoScroll`, `isDisplayModeUrl`, `displayModeUrl`, `controlDeskUrl`, `tournamentCsv`, `splitFromPointer`, `nudgeSplit`, `loadDisplayLayout`, `saveDisplayLayout`, `isTournamentStorageKey` |
| Club leaderboard                 | `fetchLeaderboardPlayers`, `getLeaderboardInfo`, `FALLBACK_LEADERBOARD_PLAYERS`                                                                                                                                                           |
| Roster                           | `checkNewPlayerName`, `addPlayer`, `addPlayersByName`, `computeStandings`, `getLeaderboardPickerView`, `getPlayerSuggestions`                                                                                                             |
| Fair matchmaking                 | `drawFairMatch`, `pickLowestPenalty`, `buildHistoryMatrices`                                                                                                                                                                              |
| Monster stage matches            | `drawMonsterMatch`, `findFreeTable`, `completeMonsterMatch`, `getMatchWinner`                                                                                                                                                             |
| Bracket generation               | `createBracket`, `buildBracketTeams`, `generateBracketStructure`, `buildManualTeams`, `clearMatchResults`                                                                                                                                 |
| Bracket play                     | `confirmBracketMatch`, `advanceWinnersBracket`, `advanceLosersBracket`, `isBracketFinished`, `calculateBracketStandings`, `assignBracketTables`                                                                                           |
| History and CSV                  | `getCompletedMatchesList`, `formatHistoryRow`, `buildCsv`, `csvFileName`, `downloadText`, `downloadCsv`                                                                                                                                   |
