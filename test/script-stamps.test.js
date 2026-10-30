const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LOCAL_SCRIPTS, stampFor, stampScripts, staleStamps } = require('../scripts/script-stamps');

const files = { 'tournament-logic.js': 'logic v1', 'firebase-config.js': 'config' };
const page =
  '<script src="https://cdn.example/react.js"></script>\n<script src="tournament-logic.js"></script>\n<script src="firebase-config.js?v=0123456789"></script>';

describe('script version stamps', () => {
  it('cover the three scripts the page loads from its own folder', () => {
    assert.deepEqual(LOCAL_SCRIPTS, ['tournament-logic.js', 'firebase-config.js', 'firebase-remote.js']);
  });

  it('are the first 10 hex digits of the SHA-256, so any change gives a new URL', () => {
    assert.equal(stampFor('logic v1'), stampFor('logic v1'));
    assert.match(stampFor('logic v1'), /^[0-9a-f]{10}$/);
    assert.notEqual(stampFor('logic v1'), stampFor('logic v2'));
  });

  it('stamp plain and stale tags, leaving other scripts alone', () => {
    const stamped = stampScripts(page, files);
    assert.equal(
      stamped,
      `<script src="https://cdn.example/react.js"></script>\n<script src="tournament-logic.js?v=${stampFor('logic v1')}"></script>\n<script src="firebase-config.js?v=${stampFor('config')}"></script>`
    );
    assert.equal(stampScripts(stamped, files), stamped, 'stamping again changes nothing');
  });

  it("refuse a page that doesn't load a script", () => {
    assert.throws(() => stampScripts(page, { 'firebase-remote.js': 'x' }), /doesn't load firebase-remote\.js/);
  });

  it('report tags that are unstamped, stale, missing or duplicated', () => {
    assert.deepEqual(staleStamps(page, files), ['tournament-logic.js', 'firebase-config.js']);
    assert.deepEqual(staleStamps(stampScripts(page, files), files), []);
    assert.deepEqual(staleStamps(stampScripts(page, files), { ...files, 'tournament-logic.js': 'logic v2' }), [
      'tournament-logic.js'
    ]);
    assert.deepEqual(staleStamps(page, { 'firebase-remote.js': 'x' }), ['firebase-remote.js']);
    const twice = stampScripts(page, files) + `<script src="firebase-config.js?v=${stampFor('config')}"></script>`;
    assert.deepEqual(staleStamps(twice, files), ['firebase-config.js']);
  });
});
