const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { L, player, teams, scoreFor } = require('./helpers');

const [ann, bo, cy, di] = [player(1, 'Ann'), player(2, 'Bo "B"'), player(3, 'Cy'), player(4, 'Di')];

const monsterDone = {
  id: 11,
  status: 'DONE',
  winner: 2,
  isHandicap: true,
  team1: [ann, bo],
  team2: [cy, di],
  games: [
    { t1: 3, t2: 5 },
    { t1: '', t2: '' },
    { t1: '5', t2: '4' }
  ]
};

describe('getCompletedMatchesList', () => {
  it('normalizes DONE Monster matches with defaults, ids prefixed by the tournament UUID', () => {
    const list = L.getCompletedMatchesList(
      [monsterDone, { id: 12, status: 'LIVE' }, { id: 13, status: 'DONE', winner: 1, isHandicap: false }],
      null,
      'tid-1'
    );
    assert.deepEqual(list[0], {
      uniqueId: 'tid-1_MONSTER-11',
      stage: 'Monster',
      winner: 2,
      team1: [ann, bo],
      team2: [cy, di],
      games: monsterDone.games,
      isHandicap: 'Yes'
    });
    assert.deepEqual(list[1], {
      uniqueId: 'tid-1_MONSTER-13',
      stage: 'Monster',
      winner: 1,
      team1: [],
      team2: [],
      games: [],
      isHandicap: 'No'
    });
  });

  it('collects DONE bracket matches in winners, losers, finals, 3rd place order', () => {
    const b = L.generateBracketStructure(teams(4), 'single', 1);
    [
      [0, 1],
      [1, 2]
    ].forEach(([mIdx, w]) => {
      scoreFor(b.winnersRounds[0][mIdx], w);
      L.confirmBracketMatch(b, 'winners', 0, mIdx);
    });
    scoreFor(b.thirdPlaceMatch, 1);
    L.confirmBracketMatch(b, 'thirdPlace', 0, 0);
    scoreFor(b.grandFinals[0], 1);
    L.confirmBracketMatch(b, 'grandFinals', 0, 0);
    const list = L.getCompletedMatchesList([], b, 'X');
    assert.deepEqual(
      list.map(m => m.uniqueId),
      ['X_BRACKET-m-winners-1-0', 'X_BRACKET-m-winners-1-1', 'X_BRACKET-m-grandFinal-2-0', 'X_BRACKET-m-thirdPlace-2-1']
    );
    assert.equal(list[0].stage, 'Playoffs');
    assert.deepEqual(
      list[0].team1.map(p => p.name),
      ['T1']
    );
  });

  it('handles losers rounds, teams without a players array, missing teams and games', () => {
    const b = L.generateBracketStructure(teams(4), 'double', 1);
    const solo = { id: 's', name: 'Solo' };
    Object.assign(b.losersRounds[0][0], {
      team1: solo,
      team2: null,
      status: 'DONE',
      winner: 1,
      games: undefined,
      isHandicap: true
    });
    b.losersRounds[1][0].status = 'DONE';
    const [entry] = L.getCompletedMatchesList([], b, 'X');
    assert.deepEqual(
      [entry.uniqueId, entry.team1, entry.team2, entry.games, entry.isHandicap],
      ['X_BRACKET-m-losers-1-0', [solo], [], [], 'Yes']
    );
  });
});

describe('formatHistoryRow', () => {
  it('builds winner/loser strings and per-game winner-first scores, skipping blanks', () => {
    const [entry] = L.getCompletedMatchesList([monsterDone], null, 'X');
    assert.deepEqual(L.formatHistoryRow(entry), {
      winTeamStr: 'Cy & Di',
      loseTeamStr: 'Ann & Bo "B"',
      games: [
        { winScore: 5, loseScore: 3 },
        { winScore: 4, loseScore: 5 }
      ]
    });
  });

  it('handles 1v1 and Team 1 wins', () => {
    const row = L.formatHistoryRow({
      winner: 1,
      team1: [ann],
      team2: [],
      games: [
        { t1: 5, t2: '' },
        { t1: 5, t2: 1 }
      ]
    });
    assert.deepEqual(row, { winTeamStr: 'Ann', loseTeamStr: '', games: [{ winScore: 5, loseScore: 1 }] });
  });
});

describe('buildCsv', () => {
  it('returns null when there is nothing to export', () => {
    assert.equal(L.buildCsv([], 'D'), null);
  });

  it('writes a header plus one quoted row per scored game', () => {
    const list = L.getCompletedMatchesList([monsterDone], null, 'X');
    list.push({
      uniqueId: 'solo',
      winner: 1,
      team1: [ann],
      team2: [cy],
      games: [
        { t1: 'x', t2: 1 },
        { t1: 5, t2: 2 }
      ],
      isHandicap: 'No'
    });
    assert.equal(
      L.buildCsv(list, '2026-10-16'),
      [
        'Match ID,Date,Game Number,Winning Score,Losing Score,Winning Player 1,Winning Player 2,Losing Player 1,Losing Player 2,Handicap Override',
        '"X_MONSTER-11",2026-10-16,1,5,3,"Cy","Di","Ann","Bo ""B""","Yes"',
        '"X_MONSTER-11",2026-10-16,3,4,5,"Cy","Di","Ann","Bo ""B""","Yes"',
        '"solo",2026-10-16,2,5,2,"Ann","","Cy","","No"'
      ].join('\n')
    );
  });
});

describe('csvFileName', () => {
  it('sanitizes the tournament name with a lowercase fallback', () => {
    assert.equal(L.csvFileName('Thu DYP', '2026-10-16'), 'Thu_DYP_2026-10-16.csv');
    assert.equal(L.csvFileName(' ', 'D'), 'tournament_D.csv');
  });
});

describe('downloadCsv', () => {
  const realDocument = globalThis.document;
  afterEach(() => {
    globalThis.document = realDocument;
  });

  function fakeDocument() {
    const log = [];
    const link = {
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      click() {
        log.push('click');
      }
    };
    return {
      log,
      link,
      createElement(tag) {
        log.push(`create:${tag}`);
        return link;
      },
      body: {
        appendChild(el) {
          log.push(el === link ? 'append' : 'append?');
        },
        removeChild(el) {
          log.push(el === link ? 'remove' : 'remove?');
        }
      }
    };
  }

  it('clicks a temporary data-URI link and removes it', () => {
    const doc = fakeDocument();
    L.downloadCsv('a,b\n"c d"', 'out.csv', doc);
    assert.deepEqual(doc.log, ['create:a', 'append', 'click', 'remove']);
    assert.deepEqual(doc.link.attrs, {
      href: 'data:text/csv;charset=utf-8,a,b%0A%22c%20d%22',
      download: 'out.csv'
    });
  });

  it('defaults to the global document', () => {
    globalThis.document = fakeDocument();
    L.downloadCsv('x', 'y.csv');
    assert.equal(globalThis.document.log.length, 4);
  });
});
