/**
 * Project Delivery deep audit — wave 3 (2026-05-26).
 *
 * § 3.1 HARD rule: snapshot-table reads must use `effective_to IS NULL`
 * ONLY. The previously-used `(effective_to IS NULL OR effective_to > NOW())`
 * pattern would include rows with a future-dated supersession — a
 * silent double-count if any caller writes a scheduled change. The
 * wave-3 audit caught this in project-platform-summary-service.ts and
 * tightened both SQLite and PostgreSQL branches.
 *
 * This test reads the service source and pins the strict guard so any
 * future regression is caught in CI.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    "../../../server/services/project-platform-summary-service.ts",
  ),
  "utf8",
);

describe("project-platform-summary-service — § 3.1 snapshot guard", () => {
  it("both DB branches read normalized_cost_lines with `effective_to IS NULL` ONLY", () => {
    // The strict pattern must appear at least twice (one per DB branch).
    const strictMatches = SOURCE.match(/effective_to\s+IS\s+NULL/g) || [];
    expect(strictMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT use the relaxed `(IS NULL OR > NOW())` / `> CURRENT_TIMESTAMP` pattern", () => {
    // The relaxed pattern includes future-dated supersessions and
    // breaks § 3.1 (double-count risk). Refuse it.
    expect(SOURCE).not.toMatch(/effective_to\s+IS\s+NULL\s+OR\s+effective_to\s*>/i);
  });
});
