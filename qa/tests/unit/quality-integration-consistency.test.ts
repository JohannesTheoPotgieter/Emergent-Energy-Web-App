/**
 * Quality Integration Consistency Tests
 *
 * Proves that the same quality truth appears consistently across all
 * integration surfaces: dashboard metrics, company overview, PM reports,
 * governance views, and the primary quality routes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeQcProgress,
  deriveQualityStatusLabel,
  QUALITY_ITEM_STATUSES,
} from "../../../shared/quality-governance";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("shared QC progress helper", () => {
  it("computes progress correctly for mixed items", () => {
    const result = computeQcProgress([
      { isApplicable: true, approved: true, qmStatus: "pass" },
      { isApplicable: true, approved: false, qmStatus: "review" },
      { isApplicable: false, approved: false, qmStatus: "na" },
      { isApplicable: true, approved: true, qmStatus: "pass" },
      { isApplicable: true, approved: false, qmStatus: "not_started" },
    ]);

    // Only 4 applicable items (one is N/A)
    expect(result.totalApplicable).toBe(4);
    // Two are approved
    expect(result.totalApproved).toBe(2);
    // 50% progress
    expect(result.progressPercent).toBe(50);
  });

  it("returns 0% for empty checklist", () => {
    const result = computeQcProgress([]);
    expect(result.totalApplicable).toBe(0);
    expect(result.totalApproved).toBe(0);
    expect(result.progressPercent).toBe(0);
  });

  it("returns 100% when all applicable items are approved", () => {
    const result = computeQcProgress([
      { isApplicable: true, approved: true },
      { isApplicable: false },
      { isApplicable: true, approved: true },
    ]);
    expect(result.progressPercent).toBe(100);
  });

  it("treats qmStatus pass as approved even if approved flag is false", () => {
    const result = computeQcProgress([
      { isApplicable: true, approved: false, qmStatus: "pass" },
    ]);
    expect(result.totalApproved).toBe(1);
    expect(result.progressPercent).toBe(100);
  });

  it("does not count non-canonical statuses like approved as pass", () => {
    const result = computeQcProgress([
      { isApplicable: true, approved: false, qmStatus: "approved" },
    ]);
    // "approved" is not a canonical status, so approved=false means not approved
    expect(result.totalApproved).toBe(0);
  });
});

describe("quality status label derivation", () => {
  it("returns On Track for zero warnings", () => {
    expect(deriveQualityStatusLabel(0, 0)).toBe("On Track");
  });

  it("returns At Risk for 1 high warning", () => {
    expect(deriveQualityStatusLabel(1, 1)).toBe("At Risk");
  });

  it("returns At Risk for 3+ open warnings without high", () => {
    expect(deriveQualityStatusLabel(3, 0)).toBe("At Risk");
  });

  it("returns Blocked for 2+ high warnings", () => {
    expect(deriveQualityStatusLabel(5, 2)).toBe("Blocked");
  });

  it("returns On Track for 1-2 open warnings without high", () => {
    expect(deriveQualityStatusLabel(2, 0)).toBe("On Track");
  });
});

describe("cross-surface consistency: all services use shared quality logic", () => {
  it("dashboard-metrics uses computeQcProgress from shared module", () => {
    const source = read("server/services/dashboard-metrics.ts");
    expect(source).toContain('import { computeQcProgress } from "@shared/quality-governance"');
    expect(source).toContain("computeQcProgress(");
  });

  it("company-overview uses computeQcProgress from shared module", () => {
    const source = read("server/services/company-overview-service.ts");
    expect(source).toContain('import { computeQcProgress } from "@shared/quality-governance"');
    expect(source).toContain("computeQcProgress(");
    // Must NOT contain the old broken qmStatus === "approved" check
    expect(source).not.toContain('qmStatus === "approved"');
  });

  it("pm-monthly-report uses computeQcProgress from shared module", () => {
    const source = read("server/services/pm-monthly-report-service.ts");
    expect(source).toContain('import { computeQcProgress } from "@shared/quality-governance"');
    expect(source).toContain("computeQcProgress(");
  });

  it("governance-views-routes uses canonical qc_item_instance table and columns", () => {
    const source = read("server/routes/governance-views-routes.ts");
    // Must use correct table name (singular)
    expect(source).toContain("FROM qc_item_instance");
    // Must use correct column names
    expect(source).toContain("qi.qm_status");
    expect(source).toContain("qi.approved");
    expect(source).toContain("qi.assignee_user_id");
    // Must NOT use the wrong table name (plural)
    expect(source).not.toContain("FROM qc_item_instances");
    // Must NOT use non-existent columns
    expect(source).not.toContain("qi.status");
    expect(source).not.toContain("qi.assigned_to_user_id");
  });

  it("governance-views PATCH actions use canonical status values", () => {
    const source = read("server/routes/governance-views-routes.ts");
    // Must NOT set non-canonical status values
    expect(source).not.toContain("status = 'closed'");
    expect(source).not.toContain("status = 'complete'");
    expect(source).not.toContain("status = 'failed'");
    // Must use canonical columns and values
    expect(source).toContain("qm_status = 'pass'");
    expect(source).toContain("qm_status = 'fail'");
    expect(source).toContain("qm_status = 'na'");
  });

  it("dashboard-routes uses severity-aware quality status thresholds", () => {
    const source = read("server/routes/dashboard-routes.ts");
    // Must track high-severity warnings separately
    expect(source).toContain("_qualityHigh");
    // Must NOT use the old arbitrary >=5 threshold
    expect(source).not.toContain("_qualityOpen >= 5 ? 'Blocked'");
  });

  it("all canonical status values are defined in shared module only", () => {
    // The shared module defines exactly 5 canonical statuses
    expect(QUALITY_ITEM_STATUSES).toHaveLength(5);
    expect(QUALITY_ITEM_STATUSES).toContain("not_started");
    expect(QUALITY_ITEM_STATUSES).toContain("review");
    expect(QUALITY_ITEM_STATUSES).toContain("pass");
    expect(QUALITY_ITEM_STATUSES).toContain("fail");
    expect(QUALITY_ITEM_STATUSES).toContain("na");
    // "pending" and "approved" are NOT canonical
    expect(QUALITY_ITEM_STATUSES).not.toContain("pending");
    expect(QUALITY_ITEM_STATUSES).not.toContain("approved");
    expect(QUALITY_ITEM_STATUSES).not.toContain("closed");
    expect(QUALITY_ITEM_STATUSES).not.toContain("complete");
  });
});
