import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', '**/*.d.ts', 'qa/artifacts/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn', // TODO: upgrade to 'error' once any count is below 500
      '@typescript-eslint/no-unused-vars': 'warn', // TODO: upgrade to 'error' once unused vars are cleaned up
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // ── Server-only guard against raw-error-leak pattern ─────────────
  //
  // `res.status(5xx).json({ error: err.message ... })` leaked raw Drizzle /
  // PostgreSQL errors (SQL text, constraint names, schema) to any client
  // who triggered a 500. Sweep the occurrences; keep `throw err` (or
  // `throw new ApiError(...)`) so the global handler sanitises.
  //
  // Historical offenders that still carry the pattern opt out via a
  // file-level `/* eslint-disable no-restricted-syntax */` — tracked tech
  // debt to be removed as each file is touched.
  {
    files: ['server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='json'] MemberExpression[object.name=/^(err|error)$/][property.name=/^(message|stack)$/]",
          message:
            'Raw err.message / err.stack in a JSON response body leaks DB details. Throw the error (or throw a sanitised ApiError) and let the global error handler respond.',
        },
        {
          selector:
            "CallExpression[callee.property.name='json'] CallExpression[callee.name='String'][arguments.length=1] > Identifier[name=/^(err|error)$/]",
          message:
            'String(err) / String(error) inside a JSON response body stringifies the raw error. Throw the error (or an ApiError) instead.',
        },
        {
          selector:
            "CallExpression[callee.property.name='json'] Property[value.type='Identifier'][value.name=/^(err|error)$/]",
          message:
            'Passing the whole catch variable (err / error) into a JSON response serialises via toString() and can leak details. Throw the error (or an ApiError) instead.',
        },
        {
          selector:
            "CallExpression[callee.property.name='json'] CallExpression[callee.object.name='JSON'][callee.property.name='stringify'] > Identifier[name=/^(err|error)$/]",
          message:
            'JSON.stringify(err) / JSON.stringify(error) inside a response body serialises the raw error shape. Throw the error (or an ApiError) instead.',
        },
      ],
    },
  },
  prettierConfig,
];
