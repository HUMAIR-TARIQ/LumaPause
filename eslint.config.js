import tseslint from 'typescript-eslint';

/**
 * Flat ESLint configuration for LumaPause.
 *
 * Routing through typescript-eslint keeps the rules aligned with the strict
 * compiler settings; formatting is owned by Prettier.
 */
export default tseslint.config(
  {
    ignores: [
      '.refdocs/**',
      'coverage/**',
      'legacy-tempo/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'release/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      '*.config.{js,mjs,ts}',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
