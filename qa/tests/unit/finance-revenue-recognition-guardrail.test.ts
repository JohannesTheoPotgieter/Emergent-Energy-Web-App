/**
 * § 3.3 revenue-recognition guardrail.
 *
 * This test pins the canonical formula contract:
 *
 *   The amount of revenue to recognise for a single normalised_cost_line is
 *   the persisted `revenue_recognition_amount` column (written at Smart
 *   Import time by the category-scoped per-line POC formula per
 *   AGENT_GUARDRAILS § 3.3.1). Routes MUST NOT re-derive revenue on the
 *   fly using project-pooled totals — that under-counts YTD revenue by
 *   ~93% (R 4.18M vs R 54.5M actual) when projects have incomplete NRL
 *   milestone data.
 *
 * The previous on-the-fly formula
 *   `(line_actual / project_total_actual) * sum_of_NRL_milestones`
 * is the EXACT pattern that produced the under-count, so we grep for it.
 *
 * If you legitimately need to compute revenue inline (e.g. a what-if
 * scenario tool), add the `// § 3.3 exception: …` marker on the same line
 * and document why in the PR description.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FINANCE_ROUTES = path.join(process.cwd(), "server/departments/finance-routes.ts");
const EXCEPTION_MARKER = /\/\/\s*§\s*3\.3\s*exception:/i;

describe("EE § 3.3 revenue-recognition guardrail", () => {
  const src = fs.readFileSync(FINANCE_ROUTES, "utf8");
  const lines = src.split("\n");

  it("finance-routes.ts does not import the deprecated allocateRevenue helper", () => {
    // The deprecated helper lives in server/lib/calculations/financeUtils.ts
    // and uses project-pooled totals. Any new code touching revenue
    // recognition must use the canonical persisted value
    // `revenue_recognition_amount` from normalized_cost_lines instead.
    const importMatches = src.match(/import\s*{[^}]*allocateRevenue[^}]*}\s*from\s*["']\.\.\/lib\/calculations\/financeUtils["']/);
    expect(importMatches, "finance-routes.ts must not import the deprecated allocateRevenue helper").toBeNull();
  });

  it("finance-routes.ts does not call allocateRevenue(...) (the deprecated helper)", () => {
    const callSites: string[] = [];
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (EXCEPTION_MARKER.test(line)) return;
      if (/\ballocateRevenue\s*\(/.test(line)) {
        callSites.push(`L${idx + 1}: ${trimmed}`);
      }
    });
    expect(callSites, [
      "Found call(s) to the deprecated allocateRevenue() in finance-routes.ts:",
      ...callSites,
      "",
      "Use the persisted revenue_recognition_amount column from",
      "normalized_cost_lines instead. See AGENT_GUARDRAILS § 3.3.",
    ].join("\n")).toEqual([]);
  });

  it("finance-routes.ts does not re-derive revenue with the project-pooled formula `(amount / totalCOS...) * totalRev... / totalMilestone...`", () => {
    // Detects the pre-fix pattern: `(X / totalCOS*) * totalRev*` or
    // `(X / totalCOS*) * totalMilestone*`. Comments and `// § 3.3 exception:`
    // markers are skipped so legitimate doc references don't trip.
    const offending: string[] = [];
    const re1 = /\(\s*\w+\s*\/\s*totalCOS\w*\s*\)\s*\*\s*total(?:Rev|Milestone)\w*/;
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (EXCEPTION_MARKER.test(line)) return;
      if (re1.test(line)) {
        offending.push(`L${idx + 1}: ${trimmed}`);
      }
    });
    expect(offending, [
      "Found project-pooled revenue-recognition formula(s) in finance-routes.ts:",
      ...offending,
      "",
      "This formula under-counts YTD revenue by ~93% for projects with",
      "incomplete NRL milestone data. Use the persisted",
      "revenue_recognition_amount from normalized_cost_lines (set by the",
      "Smart Import normalizer at write time) instead. See AGENT_GUARDRAILS § 3.3.",
    ].join("\n")).toEqual([]);
  });
});
