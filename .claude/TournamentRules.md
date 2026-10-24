# Tournament rules: quick reference

For AI assistants deciding how to change the software. Lists the competition rules the code enforces, where
each lives, and the gaps. Conventions are in [`CLAUDE.md`](CLAUDE.md), flow diagrams in [`Flow.md`](Flow.md).
Line numbers drift: search by function name. Update this file when a rule changes.

## Shape of an event

1. **Setup**: name, Tables Available (1-10), format (`2v2` or `1v1`), Monster best-of (1, 3, 5, 7).
2. **Monster / DYP open play**: draw fair random matches onto free tables, score them, repeat.
3. **Brackets**: the Monster standings feed a single, double or championship elimination bracket.
4. **Standings**: bracket places 1-3 (single also 4th).

One format applies to the whole event: Monster and bracket both use `format`.

## Rules by area

### Roster (`ROSTER` section)

| #   | Rule                                                                                                                     | Code                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| R1  | Names are 1-25 chars after trimming and stripping `<` `>`.                                                               | `sanitizeInput`, `PLAYER_NAME_MAX_LENGTH` |
| R2  | Names are unique, case-insensitive, on add and rename.                                                                   | `checkNewPlayerName`, `renamePlayer`      |
| R3  | A name not on the club leaderboard (or recent players) is a guest and needs a confirm.                                   | `checkNewPlayerName` → `onLeaderboard`    |
| R4  | New players start active, unpaid, 0 W/L/GF/GA, `eligibleDrawsMissed` 0.                                                  | `createPlayer`                            |
| R5  | **Paid** is bookkeeping only: no rule reads it.                                                                          | `togglePlayerFlag`                        |
| R6  | **Active/Paused** only gates Monster draws. Paused players still rank and still enter the bracket draw (the page warns). | `drawFairMatch`, paused-warning modal     |
| R7  | Removing a player keeps their past matches (teams hold copies).                                                          | `removePlayer`                            |

### Monster matchmaking (`drawFairMatch`, `pickLowestPenalty`)

| #   | Rule                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | A match needs a free table: lowest-numbered table with no LIVE **Monster** match (`findFreeTable`).                                              |
| M2  | Eligible pool: active players not in a LIVE match. Need 4 (2v2) or 2 (1v1).                                                                      |
| M3  | Picks are greedy, in order. p1: lowest score with no pair penalty. 2v2: p2 = p1's partner, p3 and p4 opponents, p4 = p3's partner.               |
| M4  | Score = pair penalty − `eligibleDrawsMissed` × 80 + noise in [0, 50). Lowest wins.                                                               |
| M5  | Pair penalty = count² × weight. Partner repeats weigh 300, opponent repeats 100. Squared, so repeats escalate.                                   |
| M6  | History counts LIVE and DONE Monster matches only. Bracket matches never count.                                                                  |
| M7  | Fairness of play time: drawn players reset `eligibleDrawsMissed` to 0; eligible players not drawn get +1. Busy and paused players are unchanged. |
| M8  | Deleting a LIVE match frees the table but does not undo M7 counters.                                                                             |

### Scoring a match (shared by Monster and bracket: `getMatchWinner`)

| #   | Rule                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- |
| S1  | Best of N: a team wins at `ceil(N/2)` game wins. N is fixed at draw time (`createGameSlots`).               |
| S2  | A game counts only when both scores are integers and differ. No target score (first to 5 etc.) is enforced. |
| S3  | Score inputs are non-negative integers or blank (`normalizeScoreInput`).                                    |
| S4  | **Handicap** override: ticking it defaults the winner to Team 1. The chosen team wins regardless of scores. |
| S5  | A match can't be finished/confirmed without a winner.                                                       |

### Monster standings (`completeMonsterMatch`, `computeStandings`)

| #   | Rule                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Each player on the match gets one **match** win or loss (not per game).                                                                              |
| L2  | GF/GA add every typed goal in the match, from that player's side.                                                                                    |
| L3  | Rank by win % (wins / matches), then average goal diff per match. 1 decimal place, so ties compare rounded values. Remaining ties keep roster order. |
| L4  | Bracket results never change player W/L/GF/GA or Monster standings.                                                                                  |
| L5  | **Clear Matches** deletes Monster matches, zeroes stats, rebuilds the bracket from its original teams.                                               |

### Bracket creation (`createBracket`, `buildBracketTeams`)

