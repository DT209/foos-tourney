const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L, player, teams } = require('./helpers');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}

const fullStorage = {
  getItem: () => null,
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {}
};

const ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-17T03:00:00Z');

function tournament(overrides = {}) {
  return {
    ...L.newTournamentState(ID, new Date(2026, 9, 16, 19, 0)),
    tournamentName: 'Week #3 <Open>',
    players: [player(1, 'Ann'), player(2, 'Bo')],
    matches: [{ id: 5, status: 'DONE', team1: [player(1, 'Ann')], team2: [player(2, 'Bo')], games: [], winner: 1 }],
    bracketData: L.generateBracketStructure(teams(4), 'single', 1),
    ...overrides
  };
}

describe('serializeTournamentExport', () => {
  it('wraps the persisted fields in a versioned, self-describing envelope', () => {
    const json = L.serializeTournamentExport({ ...tournament(), showPinModal: true }, NOW);
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, 'foos-tourney');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.exportedAt, NOW.toISOString());
    assert.deepEqual(parsed.tournament, JSON.parse(JSON.stringify(tournament())));
    assert.equal('showPinModal' in parsed.tournament, false);
  });

  it('defaults exportedAt to now', () => {
    assert.ok(Date.parse(JSON.parse(L.serializeTournamentExport(tournament())).exportedAt) > 0);
  });
});

describe('tournamentExportFileName', () => {
  it('uses a safe name, the local start date and a short id', () => {
    assert.equal(L.tournamentExportFileName(tournament()), 'Week__3__Open__2026-10-16_11111111.json');
    assert.equal(
      L.tournamentExportFileName(tournament({ tournamentName: '  ' })),
      'tournament_2026-10-16_11111111.json'
    );
  });
});

describe('parseTournamentExport', () => {
  const opts = { newId: () => NEW_ID, now: NOW };

  it('round-trips an export', () => {
    const result = L.parseTournamentExport(L.serializeTournamentExport(tournament(), NOW), opts);
    assert.deepEqual(result.tournament, JSON.parse(JSON.stringify(tournament())));
  });

  it('fills invalid or missing fields with defaults, like a saved tournament', () => {
    const text = JSON.stringify({ format: 'foos-tourney', version: 1, tournament: { tournamentId: ID, players: 'x' } });
    const { tournament: t } = L.parseTournamentExport(text, opts);
    assert.equal(t.tournamentId, ID);
    assert.deepEqual(t.players, []);
    assert.equal(t.startedAt, NOW.toISOString());
  });

  it('rejects files that are not Foos Tourney exports', () => {
    const notOurs = { error: "This file isn't a Foos Tourney tournament export." };
    assert.deepEqual(L.parseTournamentExport('{oops', opts), notOurs);
    assert.deepEqual(L.parseTournamentExport('null', opts), notOurs);
    assert.deepEqual(L.parseTournamentExport(JSON.stringify({ format: 'other', version: 1 }), opts), notOurs);
    assert.deepEqual(
      L.parseTournamentExport(JSON.stringify({ format: 'foos-tourney', version: 1, tournament: [] }), opts),
      notOurs
    );
  });

  it('rejects exports from a newer version', () => {
    assert.deepEqual(
      L.parseTournamentExport(JSON.stringify({ format: 'foos-tourney', version: 2, tournament: {} }), opts),
      {
        error: 'This file was exported by a newer version of the Tournament Manager. Update the page and try again.'
      }
    );
  });

  it('rejects an export without a tournament id', () => {
    assert.deepEqual(
      L.parseTournamentExport(
        JSON.stringify({ format: 'foos-tourney', version: 1, tournament: { tournamentName: 'x' } }),
        opts
      ),
      { error: 'This export is missing its tournament id.' }
    );
  });

  it('defaults the clock and id generator', () => {
    const text = JSON.stringify({ format: 'foos-tourney', version: 1, tournament: { tournamentId: ID } });
    assert.equal(L.parseTournamentExport(text).tournament.tournamentId, ID);
  });
});

describe('tournamentExists', () => {
  it('reports whether a tournament id is saved', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, tournament());
    assert.equal(L.tournamentExists(storage, ID), true);
    assert.equal(L.tournamentExists(storage, NEW_ID), false);
    assert.equal(L.tournamentExists(null, ID), false);
  });
});

describe('storeImportedTournament', () => {
  const opts = mode => ({ mode, newId: () => NEW_ID, now: NOW });

  it('adds a new tournament without making it current', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, tournament({ tournamentId: NEW_ID }));
    assert.deepEqual(L.storeImportedTournament(storage, tournament(), opts('add')), { id: ID });
    assert.equal(L.loadTournament(storage, ID).tournamentName, 'Week #3 <Open>');
    assert.equal(storage.getItem(L.CURRENT_TOURNAMENT_KEY), NEW_ID);
  });

  it('replace overwrites the saved copy with the same id', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, tournament({ tournamentName: 'Old' }));
    assert.deepEqual(L.storeImportedTournament(storage, tournament(), opts('replace')), { id: ID });
    assert.equal(L.loadTournament(storage, ID).tournamentName, 'Week #3 <Open>');
    assert.equal(L.listTournaments(storage).length, 1);
  });

  it('copy keeps both under a new id with "(copy)" in the name', () => {
    const storage = memoryStorage();
    L.saveTournament(storage, tournament());
    assert.deepEqual(L.storeImportedTournament(storage, tournament(), opts('copy')), { id: NEW_ID });
    assert.equal(L.loadTournament(storage, NEW_ID).tournamentName, 'Week #3 <Open> (copy)');
    assert.equal(L.loadTournament(storage, NEW_ID).tournamentId, NEW_ID);
    assert.equal(L.listTournaments(storage).length, 2);
  });

  it('reports when the browser cannot store it', () => {
    assert.deepEqual(L.storeImportedTournament(fullStorage, tournament(), opts('add')), {
      error: 'Could not save the imported tournament in this browser.'
    });
  });

  it('defaults the clock and id generator', () => {
    const storage = memoryStorage();
    const { id } = L.storeImportedTournament(storage, tournament(), { mode: 'copy' });
    assert.match(id, /^[0-9a-f-]{36}$/);
  });
});

describe('downloadText', () => {
  function fakeDocument() {
    const link = {
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      click() {
        this.clicked = true;
      }
    };
    return {
      link,
      createElement: () => link,
      body: { appendChild() {}, removeChild() {} }
    };
  }

  it('percent-encodes everything, so a # no longer truncates the file', () => {
    const doc = fakeDocument();
    L.downloadText('{"name":"Week #3"}', 'x.json', 'application/json', doc);
    assert.equal(
      doc.link.attrs.href,
      'data:application/json;charset=utf-8,' + encodeURIComponent('{"name":"Week #3"}')
    );
    assert.equal(doc.link.attrs.download, 'x.json');
    assert.equal(doc.link.clicked, true);
    assert.equal(decodeURIComponent(doc.link.attrs.href.split(',').slice(1).join(',')), '{"name":"Week #3"}');
  });
});
