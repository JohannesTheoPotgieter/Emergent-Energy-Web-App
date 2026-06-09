/**
 * Reconciliation service (P2.2) — app-vs-tracker status classification.
 *
 * Acceptance (step 4): seed a drifted revenue_stored on one line → the project
 * turns AMBER and the offending line is identified (so the drawer can name it).
 * Plus the green (ties) and red (structural) classifications.
 *
 * Pure unit tests of the core maths — no database — so the classification is
 * verified deterministically.
 */

import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import {
  computeAppVsTrackerStatus,
  worstStatus,
  RECON_R1,
  type ReconLineInput,
} from "../../../server/services/reconciliation-service";

// reconDelta = revenueStored − perLineRevenue (P2.1 convention).
const line = (
  lineId: number,
  perLineRevenue: number,
  revenueStored: number | null,
  derivationWarning: string | null = null,
): ReconLineInput => ({
  lineId,
  perLineRevenue,
  revenueStored,
  reconDelta: revenueStored == null ? null : revenueStored - perLineRevenue,
  derivationWarning,
});

describe("computeAppVsTrackerStatus", () => {
  it("GREEN — app ties to the tracker within R1 (and no-col-U lines are ignored)", () => {
    const r = computeAppVsTrackerStatus([
      line(31, 500_000, 500_000), // exact tie
      line(32, 300_000, null), // no pasted col U → nothing to reconcile
      line(33, 200_000, 200_000.4), // within R1
    ]);
    expect(r.status).toBe("green");
    expect(r.offendingLineIds).toHaveLength(0);
    expect(r.accumulatedAbsDelta).toBeLessThanOrEqual(RECON_R1);
  });

  it("AMBER — a seeded drifted revenue_stored on ONE line flips the project to drift", () => {
    const r = computeAppVsTrackerStatus([
      line(11, 600_000, 600_000), // ties
      line(12, 400_000, 405_000), // seeded drift: pasted 405k vs formula 400k → +5k
    ]);
    expect(r.status).toBe("amber");
    // The offending line is named so the drawer can drill to it.
    expect(r.offendingLineIds).toEqual([12]);
    expect(r.driftLineIds).toEqual([12]);
    expect(r.offendingLineIds).not.toContain(11);
    expect(r.accumulatedAbsDelta).toBeCloseTo(5_000, 2);
    // app − tracker over comparable lines = −Σ reconDelta = −5000.
    expect(r.appVsTrackerDelta).toBeCloseTo(-5_000, 2);
  });

  it("UNLINKED — a 'category allocation missing' line is honest 'unlinked', not red, and outranks drift", () => {
    const r = computeAppVsTrackerStatus([
      line(21, 0, null, "category_revenue_allocation_missing"), // allocation not linked
      line(22, 100_000, 130_000), // also drifted, but the unlinked line wins
    ]);
    // §3.3 "allocation missing" is a data-readiness state (re-import), NOT a
    // structural reconciliation fault — so it must NOT show as red "Structural".
    expect(r.status).toBe("unlinked");
    expect(r.offendingLineIds).toContain(21);
    expect(r.unlinkedLineIds).toContain(21);
    expect(r.structuralLineIds).toHaveLength(0);
    expect(r.reason).toMatch(/re-import/i);
  });

  it("UNLINKED — missing linkage and a zero category total are 'unlinked', not red", () => {
    expect(
      computeAppVsTrackerStatus([line(51, 0, null, "missing_category_allocation_linkage")]).status,
    ).toBe("unlinked");
    expect(
      computeAppVsTrackerStatus([line(52, 0, null, "category_total_actual_zero")]).status,
    ).toBe("unlinked");
  });

  it("RED — orphan actuals row with no parent is structural (genuine corruption)", () => {
    const r = computeAppVsTrackerStatus([
      line(41, 0, null, "orphan_actuals_row_no_parent"),
    ]);
    expect(r.status).toBe("red");
    expect(r.offendingLineIds).toEqual([41]);
  });

  it("RED — a negative category total (credits > costs) is structural", () => {
    const r = computeAppVsTrackerStatus([
      line(61, 0, null, "category_total_actual_negative"),
    ]);
    expect(r.status).toBe("red");
    expect(r.offendingLineIds).toEqual([61]);
  });

  it("RED outranks UNLINKED — genuine corruption wins over an allocation-missing line", () => {
    const r = computeAppVsTrackerStatus([
      line(71, 0, null, "category_revenue_allocation_missing"), // unlinked
      line(72, 0, null, "orphan_actuals_row_no_parent"), // structural
    ]);
    expect(r.status).toBe("red");
    expect(r.offendingLineIds).toContain(72);
  });

  it("empty period → green, nothing to reconcile", () => {
    const r = computeAppVsTrackerStatus([]);
    expect(r.status).toBe("green");
    expect(r.offendingLineIds).toHaveLength(0);
  });
});

describe("worstStatus rollup", () => {
  it("no rows → unknown", () => {
    expect(worstStatus([])).toBe("unknown");
  });
  it("red dominates", () => {
    expect(worstStatus(["green", "amber", "red"])).toBe("red");
  });
  it("red outranks unlinked; unlinked outranks amber", () => {
    expect(worstStatus(["unlinked", "amber", "red"])).toBe("red");
    expect(worstStatus(["green", "amber", "unlinked"])).toBe("unlinked");
  });
  it("amber over green", () => {
    expect(worstStatus(["green", "amber", "green"])).toBe("amber");
  });
  it("all green → green", () => {
    expect(worstStatus(["green", "green"])).toBe("green");
  });
});

describe("recon-ignore audit (P2.3) — cascade-driven clears are audited", () => {
  it("the cascade recon_ignore_clear writes an audit_events row (recordAudit)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "server/services/quickbooks-cascade-proposals-service.ts"),
      "utf8",
    );
    // The recon_ignore_clear case must call recordAudit so a cascade-driven
    // clear is never silently dropped (route-level clears already audit).
    const caseIdx = src.indexOf('case "recon_ignore_clear"');
    expect(caseIdx).toBeGreaterThan(-1);
    const nextCaseIdx = src.indexOf("case ", caseIdx + 1);
    const block = src.slice(caseIdx, nextCaseIdx > -1 ? nextCaseIdx : caseIdx + 1500);
    expect(block).toMatch(/recordAudit\(/);
    expect(block).toMatch(/recon_ignore_cleared_via_cascade/);
  });
});
