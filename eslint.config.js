'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      '.claude/',
      'node_modules/',
      'data/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'public/vendor/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
    },
  },
  {
    // The client script of the server-rendered pages: plain browser JavaScript, all rules on.
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // Playwright scripts pass functions to the browser, where window and document exist.
    files: ['scripts/check-routes.js', 'scripts/capture-screenshots.js'],
    languageOptions: { globals: { ...globals.node, window: 'readonly', document: 'readonly' } },
  },
  prettier,
];
