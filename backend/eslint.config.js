const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  }
);
