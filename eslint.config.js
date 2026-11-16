'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  { ignores: ['node_modules/', 'data/', 'coverage/', 'playwright-report/', 'test-results/', 'public/vendor/'] },
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
    // Browser scripts share functions through the global scope until the UI is rebuilt.
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, bootstrap: 'readonly', Chart: 'readonly' },
    },
    // The legacy UI is not edited before it is replaced (Phase 4), so its known style findings are off.
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      eqeqeq: 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'no-empty': 'off',
    },
  },
  prettier,
];
