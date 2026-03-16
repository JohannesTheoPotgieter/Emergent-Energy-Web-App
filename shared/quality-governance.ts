export interface QualityGovernanceItemLike {
  qmStatus?: string | null;
  approved?: boolean | null;
  isApplicable?: boolean | null;
  endDate?: string | null;
  scheduledDate?: string | null;
  approvalComment?: string | null;
  isEvidenceRequired?: boolean | null;
  evidenceCount?: number | null;
}

export interface QualityWarningLike {
  severity?: string | null;
  status?: string | null;
}

export interface QualityHandoverLike {
  blockers?: string[] | null;
  engineeringStatus?: string | null;
  qualityRequired?: boolean | null;
  qualityStatus?: string | null;
  handoverStatus?: string | null;
  rejectionReason?: string | null;
  executionEnabled?: boolean | null;
  executionGateStatus?: string | null;
}

export type QualityApprovalState =
  | "approved"
  | "pending_review"
  | "resubmission_needed"
  | "not_started";

export type QualityRiskLevel = "low" | "medium" | "high" | "critical";

export interface QualityGovernanceItemEvaluation {
  normalizedStatus: string;
  approvalState: QualityApprovalState;
  overdue: boolean;
  daysOverdue: number;
  evidenceMissing: boolean;
  resubmissionNeeded: boolean;
}

export interface QualityRiskSummary {
  score: number;
  level: QualityRiskLevel;
  summary: string;
  exposures: {
    overdueCount: number;
    resubmissionCount: number;
    evidenceGapCount: number;
    pendingReviewCount: number;
    openWarningCount: number;
    highWarningCount: number;
    blockedHandover: boolean;
    handoverReasonCount: number;
    linkedMicrosoftCount: number;
  };
}

const QUALITY_BLOCKER_PATTERN =
  /(quality|evidence|handover charter|site visit report|signed cost proposal|commissioning|qc)/i;

