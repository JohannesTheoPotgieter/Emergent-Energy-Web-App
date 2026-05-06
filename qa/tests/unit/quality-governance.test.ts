import { describe, expect, it } from "vitest";
import {
  computeQualityRiskSummary,
  evaluateQualityGovernanceItem,
  getQualityApprovalState,
  getQualityHandoverReasons,
  isHandoverQualityBlocked,
  isQualityItemOverdue,
  isQualityStatusRequired,
  QUALITY_ITEM_STATUSES,
  VALID_QM_STATUS_TRANSITIONS,
  isValidQmStatusTransition,
  isQualityItemComplete,
  getApprovalBlockReason,
  evaluateChecklistHandoverReadiness,
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

describe("quality item status constants and transitions", () => {
  it("defines exactly the five canonical statuses", () => {
    expect(QUALITY_ITEM_STATUSES).toEqual(["not_started", "review", "pass", "fail", "na"]);
  });

  it("allows all transitions from not_started", () => {
    expect(VALID_QM_STATUS_TRANSITIONS.not_started).toContain("review");
    expect(VALID_QM_STATUS_TRANSITIONS.not_started).toContain("pass");
    expect(VALID_QM_STATUS_TRANSITIONS.not_started).toContain("na");
  });

  it("validates transitions correctly", () => {
    expect(isValidQmStatusTransition("not_started", "review")).toBe(true);
    expect(isValidQmStatusTransition("review", "pass")).toBe(true);
    expect(isValidQmStatusTransition("review", "fail")).toBe(true);
    expect(isValidQmStatusTransition("fail", "review")).toBe(true);
    expect(isValidQmStatusTransition("na", "not_started")).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(isValidQmStatusTransition("pending", "review")).toBe(false);
    expect(isValidQmStatusTransition("not_started", "unknown")).toBe(false);
  });
});

describe("quality item definition of done", () => {
  it("marks N/A items as complete", () => {
    const result = isQualityItemComplete({ isApplicable: false });
    expect(result.complete).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("marks approved items with evidence as complete", () => {
    const result = isQualityItemComplete({
      approved: true,
      qmStatus: "pass",
      isApplicable: true,
      isEvidenceRequired: true,
      evidenceCount: 2,
    });
    expect(result.complete).toBe(true);
  });

  it("marks approved items without required evidence as incomplete", () => {
    const result = isQualityItemComplete({
      approved: true,
      qmStatus: "pass",
      isApplicable: true,
      isEvidenceRequired: true,
      evidenceCount: 0,
    });
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("Required evidence not uploaded");
  });

  it("marks unapproved items as incomplete with appropriate reason", () => {
    const failResult = isQualityItemComplete({ qmStatus: "fail", approved: false, isApplicable: true });
    expect(failResult.complete).toBe(false);
    expect(failResult.reasons).toContain("Item failed — resubmission required");

    const reviewResult = isQualityItemComplete({ qmStatus: "review", approved: false, isApplicable: true });
    expect(reviewResult.complete).toBe(false);
    expect(reviewResult.reasons).toContain("Awaiting approval review");

    const notStartedResult = isQualityItemComplete({ qmStatus: "not_started", approved: false, isApplicable: true });
    expect(notStartedResult.complete).toBe(false);
    expect(notStartedResult.reasons).toContain("Not yet approved");
  });
});

describe("approval block reason", () => {
  it("allows approval when evidence is present", () => {
    expect(getApprovalBlockReason({ isEvidenceRequired: true, evidenceCount: 1 })).toBeNull();
  });

  it("blocks approval when required evidence is missing", () => {
    const reason = getApprovalBlockReason({ isEvidenceRequired: true, evidenceCount: 0 });
    expect(reason).toBe("Cannot approve: required evidence has not been uploaded");
  });

  it("allows approval when evidence is not required", () => {
    expect(getApprovalBlockReason({ isEvidenceRequired: false, evidenceCount: 0 })).toBeNull();
  });

  it("allows approval for N/A items", () => {
    expect(getApprovalBlockReason({ isApplicable: false, isEvidenceRequired: true, evidenceCount: 0 })).toBeNull();
  });
});

describe("checklist handover readiness", () => {
  it("reports ready when all applicable items are complete", () => {
    const result = evaluateChecklistHandoverReadiness({
      items: [
        { approved: true, qmStatus: "pass", isApplicable: true, isEvidenceRequired: false },
        { isApplicable: false },
        { approved: true, qmStatus: "pass", isApplicable: true, isEvidenceRequired: true, evidenceCount: 1 },
      ],
    });
    expect(result.ready).toBe(true);
    expect(result.completionPercent).toBe(100);
    expect(result.blockers).toHaveLength(0);
  });

  it("reports not ready when items are incomplete", () => {
    const result = evaluateChecklistHandoverReadiness({
      items: [
        { approved: true, qmStatus: "pass", isApplicable: true },
        { approved: false, qmStatus: "review", isApplicable: true },
        { approved: false, qmStatus: "not_started", isApplicable: true },
      ],
      itemNames: ["Item A", "Item B", "Item C"],
    });
    expect(result.ready).toBe(false);
    expect(result.totalApplicable).toBe(3);
    expect(result.totalComplete).toBe(1);
    expect(result.completionPercent).toBe(33);
    expect(result.incompleteItems).toHaveLength(2);
    expect(result.blockers).toContain("2 quality item(s) not complete");
  });

  it("reports not ready when high-severity warnings are open", () => {
    const result = evaluateChecklistHandoverReadiness({
      items: [
        { approved: true, qmStatus: "pass", isApplicable: true },
      ],
      warnings: [
        { severity: "High", status: "open" },
      ],
    });
    expect(result.ready).toBe(false);
    expect(result.openHighWarnings).toBe(1);
    expect(result.blockers).toContain("1 open high-severity warning(s)");
  });

  it("ignores resolved warnings", () => {
    const result = evaluateChecklistHandoverReadiness({
      items: [
        { approved: true, qmStatus: "pass", isApplicable: true },
      ],
      warnings: [
        { severity: "High", status: "resolved" },
      ],
    });
    expect(result.ready).toBe(true);
    expect(result.openHighWarnings).toBe(0);
  });

  it("blocks on high-severity triggered risk answers", () => {
    const result = evaluateChecklistHandoverReadiness({
      items: [
        { approved: true, qmStatus: "pass", isApplicable: true },
      ],
      riskAnswers: [
        { triggersWarning: true, triggerCondition: "yes", triggerSeverity: "High", answerYesno: true },
      ],
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("1 high-severity risk trigger(s) active");
  });
});
