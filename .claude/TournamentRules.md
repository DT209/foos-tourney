# Tournament rules: quick reference

For AI assistants deciding how to change the software. Lists the competition rules the code enforces, where
each lives, and the gaps. Conventions are in [`CLAUDE.md`](CLAUDE.md), flow diagrams in [`Flow.md`](Flow.md).
Line numbers drift: search by function name. Update this file when a rule changes.

## Shape of an event

1. **Setup**: name, Tables Available (1-10), format (`2v2` or `1v1`), Monster best-of (1, 3, 5, 7).
2. **Monster / DYP open play**: draw fair random matches onto free tables, score them, repeat.
3. **Brackets**: the Monster standings feed a single, double or championship elimination bracket.
4. **Standings**: bracket places 1-3. Single elimination also computes 4th, which the page doesn't show (intended).
5. **Finish**: when the bracket completes, the organizer is asked whether the tournament is done. Finishing
   makes it read-only on the page for good (see P11).

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

| #   | Rule                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Best of N: a team needs a strict majority of the N games (more than N/2), so an even split or no games has no winner. N is fixed at draw time (`createGameSlots`). |
| S2  | A game counts toward the winner only when both scores are integers and differ. No target score (first to 5 etc.) is enforced.                                      |
| S3  | Score inputs are non-negative integers or blank (`normalizeScoreInput`).                                                                                           |
| S4  | **Handicap** override: ticking it defaults the winner to Team 1. The chosen team wins regardless of scores.                                                        |
| S5  | A match can't be finished/confirmed without a winner.                                                                                                              |

### Monster standings (`completeMonsterMatch`, `computeStandings`)

| #   | Rule                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Each player on the match gets one **match** win or loss (not per game).                                                                                                                         |
| L2  | GF/GA add the goals of every game with both scores entered (ties included), from that player's side: the same games Match History and the CSV show.                                             |
| L3  | Players with no matches rank last. Others rank by win % (wins / matches), then goal diff per match, compared exactly (the 1-decimal values are display only). Remaining ties keep roster order. |
| L4  | Bracket results never change player W/L/GF/GA or Monster standings.                                                                                                                             |
| L5  | **Clear Matches** deletes Monster matches, zeroes stats, rebuilds the bracket from its original teams.                                                                                          |

### Bracket creation (`createBracket`, `buildBracketTeams`)

| #   | Rule                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Team count ≥ 2. Need `teams × 2` (2v2) or `teams` (1v1) ranked players. **Teams are never uneven**: every 2v2 team has two players and every 1v1 team one, in every formation strategy including manual, because standings and the ranking systems built on them assume equal team sizes. Don't flag the `teams × 2` check as too strict.  |
| B2  | Qualifiers are always the top of the **Monster standings**, whatever the seeding strategy. Includes paused players.                                                                                                                                                                                                                        |
| B3  | 2v2 team formation: **fair** 1st+Nth, 2nd+(N−1)th; **topBias** 1+2, 3+4; **topBottomRandom** top half each with a random bottom-half player; **random**; **manual** (pre-filled 1+2, 3+4, candidates are the top `teams × 2`; every team needs exactly two players and each player is used once, `manualTeamsError`). 1v1 skips formation. |
| B4  | Seeding **ranking**: player value `2^((N − rank)/5)`, team = sum. **elo**: club leaderboard ELO (doubles or singles), guests/unranked 1000, team = 0.6 × higher + 0.4 × lower. **random**: shuffle. Higher value = higher seed.                                                                                                            |
| B5  | Bracket size is the next power of 2. Standard seed placement (1 v N, 2 v N−1, ...). Empty slots are BYEs, which go to the top seeds.                                                                                                                                                                                                       |
| B6  | BYE matches resolve at creation. In double/championship the BYE "loser" drops to the Losers Bracket and is auto-resolved there.                                                                                                                                                                                                            |
| B7  | Bracket best-of is set separately from Monster best-of (`bracketMaxGames`).                                                                                                                                                                                                                                                                |