function toDateOnlyTimestamp(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const datePart = text.split("T")[0];
  const parsed = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function startOfDayTimestamp(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function isQualityStatusRequired(engineeringStatus?: string | null): boolean {
  const normalized = String(engineeringStatus ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return ["na", "n/a", "not applicable", "not started"].every((token) => !normalized.includes(token));
}

export function normalizeQualityItemStatus(item: QualityGovernanceItemLike): string {
  if (item.isApplicable === false) return "na";
  if (item.approved) return "pass";
  const status = String(item.qmStatus ?? "").trim().toLowerCase();
  return status || "not_started";
}

export function getQualityApprovalState(item: QualityGovernanceItemLike): QualityApprovalState {
  if (item.approved) return "approved";
  const normalizedStatus = normalizeQualityItemStatus(item);
  if (normalizedStatus === "review") return "pending_review";
  if (normalizedStatus === "fail") return "resubmission_needed";
  return "not_started";
}

export function hasEvidenceGap(item: QualityGovernanceItemLike): boolean {
  if (item.isApplicable === false) return false;
  if (!item.isEvidenceRequired) return false;
  return Number(item.evidenceCount ?? 0) <= 0;
}

export function getQualityItemDaysOverdue(
  item: Pick<QualityGovernanceItemLike, "endDate" | "scheduledDate" | "approved" | "qmStatus" | "isApplicable">,
  now = new Date(),
): number {
  const normalizedStatus = normalizeQualityItemStatus(item);
  if (item.isApplicable === false) return 0;
  if (item.approved || normalizedStatus === "pass" || normalizedStatus === "na") return 0;

  const dueTimestamp = toDateOnlyTimestamp(item.endDate || item.scheduledDate || null);
  if (dueTimestamp == null) return 0;

  const todayTimestamp = startOfDayTimestamp(now);
  if (dueTimestamp >= todayTimestamp) return 0;

  return Math.max(0, Math.floor((todayTimestamp - dueTimestamp) / (24 * 60 * 60 * 1000)));
}

export function isQualityItemOverdue(item: QualityGovernanceItemLike, now = new Date()): boolean {
  return getQualityItemDaysOverdue(item, now) > 0;
}

export function evaluateQualityGovernanceItem(
  item: QualityGovernanceItemLike,
  now = new Date(),
): QualityGovernanceItemEvaluation {
  const normalizedStatus = normalizeQualityItemStatus(item);
  const approvalState = getQualityApprovalState(item);
  const daysOverdue = getQualityItemDaysOverdue(item, now);

  return {
    normalizedStatus,
    approvalState,
    overdue: daysOverdue > 0,
    daysOverdue,
    evidenceMissing: hasEvidenceGap(item),
    resubmissionNeeded: approvalState === "resubmission_needed",
  };
}

export function getQualityHandoverReasons(handover?: QualityHandoverLike | null): string[] {
  if (!handover) return [];

  const blockers = Array.isArray(handover.blockers) ? handover.blockers : [];
  const qualityRequired =
    handover.qualityRequired != null
      ? handover.qualityRequired === true
      : isQualityStatusRequired(handover.engineeringStatus);

  const blockerReasons = blockers.filter((blocker) => QUALITY_BLOCKER_PATTERN.test(String(blocker ?? "")));
  const rejectionReason =
    handover.handoverStatus === "REJECTED" && QUALITY_BLOCKER_PATTERN.test(String(handover.rejectionReason ?? ""))
      ? `Rejected: ${String(handover.rejectionReason ?? "").trim()}`
      : null;

  return uniqueNonEmpty([
    ...blockerReasons,
    qualityRequired && !String(handover.qualityStatus ?? "").trim() ? "Quality status" : null,
    rejectionReason,
  ]);
}

export function isHandoverQualityBlocked(handover?: QualityHandoverLike | null): boolean {
  if (!handover) return false;
  const reasons = getQualityHandoverReasons(handover);
  if (reasons.length === 0) return false;
  if (handover.executionEnabled === true || String(handover.executionGateStatus ?? "").trim().toUpperCase() === "ENABLED") {
    return false;
  }
  return true;
}

export function computeQualityRiskSummary(params: {
  items: QualityGovernanceItemLike[];
  warnings?: QualityWarningLike[] | null;
  handover?: QualityHandoverLike | null;
  linkedMicrosoftCount?: number;
  now?: Date;
}): QualityRiskSummary {
  const now = params.now ?? new Date();
  const evaluations = params.items.map((item) => evaluateQualityGovernanceItem(item, now));
  const warnings = (params.warnings ?? []).filter((warning) => String(warning.status ?? "").toLowerCase() !== "resolved");
  const handoverReasons = getQualityHandoverReasons(params.handover);
  const blockedHandover = isHandoverQualityBlocked(params.handover);
  const linkedMicrosoftCount = Math.max(0, Number(params.linkedMicrosoftCount ?? 0));

  const overdueCount = evaluations.filter((item) => item.overdue).length;
  const resubmissionCount = evaluations.filter((item) => item.resubmissionNeeded).length;
  const evidenceGapCount = evaluations.filter((item) => item.evidenceMissing).length;
  const pendingReviewCount = evaluations.filter((item) => item.approvalState === "pending_review").length;
  const highWarningCount = warnings.filter((warning) => String(warning.severity ?? "").toLowerCase() === "high").length;
  const openWarningCount = warnings.length;

  const score =
    overdueCount * 2 +
    resubmissionCount * 3 +
    evidenceGapCount * 2 +
    pendingReviewCount +
    openWarningCount +
    highWarningCount * 2 +
    (blockedHandover ? 4 : 0) +
    Math.min(linkedMicrosoftCount, 2);

  let level: QualityRiskLevel = "low";
  if (blockedHandover || score >= 12 || highWarningCount >= 2) {
    level = "critical";
  } else if (score >= 7 || highWarningCount >= 1 || resubmissionCount >= 1 || overdueCount >= 2) {
    level = "high";
  } else if (score >= 3 || evidenceGapCount >= 1 || pendingReviewCount >= 1 || openWarningCount >= 1) {
    level = "medium";
  }

  const summaryBits = uniqueNonEmpty([
    blockedHandover ? "handover blocked" : null,
    overdueCount > 0 ? `${overdueCount} overdue` : null,
    resubmissionCount > 0 ? `${resubmissionCount} resubmission` : null,
    evidenceGapCount > 0 ? `${evidenceGapCount} evidence gap` : null,
    highWarningCount > 0 ? `${highWarningCount} high warning` : null,
    linkedMicrosoftCount > 0 ? `${linkedMicrosoftCount} linked Microsoft item` : null,
  ]);

  return {
    score,
    level,
    summary: summaryBits.length > 0 ? summaryBits.join(", ") : "Stable quality position",
    exposures: {
      overdueCount,
      resubmissionCount,
      evidenceGapCount,
      pendingReviewCount,
      openWarningCount,
      highWarningCount,
      blockedHandover,
      handoverReasonCount: handoverReasons.length,
      linkedMicrosoftCount,
    },
  };
}
