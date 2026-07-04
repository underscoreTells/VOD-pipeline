import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = [
  'dist/**',
  'node_modules/**',
  'coverage/**',
  'src/**/*.d.ts',
  'src/**/*.js',
  'src/**/*.cjs',
  '**/*.svelte',
];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-case-declarations': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
