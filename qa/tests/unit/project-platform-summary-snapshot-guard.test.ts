/**
 * Project Delivery deep audit — wave 3 (2026-05-26), updated 2026-06.
 *
 * § 3.1 HARD rule: snapshot-table reads must use `effective_to IS NULL`
 * ONLY (never the relaxed `IS NULL OR > NOW()` pattern, which would include
 * future-dated supersessions and silently double-count).
 *
 * 2026-06 convergence: the live finance fallback in
 * project-platform-summary-service.ts no longer issues its own
 * `SUM(... WHERE cos_realised)` SQL against normalized_cost_lines. It now
 * delegates to `getCanonicalFinanceByProjectIds`, the SAME snapshot-guarded,
 * gate-based aggregator the materialiser uses — so the live fallback and the
 * cache can never disagree on the realised numbers, and the persisted
 * `cos_realised` boolean (invoice-only — no colour, no future-date guard) is
 * no longer trusted as a realisation signal here. The §3.1 guard still
 * applies; it now lives inside the canonical aggregator (which has its own
 * snapshot-guard coverage).
 *
 * This test pins both invariants so a future regression is caught in CI.
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

describe("project-platform-summary-service — § 3.1 snapshot guard + finance convergence", () => {
  it("routes the live finance fallback through the canonical snapshot-guarded aggregator", () => {
    // getCanonicalFinanceByProjectIds applies `effective_to IS NULL` +
    // `deleted_at IS NULL` on every read and computes realised cost through
    // `isCanonicalCosRealised` (incl. the future-date guard) — so the §3.1
    // guarantee and the single realisation gate are both preserved.
    expect(SOURCE).toMatch(/getCanonicalFinanceByProjectIds\s*\(/);
  });

  it("does NOT sum the persisted `cos_realised` boolean inline (split-brain anti-pattern)", () => {
    // The realised over-count came from `SUM(... WHERE cos_realised)` summing a
    // boolean that ignored invoice-date colour + the future-date guard. The
    // canonical gate is the single source of truth now; refuse the raw pattern.
    expect(SOURCE).not.toMatch(/WHEN\s+cos_realised/i);
    expect(SOURCE).not.toMatch(/WHERE\s+cos_realised/i);
  });

  it("does NOT use the relaxed `(IS NULL OR > NOW())` / `> CURRENT_TIMESTAMP` snapshot pattern", () => {
    // If any snapshot SQL is (re)introduced here it must use the strict guard.
    expect(SOURCE).not.toMatch(/effective_to\s+IS\s+NULL\s+OR\s+effective_to\s*>/i);
  });
});
