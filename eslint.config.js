// ESLint flat config. Lints the logic module, the tests, the build script,
// and the inline JSX (<script type="text/babel">) inside TournamentManager.html.
const js = require('@eslint/js');
const globals = require('globals');
const html = require('eslint-plugin-html');
const react = require('eslint-plugin-react');

const quality = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  curly: ['error', 'multi-line'],
  'no-implicit-globals': 'error',
  complexity: ['warn', 25]
};

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['tournament-logic.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: quality
  },
  {
    files: ['test/**/*.js', 'test-firebase/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: quality
  },
  {
    // UI tests run in Node; callbacks passed to page.evaluate run in the browser.
    files: ['test-e2e/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: quality
  },
  {
    files: ['**/*.html'],
    plugins: { html, react },
    settings: { 'html/javascript-mime-types': ['text/babel'], react: { version: '18.3' } },
    languageOptions: {
      sourceType: 'script',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, React: 'readonly', ReactDOM: 'readonly', tailwind: 'writable' }
    },
    rules: {
      ...quality,
      // The Babel block is the app entry point: MatchCard and FoosballApp are
      // meant to be top-level, and FoosballApp is one large stateful component.
      'no-implicit-globals': 'off',
      complexity: 'off',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-unescaped-entities': 'off'
    }
  }
];
