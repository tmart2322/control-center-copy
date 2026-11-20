import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-*/**',
      'out/**',
      'coverage/**',
      '.shots/**',
      '.claude/**',
      'tools/**',
      'public/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      'src/db/migrations/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests may poke at untyped fixtures.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default config;
