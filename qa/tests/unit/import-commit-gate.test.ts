/**
 * Auto-commit gate + parked-run review (feat/import-commit-gate).
 *
 * Tightens the definition of "clean" for unattended auto-commit and gives
 * parked runs a lock-aware review path. Nothing un-clean auto-commits; nothing
 * staged or rejected moves a reported number.
 *
 * Acceptance scenarios:
 *   (a) a run touching a locked period parks with the right reason (no numbers move)
 *   (b) >80% soft-close parks
 *   (c) committing a parked run is lock-aware and refreshes reconciliation
 *   (d) rejecting a parked run leaves figures untouched + writes an audit row
 *   (e) a clean run still auto-commits with no prompt
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  decideSchedulerAutoCommit,
  computeSoftClosePct,
  detectErrorOnRev,
  detectMissingAllocationOnNewLines,
  collectCommitLockDates,
  computeMetricSwingPct,
  detectNetDeltaExceeded,
  OVER_WIPE_THRESHOLD,
  NET_DELTA_PARK_THRESHOLD_PCT,
  type AutoCommitGateSignals,
  type ProjectMetricSwing,
} from "../../../server/lib/import/auto-commit-gate";

const CLEAN: AutoCommitGateSignals = {
  hasBlockers: false,
  lockedPeriods: [],
  errorOnRev: false,
  missingAllocationOnNewLines: false,
  softClosePct: 0,
  hasResurrections: false,
  conflictPolicyParks: false,
};

describe("auto-commit gate — decision", () => {
  it("(e) a clean run still auto-commits (no prompt added to the clean path)", () => {
    expect(decideSchedulerAutoCommit(CLEAN)).toEqual({ decision: "commit", reason: "clean" });
  });

  it("(a) a locked period parks with the period named in the reason", () => {
    const d = decideSchedulerAutoCommit({ ...CLEAN, lockedPeriods: ["2026-03-01"] });
    expect(d.decision).toBe("park");
    expect(d.reason).toContain("locked period");
    expect(d.reason).toContain("2026-03-01");
  });

  it("(b) over-wipe parks above the threshold but commits at/below it", () => {
    expect(decideSchedulerAutoCommit({ ...CLEAN, softClosePct: 0.81 }).decision).toBe("park");
    expect(decideSchedulerAutoCommit({ ...CLEAN, softClosePct: 0.81 }).reason).toContain("over-wipe");
    // Strictly-greater parks; exactly at the threshold is still clean.
    expect(decideSchedulerAutoCommit({ ...CLEAN, softClosePct: OVER_WIPE_THRESHOLD }).decision).toBe("commit");
  });

  it("parks on blockers / ERROR-on-REV / missing allocation / resurrections / conflicts", () => {
    expect(decideSchedulerAutoCommit({ ...CLEAN, hasBlockers: true }).decision).toBe("park");
    expect(decideSchedulerAutoCommit({ ...CLEAN, errorOnRev: true }).reason).toContain("ERROR on REV");
    expect(decideSchedulerAutoCommit({ ...CLEAN, missingAllocationOnNewLines: true }).reason).toContain("allocation");
    expect(decideSchedulerAutoCommit({ ...CLEAN, hasResurrections: true }).decision).toBe("park");
    expect(decideSchedulerAutoCommit({ ...CLEAN, conflictPolicyParks: true }).decision).toBe("park");
  });

  it("locked period wins over other park reasons (worst-first ordering)", () => {
    const d = decideSchedulerAutoCommit({
      ...CLEAN,
      lockedPeriods: ["2026-03-01"],
      hasBlockers: true,
      softClosePct: 0.99,
    });
    expect(d.reason).toContain("locked period");
  });

  it("net-delta over threshold parks; the clean path is unchanged when absent", () => {
    // Absent (optional) signal → still clean (no behaviour change for callers
    // that don't yet compute the swing).
    expect(decideSchedulerAutoCommit(CLEAN)).toEqual({ decision: "commit", reason: "clean" });
    const d = decideSchedulerAutoCommit({
      ...CLEAN,
      deltaExceeded: true,
      deltaExceededDetail: { projectName: "Solar Alpha", metric: "COS", pct: 42 },
    });
    expect(d.decision).toBe("park");
    expect(d.reason).toContain("net delta");
    expect(d.reason).toContain("Solar Alpha");
    expect(d.reason).toContain("COS");
    expect(d.reason).toContain("+42%");
  });

  it("over-wipe still wins over net-delta (worst-first ordering)", () => {
    const d = decideSchedulerAutoCommit({
      ...CLEAN,
      softClosePct: 0.9,
      deltaExceeded: true,
      deltaExceededDetail: { projectName: "Solar Alpha", metric: "REV", pct: 80 },
    });
    expect(d.reason).toContain("over-wipe");
  });
});

describe("auto-commit gate — net-delta guard (REV/COS swing)", () => {
  it("computeMetricSwingPct handles zero / appearance / non-finite", () => {
    expect(computeMetricSwingPct(0, 0)).toBe(0);
    expect(computeMetricSwingPct(100, 125)).toBeCloseTo(25);
    expect(computeMetricSwingPct(100, 50)).toBeCloseTo(-50);
    // A metric appearing from nothing is a structural change → always parks.
    expect(computeMetricSwingPct(0, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(computeMetricSwingPct(Number.NaN, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("detectNetDeltaExceeded: within threshold commits, beyond parks with the WORST swing", () => {
    const within: ProjectMetricSwing[] = [
      { projectName: "A", metric: "REV", current: 100, next: 110 }, // +10%
      { projectName: "B", metric: "COS", current: 200, next: 180 }, // -10%
    ];
    expect(detectNetDeltaExceeded(within).exceeded).toBe(false);

    const beyond: ProjectMetricSwing[] = [
      { projectName: "A", metric: "REV", current: 100, next: 130 }, // +30% (> 25)
      { projectName: "B", metric: "COS", current: 200, next: 50 }, //  -75% (worst)
    ];
    const r = detectNetDeltaExceeded(beyond);
    expect(r.exceeded).toBe(true);
    expect(r.detail).toEqual({ projectName: "B", metric: "COS", pct: -75 });
  });

  it("honours a custom threshold and ignores baseline (empty) runs", () => {
    const swings: ProjectMetricSwing[] = [{ projectName: "A", metric: "REV", current: 100, next: 120 }];
    // 20% swing: parks at a 10% threshold, commits at the default 25%.
    expect(detectNetDeltaExceeded(swings, 10).exceeded).toBe(true);
    expect(detectNetDeltaExceeded(swings, NET_DELTA_PARK_THRESHOLD_PCT).exceeded).toBe(false);
    // Baseline import — no prior totals to compare → never trips this guard.
    expect(detectNetDeltaExceeded([]).exceeded).toBe(false);
    expect(detectNetDeltaExceeded(null).exceeded).toBe(false);
  });
});

describe("auto-commit gate — pure signal extractors", () => {
  it("computeSoftClosePct = Σ missing / Σ existing (0 when no existing rows)", () => {
    expect(
      computeSoftClosePct({ sections: { EXPENDITURE: { missingFromUploadCount: 9, existingRowCount: 10 } } }),
    ).toBeCloseTo(0.9);
    expect(
      computeSoftClosePct({ sections: { EXPENDITURE: { missingFromUploadCount: 0, existingRowCount: 0 } } }),
    ).toBe(0);
    expect(computeSoftClosePct(null)).toBe(0);
  });

  it("detectErrorOnRev flags the positional-fallback (ERROR on REV) allocation", () => {
    expect(detectErrorOnRev([{ allocationConfidence: "direct" }])).toBe(false);
    expect(detectErrorOnRev([{ allocationConfidence: "header_error_positional" }])).toBe(true);
    expect(detectErrorOnRev([{ allocationSource: "HEADER_ERROR_POSITIONAL" }])).toBe(true);
    expect(detectErrorOnRev(undefined)).toBe(false);
  });

  it("detectMissingAllocationOnNewLines: only with cost-line activity AND a null allocation", () => {
    const churn = { sections: { EXPENDITURE: { newCount: 2, changedCount: 0, existingRowCount: 5 } } };
    expect(detectMissingAllocationOnNewLines(churn, [{ revenueAllocation: 1 }])).toBe(false);
    expect(detectMissingAllocationOnNewLines(churn, [{ revenueAllocation: null }])).toBe(true);
    // No expenditure churn → never flags, even with a null allocation present.
    expect(
      detectMissingAllocationOnNewLines(
        { sections: { EXPENDITURE: { newCount: 0, changedCount: 0 } } },
        [{ revenueAllocation: null }],
      ),
    ).toBe(false);
  });

  it("collectCommitLockDates gathers cost/actual invoice + revenue invoice/paid dates", () => {
    expect(
      collectCommitLockDates({
        costLines: [{ invoiceDate: "2026-03-10" }],
        actualLineRows: [{ invoiceDate: "2026-04-01" }],
        revenueLines: [{ invoiceDate: "2026-03-20", paidDate: "2026-05-02" }],
      }),
    ).toEqual(["2026-03-10", "2026-04-01", "2026-03-20", "2026-05-02"]);
    expect(collectCommitLockDates(null)).toEqual([]);
  });
});

// Source-level invariants (mirrors scheduled-import-error-surface.test.ts):
// commit-from-review is lock-aware + refreshes reconciliation; the dry-run
// preview rolls back before persisting; reject only flips status + audits and
// never writes a finance table.
describe("commit-gate wiring + financial safety", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");
  const commitSrc = read("server/services/scheduler-commit.ts");
  const reviewSrc = read("server/services/smart-import-review-service.ts");
  const httpSrc = read("server/smart-import-routes.ts");

  it("scheduler routes the auto-commit decision through the tightened gate", () => {
    expect(schedulerSrc).toContain('from "../lib/import/auto-commit-gate"');
    expect(schedulerSrc).toContain("decideSchedulerAutoCommit(");
    expect(schedulerSrc).toContain("enforceCosPeriodLock(");
    expect(schedulerSrc).toContain("autoCommitGate");
  });

  it("(c) the commit path is lock-aware and refreshes reconciliation after writing", () => {
    // Commit-from-review uses the existing lock-aware HTTP commit handler …
    expect(httpSrc).toContain("guardCosPeriodLock");
    // … and the scheduler commit transaction refreshes reconciliation.
    expect(commitSrc).toContain("refreshReconciliationForProjects");
  });

  it("(d-preview) dry-run computes reconciliation then ROLLS BACK before marking committed", () => {
    const dryIdx = commitSrc.indexOf("opts.dryRun");
    const reconIdx = commitSrc.indexOf("getReconciliationDetail(tx");
    const rollbackThrowIdx = commitSrc.indexOf("dry_run_rollback");
    // The mark-as-committed WRITE (not the result-type literal): its unique comment.
    const markCommittedIdx = commitSrc.indexOf("Finalize: mark as committed");
    expect(dryIdx).toBeGreaterThan(-1);
    expect(reconIdx).toBeGreaterThan(dryIdx);
    expect(rollbackThrowIdx).toBeGreaterThan(reconIdx);
    expect(markCommittedIdx).toBeGreaterThan(-1);
    // The rollback is thrown BEFORE the run is ever marked committed.
    expect(rollbackThrowIdx).toBeLessThan(markCommittedIdx);
  });

  it("(d-reject) reject only flips status to 'rejected' + audits; never writes a finance table", () => {
    expect(reviewSrc).toContain('status: "rejected"');
    expect(reviewSrc).toContain("logAudit");
    // Status-guarded so a racing commit is never clobbered.
    expect(reviewSrc).toContain('inArray(smartImportRuns.status, ["awaiting_review", "preview"])');
    // No finance line / reconciliation tables are touched in the reject path.
    expect(reviewSrc).not.toMatch(
      /normalizedCostLines|normalizedRevenueLines|financialReconciliation|categoryRevenueAllocations/,
    );
  });

  it("'rejected' shipped as a committed migration (not just a schema edit)", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json")) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some((e) => e.tag === "0095_smart_import_rejected_status")).toBe(true);
    expect(read("migrations/0095_smart_import_rejected_status.sql")).toContain(
      "ADD VALUE IF NOT EXISTS 'rejected'",
    );
  });
});
