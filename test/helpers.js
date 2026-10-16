// Shared test helpers. tournament-logic.js is a classic browser script that
// attaches its API to globalThis, so requiring it once exposes it here.
require('../tournament-logic.js');

const L = globalThis.TournamentLogic;

// Deterministic stand-in for Math.random that replays `values` in a loop.
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const zero = () => 0;

function player(id, name = `P${id}`, extra = {}) {
  return { ...L.createPlayer(id, name), ...extra };
}

function players(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => player(i + 1, `P${i + 1}`, extra));
}

function team(id, name = `T${id}`) {
  return { id: `team-${id}`, name, players: [player(id, name)] };
}

function teams(n) {
  return Array.from({ length: n }, (_, i) => team(i + 1));
}

const BYE = { id: 'bye-x', name: 'BYE', isBye: true };

// A bracket match whose scores make `winner` (1 or 2) win a best-of-1.
function scoreFor(match, winner) {
  match.games = [winner === 1 ? { t1: 5, t2: 0 } : { t1: 0, t2: 5 }];
}

module.exports = { L, seq, zero, player, players, team, teams, BYE, scoreFor };
