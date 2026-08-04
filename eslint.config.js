'use strict';

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const boundaries = require('eslint-plugin-boundaries');
const sonarjs = require('eslint-plugin-sonarjs');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      boundaries,
      sonarjs,
    },
    settings: {
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/*' },
        {
          type: 'domain',
          pattern: 'src/modules/*/domain',
          capture: ['module'],
        },
        {
          type: 'application',
          pattern: 'src/modules/*/application',
          capture: ['module'],
        },
        {
          type: 'infrastructure',
          pattern: 'src/modules/*/infrastructure',
          capture: ['module'],
        },
      ],
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Baseline complexity gate. Domain code has stricter, class-scoped targets
      // (Rule <= 3, RiskFilter/RiskEngine <= 5, rest of domain <= 10) per
      // docs/ESTANDAR_INGENIERIA_DOMINIO.md, but sonarjs/cognitive-complexity is
      // function/file scoped, not class-aware, so those targets cannot be encoded
      // here — enforce them via review until a dedicated check exists.
      'sonarjs/cognitive-complexity': ['warn', 15],

      // Best-effort layering: domain is pure (no application/infrastructure/shared,
      // no other module's domain), application depends only on its own module's
      // domain, infrastructure depends on its own module's application + domain.
      // Cross-module access through a module's public surface is not fully
      // enforced yet — refine when public-surface entry points exist.
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: 'domain',
              disallow: [
                'application',
                'infrastructure',
                ['domain', { module: '!${from.module}' }],
              ],
              message:
                'domain must stay pure: no application, infrastructure, shared, or other modules\' domain.',
            },
            {
              from: 'domain',
              disallow: ['shared'],
              message: 'domain must stay pure: no dependency on shared/.',
            },
            {
              from: 'application',
              disallow: [
                'infrastructure',
                ['domain', { module: '!${from.module}' }],
                ['application', { module: '!${from.module}' }],
              ],
              message:
                'application may only depend on its own module\'s domain.',
            },
            {
              from: 'infrastructure',
              disallow: [
                ['domain', { module: '!${from.module}' }],
                ['application', { module: '!${from.module}' }],
                ['infrastructure', { module: '!${from.module}' }],
              ],
              message:
                'infrastructure may only depend on its own module\'s application + domain.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'max-depth': ['error', 1],
    },
  },
];
