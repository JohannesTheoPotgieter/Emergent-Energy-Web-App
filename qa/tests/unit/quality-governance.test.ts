import { describe, expect, it } from "vitest";
import {
  computeQualityRiskSummary,
  evaluateQualityGovernanceItem,
  getQualityApprovalState,
  getQualityHandoverReasons,
  isHandoverQualityBlocked,
  isQualityItemOverdue,
  isQualityStatusRequired,
} from "../../../shared/quality-governance";

describe("quality governance helpers", () => {
  it("marks rejected items as resubmission-needed and keeps pending review distinct", () => {
    expect(getQualityApprovalState({ qmStatus: "fail", approved: false })).toBe("resubmission_needed");
    expect(getQualityApprovalState({ qmStatus: "review", approved: false })).toBe("pending_review");
    expect(getQualityApprovalState({ qmStatus: "pass", approved: true })).toBe("approved");
  });

  it("detects overdue and evidence-gap quality items", () => {
    const evaluation = evaluateQualityGovernanceItem(
      {
        qmStatus: "review",
        approved: false,
        endDate: "2026-03-10",
        isEvidenceRequired: true,
        evidenceCount: 0,
      },
      new Date("2026-03-16T09:00:00.000Z"),
    );

    expect(isQualityItemOverdue(
      { qmStatus: "review", approved: false, endDate: "2026-03-10" },
      new Date("2026-03-16T09:00:00.000Z"),
    )).toBe(true);
    expect(evaluation.overdue).toBe(true);
    expect(evaluation.daysOverdue).toBe(6);
    expect(evaluation.evidenceMissing).toBe(true);
  });

  it("derives quality handover blockers from quality status gaps and rejection context", () => {
    const handover = {
      engineeringStatus: "Design pack issued",
      qualityStatus: "",
      handoverStatus: "REJECTED",
      rejectionReason: "Quality evidence pack incomplete",
      executionEnabled: false,
      blockers: ["Quality status", "Scope summary"],
    };

    expect(isQualityStatusRequired(handover.engineeringStatus)).toBe(true);
    expect(getQualityHandoverReasons(handover)).toEqual([
      "Quality status",
      "Rejected: Quality evidence pack incomplete",
    ]);
    expect(isHandoverQualityBlocked(handover)).toBe(true);
  });

  it("scores blocked, overdue, and resubmission-heavy projects as high risk", () => {
    const summary = computeQualityRiskSummary({
      items: [
        {
          qmStatus: "fail",
          approved: false,
          endDate: "2026-03-10",
          isEvidenceRequired: true,
          evidenceCount: 0,
        },
        {
          qmStatus: "review",
          approved: false,
          endDate: "2026-03-11",
          isEvidenceRequired: false,
          evidenceCount: 0,
        },
      ],
      warnings: [
        { severity: "High", status: "open" },
        { severity: "Medium", status: "open" },
      ],
      handover: {
        engineeringStatus: "Commissioning active",
        qualityStatus: "",
        handoverStatus: "REJECTED",
        rejectionReason: "QC evidence not complete",
        executionEnabled: false,
      },
      linkedMicrosoftCount: 1,
      now: new Date("2026-03-16T09:00:00.000Z"),
    });

    expect(summary.level).toBe("critical");
    expect(summary.exposures).toMatchObject({
      overdueCount: 2,
      resubmissionCount: 1,
      evidenceGapCount: 1,
      pendingReviewCount: 1,
      blockedHandover: true,
      linkedMicrosoftCount: 1,
    });
    expect(summary.summary).toContain("handover blocked");
    expect(summary.summary).toContain("resubmission");
  });
});