| #   | Rule                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Team count ≥ 2. Need `teams × 2` (2v2) or `teams` (1v1) ranked players.                                                                                                                                                                             |
| B2  | Qualifiers are always the top of the **Monster standings**, whatever the seeding strategy. Includes paused players.                                                                                                                                 |
| B3  | 2v2 team formation: **fair** 1st+Nth, 2nd+(N−1)th; **topBias** 1+2, 3+4; **topBottomRandom** top half each with a random bottom-half player; **random**; **manual** (pre-filled 1+2, 3+4, candidates are the top `teams × 2`). 1v1 skips formation. |
| B4  | Seeding **ranking**: player value `2^((N − rank)/5)`, team = sum. **elo**: club leaderboard ELO (doubles or singles), guests/unranked 1000, team = 0.6 × higher + 0.4 × lower. **random**: shuffle. Higher value = higher seed.                     |
| B5  | Bracket size is the next power of 2. Standard seed placement (1 v N, 2 v N−1, ...). Empty slots are BYEs, which go to the top seeds.                                                                                                                |
| B6  | BYE matches resolve at creation. In double/championship the BYE "loser" drops to the Losers Bracket and is auto-resolved there.                                                                                                                     |
| B7  | Bracket best-of is set separately from Monster best-of (`bracketMaxGames`).                                                                                                                                                                         |

### Bracket play (`confirmBracketMatch` and helpers)

| #   | Rule                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Match states: PENDING (team unknown) → READY (both real teams) → DONE.                                                                                                                                                                                                                     |
| P2  | **Single**: winners advance. Semi-final losers play a 3rd/4th Place Match (if ≥ 4-slot bracket). Final = "Grand Finals".                                                                                                                                                                   |
| P3  | **Double**: Winners losers drop to the Losers Bracket. Round 1 losers pair in order; later drops are mirrored (`length − 1 − mIdx`) to avoid an immediate rematch. Losers champion meets Winners champion in Grand Finals. If the Losers champion (team 2) wins GF1, a reset GF2 is added. |
| P4  | **Championship**: like double, but the last Winners round **is** the Grand Final (1st/2nd), its loser does not drop, and the Losers Bracket final is the 3rd Place Match. Losers Bracket has one fewer round.                                                                              |
| P5  | Losers Bracket rounds alternate: even (0-indexed) rounds take drop-ins 1:1 into team2, odd rounds halve.                                                                                                                                                                                   |
| P6  | Finished: single = final and 3rd place done; double = last GF done; championship = Winners final and Losers final done.                                                                                                                                                                    |
| P7  | Places: single 1-4; double 1-3 (3rd = Losers final loser); championship 1-3 (3rd = Losers final winner). No 5th+ places.                                                                                                                                                                   |
| P8  | Tables: playable matches take the lowest free table, in list order (Winners, Losers, GF, 3rd). Once set, a match keeps its table until DONE (`assignBracketTables`, runs during render).                                                                                                   |
| P9  | Monster and bracket tables are tracked separately. On the display a LIVE Monster match on a table hides that table's bracket match.                                                                                                                                                        |
| P10 | Results can't be edited after confirm. **Clear Matches** is the only undo.                                                                                                                                                                                                                 |

### Other constraints that touch rules

- The admin lock (4-8 digit PIN) disables editing. It is a guard, not security.
- Persisted fields and validators (`newTournamentState`, `FIELD_VALIDATORS`) bound the rule settings: changing an allowed value (e.g. best-of 9, new strategy) means updating the validator, the `<option>` lists, export compatibility, and `test/persistence.test.js`.
- Settings (tables, format, best-of) can be changed mid-event. Existing matches keep their game slots and format.

## Known gaps (open GitHub issues)

| Issue | Rule affected                                                          |
| ----- | ---------------------------------------------------------------------- |
| #1    | P1/S5: a bracket match with a TBD team can be confirmed.               |
| #2    | B5/P6: 3-team single elimination never finishes, lists BYE 3rd.        |
| #3    | B3: manual pairings aren't validated (duplicates, empty teams).        |
| #4    | M1/P8: lowering Tables Available hides live matches on removed tables. |
| #5    | S4: handicap wins with no scores are missing from the CSV.             |
| #6    | B6: automatic BYE wins appear in Match History and the count.          |
| #7    | L2/S2: partial or tied games still add to GF/GA.                       |
| #8    | S1: with an even game count, a tie goes to Team 1.                     |
| #9    | L3: players with 0 games rank above players at 0%.                     |
| #10   | New Tournament resets every setting.                                   |
| #11   | B2/R6: paused players can qualify for the bracket.                     |
| #12   | P9: Monster and bracket matches can share a table.                     |
| #13   | M8: deleting a LIVE match doesn't undo the M7 counters.                |
| #14   | Changing `format` mid-event mixes 1v1 and 2v2 results.                 |

Not filed: no undo for a confirmed bracket match (P10).

## Deciding where a change goes

- **New rule or rule change**: `tournament-logic.js`, in the section named above. The page only wires it.
- **New setting**: persisted-state checklist in `CLAUDE.md`, plus the bracket modal or setup card.
- **Bracket structure** (`generateBracketStructure`, advance helpers): drive whole tournaments with `playOut()` in
  `test/bracket-play.test.js` for every type and several team counts (including non-powers of 2), and assert on
  standings.
- **Matchmaking weights**: inject `random` with `seq()`; compare old and new on seeded random inputs.
- **Bracket match shape**: saved and exported data must still pass `isBracketMatch`/`isBracket`, or bump versions
  with a migration.
- Fixing an issue above: regression test plus `Fixes #N` in the commit.
