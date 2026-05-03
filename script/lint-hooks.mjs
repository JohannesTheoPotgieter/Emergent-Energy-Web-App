#!/usr/bin/env node
/**
 * lint-hooks.mjs
 * --------------
 * Targeted ESLint runner that fails the build on any
 * `react-hooks/rules-of-hooks` violation in the client. The repo's
 * ESLint config already declares the rule as `error`, but
 * `npm run lint` runs on the entire monorepo and is currently noisy
 * with TypeScript warnings, so violations like the QualityTab #310
 * regression slipped through unnoticed.
 *
 * This script:
 *   - lints client/src/**\/*.{ts,tsx} only,
 *   - filters to the single rule we care about,
 *   - exits non-zero if any violation is found.
 *
 * Wire into CI / pre-commit via `npm run lint:hooks`.
 */
import { ESLint } from "eslint";

const eslint = new ESLint();
const results = await eslint.lintFiles(["client/src/**/*.{ts,tsx}"]);

const offenders = results.flatMap((r) =>
  (r.messages || [])
    .filter((m) => m.ruleId === "react-hooks/rules-of-hooks")
    .map((m) => `${r.filePath}:${m.line}:${m.column}  ${m.message}`),
);

if (offenders.length > 0) {
  console.error(
    `\n✖ Rules-of-Hooks violations (${offenders.length}):\n` +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n\nFix by ensuring every hook (useState/useEffect/useMemo/useCallback/etc.)" +
      "\nis called unconditionally at the top of the component, BEFORE any\n" +
      "early `return`. See React docs: https://react.dev/link/rules-of-hooks\n",
  );
  process.exit(1);
}

console.log(
  `✓ No Rules-of-Hooks violations in client/src (${results.length} files scanned)`,
);
