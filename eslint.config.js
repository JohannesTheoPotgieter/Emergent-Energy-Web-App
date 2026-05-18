import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    // scripts/_archive is dead archived code (already excluded from
    // tsconfig.check.json); tmp/ holds dev scratch + data dumps, not source.
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '**/*.d.ts',
      'qa/artifacts/**',
      'scripts/_archive/**',
      'tmp/**',
    ],
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
      // The bare 'warn' override above the recommended preset dropped its
      // default ignore patterns, so the `_`-prefix convention for
      // intentionally-unused bindings did not work. Restore it explicitly.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ], // TODO: upgrade to 'error' once unused vars are cleaned up
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
        // parseInt(req.params.X) (or wrapped in String() / paramStr() / `as string`)
        // returns NaN silently and produces wrong WHERE clauses. Use
        // parseIntParam() from server/lib/req-params instead — it consolidates
        // the param extraction so we can later add validation in one place.
        {
          selector:
            "CallExpression[callee.name='parseInt'] :matches(MemberExpression[object.object.name='req'][object.property.name='params'], CallExpression[callee.name=/^(String|paramStr|p)$/] > MemberExpression[object.object.name='req'][object.property.name='params'], TSAsExpression > MemberExpression[object.object.name='req'][object.property.name='params'])",
          message:
            'parseInt(req.params.X) silently returns NaN on bad input. Use parseIntParam(req.params.X) from server/lib/req-params instead.',
        },
      ],
    },
  },
  // ── New-style route files: must go through the repository layer ─
  //
  // server/routes/<domain>.routes.ts is the canonical new-route location.
  // Per CLAUDE.md, route handlers in this layout MUST NOT call
  // db.select / db.insert / db.update / db.delete directly — all CRUD
  // belongs in server/repositories/* so RBAC, audit, and snapshot
  // invariants are centrally enforced.
  //
  // Legacy server/*-routes.ts files are intentionally NOT covered by this
  // rule yet — they hold the bulk of the in-progress repository migration
  // and would require ~1.4k disable comments in one go.
  {
    files: ['server/routes/**/*.routes.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='db'][callee.property.name=/^(select|insert|update|delete)$/]",
          message:
            'Direct db.{select,insert,update,delete} from a *.routes.ts handler bypasses the repository layer (CLAUDE.md). Move the call into server/repositories/* and import the repo method.',
        },
      ],
    },
  },
  // ── EE-QA-017: legacy Excel parser / scheduler — no NEW imports ─
  //
  // server/excelParser.ts and server/importPipeline.ts are the legacy
  // pre-Smart-Import-v2 modules. The 4 existing call sites are tracked
  // for migration as a structural workstream; this rule prevents new
  // call sites from accumulating in the meantime. To migrate a caller,
  // delete the entry from the allowlist below and switch the file to
  // server/imports/* (Smart Import v2).
  {
    files: ['server/**/*.{ts,tsx}'],
    ignores: [
      'server/excelParser.ts',
      'server/importPipeline.ts',
      'server/routes/imports-admin-extracted-routes.ts',
      'server/departments/admin-routes.ts',
      'server/bootstrap/start-runtime-services.ts',
      'server/bootstrap/environment-status.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/excelParser', '**/importPipeline'],
              message:
                'EE-QA-017 — server/excelParser.ts and server/importPipeline.ts are deprecated (Smart Import v2 lives in server/imports/). Do not add new callers; the 4 existing legacy call sites are explicitly allow-listed and tracked for migration.',
            },
          ],
        },
      ],
    },
  },
  {
    // CommonJS files legitimately use require(); no-require-imports targets
    // ESM modules only. Placed after the recommended ruleset so it wins.
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // CLI scripts, QA/test harnesses, audit probes and build tooling write
    // to stdout/stderr by design — console is their output mechanism, not
    // debug debt. Runtime code (server/**, client/**) is NOT exempt and
    // must use the structured logger.
    files: [
      'scripts/**/*.{ts,tsx,js,mjs,cjs}',
      'script/**/*.{ts,tsx,js,mjs,cjs}',
      'qa/**/*.{ts,tsx,js,mjs,cjs}',
      'audit/**/*.{ts,tsx,js,mjs,cjs}',
      '*.config.{js,ts,mjs,cjs}',
      'vite-plugin-*.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
];
