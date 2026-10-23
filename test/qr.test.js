const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const qrcode = require('qrcode-generator');
const jsQR = require('jsqr');
const { L } = require('./helpers');

const ID = '11111111-1111-4111-8111-111111111111';
const LAYOUT = { arrangement: 'top', tables: 0.5, standings: 0.5 };

// Paints QR modules (plus the quiet zone) into an RGBA buffer, 4 pixels per
// module, the way a phone camera would see the dialog, and decodes it.
function decode(modules) {
  const scale = 4;
  const size = (modules.length + 2 * L.QR_QUIET_ZONE) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + L.QR_QUIET_ZONE) * scale + y) * size + (c + L.QR_QUIET_ZONE) * scale + x;
          data.fill(0, px * 4, px * 4 + 3);
        }
      }
    })
  );
  const result = jsQR(data, size, size);
  return result && result.data;
}

describe('qrModules', () => {
  it('encodes a viewer link that decodes back to the same URL', () => {
    const url = L.remoteTournamentUrl('http://192.168.0.22:8080/', ID, LAYOUT);
    const modules = L.qrModules(url, qrcode);
    assert.equal(modules.length, modules[0].length, 'square');
    assert.ok(modules.length >= 21, 'at least a version 1 code');
    assert.equal(decode(modules), url);
  });

  it('handles a long hosted address', () => {
    const url = L.remoteTournamentUrl('https://calgaryfoosballclub.com/dyp/index.html?x=1', ID, LAYOUT);
    assert.equal(decode(L.qrModules(url, qrcode)), url);
  });
});

describe('qrSvgPath', () => {
  it('draws one unit square per dark module, offset by the quiet zone', () => {
    assert.equal(
      L.qrSvgPath([
        [true, false],
        [false, true]
      ]),
      'M4 4h1v1h-1zM5 5h1v1h-1z'
    );
    assert.equal(L.qrSvgPath([[false]]), '');
  });

  it('sizes the drawing to the code plus a quiet zone on each side', () => {
    assert.equal(
      L.qrViewBoxSize([
        [true, false],
        [false, true]
      ]),
      2 + 2 * L.QR_QUIET_ZONE
    );
  });
});

describe('choiceViewerUrl', () => {
  const href = 'http://192.168.0.22:8080/?display=1';

  it('links a published tournament from the address the page is open at', () => {
    const remote = { source: 'remote', id: ID };
    assert.equal(
      L.choiceViewerUrl(remote, { href, layout: LAYOUT, publishedId: null }),
      `http://192.168.0.22:8080/?remote=${ID}&layout=top-50-50`
    );
    assert.equal(
      L.choiceViewerUrl(remote, { href: 'https://club.example/dyp/', layout: LAYOUT, publishedId: null }),
      `https://club.example/dyp/?remote=${ID}&layout=top-50-50`
    );
  });

  it("links this device's tournament only while it is published", () => {
    const local = { source: 'local', id: ID };
    assert.equal(
      L.choiceViewerUrl(local, { href, layout: LAYOUT, publishedId: ID }),
      `http://192.168.0.22:8080/?remote=${ID}&layout=top-50-50`
    );
    assert.equal(L.choiceViewerUrl(local, { href, layout: LAYOUT, publishedId: null }), null);
    assert.equal(L.choiceViewerUrl(local, { href, layout: LAYOUT, publishedId: 'other' }), null);
  });
});

describe('isLocalOnlyUrl', () => {
  it('spots addresses other devices cannot reach', () => {
    for (const url of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://[::1]:8080/', 'http://0.0.0.0:8080/']) {
      assert.equal(L.isLocalOnlyUrl(url), true, url);
    }
    for (const url of [
      'http://192.168.0.22:8080/',
      'https://calgaryfoosballclub.com/dyp/',
      'http://ddesk6.local:8080/'
    ]) {
      assert.equal(L.isLocalOnlyUrl(url), false, url);
    }
  });
});
