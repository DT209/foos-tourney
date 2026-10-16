// ==========================================
// TOURNAMENT LOGIC
// ==========================================
// All non-rendering behaviour for TournamentManager.html. Loaded in the
// browser as a classic <script> (exposes window.TournamentLogic) and in
// Node tests via require() (exposes globalThis.TournamentLogic).
//
// Sources of non-determinism (Math.random, Date.now, fetch, DOM) are
// injectable parameters so every function can be tested in isolation.

globalThis.TournamentLogic = (() => {
  // ==========================================
  // SECURITY & SANITIZATION HELPERS
  // ==========================================

  function sanitizeInput(input, maxLength = 35) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>]/g, '').trim().substring(0, maxLength);
  }

  function sanitizeInt(input, fallback = 0) {
    const parsed = parseInt(input, 10);
    return isNaN(parsed) ? fallback : Math.max(0, parsed);
  }

  // Score inputs may be cleared to '' while typing; anything else is a
  // non-negative integer.
  function normalizeScoreInput(value) {
    return value === '' ? '' : sanitizeInt(value);
  }

  // ==========================================
  // ADMIN LOCK
  // ==========================================
  // The lock guards a shared screen against accidental edits; it is not
  // security (the PIN lives in this browser's storage).

  const PIN_PATTERN = /^\d{4,8}$/;

  // With no PIN set, the first submission chooses one and locks. Otherwise
  // the correct PIN toggles the lock. Returns { error } or { pin, isLocked }.
  function submitPin({ pin, input, isLocked }) {
    if (pin === null) {
      if (!PIN_PATTERN.test(input)) return { error: 'Choose a PIN of 4 to 8 digits.' };
      return { pin: input, isLocked: true };
    }
    if (input !== pin) return { error: 'Incorrect PIN!' };
    return { pin, isLocked: !isLocked };
  }

  // Escape hatch for a forgotten PIN: unlock and let the next lock set a new one.
  function forgetPin() {
    return { pin: null, isLocked: false };
  }

  // ==========================================
  // PERSISTENCE
  // ==========================================
  // The tournament auto-saves to localStorage so a refresh or closed tab
  // doesn't lose it. Saves are versioned; anything unreadable loads as null.
  // None of these throw: private mode, blocked site data and full storage
  // all degrade to "not saved".

  const STORAGE_KEY = 'foosTourney.tournament';
  const STORAGE_VERSION = 1;

  function defaultTournamentState(today) {
    return {
      tournamentName: 'Thursday DYP',
      startDate: today,
      tableCount: 2,
      format: '2v2',
      maxGames: 3,
      activeTab: 'pool',
      players: [],
      matches: [],
      bracketData: null,
      bracketTeamCount: 4,
      bracketElimType: 'single',
      bracketMaxGames: 3,
      teamFormationStrategy: 'fair',
      seedingStrategy: 'ranking',
      customTeams: [],
      isLocked: false,
      adminPin: null
    };
  }

  const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

  // Fields whose valid type differs from their default's type.
  const FIELD_VALIDATORS = {
    bracketData: v => v === null || isPlainObject(v),
    bracketTeamCount: v => typeof v === 'number' || typeof v === 'string',
    adminPin: v => v === null || typeof v === 'string'
  };

  function isValidField(key, value, fallback) {
    if (FIELD_VALIDATORS[key]) return FIELD_VALIDATORS[key](value);
    if (Array.isArray(fallback)) return Array.isArray(value);
    return typeof value === typeof fallback;
  }

  // Full initial state: each saved field is kept only if it has a valid type.
  function restoreTournamentState(saved, today) {
    const state = defaultTournamentState(today);
    if (!saved) return state;
    Object.keys(state).forEach(key => {
      if (key in saved && isValidField(key, saved[key], state[key])) state[key] = saved[key];
    });
    return state;
  }

  function saveTournament(storage, state) {
    const persisted = {};
    Object.keys(defaultTournamentState('')).forEach(key => {
      persisted[key] = state[key];
    });
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: persisted }));
      return true;
    } catch {
      return false;
    }
  }

  function loadTournament(storage) {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY));
      if (!saved || saved.version !== STORAGE_VERSION || !isPlainObject(saved.state)) return null;
      return saved.state;
    } catch {
      return null;
    }
  }

  function clearTournament(storage) {
    try {
      storage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  // window.localStorage, or null where it is missing or access throws.
  function getBrowserStorage() {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  // ==========================================
  // CLUB LEADERBOARD
  // ==========================================
  // Fallback snapshot, used only if the live fetch fails (e.g. when
  // testing this file locally via file://, which can't reach the site).
  // When hosted at calgaryfoosballclub.com/dyp/, the live fetch is
  // same-origin as calgaryfoosballclub.com/leaderboard/ and always wins.
  // Refresh with `npm run refresh-leaderboard`.
  // Last refreshed from the live page: 2026-10-16.
  const FALLBACK_LEADERBOARD_DATE = '2026-10-16';
  const FALLBACK_LEADERBOARD_PLAYERS = [
    { name: 'Andrew', singlesElo: null, doublesElo: 1058 },
    { name: 'Brian L', singlesElo: null, doublesElo: 1277 },
    { name: 'Castillo', singlesElo: null, doublesElo: 1125 },
    { name: 'Darrel', singlesElo: null, doublesElo: 928 },
    { name: 'David', singlesElo: null, doublesElo: 912 },
    { name: 'Doogle', singlesElo: null, doublesElo: 911 },
    { name: 'Emett', singlesElo: null, doublesElo: null },
    { name: 'Eric Goodman', singlesElo: null, doublesElo: null },
    { name: 'Fred', singlesElo: null, doublesElo: 1056 },
    { name: 'Ivor', singlesElo: null, doublesElo: 1184 },
    { name: 'J.Herman', singlesElo: null, doublesElo: 1254 },
    { name: 'Jackie', singlesElo: null, doublesElo: 984 },
    { name: 'Jay', singlesElo: null, doublesElo: 754 },
    { name: 'Joe', singlesElo: null, doublesElo: 969 },
    { name: 'Kai', singlesElo: null, doublesElo: null },
    { name: 'Kent', singlesElo: null, doublesElo: 1032 },
    { name: 'Linda', singlesElo: null, doublesElo: 1163 },
    { name: 'Mark', singlesElo: null, doublesElo: 941 },
    { name: 'Matt', singlesElo: null, doublesElo: 1202 },
    { name: 'Mike Leach', singlesElo: null, doublesElo: 956 },
    { name: 'Mike Locken', singlesElo: null, doublesElo: 1067 },
    { name: 'Mike Ward', singlesElo: null, doublesElo: null },
    { name: 'Mo', singlesElo: null, doublesElo: null },
    { name: 'Patrick', singlesElo: null, doublesElo: 917 },
    { name: 'Rob', singlesElo: null, doublesElo: null },
    { name: 'Shane', singlesElo: null, doublesElo: 1060 },
    { name: 'Shawn', singlesElo: null, doublesElo: 755 },
    { name: 'Taco', singlesElo: null, doublesElo: 889 },
    { name: 'Tammy', singlesElo: null, doublesElo: null },
    { name: 'Taquito', singlesElo: null, doublesElo: null },
    { name: 'Tony', singlesElo: null, doublesElo: 1138 },
    { name: 'Zack', singlesElo: null, doublesElo: 870 }
  ];

  const LEADERBOARD_URL = 'https://calgaryfoosballclub.com/leaderboard/';

  function findLeaderboardPlayer(list, name) {
    return list.find(lp => lp.name === name) || null;
  }

  // Display info for a roster entry: null when the player isn't on the club
  // leaderboard, otherwise the format-specific ELO (null = unranked).
  function getLeaderboardInfo(leaderboardPlayers, name, format) {
    const lb = findLeaderboardPlayer(leaderboardPlayers, name);
    if (!lb) return null;
    return {
      elo: format === '1v1' ? lb.singlesElo : lb.doublesElo,
      label: format === '1v1' ? 'Singles' : 'Doubles'
    };
  }

  // The leaderboard page renders its table with client-side JS (a
  // `playersData` array fed through `renderTable()`), so fetch()'ing the
  // page's raw HTML always sees an empty <tbody> - fetch never runs that
  // script. Instead, pull `playersData` straight out of the page's own
  // inline <script> source (still present as plain text in the raw HTML)
  // and parse it directly, without executing it.
  function parsePlayersDataScript(scriptText) {
    const arrayMatch = scriptText.match(/const\s+playersData\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!arrayMatch) return null;

    const objectBlocks = arrayMatch[1].match(/\{[^{}]*\}/g) || [];
    const parseField = (block, field) => {
      const m = block.match(new RegExp(field + '\\s*:\\s*("Unranked"|-?\\d+(?:\\.\\d+)?)'));
      if (!m || m[1] === '"Unranked"') return null;
      return Math.round(parseFloat(m[1]));
    };

    const players = [];
    objectBlocks.forEach(block => {
      const nameMatch = block.match(/name\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (!nameMatch) return;
      players.push({
        name: nameMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        singlesElo: parseField(block, 'singlesElo'),
        doublesElo: parseField(block, 'doublesElo')
      });
    });
    return players;
  }

  function parseHtmlDocument(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // Fetches and parses the live club leaderboard. Same-origin when this
  // tool is hosted at calgaryfoosballclub.com/dyp/, so no CORS issues there.
  async function fetchLeaderboardPlayers(fetchImpl = globalThis.fetch, parseHtml = parseHtmlDocument) {
    const res = await fetchImpl(LEADERBOARD_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Leaderboard request failed: ' + res.status);
    const html = await res.text();
    const doc = parseHtml(html);

    const dataScript = Array.from(doc.querySelectorAll('script:not([src])')).find(s =>
      /const\s+playersData\s*=/.test(s.textContent)
    );
    if (!dataScript) throw new Error('Could not locate playersData on leaderboard page');

    const players = parsePlayersDataScript(dataScript.textContent);
    if (!players || players.length === 0) throw new Error('Leaderboard playersData was empty or unparsable');
    return players;
  }

  // ==========================================
  // ROSTER
  // ==========================================

  const PLAYER_NAME_MAX_LENGTH = 25;

  function normalizeName(name) {
    return name.trim().toLowerCase();
  }

  function createPlayer(id, name) {
    return {
      id,
      name,
      paid: false,
      active: true,
      wins: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      eligibleDrawsMissed: 0
    };
  }

  // Validates a typed player name. Returns { error } or { name, onLeaderboard };
  // a name that isn't an exact leaderboard match needs confirming as a guest.
  function checkNewPlayerName(rawName, players, leaderboardPlayers) {
    const name = sanitizeInput(rawName, PLAYER_NAME_MAX_LENGTH);
    if (!name) {
      return { error: 'Please enter a valid player name.' };
    }
    if (players.some(p => normalizeName(p.name) === name.toLowerCase())) {
      return { error: `A player named "${name}" already exists in the roster.` };
    }
    return { name, onLeaderboard: Boolean(findLeaderboardPlayer(leaderboardPlayers, name)) };
  }

  function addPlayer(players, id, name) {
    return [...players, createPlayer(id, name)];
  }

  // Bulk add from the leaderboard picker, skipping names already on the roster.
  // Ids are baseId + index - a shared Date.now() would collide.
  function addPlayersByName(players, names, baseId) {
    const existing = new Set(players.map(p => normalizeName(p.name)));
    const additions = names
      .filter(name => !existing.has(normalizeName(name)))
      .map((name, i) => createPlayer(baseId + i, name));
    return [...players, ...additions];
  }

  function togglePlayerFlag(players, id, flag) {
    return players.map(p => (p.id === id ? { ...p, [flag]: !p[flag] } : p));
  }

  // An empty (post-sanitize) name leaves the roster unchanged.
  function renamePlayer(players, id, rawName) {
    const name = sanitizeInput(rawName, PLAYER_NAME_MAX_LENGTH);
    if (!name) return players;
    return players.map(p => (p.id === id ? { ...p, name } : p));
  }

  function removePlayer(players, id) {
    return players.filter(p => p.id !== id);
  }

  function resetPlayerStats(players) {
    return players.map(p => ({ ...p, wins: 0, losses: 0, gf: 0, ga: 0, eligibleDrawsMissed: 0 }));
  }

  function countActivePlayers(players) {
    return players.filter(p => p.active).length;
  }

  function hasPausedPlayers(players) {
    return players.some(p => !p.active);
  }

  // Monster-stage standings: win % first, then average goal differential.
  function computeStandings(players) {
    return players
      .map(p => {
        const totalGames = p.wins + p.losses;
        const winPct = totalGames > 0 ? ((p.wins / totalGames) * 100).toFixed(1) : '0.0';
        const diff = p.gf - p.ga;
        const avgDiff = totalGames > 0 ? (diff / totalGames).toFixed(1) : '0.0';
        return { ...p, totalGames, winPct, diff, avgDiff };
      })
      .sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct) || parseFloat(b.avgDiff) - parseFloat(a.avgDiff));
  }

  // --- Leaderboard picker & autocomplete ---

  function togglePickerSelection(selection, name) {
    return selection.includes(name) ? selection.filter(n => n !== name) : [...selection, name];
  }

  function getLeaderboardPickerView(players, leaderboardPlayers, selection) {
    const onRoster = new Set(players.map(p => normalizeName(p.name)));
    const sortedLeaderboard = [...leaderboardPlayers].sort((a, b) => a.name.localeCompare(b.name));
    const available = sortedLeaderboard.filter(lp => !onRoster.has(normalizeName(lp.name)));
    const allSelected = available.length > 0 && available.every(lp => selection.includes(lp.name));
    const rows = sortedLeaderboard.map(lp => {
      const alreadyAdded = onRoster.has(normalizeName(lp.name));
      return { player: lp, alreadyAdded, checked: alreadyAdded || selection.includes(lp.name) };
    });
    return { rows, available, allSelected };
  }

  // "Select All" flips between every available name and none.
  function toggleSelectAll(view) {
    return view.allSelected ? [] : view.available.map(lp => lp.name);
  }

  function getPlayerSuggestions(leaderboardPlayers, rawQuery, limit = 8) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return [];
    return leaderboardPlayers.filter(lp => lp.name.toLowerCase().includes(query)).slice(0, limit);
  }

  // ==========================================
  // FAIR MATCHMAKING ALGORITHM HELPERS
  // ==========================================

  function pairKey(id1, id2) {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  }

  function buildHistoryMatrices(matches) {
    const partnerHistory = {};
    const opponentHistory = {};

    const recordPair = (matrix, id1, id2) => {
      const key = pairKey(id1, id2);
      matrix[key] = (matrix[key] || 0) + 1;
    };

    matches.forEach(m => {
      if (!m || (m.status !== 'DONE' && m.status !== 'LIVE')) return;

      const t1Ids = (m.team1 || []).map(p => p.id);
      const t2Ids = (m.team2 || []).map(p => p.id);

      if (t1Ids.length === 2) recordPair(partnerHistory, t1Ids[0], t1Ids[1]);
      if (t2Ids.length === 2) recordPair(partnerHistory, t2Ids[0], t2Ids[1]);

      t1Ids.forEach(id1 => {
        t2Ids.forEach(id2 => {
          recordPair(opponentHistory, id1, id2);
        });
      });
    });

    return { partnerHistory, opponentHistory };
  }

  function getPairCount(matrix, id1, id2) {
    return matrix[pairKey(id1, id2)] || 0;
  }

  const W_TEAMMATE = 300;
  const W_OPPONENT = 100;
  const W_UNLUCKY = 80;
  const MAX_RANDOM_NOISE = 50;

  // Picks the candidate with the lowest penalty. Every candidate gets credit
  // for draws it sat out plus a little random noise to break ties.
  function pickLowestPenalty(pool, penaltyFn, random) {
    let best = null;
    let lowest = Infinity;
    pool.forEach(candidate => {
      const unluckinessCredit = (candidate.eligibleDrawsMissed || 0) * W_UNLUCKY;
      const randomNoise = Math.floor(random() * MAX_RANDOM_NOISE);
      const total = penaltyFn(candidate) - unluckinessCredit + randomNoise;
      if (total < lowest) {
        lowest = total;
        best = candidate;
      }
    });
    return best;
  }

  function drawFairMatch(players, matches, format = '2v2', random = Math.random) {
    if (!Array.isArray(players) || !Array.isArray(matches)) {
      return { error: 'Invalid input: players and matches must be arrays.' };
    }

    const busyPlayerIds = new Set();
    matches
      .filter(m => m && m.status === 'LIVE')
      .forEach(m => {
        const activeMatchPlayers = [...(m.team1 || []), ...(m.team2 || [])];
        activeMatchPlayers.forEach(p => {
          if (p && p.id !== undefined) busyPlayerIds.add(p.id);
        });
      });

    const availablePlayers = players.filter(p => {
      if (!p || p.id === undefined) return false;
      const isPlayerActive = p.active !== undefined ? p.active : p.isActive;
      return Boolean(isPlayerActive) && !busyPlayerIds.has(p.id);
    });

    const reqPlayers = format === '2v2' ? 4 : 2;
    if (availablePlayers.length < reqPlayers) {
      return {
        error: `Not enough available players. Found ${availablePlayers.length}, need at least ${reqPlayers}.`
      };
    }

    const { partnerHistory, opponentHistory } = buildHistoryMatrices(matches);
    const teammatePenalty = (a, b) => Math.pow(getPairCount(partnerHistory, a.id, b.id), 2) * W_TEAMMATE;
    const opponentPenalty = (a, b) => Math.pow(getPairCount(opponentHistory, a.id, b.id), 2) * W_OPPONENT;

    let pool = [...availablePlayers];
    const p1 = pickLowestPenalty(pool, () => 0, random);
    pool = pool.filter(p => p.id !== p1.id);

    let team1;
    let team2;
    if (format === '1v1') {
      const p2 = pickLowestPenalty(pool, c => opponentPenalty(p1, c), random);
      team1 = [p1];
      team2 = [p2];
    } else {
      const p2 = pickLowestPenalty(pool, c => teammatePenalty(p1, c), random);
      pool = pool.filter(p => p.id !== p2.id);
      const p3 = pickLowestPenalty(pool, c => opponentPenalty(p1, c) + opponentPenalty(p2, c), random);
      pool = pool.filter(p => p.id !== p3.id);
      const p4 = pickLowestPenalty(
        pool,
        c => teammatePenalty(p3, c) + opponentPenalty(p1, c) + opponentPenalty(p2, c),
        random
      );
      team1 = [p1, p2];
      team2 = [p3, p4];
    }

    // Drawn players reset their "missed" counter; idle active players who
    // were eligible but not picked accumulate one.
    const drawnIds = new Set([...team1, ...team2].map(p => p.id));
    const updatedPlayers = players.map(p => {
      if (p.active && !busyPlayerIds.has(p.id) && !drawnIds.has(p.id)) {
        return { ...p, eligibleDrawsMissed: (p.eligibleDrawsMissed || 0) + 1 };
      }
      if (drawnIds.has(p.id)) {
        return { ...p, eligibleDrawsMissed: 0 };
      }
      return p;
    });

    return { team1, team2, updatedPlayers };
  }

  // ==========================================
  // MONSTER STAGE MATCHES
  // ==========================================

  function createGameSlots(count) {
    return Array.from({ length: count }, () => ({ t1: '', t2: '' }));
  }

  // Lowest-numbered table without a LIVE match, or null when all are busy.
  function findFreeTable(matches, tableCount) {
    const activeTableNums = matches.filter(m => m.status === 'LIVE').map(m => m.table);
    for (let i = 1; i <= tableCount; i++) {
      if (!activeTableNums.includes(i)) return i;
    }
    return null;
  }

  function findLiveMatchAtTable(matches, tableNum) {
    return matches.find(m => m.table === tableNum && m.status === 'LIVE');
  }

  // Draws a fair match onto the first free table.
  // Returns { error } or { players, matches } with the new match appended.
  function drawMonsterMatch({ players, matches, tableCount, format, maxGames, id, random = Math.random }) {
    const freeTable = findFreeTable(matches, tableCount);
    if (!freeTable) {
      return { error: 'All tables are currently occupied!' };
    }

    const result = drawFairMatch(players, matches, format, random);
    if (result.error) {
      return { error: result.error };
    }

    const newMatch = {
      id,
      table: freeTable,
      type: format,
      team1: result.team1,
      team2: result.team2,
      games: createGameSlots(maxGames),
      overrideWinner: null,
      isHandicap: false,
      status: 'LIVE'
    };

    return { players: result.updatedPlayers, matches: [...matches, newMatch] };
  }

  function deleteMatch(matches, matchId) {
    return matches.filter(m => m.id !== matchId);
  }

  function updateMatchById(matches, matchId, updater) {
    return matches.map(m => (m.id === matchId ? updater(m) : m));
  }

  function updateMonsterGameScore(matches, matchId, gameIndex, teamKey, value) {
    return updateMatchById(matches, matchId, m => {
      const games = [...m.games];
      games[gameIndex] = { ...games[gameIndex], [teamKey]: normalizeScoreInput(value) };
      return { ...m, games };
    });
  }

  // Turning the handicap override on defaults the winner to Team 1.
  function setMonsterHandicap(matches, matchId, checked) {
    return updateMatchById(matches, matchId, m => ({ ...m, isHandicap: checked, overrideWinner: checked ? 1 : null }));
  }

  function setMonsterOverrideWinner(matches, matchId, winner) {
    return updateMatchById(matches, matchId, m => ({ ...m, overrideWinner: Number(winner) }));
  }

  // 1 or 2 when a team has won a majority of the games (or a handicap
  // override is set), otherwise null.
  function getMatchWinner(match) {
    if (match.isHandicap && match.overrideWinner) {
      return match.overrideWinner;
    }

    let t1Wins = 0;
    let t2Wins = 0;
    const winsNeeded = Math.ceil(match.games.length / 2);

    for (const g of match.games) {
      const s1 = parseInt(g.t1, 10);
      const s2 = parseInt(g.t2, 10);
      if (!isNaN(s1) && !isNaN(s2) && s1 !== s2) {
        if (s1 > s2) t1Wins++;
        else t2Wins++;
      }
    }

    if (t1Wins >= winsNeeded) return 1;
    if (t2Wins >= winsNeeded) return 2;
    return null;
  }

  // Marks a Monster match DONE and credits W/L and goals to its players.
  // Returns null for an unknown id, { error } with no winner yet, otherwise
  // { players, matches }.
  function completeMonsterMatch(players, matches, matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return null;

    const winner = getMatchWinner(match);
    if (!winner) {
      return { error: 'Cannot complete match: No team has secured enough game wins.' };
    }

    let t1TotalGoals = 0;
    let t2TotalGoals = 0;
    match.games.forEach(g => {
      t1TotalGoals += parseInt(g.t1, 10) || 0;
      t2TotalGoals += parseInt(g.t2, 10) || 0;
    });

    const updatedPlayers = players.map(p => {
      const inTeam1 = match.team1.some(tp => tp.id === p.id);
      const inTeam2 = match.team2.some(tp => tp.id === p.id);

      if (!inTeam1 && !inTeam2) return p;

      const isUserWinner = (inTeam1 && winner === 1) || (inTeam2 && winner === 2);

      return {
        ...p,
        wins: p.wins + (isUserWinner ? 1 : 0),
        losses: p.losses + (isUserWinner ? 0 : 1),
        gf: p.gf + (inTeam1 ? t1TotalGoals : t2TotalGoals),
        ga: p.ga + (inTeam1 ? t2TotalGoals : t1TotalGoals)
      };
    });

    return {
      players: updatedPlayers,
      matches: matches.map(m => (m.id === matchId ? { ...m, status: 'DONE', winner } : m))
    };
  }

  function teamLabel(teamPlayers) {
    return teamPlayers.map(p => p.name).join(' & ');
  }

  // ==========================================
  // BRACKET GENERATION LOGIC
  // ==========================================

  // Standard tournament bracket seed positions generator
  function getStandardBracketSeedPositions(size) {
    if (size === 2) return [1, 2];
    const rounds = Math.log2(size) - 1;
    let pls = [1, 2];
    for (let i = 0; i < rounds; i++) {
      const nextPls = [];
      for (let j = 0; j < pls.length; j++) {
        nextPls.push(pls[j]);
        nextPls.push(pls.length * 2 + 1 - pls[j]);
      }
      pls = nextPls;
    }
    return pls;
  }

  function buildBracketTeams(
    rankedPlayers,
    teamCount,
    format,
    teamFormationStrategy,
    seedingStrategy,
    customTeams = [],
    leaderboardPlayers = [],
    random = Math.random
  ) {
    const requiredPlayers = format === '2v2' ? teamCount * 2 : teamCount;
    // "Top X" selection always comes from Monster stage performance, regardless
    // of seeding strategy - only the seed ORDER within that group changes below.
    const qualified = rankedPlayers.slice(0, requiredPlayers);
    const shuffle = () => random() - 0.5;

    // Guests / players not on the club leaderboard, or unranked in this format,
    // default to 1000 ELO.
    const getPlayerElo = p => {
      const lb = findLeaderboardPlayer(leaderboardPlayers, p.name);
      const elo = lb ? (format === '1v1' ? lb.singlesElo : lb.doublesElo) : null;
      return elo === null || elo === undefined ? 1000 : elo;
    };

    const N = qualified.length;
    const playerSeedMap = new Map();
    qualified.forEach((p, idx) => {
      if (seedingStrategy === 'elo') {
        // Higher ELO = higher seed / BYE priority (opposite direction from
        // Monster rank, where a lower rank number is the higher seed).
        playerSeedMap.set(p.id, getPlayerElo(p));
      } else {
        const rank = idx + 1;
        playerSeedMap.set(p.id, Math.pow(2, (N - rank) / 5));
      }
    });

    if (format === '1v1') {
      const teams1v1 = qualified.map((p, idx) => ({
        id: `team-${idx + 1}`,
        name: p.name,
        players: [p],
        monsterRank: idx + 1,
        seedValue: playerSeedMap.get(p.id) || 0
      }));

      if (seedingStrategy === 'ranking' || seedingStrategy === 'elo') {
        teams1v1.sort((a, b) => b.seedValue - a.seedValue);
      } else if (seedingStrategy === 'random') {
        teams1v1.sort(shuffle);
      }
      return teams1v1;
    }

    let pairs = [];
    if (teamFormationStrategy === 'manual') {
      pairs = customTeams.map(ct => [ct.p1, ct.p2].filter(Boolean));
    } else if (teamFormationStrategy === 'fair') {
      for (let i = 0; i < Math.floor(N / 2); i++) {
        pairs.push([qualified[i], qualified[N - 1 - i]]);
      }
    } else if (teamFormationStrategy === 'topBias') {
      for (let i = 0; i < N; i += 2) {
        if (qualified[i + 1]) pairs.push([qualified[i], qualified[i + 1]]);
      }
    } else if (teamFormationStrategy === 'topBottomRandom') {
      const topHalf = qualified.slice(0, Math.ceil(N / 2));
      const bottomHalf = qualified.slice(Math.ceil(N / 2)).sort(shuffle);
      for (let i = 0; i < topHalf.length; i++) {
        if (bottomHalf[i]) pairs.push([topHalf[i], bottomHalf[i]]);
      }
    } else if (teamFormationStrategy === 'random') {
      const shuffled = [...qualified].sort(shuffle);
      for (let i = 0; i < N; i += 2) {
        if (shuffled[i + 1]) pairs.push([shuffled[i], shuffled[i + 1]]);
      }
    }

    const formedTeams = pairs.map(pair => {
      const p1 = pair[0];
      const p2 = pair[1];
      const seed1 = p1 ? playerSeedMap.get(p1.id) || 0 : 0;
      const seed2 = p2 ? playerSeedMap.get(p2.id) || 0 : 0;

      // Team ELO = 60% the higher player's ELO + 40% the lower player's ELO.
      const teamSeedValue =
        seedingStrategy === 'elo' && p1 && p2
          ? 0.6 * Math.max(seed1, seed2) + 0.4 * Math.min(seed1, seed2)
          : seed1 + seed2;

      return {
        name: pair[1] ? `${pair[0].name} & ${pair[1].name}` : pair[0] ? pair[0].name : 'TBD Team',
        players: pair,
        seedValue: teamSeedValue
      };
    });

    if (seedingStrategy === 'ranking' || seedingStrategy === 'elo') {
      formedTeams.sort((a, b) => b.seedValue - a.seedValue);
    } else if (seedingStrategy === 'random') {
      formedTeams.sort(shuffle);
    }

    return formedTeams.map((t, idx) => ({
      id: `team-${idx + 1}`,
      name: t.name,
      players: t.players,
      seedValue: t.seedValue
    }));
  }

  // --- Manual team pairing (bracket modal) ---

  // Pre-fills manual pairings in Monster rank order: (1,2), (3,4), ...
  function buildManualTeams(rankedPlayers, teamCount, format) {
    const count = parseInt(teamCount, 10) || 2;
    const reqPlayers = format === '2v2' ? count * 2 : count;
    const qualified = rankedPlayers.slice(0, reqPlayers);
    const teams = [];

    for (let i = 0; i < count; i++) {
      if (format === '2v2') {
        teams.push({ p1: qualified[i * 2] || null, p2: qualified[i * 2 + 1] || null });
      } else {
        teams.push({ p1: qualified[i] || null, p2: null });
      }
    }
    return teams;
  }

  function getManualTeamCandidates(rankedPlayers, teamCount) {
    const count = parseInt(teamCount, 10) || 2;
    return rankedPlayers.slice(0, count * 2);
  }

  // `slot` is 'p1' or 'p2'; `playerId` comes from a <select> value, so it's a
  // string ('' clears the slot because no candidate has id 0).
  function setManualTeamPlayer(customTeams, teamIndex, slot, candidates, playerId) {
    const player = candidates.find(p => p.id === Number(playerId));
    return customTeams.map((team, idx) => (idx === teamIndex ? { ...team, [slot]: player } : team));
  }

  // The team-count input accepts free text; returns the number to rebuild
  // manual teams with, or null while the field is blank/non-numeric.
  function parseTeamCountInput(value) {
    if (value === '') return null;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  // Helper to evaluate and advance BYE matches automatically across Losers Bracket rounds
  function processLoserBracketByes(losersRounds) {
    if (!losersRounds) return;

    let changed = true;
    while (changed) {
      changed = false;
      losersRounds.forEach((round, rIdx) => {
        round.forEach((match, mIdx) => {
          if (match.status === 'DONE') return;

          const t1Bye = match.team1 && match.team1.isBye;
          const t2Bye = match.team2 && match.team2.isBye;

          // 1. Both slots filled with actual BYEs
          if (t1Bye && t2Bye) {
            match.winner = 1;
            match.status = 'DONE';
            changed = true;
            advanceLoserWinner(losersRounds, rIdx, mIdx, match.team1);
            return;
          }

          // 2. One real team vs one confirmed BYE
          if ((match.team1 && !t1Bye && t2Bye) || (match.team2 && !t2Bye && t1Bye)) {
            const winningTeam = match.team1 && !t1Bye ? match.team1 : match.team2;
            match.winner = match.team1 && !t1Bye ? 1 : 2;
            match.status = 'DONE';
            changed = true;
            advanceLoserWinner(losersRounds, rIdx, mIdx, winningTeam);
          }
        });
      });
    }
  }

  function bothRealTeams(match) {
    return Boolean(match.team1 && match.team2 && !match.team1.isBye && !match.team2.isBye);
  }

  function advanceLoserWinner(losersRounds, rIdx, mIdx, winningTeam) {
    if (rIdx + 1 >= losersRounds.length) return;

    const nextRound = losersRounds[rIdx + 1];
    // Even rounds (0-indexed) are "drop-in" rounds that feed 1:1 into the
    // next round's team2 slot; odd rounds halve, pairing adjacent winners.
    const isEvenRound = rIdx % 2 === 0;
    const next = nextRound[isEvenRound ? mIdx : Math.floor(mIdx / 2)];

    if (isEvenRound || mIdx % 2 !== 0) {
      next.team2 = winningTeam;
      next.hasPropagatedT2 = true;
    } else {
      next.team1 = winningTeam;
      next.hasPropagatedT1 = true;
    }

    if (bothRealTeams(next)) {
      next.status = 'READY';
    }
  }

  function generateBracketStructure(teams, elimType, maxGames) {
    const numTeams = teams.length;
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(numTeams)));
    const numRounds = Math.log2(bracketSize);

    const seedPositions = getStandardBracketSeedPositions(bracketSize);

    const seededSlots = seedPositions.map((seedNum, slotIdx) =>
      seedNum <= teams.length ? teams[seedNum - 1] : { id: `bye-${slotIdx}`, name: 'BYE', isBye: true }
    );

    let matchIdCounter = 1;
    const createMatchSlot = (round, position, bracketType, label) => ({
      id: `m-${bracketType}-${round}-${position}`,
      num: matchIdCounter++,
      round,
      position,
      bracketType,
      label: label || `Match ${matchIdCounter - 1}`,
      team1: null,
      team2: null,
      games: createGameSlots(maxGames),
      winner: null,
      status: 'PENDING',
      isHandicap: false,
      overrideWinner: null,
      hasPropagatedT1: false,
      hasPropagatedT2: false,
      table: null
    });

    const winnersRounds = [];
    const numWinnersRounds = elimType === 'single' ? numRounds - 1 : numRounds;
    for (let r = 1; r <= numWinnersRounds; r++) {
      const matchesInRound = bracketSize / Math.pow(2, r);
      const roundMatches = [];
      // In Championship Format, the last Winners Bracket round IS the Grand Finals -
      // there's no separate merge match against the Losers Bracket champion.
      const isChampionshipFinal = elimType === 'championship' && r === numWinnersRounds;
      for (let p = 0; p < matchesInRound; p++) {
        roundMatches.push(createMatchSlot(r, p, 'winners', isChampionshipFinal ? 'Grand Finals' : ''));
      }
      winnersRounds.push(roundMatches);
    }

    let losersRounds = null;
    let grandFinals = null;
    let thirdPlaceMatch = null;

    if (elimType === 'single') {
      grandFinals = [createMatchSlot(numRounds, 0, 'grandFinal', 'Grand Finals')];
      if (numRounds >= 2) {
        thirdPlaceMatch = createMatchSlot(numRounds, 1, 'thirdPlace', '3rd / 4th Place Match');
      }
    } else if (elimType === 'double' || elimType === 'championship') {
      losersRounds = [];
      // Championship Format's Losers Bracket has one fewer round than Double Elimination's:
      // the Winners Bracket runner-up never drops down to face the Losers Bracket champion,
      // so the Losers Bracket's own final round IS the 3rd Place Match.
      const numLoserRounds = elimType === 'championship' ? Math.max(0, (numRounds - 1) * 2 - 1) : (numRounds - 1) * 2;
      let currentMatchesCount = bracketSize / 4;

      for (let lr = 1; lr <= numLoserRounds; lr++) {
        const roundMatches = [];
        const isThirdPlaceRound = elimType === 'championship' && lr === numLoserRounds;
        for (let p = 0; p < currentMatchesCount; p++) {
          roundMatches.push(createMatchSlot(lr, p, 'losers', isThirdPlaceRound ? '3rd Place Match' : ''));
        }
        losersRounds.push(roundMatches);
        if (lr % 2 === 0) {
          currentMatchesCount /= 2;
        }
      }

      if (elimType === 'double') {
        grandFinals = [createMatchSlot(1, 0, 'grandFinal', 'Grand Finals (Match 1)')];
      }
    }

    // Populate Winners Round 1 & resolve BYEs. Every slot holds a team or a
    // BYE, and the two strongest seeds are never both BYEs, so a match is
    // either playable or decided by a BYE.
    // (Championship: a Round 1 that is also the final Winners round keeps
    // its loser out of the Losers Bracket.)
    const dropsToLosers =
      Boolean(losersRounds && losersRounds.length > 0) && !(elimType === 'championship' && winnersRounds.length === 1);
    // Single elimination with 2 teams has no Winners rounds: the opening
    // match is the Grand Final itself.
    if (winnersRounds.length === 0) {
      grandFinals[0].team1 = seededSlots[0];
      grandFinals[0].team2 = seededSlots[1];
      grandFinals[0].status = 'READY';
    }
    const round1 = winnersRounds[0] || [];
    round1.forEach((match, i) => {
      const t1 = seededSlots[i * 2];
      const t2 = seededSlots[i * 2 + 1];
      match.team1 = t1;
      match.team2 = t2;

      if (t1.isBye || t2.isBye) {
        match.winner = t1.isBye && !t2.isBye ? 2 : 1;
        match.status = 'DONE';
      } else {
        match.status = 'READY';
      }

      // Propagate BYE losers into Losers Bracket
      if (dropsToLosers) {
        const losingTeam = match.status === 'DONE' ? (match.winner === 1 ? t2 : t1) : null;
        const targetMatch = losersRounds[0][Math.floor(i / 2)];
        if (i % 2 === 0) {
          targetMatch.team1 = losingTeam;
          targetMatch.hasPropagatedT1 = true;
        } else {
          targetMatch.team2 = losingTeam;
          targetMatch.hasPropagatedT2 = true;
        }
      }
    });

    // Advance BYE winners from Round 1 to Round 2 (or Grand Finals if 2-team single elim)
    const advanceTarget =
      winnersRounds.length > 1
        ? mIdx => winnersRounds[1][Math.floor(mIdx / 2)]
        : elimType === 'single'
          ? () => grandFinals[0]
          : null;
    if (advanceTarget) {
      round1.forEach((m, mIdx) => {
        if (m.status !== 'DONE') return;
        const next = advanceTarget(mIdx);
        const winningTeam = m.winner === 1 ? m.team1 : m.team2;
        if (mIdx % 2 === 0) next.team1 = winningTeam;
        else next.team2 = winningTeam;
        if (bothRealTeams(next)) next.status = 'READY';
      });
    }

    // Process and advance BYEs in the Losers Bracket
    processLoserBracketByes(losersRounds);

    return {
      type: elimType,
      maxGames,
      winnersRounds,
      losersRounds,
      grandFinals,
      thirdPlaceMatch,
      isCompleted: false,
      // Kept so "Clear Matches" can rebuild an identical, fresh Round 1
      // (same teams/seeding/byes) without needing a full re-draw.
      originalTeams: teams
    };
  }

  // Validates the bracket modal and builds teams + bracket.
  // Returns { error } or { bracket }.
  function createBracket({
    rankedPlayers,
    teamCount,
    format,
    teamFormationStrategy,
    seedingStrategy,
    customTeams,
    leaderboardPlayers,
    elimType,
    maxGames,
    random = Math.random
  }) {
    const parsedTeamCount = parseInt(teamCount, 10);
    if (isNaN(parsedTeamCount) || parsedTeamCount < 2) {
      return { error: 'Please enter a valid number of teams (minimum 2).' };
    }

    const requiredPlayers = format === '2v2' ? parsedTeamCount * 2 : parsedTeamCount;
    if (rankedPlayers.length < requiredPlayers) {
      return {
        error: `Not enough ranked players on the leaderboard. Need at least ${requiredPlayers} players for ${parsedTeamCount} teams in ${format} format.`
      };
    }

    const teams = buildBracketTeams(
      rankedPlayers,
      parsedTeamCount,
      format,
      teamFormationStrategy,
      seedingStrategy,
      customTeams,
      leaderboardPlayers,
      random
    );
    return { bracket: generateBracketStructure(teams, elimType, maxGames) };
  }

  // Rebuilds the same bracket (teams, seeding, byes) with all results cleared.
  function resetBracket(bracketData) {
    if (!bracketData) return null;
    return generateBracketStructure(bracketData.originalTeams, bracketData.type, bracketData.maxGames);
  }

  // "Clear Matches": wipe Monster matches and results but keep the roster and
  // any bracket's Round 1 structure.
  function clearMatchResults(players, bracketData) {
    return {
      matches: [],
      bracketData: resetBracket(bracketData),
      players: resetPlayerStats(players)
    };
  }

  // ==========================================
  // BRACKET PLAY
  // ==========================================
  // These mutate match objects inside the bracket and return a shallow copy
  // of the bracket so React sees a new reference.

  function getBracketMatch(bracket, section, rIdx, mIdx) {
    if (section === 'winners') return bracket.winnersRounds[rIdx][mIdx];
    if (section === 'losers') return bracket.losersRounds[rIdx][mIdx];
    if (section === 'grandFinals') return bracket.grandFinals[mIdx];
    if (section === 'thirdPlace') return bracket.thirdPlaceMatch;
    return undefined;
  }

  function updateBracketGameScore(bracket, section, rIdx, mIdx, gIdx, teamKey, value) {
    const updated = { ...bracket };
    getBracketMatch(updated, section, rIdx, mIdx).games[gIdx][teamKey] = normalizeScoreInput(value);
    return updated;
  }

  function setBracketHandicap(bracket, section, rIdx, mIdx, checked) {
    const updated = { ...bracket };
    const match = getBracketMatch(updated, section, rIdx, mIdx);
    match.isHandicap = checked;
    match.overrideWinner = checked ? 1 : null;
    return updated;
  }

  function setBracketOverrideWinner(bracket, section, rIdx, mIdx, winner) {
    const updated = { ...bracket };
    getBracketMatch(updated, section, rIdx, mIdx).overrideWinner = Number(winner);
    return updated;
  }

  function isBracketFinished(bracket) {
    if (bracket.type === 'single') {
      const finalMatch = bracket.grandFinals ? bracket.grandFinals[0] : null;
      const finalDone = Boolean(finalMatch && finalMatch.status === 'DONE');
      const thirdPlaceDone = !bracket.thirdPlaceMatch || bracket.thirdPlaceMatch.status === 'DONE';
      return finalDone && thirdPlaceDone;
    }
    if (bracket.type === 'championship') {
      const wRounds = bracket.winnersRounds;
      const finalMatch = wRounds && wRounds.length > 0 ? wRounds[wRounds.length - 1][0] : null;
      const finalDone = Boolean(finalMatch && finalMatch.status === 'DONE');
      const lRounds = bracket.losersRounds;
      const losersDone =
        !lRounds ||
        lRounds.length === 0 ||
        Boolean(lRounds[lRounds.length - 1][0] && lRounds[lRounds.length - 1][0].status === 'DONE');
      return finalDone && losersDone;
    }
    if (bracket.type === 'double') {
      const gfMatches = bracket.grandFinals;
      const lastGf = gfMatches[gfMatches.length - 1];
      return Boolean(lastGf && lastGf.status === 'DONE');
    }
    return false;
  }

  // Winner moves to the next Winners round, or into the Grand Finals.
  function advanceWinnerUpward(bracket, rIdx, mIdx, winningTeam) {
    const numRounds = bracket.winnersRounds.length;
    if (rIdx + 1 < numRounds) {
      const next = bracket.winnersRounds[rIdx + 1][Math.floor(mIdx / 2)];
      if (mIdx % 2 === 0) next.team1 = winningTeam;
      else next.team2 = winningTeam;
      if (bothRealTeams(next)) next.status = 'READY';
    } else if (bracket.grandFinals && bracket.grandFinals[0]) {
      // Reached Grand Finals slot in Single/Double elim
      const gf = bracket.grandFinals[0];
      if (bracket.type === 'single' && mIdx % 2 !== 0) gf.team2 = winningTeam;
      else gf.team1 = winningTeam;
      if (bothRealTeams(gf)) gf.status = 'READY';
    }
  }

  // Single Elimination: semi-final losers meet in the 3rd/4th Place Match.
  function dropToThirdPlace(bracket, rIdx, mIdx, losingTeam) {
    const isSemiFinalRound = rIdx === bracket.winnersRounds.length - 1;
    const tpm = bracket.thirdPlaceMatch;
    if (bracket.type !== 'single' || !isSemiFinalRound || !tpm) return;

    if (mIdx === 0) {
      tpm.team1 = losingTeam;
      tpm.hasPropagatedT1 = true;
    } else if (mIdx === 1) {
      tpm.team2 = losingTeam;
      tpm.hasPropagatedT2 = true;
    }

    if (tpm.team1 && tpm.team2) {
      const t1Bye = tpm.team1.isBye;
      const t2Bye = tpm.team2.isBye;
      if (t1Bye || t2Bye) {
        tpm.winner = t1Bye && !t2Bye ? 2 : 1;
        tpm.status = 'DONE';
      } else {
        tpm.status = 'READY';
      }
    }
  }

  // Double / Championship: the loser drops into the Losers Bracket.
  function dropToLosersBracket(bracket, rIdx, mIdx, losingTeam) {
    // Championship: the final Winners round's loser doesn't drop to the Losers Bracket -
    // that round IS the Grand Finals, and only decides 1st/2nd.
    const isChampionshipFinalRound = bracket.type === 'championship' && rIdx === bracket.winnersRounds.length - 1;
    const hasLosersBracket = bracket.type === 'double' || bracket.type === 'championship';
    if (!hasLosersBracket || !bracket.losersRounds || isChampionshipFinalRound) return;

    // Double elimination with 2 teams has no Losers rounds: the Winners final
    // loser is the Losers Bracket champion and goes straight to the Grand Final.
    if (bracket.losersRounds.length === 0) {
      const gf = bracket.grandFinals[0];
      gf.team2 = losingTeam;
      if (bothRealTeams(gf)) gf.status = 'READY';
      return;
    }

    const targetLoserRound = bracket.losersRounds[rIdx === 0 ? 0 : (rIdx - 1) * 2 + 1];
    // Anti-rematch mirroring: a Round 1 drop (rIdx === 0) can't collide - two
    // Round 1 matches never share a team, so their losers never played each
    // other. From Round 2 on, the "parallel" slot (same match index) would pit
    // this loser against a losers-bracket survivor who may be the very
    // opponent they just lost to upstream. Mirroring the index within the
    // receiving round routes the drop-in to the opposite half of the bracket's
    // survivor lineage instead, avoiding that immediate re-pairing.
    const targetLoserMatch =
      targetLoserRound && targetLoserRound[rIdx === 0 ? Math.floor(mIdx / 2) : targetLoserRound.length - 1 - mIdx];

    if (targetLoserMatch) {
      if (rIdx === 0 && mIdx % 2 !== 0) {
        targetLoserMatch.team2 = losingTeam;
        targetLoserMatch.hasPropagatedT2 = true;
      } else {
        targetLoserMatch.team1 = losingTeam;
        targetLoserMatch.hasPropagatedT1 = true;
      }
      if (bothRealTeams(targetLoserMatch)) targetLoserMatch.status = 'READY';
    }

    // Trigger BYE auto-advancements in Losers Bracket
    processLoserBracketByes(bracket.losersRounds);
  }

  function advanceWinnersBracket(bracket, rIdx, mIdx, winningTeam, losingTeam) {
    advanceWinnerUpward(bracket, rIdx, mIdx, winningTeam);
    dropToThirdPlace(bracket, rIdx, mIdx, losingTeam);
    dropToLosersBracket(bracket, rIdx, mIdx, losingTeam);
  }

  function advanceLosersBracket(bracket, rIdx, mIdx, winningTeam) {
    advanceLoserWinner(bracket.losersRounds, rIdx, mIdx, winningTeam);

    // Double Elimination only: the Losers Bracket champion advances to face the
    // Winners Bracket champion in the Grand Finals. Championship Format has no
    // such match - the Losers Bracket final IS the 3rd Place Match, decided already.
    if (rIdx + 1 >= bracket.losersRounds.length && bracket.grandFinals) {
      const gf = bracket.grandFinals[0];
      gf.team2 = winningTeam;
      if (bothRealTeams(gf)) gf.status = 'READY';
    }

    // Trigger BYE auto-advancements in Losers Bracket
    processLoserBracketByes(bracket.losersRounds);
  }

  // Double Elimination: if the Losers Bracket champion (team 2) wins the first
  // Grand Final, both teams have one loss and a deciding reset match is added.
  function addGrandFinalResetIfNeeded(bracket, mIdx, winner) {
    if (mIdx !== 0 || bracket.type !== 'double' || winner !== 2 || bracket.grandFinals.length !== 1) return;
    const first = bracket.grandFinals[0];
    bracket.grandFinals.push({
      id: `m-grandFinal-2-0`,
      num: first.num + 1,
      round: 2,
      position: 0,
      bracketType: 'grandFinal',
      label: 'Grand Finals Bracket Reset (Match 2)',
      team1: first.team1,
      team2: first.team2,
      games: createGameSlots(bracket.maxGames),
      winner: null,
      status: 'READY',
      isHandicap: false,
      overrideWinner: null,
      table: null
    });
  }

  // Confirms a bracket match result and advances teams.
  // Returns { error } or { bracket, finished }.
  function confirmBracketMatch(bracket, section, rIdx, mIdx) {
    const updated = { ...bracket };
    const match = getBracketMatch(updated, section, rIdx, mIdx);

    const winner = getMatchWinner(match);
    if (!winner) {
      return { error: 'Cannot complete match: No team has won enough games.' };
    }

    match.winner = winner;
    match.status = 'DONE';

    const winningTeam = winner === 1 ? match.team1 : match.team2;
    const losingTeam = winner === 1 ? match.team2 : match.team1;

    if (section === 'winners') advanceWinnersBracket(updated, rIdx, mIdx, winningTeam, losingTeam);
    if (section === 'losers') advanceLosersBracket(updated, rIdx, mIdx, winningTeam);
    if (section === 'grandFinals') addGrandFinalResetIfNeeded(updated, mIdx, winner);

    const finished = isBracketFinished(updated);
    if (finished) updated.isCompleted = true;
    return { bracket: updated, finished };
  }

  // Helper function to calculate final bracket standings
  function calculateBracketStandings(bracketData) {
    if (!bracketData) return [];

    const standings = [];
    const push = (place, team) => {
      if (team) standings.push({ place, team });
    };
    const winnerOf = m => (m.winner === 1 ? m.team1 : m.team2);
    const loserOf = m => (m.winner === 1 ? m.team2 : m.team1);

    if (bracketData.type === 'single') {
      const finalMatch = bracketData.grandFinals ? bracketData.grandFinals[0] : null;
      if (finalMatch && finalMatch.winner) {
        push(1, winnerOf(finalMatch));
        push(2, loserOf(finalMatch));

        const tpm = bracketData.thirdPlaceMatch;
        if (tpm && tpm.winner) {
          push(3, winnerOf(tpm));
          push(4, loserOf(tpm));
        } else if (bracketData.winnersRounds && bracketData.winnersRounds.length > 0) {
          const sfRound = bracketData.winnersRounds[bracketData.winnersRounds.length - 1];
          sfRound.forEach(m => {
            if (m.winner) push(3, loserOf(m));
          });
        }
      }
    } else if (bracketData.type === 'championship') {
      // Championship Format: the last Winners Bracket round IS the Grand Finals -
      // 1st/2nd come directly from it. The Winners Bracket runner-up never drops to
      // the Losers Bracket, so the Losers Bracket final is the 3rd Place Match outright.
      const wRounds = bracketData.winnersRounds;
      const winnersFinal = wRounds && wRounds.length > 0 ? wRounds[wRounds.length - 1][0] : null;
      if (winnersFinal && winnersFinal.winner) {
        push(1, winnerOf(winnersFinal));
        push(2, loserOf(winnersFinal));
      }

      if (bracketData.losersRounds && bracketData.losersRounds.length > 0) {
        const finalLoserMatch = bracketData.losersRounds[bracketData.losersRounds.length - 1][0];
        if (finalLoserMatch && finalLoserMatch.winner) {
          push(3, winnerOf(finalLoserMatch));
        }
      }
    } else {
      const gfMatches = bracketData.grandFinals;
      const lastGf = gfMatches[gfMatches.length - 1];
      if (lastGf && lastGf.winner) {
        push(1, winnerOf(lastGf));
        push(2, loserOf(lastGf));

        if (bracketData.losersRounds && bracketData.losersRounds.length > 0) {
          const lastLoserMatch = bracketData.losersRounds[bracketData.losersRounds.length - 1][0];
          if (lastLoserMatch && lastLoserMatch.winner) {
            // The Losers Bracket final's loser is 3rd; its winner reached the Grand Finals.
            push(3, loserOf(lastLoserMatch));
          }
        }
      }
    }

    return standings;
  }

  function placeLabel(place) {
    if (place === 1) return '1st Place';
    if (place === 2) return '2nd Place';
    if (place === 3) return '3rd Place';
    return `${place}th Place`;
  }

  function placeMedal(place) {
    return { 1: '🥇', 2: '🥈', 3: '🥉' }[place] || null;
  }

  // Every bracket match tagged with where it lives, for table assignment.
  function listBracketMatches(bracketData) {
    const all = [];
    const collect = (rounds, section) => {
      if (!rounds) return;
      rounds.forEach((round, rIdx) => {
        round.forEach((match, mIdx) => {
          all.push({ match, section, rIdx, mIdx });
        });
      });
    };
    collect(bracketData.winnersRounds, 'winners');
    collect(bracketData.losersRounds, 'losers');
    if (bracketData.grandFinals) collect([bracketData.grandFinals], 'grandFinals');
    if (bracketData.thirdPlaceMatch) collect([[bracketData.thirdPlaceMatch]], 'thirdPlace');
    return all;
  }

  // Assigns free tables to playable bracket matches without reassigning
  // established ("sticky") tables. Mutates match.table. Returns an array of
  // length tableCount holding the { match, section, rIdx, mIdx } on each table.
  function assignBracketTables(bracketData, tableCount) {
    if (!bracketData) return [];

    const allMatches = listBracketMatches(bracketData);

    const takenTables = new Set();
    allMatches.forEach(({ match }) => {
      if (match.status !== 'DONE' && match.table) {
        takenTables.add(match.table);
      }
    });

    allMatches.forEach(({ match }) => {
      const isPlayable = match.status === 'READY' || (bothRealTeams(match) && match.status !== 'DONE');
      if (isPlayable && !match.table) {
        for (let t = 1; t <= tableCount; t++) {
          if (!takenTables.has(t)) {
            match.table = t;
            takenTables.add(t);
            break;
          }
        }
      }
    });

    const activeAssignments = Array.from({ length: tableCount }, () => null);
    allMatches.forEach(item => {
      if (item.match.status !== 'DONE' && item.match.table && item.match.table <= tableCount) {
        activeAssignments[item.match.table - 1] = item;
      }
    });

    return activeAssignments;
  }

  // Visual state of a bracket match card: 'done', 'tabled' (on a table),
  // 'ready' (both teams known) or 'pending'.
  function getMatchCardState(match) {
    if (match.status === 'DONE') return 'done';
    if (match.table) return 'tabled';
    if (match.status === 'READY') return 'ready';
    return 'pending';
  }

  function bracketTeamName(team) {
    return team ? team.name : 'TBD';
  }

  // ==========================================
  // MATCH HISTORY & CSV EXPORT
  // ==========================================

  function safeFilePart(text, fallback) {
    return (text.trim() || fallback).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // Normalizes completed Monster and bracket matches into one list:
  // { uniqueId, stage, winner, team1: [players], team2: [players], games, isHandicap: 'Yes'|'No' }
  function getCompletedMatchesList(matches, bracketData, tournamentName, startDate) {
    const prefix = `${safeFilePart(tournamentName, 'Tournament')}_${startDate}`;
    const allCompletedMatches = [];

    matches
      .filter(m => m.status === 'DONE')
      .forEach(m => {
        allCompletedMatches.push({
          uniqueId: `${prefix}_MONSTER-${m.id}`,
          stage: 'Monster',
          winner: m.winner,
          team1: m.team1 || [],
          team2: m.team2 || [],
          games: m.games || [],
          isHandicap: m.isHandicap ? 'Yes' : 'No'
        });
      });

    if (bracketData) {
      const teamPlayers = team => (team ? (Array.isArray(team.players) ? team.players : [team]) : []);
      listBracketMatches(bracketData).forEach(({ match: m }) => {
        if (m.status === 'DONE' && m.winner) {
          allCompletedMatches.push({
            uniqueId: `${prefix}_BRACKET-${m.id}`,
            stage: 'Playoffs',
            winner: m.winner,
            team1: teamPlayers(m.team1),
            team2: teamPlayers(m.team2),
            games: m.games || [],
            isHandicap: m.isHandicap ? 'Yes' : 'No'
          });
        }
      });
    }

    return allCompletedMatches;
  }

  function winLoseNames(m) {
    const winTeam = m.winner === 1 ? m.team1 : m.team2;
    const loseTeam = m.winner === 1 ? m.team2 : m.team1;
    const name = (team, i) => (team[i] ? team[i].name : '');
    return {
      winP1: name(winTeam, 0),
      winP2: name(winTeam, 1),
      loseP1: name(loseTeam, 0),
      loseP2: name(loseTeam, 1)
    };
  }

  function winLoseScores(m, game) {
    const s1 = parseInt(game.t1, 10);
    const s2 = parseInt(game.t2, 10);
    return {
      winScore: m.winner === 1 ? s1 : s2,
      loseScore: m.winner === 1 ? s2 : s1
    };
  }

  // Display model for a match history row.
  function formatHistoryRow(m) {
    const { winP1, winP2, loseP1, loseP2 } = winLoseNames(m);
    return {
      winTeamStr: [winP1, winP2].filter(Boolean).join(' & '),
      loseTeamStr: [loseP1, loseP2].filter(Boolean).join(' & '),
      games: m.games.filter(g => g.t1 !== '' && g.t2 !== '').map(g => winLoseScores(m, g))
    };
  }

  const CSV_HEADERS = [
    'Match ID',
    'Date',
    'Game Number',
    'Winning Score',
    'Losing Score',
    'Winning Player 1',
    'Winning Player 2',
    'Losing Player 1',
    'Losing Player 2',
    'Handicap Override'
  ];

  function csvQuote(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  // One row per scored game. Returns null when there's nothing to export.
  function buildCsv(completedMatches, startDate) {
    if (completedMatches.length === 0) return null;

    const rows = [CSV_HEADERS.join(',')];
    completedMatches.forEach(m => {
      const { winP1, winP2, loseP1, loseP2 } = winLoseNames(m);
      m.games.forEach((game, gIdx) => {
        const { winScore, loseScore } = winLoseScores(m, game);
        if (isNaN(winScore) || isNaN(loseScore)) return;
        rows.push(
          [
            csvQuote(m.uniqueId),
            startDate,
            gIdx + 1,
            winScore,
            loseScore,
            csvQuote(winP1),
            csvQuote(winP2),
            csvQuote(loseP1),
            csvQuote(loseP2),
            csvQuote(m.isHandicap)
          ].join(',')
        );
      });
    });
    return rows.join('\n');
  }

  function csvFileName(tournamentName, startDate) {
    return `${safeFilePart(tournamentName, 'tournament')}_${startDate}.csv`;
  }

  // Triggers a browser download of the CSV via a temporary <a download> link.
  function downloadCsv(csvText, fileName, doc = globalThis.document) {
    const link = doc.createElement('a');
    link.setAttribute('href', encodeURI('data:text/csv;charset=utf-8,' + csvText));
    link.setAttribute('download', fileName);
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
  }

  function todayIsoDate(now = new Date()) {
    return now.toISOString().split('T')[0];
  }

  return {
    // sanitization & admin
    sanitizeInput,
    sanitizeInt,
    normalizeScoreInput,
    submitPin,
    forgetPin,
    // persistence
    STORAGE_KEY,
    restoreTournamentState,
    saveTournament,
    loadTournament,
    clearTournament,
    getBrowserStorage,
    // leaderboard
    FALLBACK_LEADERBOARD_PLAYERS,
    FALLBACK_LEADERBOARD_DATE,
    LEADERBOARD_URL,
    findLeaderboardPlayer,
    getLeaderboardInfo,
    parsePlayersDataScript,
    parseHtmlDocument,
    fetchLeaderboardPlayers,
    // roster
    createPlayer,
    checkNewPlayerName,
    addPlayer,
    addPlayersByName,
    togglePlayerFlag,
    renamePlayer,
    removePlayer,
    resetPlayerStats,
    countActivePlayers,
    hasPausedPlayers,
    computeStandings,
    togglePickerSelection,
    getLeaderboardPickerView,
    toggleSelectAll,
    getPlayerSuggestions,
    // matchmaking
    buildHistoryMatrices,
    getPairCount,
    drawFairMatch,
    // monster matches
    createGameSlots,
    findFreeTable,
    findLiveMatchAtTable,
    drawMonsterMatch,
    deleteMatch,
    updateMonsterGameScore,
    setMonsterHandicap,
    setMonsterOverrideWinner,
    getMatchWinner,
    completeMonsterMatch,
    teamLabel,
    // bracket setup
    getStandardBracketSeedPositions,
    buildBracketTeams,
    buildManualTeams,
    getManualTeamCandidates,
    setManualTeamPlayer,
    parseTeamCountInput,
    processLoserBracketByes,
    advanceLoserWinner,
    generateBracketStructure,
    createBracket,
    resetBracket,
    clearMatchResults,
    // bracket play
    getBracketMatch,
    updateBracketGameScore,
    setBracketHandicap,
    setBracketOverrideWinner,
    isBracketFinished,
    confirmBracketMatch,
    calculateBracketStandings,
    placeLabel,
    placeMedal,
    listBracketMatches,
    assignBracketTables,
    getMatchCardState,
    bracketTeamName,
    // history & export
    getCompletedMatchesList,
    formatHistoryRow,
    buildCsv,
    csvFileName,
    downloadCsv,
    todayIsoDate
  };
})();
