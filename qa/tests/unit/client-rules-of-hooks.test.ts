/**
 * Regression guard for React #310 ("Rendered more hooks than during the
 * previous render"). The class of bug is structural — a hook
 * (useState / useEffect / useMemo / useCallback / …) declared AFTER an
 * early `return` causes the hook count to differ between the loading
 * render and the loaded render, which crashes the page at runtime with
 * an unhelpful minified error.
 *
 * Notable past offender: `client/src/components/tabs/QualityTab.tsx` had
 * two `useMemo` calls (drillDownInstances, drillDownInPhase) below the
 * `if (isLoading) return …` block, which crashed the entire `/quality`
 * route on every load. See git history around 2026-04-29 for the fix.
 *
 * This test runs `eslint-plugin-react-hooks` against the entire client
 * codebase and asserts zero violations of `react-hooks/rules-of-hooks`.
 * The rule itself is already configured as `error` in `eslint.config.js`;
 * this test makes that contract enforceable from `npm test` so future
 * regressions are caught before they ship.
 */
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

describe("client Rules of Hooks", () => {
  it("has zero react-hooks/rules-of-hooks violations under client/src", async () => {
    const eslint = new ESLint();
    const results = await eslint.lintFiles(["client/src/**/*.{ts,tsx}"]);

    const offenders = results.flatMap((r) =>
      (r.messages || [])
        .filter((m) => m.ruleId === "react-hooks/rules-of-hooks")
        .map((m) => `${r.filePath}:${m.line}:${m.column}  ${m.message}`),
    );

    expect(
      offenders,
      `Found ${offenders.length} Rules-of-Hooks violation(s):\n${offenders.join("\n")}`,
    ).toEqual([]);
  }, 120_000);
});
