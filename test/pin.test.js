const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { L } = require('./helpers');

describe('submitPin', () => {
  it('with no PIN set, the first lock sets a 4-8 digit PIN and locks', () => {
    assert.deepEqual(L.submitPin({ pin: null, input: '2468', isLocked: false }), { pin: '2468', isLocked: true });
    assert.deepEqual(L.submitPin({ pin: null, input: '12345678', isLocked: false }), {
      pin: '12345678',
      isLocked: true
    });
  });

  it('rejects a new PIN that is not 4-8 digits', () => {
    const error = { error: 'Choose a PIN of 4 to 8 digits.' };
    ['', '123', '123456789', '12a4', ' 1234'].forEach(input =>
      assert.deepEqual(L.submitPin({ pin: null, input, isLocked: false }), error)
    );
  });

  it('the correct PIN toggles the lock and keeps the PIN', () => {
    assert.deepEqual(L.submitPin({ pin: '2468', input: '2468', isLocked: false }), { pin: '2468', isLocked: true });
    assert.deepEqual(L.submitPin({ pin: '2468', input: '2468', isLocked: true }), { pin: '2468', isLocked: false });
  });

  it('a wrong PIN is rejected', () => {
    assert.deepEqual(L.submitPin({ pin: '2468', input: '1234', isLocked: true }), { error: 'Incorrect PIN!' });
  });

  it('no longer ships a default PIN', () => {
    assert.equal(L.newTournamentState('id', new Date()).adminPin, null);
    assert.equal('checkPin' in L, false);
  });
});

describe('forgetPin', () => {
  it('unlocks and clears the PIN so a new one can be set', () => {
    assert.deepEqual(L.forgetPin(), { pin: null, isLocked: false });
  });
});
