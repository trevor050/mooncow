import js from '@eslint/js';
import globals from 'globals';

const webext = { browser: 'readonly', chrome: 'readonly' };

export default [
  { ignores: ['node_modules/', 'vendor/', 'web-ext-artifacts/', 'test-results/', 'playwright-report/', '.shots/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, ...webext },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/content/**/*.js', 'src/shared/browser-shim.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['src/panel/panel.js'],
    languageOptions: { globals: { nerdamer: 'readonly', katex: 'readonly' } },
  },
  {
    files: ['test/**/*.js', 'e2e/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