### Bracket play (`confirmBracketMatch` and helpers)

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Match states: PENDING (team unknown) → READY (both real teams) → DONE. Only a match with two real teams can be confirmed; the card shows no scores until then.                                                                                                                                                                                                                                                                    |
| P2  | **Single**: winners advance. Semi-final losers play a 3rd/4th Place Match (4+ teams; with 3 teams one semi-final is a BYE and the other's loser is 3rd). Final = "Grand Finals".                                                                                                                                                                                                                                                  |
| P3  | **Double**: Winners losers drop to the Losers Bracket. Round 1 losers pair in order; later drops are mirrored (`length − 1 − mIdx`) to avoid an immediate rematch. Losers champion meets Winners champion in Grand Finals. If the Losers champion (team 2) wins GF1, a reset GF2 is added.                                                                                                                                        |
| P4  | **Championship**: like double, but the last Winners round **is** the Grand Final (1st/2nd), its loser does not drop, and the Losers Bracket final is the 3rd Place Match. Losers Bracket has one fewer round.                                                                                                                                                                                                                     |
| P5  | Losers Bracket rounds alternate: even (0-indexed) rounds take drop-ins 1:1 into team2, odd rounds halve.                                                                                                                                                                                                                                                                                                                          |
| P6  | Finished: single = final and 3rd place done; double = last GF done; championship = Winners final and Losers final done.                                                                                                                                                                                                                                                                                                           |
| P7  | Places: single 1-4 (the page shows 1-3); double 1-3 (3rd = Losers final loser); championship 1-3 (3rd = Losers final winner). No 5th+ places.                                                                                                                                                                                                                                                                                     |
| P8  | Tables: playable matches take the lowest free table, in list order (Winners, Losers, GF, 3rd). Once set, a match keeps its table until DONE (`assignBracketTables`, runs during render). Lowering Tables Available asks first when a bracket match is on a removed table, then frees it to take the next free table (`checkTableCountChange`, `releaseBracketTables`); a LIVE Monster match on a removed table blocks the change. |
| P9  | Monster and bracket tables are tracked separately. On the display a LIVE Monster match on a table hides that table's bracket match.                                                                                                                                                                                                                                                                                               |
| P10 | A confirmed result can be corrected only through an admin edit (C3, C4). **Clear Matches** still undoes everything.                                                                                                                                                                                                                                                                                                               |
| P11 | **Finishing** (`canFinishTournament`, `finishTournament`, `tournamentEditLock`): offered only once the bracket is complete, and not while the admin lock is on. It sets `finishedAt`; the tournament is then read-only on the page for good (the PIN can't lift it, and Clear Matches is disabled). Corrections go through Export JSON, editing the file (`finishedAt: null` reopens it) and Import with Replace Saved Copy.      |

### Corrections (admin: `authorizeAdminAction` and the CORRECTIONS section)

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Every edit or substitution asks for the admin PIN, even unlocked (no PIN yet: the entry becomes the PIN). Allowed under the admin lock; not on a finished tournament or a read-only copy (`canCorrect` in the page).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C2  | Only finished matches are edited. Bracket matches decided by a BYE aren't editable. Edits set `editedAt`, shown as "✎ edited".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C3  | **Monster edit** (`editMonsterMatch`): scores, override and who played. It needs a winner and distinct players. Player W/L/GF/GA are then rebuilt from all DONE Monster matches (`recomputePlayerStats`, same credit rule as L1/L2); `eligibleDrawsMissed` is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C4  | **Bracket edit** (`editBracketMatch`, `replayBracket`): rebuild from `originalTeams` and replay every confirmed result with the edit in its place. Fixing scores with the same winner is always allowed. A stored result whose match now has different teams is a played dependent: a changed winner is refused on Save. `editDraftFor` replays with the other winner up front and sets a generic `note` in the editor when the winner is locked. A stored DONE result with no winner (hand-edited file) stops the replay and refuses the edit with a message naming that match. Unconfirmed progress (scores, handicap, table) carries over when teams are unchanged, otherwise it is cleared after a confirm. `finished` (champion pop-up) is set only when the edit finished the bracket or changed the champion. `editMatch` is the single entry point the page calls for both kinds. |
| C5  | **Substitution** (`substitutePlayer`): replaces the player in their LIVE Monster match and on their bracket team (`originalTeams` and every non-DONE match, renamed); DONE matches keep their line-ups. The leaving player is paused, the replacement made active. Refused if the replacement is in a LIVE match or on a team still in the bracket. Ids from dropdowns are matched as text (`findById`), so imported text ids work.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Other constraints that touch rules

- The admin lock (4-8 digit PIN) disables editing. It is a guard, not security. A finished tournament (P11) is
  read-only regardless of the PIN.
- Persisted fields and validators (`newTournamentState`, `FIELD_VALIDATORS`) bound the rule settings: changing an allowed value (e.g. best-of 9, new strategy) means updating the validator, the `<option>` lists, export compatibility, and `test/persistence.test.js`.
- Settings (tables, format, best-of) can be changed mid-event. Existing matches keep their game slots and format.
- **New Tournament** (`nextTournamentState`) keeps the name, tables, format, best-of, bracket options and PIN; players, matches, bracket and lock reset.

## Known gaps (open GitHub issues)

| Issue | Rule affected                                           |
| ----- | ------------------------------------------------------- |
| #11   | B2/R6: paused players can qualify for the bracket.      |
| #12   | P9: Monster and bracket matches can share a table.      |
| #13   | M8: deleting a LIVE match doesn't undo the M7 counters. |
| #14   | Changing `format` mid-event mixes 1v1 and 2v2 results.  |

Kept as intended by the organizers (no change planned): #5, a handicap win with no scores has no CSV row; #6, automatic
BYE wins appear in Match History and the count.

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
