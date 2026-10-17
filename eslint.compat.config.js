// Cross-browser check (build step "Cross-browser check"), separate from the
// style lint so its findings read as bugs. Covers the code browsers run: the
// logic module, the Firebase files and the inline JSX in the page.
//
// 1. compat/compat: browser APIs unsupported by the targets in package.json
//    "browserslist" (MDN compatibility data).
// 2. Secure-context APIs: browsers only provide these on HTTPS or localhost,
//    so they are missing when the page is opened from a plain-http LAN
//    address (http://192.168.x.x). Code that checks for them first and has a
//    fallback can say so with an eslint-disable-next-line comment and a reason.
const globals = require('globals');
const html = require('eslint-plugin-html');
const compat = require('eslint-plugin-compat');

const BUG = 'Cross-browser bug:';
const SECURE_ONLY = `only exists on secure pages (HTTPS or localhost), so it is missing on a plain-http LAN address. Check for it and fall back.`;

const secureContextProperties = [
  'randomUUID',
  'subtle',
  'clipboard',
  'serviceWorker',
  'mediaDevices',
  'wakeLock',
  'credentials',
  'geolocation',
  'share',
  'canShare'
].map(property => ({ property, message: `${BUG} ${property} ${SECURE_ONLY}` }));

const secureContextGlobals = ['Notification', 'PaymentRequest', 'caches'].map(name => ({
  name,
  message: `${BUG} ${name} ${SECURE_ONLY}`
}));

const rules = {
  'compat/compat': 'error',
  'no-restricted-properties': ['error', ...secureContextProperties],
  'no-restricted-globals': ['error', ...secureContextGlobals]
};

module.exports = [
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['tournament-logic.js', 'firebase-remote.js', 'firebase-config.js'],
    plugins: { compat },
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules
  },
  {
    files: ['**/*.html'],
    plugins: { html, compat },
    settings: { 'html/javascript-mime-types': ['text/babel'] },
    languageOptions: {
      sourceType: 'script',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    rules
  }
];
