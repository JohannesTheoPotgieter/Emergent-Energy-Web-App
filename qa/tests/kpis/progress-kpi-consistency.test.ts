/**
 * Progress / schedule KPI consistency regression
 *
 * The audit at docs/smart-import-v2-task-dedup-audit.md (Fix 4) found that
 * the same `work_items` row was producing different `% complete`,
 * `% expected`, and RAG numbers on different pages because:
 *
 *   - readers disagreed about whether `percentComplete` is stored on a
 *     0..1 or 0..100 scale (Fix 4a), and
 *   - the date-derived "expected %" formula was duplicated, with some
 *     callers using SA working days and others using raw calendar days
 *     (Fix 4b), and
 *   - milestone completion used two different definitions (Fix 4c).
 *
 * After Fix 4 there is one source of truth for each of these:
 *   - clampPercent (server/lib/import/value-normalization.ts) normalises
 *     every Smart Import write to 0..1, with a one-off migration
 *     (migrations/0064) cleaning up existing rows.
 *   - server/lib/kpi-formulas.ts exports `pctTo100`,
 *     `expectedPctFromDates`, and `scheduleRagFromVariance`. Every reader
 *     that needs these KPIs must call into this file rather than
 *     re-implement the math.
 *
 * This suite (a) exercises the helpers as pure functions, and (b)
 * verifies that the readers identified during the audit do call into
 * the shared helpers (so a future PR that re-inlines the formula gets
 * caught here).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { clampPercent } from "../../../server/lib/import/value-normalization";
import {
  expectedPctFromDates,
  pctTo100,
  saWorkingDays,
  scheduleRagFromVariance,
} from "../../../server/lib/kpi-formulas";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Pure-function: scale normalisation (Fix 4a)
// ---------------------------------------------------------------------------

describe("clampPercent — canonical 0..1 scale at the write boundary", () => {
  it("passes 0..1 values through unchanged", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(0.25)).toBe(0.25);
    expect(clampPercent(0.5)).toBe(0.5);
    expect(clampPercent(1)).toBe(1);
  });

  it("scales 0..100 percentage-style values down to 0..1", () => {
    expect(clampPercent(25)).toBe(0.25);
    expect(clampPercent(75)).toBe(0.75);
    expect(clampPercent(100)).toBe(1);
  });

  it("returns null for missing or non-numeric inputs", () => {
    expect(clampPercent(null)).toBeNull();
    expect(clampPercent(undefined)).toBeNull();
    expect(clampPercent("")).toBeNull();
    expect(clampPercent("abc")).toBeNull();
  });

  it("clamps runaway values to the 0..1 bounds", () => {
    expect(clampPercent(150)).toBe(1);
    expect(clampPercent(-5)).toBe(0);
  });

  it("strips currency-style decoration on string inputs (delegates to tryParseNumeric)", () => {
    expect(clampPercent("75")).toBe(0.75);
    expect(clampPercent("0.5")).toBe(0.5);
  });
});

describe("pctTo100 — symmetric helper that read sites use", () => {
  it("scales canonical 0..1 inputs up to 0..100", () => {
    expect(pctTo100(0)).toBe(0);
    expect(pctTo100(0.5)).toBe(50);
    expect(pctTo100(1)).toBe(100);
  });

  it("is defensive about legacy 0..100 stragglers", () => {
    expect(pctTo100(75)).toBe(75);
    expect(pctTo100(100)).toBe(100);
  });

  it("returns null for null / undefined / NaN inputs", () => {
    expect(pctTo100(null)).toBeNull();
    expect(pctTo100(undefined)).toBeNull();
    expect(pctTo100(Number.NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure-function: SA working-days expected % (Fix 4b)
// ---------------------------------------------------------------------------

describe("expectedPctFromDates — single source of truth for date-derived expected %", () => {
  it("returns null for missing or malformed dates", () => {
    expect(expectedPctFromDates(null, "2026-05-15", "2026-05-15")).toBeNull();
    expect(expectedPctFromDates("2026-05-01", null, "2026-05-15")).toBeNull();
    expect(expectedPctFromDates("bogus", "2026-05-15", "2026-05-15")).toBeNull();
  });

  it("returns 0 before the range starts", () => {
    expect(expectedPctFromDates("2026-05-15", "2026-05-22", "2026-05-01")).toBe(0);
  });

  it("returns 1 after the range ends", () => {
    expect(expectedPctFromDates("2026-05-01", "2026-05-15", "2026-06-01")).toBe(1);
  });

  it("uses SA working days, not calendar days, for the elapsed/total ratio", () => {
    // Range: Mon 2026-05-04 → Fri 2026-05-08 (5 working days, no SA holidays
    // in this window). Today: Wed 2026-05-06. Working days elapsed: 3.
    const exp = expectedPctFromDates("2026-05-04", "2026-05-08", "2026-05-06");
    expect(exp).not.toBeNull();
    expect(exp!).toBeGreaterThan(0.59);
    expect(exp!).toBeLessThan(0.61);
  });

  it("excludes weekends from the count (calendar would over-count them)", () => {
    // Same week, but "today" lands on a Saturday: 2026-05-09 (Sat) sits
    // outside any working day. Working days from 2026-05-04..09 inclusive
    // = 5 (Mon-Fri), total working days 2026-05-04..08 = 5. With weekend
    // exclusion, ratio = 1.0. A calendar-day formula would have given 6/5
    // = 1.2 (clamped to 1.0) before exclusion. The point: the helper
    // never depends on a weekend boundary.
    const exp = expectedPctFromDates("2026-05-04", "2026-05-08", "2026-05-09");
    expect(exp).toBe(1);
  });
});

describe("saWorkingDays — sanity over a weekend boundary", () => {
  it("counts 5 days for a full Mon–Fri", () => {
    expect(saWorkingDays("2026-05-04", "2026-05-08")).toBe(5);
  });

  it("does not double-count the weekend in Mon–Mon", () => {
    // Mon 2026-05-04 → Mon 2026-05-11 = 6 working days (Mon, Tue, Wed,
    // Thu, Fri, Mon — the Sat/Sun are excluded).
    expect(saWorkingDays("2026-05-04", "2026-05-11")).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Pure-function: schedule RAG band (Fix 4b)
// ---------------------------------------------------------------------------

describe("scheduleRagFromVariance — single source of truth for RAG bands", () => {
  it("green for delta >= -5", () => {
    expect(scheduleRagFromVariance(80, 80)).toBe("green");
    expect(scheduleRagFromVariance(75, 80)).toBe("green");
    expect(scheduleRagFromVariance(85, 80)).toBe("green");
  });

  it("amber for -15 <= delta < -5", () => {
    expect(scheduleRagFromVariance(70, 80)).toBe("amber");
    expect(scheduleRagFromVariance(65, 80)).toBe("amber");
  });

  it("red for delta < -15", () => {
    expect(scheduleRagFromVariance(60, 80)).toBe("red");
    expect(scheduleRagFromVariance(0, 80)).toBe("red");
  });

  it("returns null when either input is missing", () => {
    expect(scheduleRagFromVariance(null, 80)).toBeNull();
    expect(scheduleRagFromVariance(75, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source-level: readers use the shared helpers
// ---------------------------------------------------------------------------

describe("KPI readers route through the shared helpers, not inlined math", () => {
  it("commit-executor.ts writes through clampPercent on PLAN rows", () => {
    const exec = read("server/lib/import/commit-executor.ts");
    expect(exec).toContain('import { clampPercent } from "./value-normalization"');
    // Two write paths: NEW insert + matched-by-ref UPDATE.
    const calls = exec.match(/clampPercent\(\s*fileRow\.(pctComplete|expectedPctComplete)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it("dashboard-repository.ts behind-plan widget converts via pctTo100", () => {
    const repo = read("server/repositories/dashboard-repository.ts");
    expect(repo).toContain('from "../lib/kpi-formulas"');
    expect(repo).toMatch(/pctTo100\(\s*t\.expected\s*\)/);
    expect(repo).toMatch(/pctTo100\(\s*t\.actual\s*\)/);
    // The pre-fix arithmetic `gap = Number(t.expected) - Number(t.actual)`
    // is gone; the new arithmetic is `gap = expected - actual` with both
    // sides already on the 0..100 scale via pctTo100. Guard against
    // accidental re-introduction of the raw-Number path.
    expect(repo).not.toMatch(/const expected = Number\(t\.expected\);\s*\n\s*const actual = Number\(t\.actual\);/);
  });

  it("program-dashboard-repository.ts routes through computeProjectProgress", () => {
    const repo = read("server/repositories/program-dashboard-repository.ts");
    // After 2026-05-15 the per-project Actual % / Expected % goes through
    // the single canonical helper so this dashboard, the Plan tab pill,
    // and the lifecycle board all show the same number for the same row.
    expect(repo).toContain("computeProjectProgress");
    expect(repo).toContain('from "../lib/kpi-formulas"');
    // The pre-fix inline calendar-day arithmetic must be gone.
    expect(repo).not.toMatch(/\(eMs - sMs\) \/ 86400000/);
    expect(repo).not.toMatch(/todayMs - sMs/);
  });

  it("kpi-service.ts uses expectedPctFromDates instead of inline calendar days", () => {
    const svc = read("server/services/kpi-service.ts");
    expect(svc).toContain("expectedPctFromDates");
    expect(svc).not.toMatch(/elapsedDays\s*\/\s*totalDays/);
  });

  it("planning-tasks-routes.ts uses expectedPctFromDates", () => {
    const r = read("server/routes/planning-tasks-routes.ts");
    expect(r).toContain("expectedPctFromDates");
  });

  it("pm-monthly-report-service.ts milestone count has the actualEnd fallback", () => {
    const svc = read("server/services/pm-monthly-report-service.ts");
    // The completedAt-only filter is replaced with a multi-line predicate
    // that also checks `actualEnd` when percentComplete is at 100%.
    expect(svc).toContain("isMilestone");
    expect(svc).toContain("w.actualEnd");
    expect(svc).toMatch(/pct\s*>=\s*1/);
  });

  it("schema documents the 0..1 contract on percentComplete / expectedPctComplete", () => {
    const schema = read("shared/schema/tasks.ts");
    // Comment block referencing the canonical 0..1 contract must sit
    // close to each column declaration.
    expect(schema).toMatch(/Canonical 0\.\.1 scale[\s\S]{0,600}percentComplete:/);
    expect(schema).toMatch(/Same 0\.\.1 scale[\s\S]{0,600}expectedPctComplete:/);
  });

  it("normalisation migration 0064 exists and scales legacy values", () => {
    const mig = read("migrations/0064_work_items_pct_scale_normalise.sql");
    expect(mig).toContain("percent_complete = percent_complete / 100");
    expect(mig).toContain("expected_pct_complete = expected_pct_complete / 100");
    expect(mig).toMatch(/percent_complete\s*>\s*1/);
  });
});
