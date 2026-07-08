// ===================== CANONICAL STATUSES =====================

/**
 * Canonical quality item statuses. Every qcItemInstance.qmStatus value
 * MUST be one of these. The UI STATUS_CONFIG and backend ALLOWED_QM_STATUSES
 * both derive from this single source of truth.
 */
export const QUALITY_ITEM_STATUSES = [
  "not_started",
  "review",
  "pass",
  "fail",
  "na",
] as const;

export type QualityItemStatus = (typeof QUALITY_ITEM_STATUSES)[number];

/**
 * Valid status transitions. Key = current status, value = set of allowed next statuses.
 * Enforced server-side on item update.
 */
export const VALID_QM_STATUS_TRANSITIONS: Record<QualityItemStatus, readonly QualityItemStatus[]> = {
  not_started: ["review", "pass", "fail", "na"],
  review: ["pass", "fail", "not_started", "na"],
  pass: ["review", "fail", "not_started", "na"],
  fail: ["review", "pass", "not_started", "na"],
  na: ["not_started", "review", "pass", "fail"],
} as const;

export function isValidQmStatusTransition(from: string, to: string): boolean {
  const allowed = VALID_QM_STATUS_TRANSITIONS[from as QualityItemStatus];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

// ===================== INTERFACES =====================

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

export interface QualityRiskAnswerLike {
  responseType?: string | null;
  triggersWarning?: boolean | null;
  triggerCondition?: string | null;
  triggerSeverity?: string | null;
  answerYesno?: boolean | null;
  answerText?: string | null;
  answerNumber?: number | null;
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
    openNcrCount: number;
    unansweredRiskCount: number;
    triggeredRiskCount: number;
    highTriggeredRiskCount: number;
    // Item-level counts that match QualityTab drill-down predicates so badge
    // counts in the alert strip exactly equal the items listed when the user
    // clicks through.
    handoverBlockingItemCount: number;
    criticalContributorItemCount: number;
    actionableForApprovalCount: number;
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
  riskAnswers?: QualityRiskAnswerLike[] | null;
  warnings?: QualityWarningLike[] | null;
  handover?: QualityHandoverLike | null;
  linkedMicrosoftCount?: number;
  openNcrCount?: number;
  now?: Date;
}): QualityRiskSummary {
  const now = params.now ?? new Date();
  const evaluations = params.items.map((item) => evaluateQualityGovernanceItem(item, now));
  const riskAnswers = params.riskAnswers ?? [];
  const warnings = (params.warnings ?? []).filter((warning) => String(warning.status ?? "").toLowerCase() !== "resolved");
  const handoverReasons = getQualityHandoverReasons(params.handover);
  const blockedHandover = isHandoverQualityBlocked(params.handover);
  const linkedMicrosoftCount = Math.max(0, Number(params.linkedMicrosoftCount ?? 0));
  const openNcrCount = Math.max(0, Number(params.openNcrCount ?? 0));

  const overdueCount = evaluations.filter((item) => item.overdue).length;
  const resubmissionCount = evaluations.filter((item) => item.resubmissionNeeded).length;
  const evidenceGapCount = evaluations.filter((item) => item.evidenceMissing).length;
  const pendingReviewCount = evaluations.filter((item) => item.approvalState === "pending_review").length;
  // Item-level set counts mirroring QualityTab drill-down predicates.
  const handoverBlockingItemCount = evaluations.filter(
    (item) => item.evidenceMissing || item.resubmissionNeeded || item.overdue || item.approvalState === "pending_review",
  ).length;
  const criticalContributorItemCount = evaluations.filter(
    (item) => item.evidenceMissing || item.resubmissionNeeded || item.overdue,
  ).length;
  const actionableForApprovalCount = params.items.filter((rawItem, index) => {
    if (rawItem.isApplicable === false) return false;
    const evaluation = evaluations[index];
    if (evaluation.approvalState === "pending_review" || evaluation.approvalState === "approved") return false;
    if (rawItem.approved) return false;
    return true;
  }).length;
  const highWarningCount = warnings.filter((warning) => String(warning.severity ?? "").toLowerCase() === "high").length;
  const openWarningCount = warnings.length;
  const unansweredRiskCount = riskAnswers.filter((answer) => {
    const responseType = String(answer.responseType ?? "yesno").toLowerCase();
    if (responseType === "number") return answer.answerNumber == null;
    if (responseType === "text") return !String(answer.answerText ?? "").trim();
    return answer.answerYesno == null;
  }).length;
  const triggeredRiskAnswers = riskAnswers.filter((answer) => {
    if (!answer.triggersWarning) return false;
    const triggerCondition = String(answer.triggerCondition ?? "").toLowerCase();
    if (triggerCondition === "yes") return answer.answerYesno === true;
    if (triggerCondition === "no") return answer.answerYesno === false;
    return false;
  });
  const triggeredRiskCount = triggeredRiskAnswers.length;
  const highTriggeredRiskCount = triggeredRiskAnswers.filter(
    (answer) => String(answer.triggerSeverity ?? "").toLowerCase() === "high",
  ).length;

  const score =
    overdueCount * 2 +
    resubmissionCount * 3 +
    evidenceGapCount * 2 +
    pendingReviewCount +
    openWarningCount +
    highWarningCount * 2 +
    unansweredRiskCount +
    triggeredRiskCount * 2 +
    highTriggeredRiskCount * 2 +
    (blockedHandover ? 4 : 0) +
    Math.min(linkedMicrosoftCount, 2) +
    openNcrCount * 2;

  let level: QualityRiskLevel = "low";
  if (blockedHandover || score >= 12 || highWarningCount >= 2) {
    level = "critical";
  } else if (score >= 7 || highWarningCount >= 1 || resubmissionCount >= 1 || overdueCount >= 2) {
    level = "high";
  } else if (score >= 3 || evidenceGapCount >= 1 || pendingReviewCount >= 1 || openWarningCount >= 1 || openNcrCount >= 1) {
    level = "medium";
  }

  const summaryBits = uniqueNonEmpty([
    blockedHandover ? "handover blocked" : null,
    overdueCount > 0 ? `${overdueCount} overdue` : null,
    resubmissionCount > 0 ? `${resubmissionCount} resubmission` : null,
    evidenceGapCount > 0 ? `${evidenceGapCount} evidence gap` : null,
    highWarningCount > 0 ? `${highWarningCount} high warning` : null,
    openNcrCount > 0 ? `${openNcrCount} open NCR` : null,
    triggeredRiskCount > 0 ? `${triggeredRiskCount} risk trigger` : null,
    unansweredRiskCount > 0 ? `${unansweredRiskCount} unanswered risk question` : null,
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
      openNcrCount,
      unansweredRiskCount,
      triggeredRiskCount,
      highTriggeredRiskCount,
      handoverBlockingItemCount,
      criticalContributorItemCount,
      actionableForApprovalCount,
    },
  };
}

// ===================== DEFINITION OF DONE =====================

export interface QualityItemCompletionResult {
  complete: boolean;
  reasons: string[];
}

/**
 * Evaluates whether a single quality item meets its Definition of Done.
 * An item is complete when:
 * 1. It is not applicable (N/A), OR
 * 2. It is approved (qmStatus = pass) AND evidence is present if required.
 */
export function isQualityItemComplete(item: QualityGovernanceItemLike): QualityItemCompletionResult {
  if (item.isApplicable === false) {
    return { complete: true, reasons: [] };
  }

  const reasons: string[] = [];

  if (!item.approved) {
    const status = normalizeQualityItemStatus(item);
    if (status === "fail") {
      reasons.push("Item failed — resubmission required");
    } else if (status === "review") {
      reasons.push("Awaiting approval review");
    } else {
      reasons.push("Not yet approved");
    }
  }

  if (item.isEvidenceRequired && Number(item.evidenceCount ?? 0) <= 0) {
    reasons.push("Required evidence not uploaded");
  }

  return { complete: reasons.length === 0, reasons };
}

/**
 * Checks whether a quality item with required evidence can be approved.
 * Returns null if approval is allowed, or a reason string if blocked.
 */
export function getApprovalBlockReason(item: QualityGovernanceItemLike): string | null {
  if (item.isApplicable === false) return null;
  if (item.isEvidenceRequired && Number(item.evidenceCount ?? 0) <= 0) {
    return "Cannot approve: required evidence has not been uploaded";
  }
  return null;
}

// ===================== HANDOVER READINESS =====================

export interface QualityChecklistReadiness {
  ready: boolean;
  completionPercent: number;
  totalApplicable: number;
  totalComplete: number;
  incompleteItems: Array<{
    itemName?: string;
    reasons: string[];
  }>;
  openHighWarnings: number;
  /** Open critical NCRs counted toward the gate (0 when the gate is off). */
  openCriticalNcrCount: number;
  blockers: string[];
}

/**
 * Evaluates whether a project's quality checklist is complete enough for handover.
 *
 * Handover readiness requires:
 * 1. All applicable quality items are complete (approved + evidence)
 * 2. No open high-severity warnings
 * 3. No unresolved high-severity risk triggers
 */
export function evaluateChecklistHandoverReadiness(params: {
  items: QualityGovernanceItemLike[];
  itemNames?: string[];
  warnings?: QualityWarningLike[];
  riskAnswers?: QualityRiskAnswerLike[];
  /** Task 3.5: open critical NCRs. Only blocks when the gate is enabled. */
  openCriticalNcrCount?: number;
  /** Task 3.5: opt-in gate — default off so existing callers are unchanged. */
  criticalNcrGateEnabled?: boolean;
}): QualityChecklistReadiness {
  const { items, itemNames, warnings, riskAnswers } = params;
  const blockers: string[] = [];

  // Pair each item with its name BEFORE filtering out non-applicable items.
  // Indexing the filtered `applicableItems` against the original `itemNames`
  // array mislabels every item that follows a skipped N/A item (off-by-N).
  const applicablePairs = items
    .map((item, index) => ({ item, itemName: itemNames?.[index] }))
    .filter(({ item }) => item.isApplicable !== false);
  const applicableItems = applicablePairs.map((pair) => pair.item);
  const completionResults = applicablePairs.map(({ item, itemName }) => ({
    result: isQualityItemComplete(item),
    itemName,
  }));

  const completeCount = completionResults.filter((r) => r.result.complete).length;
  const incompleteItems = completionResults
    .filter((r) => !r.result.complete)
    .map((r) => ({
      itemName: r.itemName,
      reasons: r.result.reasons,
    }));

  const completionPercent = applicableItems.length > 0
    ? Math.round((completeCount / applicableItems.length) * 100)
    : 100;

  if (incompleteItems.length > 0) {
    blockers.push(`${incompleteItems.length} quality item(s) not complete`);
  }

  const openHighWarnings = (warnings ?? []).filter(
    (w) =>
      String(w.status ?? "").toLowerCase() !== "resolved" &&
      String(w.severity ?? "").toLowerCase() === "high",
  ).length;

  if (openHighWarnings > 0) {
    blockers.push(`${openHighWarnings} open high-severity warning(s)`);
  }

  const highTriggeredRisks = (riskAnswers ?? []).filter((answer) => {
    if (!answer.triggersWarning) return false;
    if (String(answer.triggerSeverity ?? "").toLowerCase() !== "high") return false;
    const condition = String(answer.triggerCondition ?? "").toLowerCase();
    if (condition === "yes") return answer.answerYesno === true;
    if (condition === "no") return answer.answerYesno === false;
    return false;
  }).length;

  if (highTriggeredRisks > 0) {
    blockers.push(`${highTriggeredRisks} high-severity risk trigger(s) active`);
  }

  // Task 3.5: opt-in gate — open critical NCRs block handover when enabled.
  // Default off (no flag → no blocker), so existing callers are unchanged.
  const openCriticalNcrCount = Math.max(0, Number(params.openCriticalNcrCount ?? 0));
  const criticalNcrBlocks = params.criticalNcrGateEnabled === true && openCriticalNcrCount > 0;
  if (criticalNcrBlocks) {
    blockers.push(`${openCriticalNcrCount} open critical NCR(s)`);
  }

  return {
    ready: blockers.length === 0,
    completionPercent,
    totalApplicable: applicableItems.length,
    totalComplete: completeCount,
    incompleteItems,
    openHighWarnings,
    openCriticalNcrCount: criticalNcrBlocks ? openCriticalNcrCount : 0,
    blockers,
  };
}

// ===================== QC PROGRESS (shared helper) =====================

export interface QcProgressResult {
  totalApplicable: number;
  totalApproved: number;
  progressPercent: number;
}

/**
 * Computes QC checklist progress from a list of item instances.
 * This is the single source of truth for QC progress calculation.
 * Used by dashboard-metrics, company-overview, pm-monthly-report, and quality-routes.
 */
export function computeQcProgress(
  items: Array<{ isApplicable?: boolean | null; approved?: boolean | null; qmStatus?: string | null }>,
): QcProgressResult {
  const applicable = items.filter((i) => i.isApplicable !== false);
  const approved = applicable.filter((i) => i.approved === true || i.qmStatus === "pass");
  const totalApplicable = applicable.length;
  const totalApproved = approved.length;
  return {
    totalApplicable,
    totalApproved,
    progressPercent: totalApplicable > 0 ? Math.round((totalApproved / totalApplicable) * 100) : 0,
  };
}

/**
 * Derives a dashboard-friendly quality status label from warning counts.
 * Aligns with governance risk levels from computeQualityRiskSummary.
 */
export function deriveQualityStatusLabel(openWarnings: number, highWarnings: number): string {
  if (highWarnings >= 2) return "Blocked";
  if (openWarnings >= 3 || highWarnings >= 1) return "At Risk";
  return "On Track";
}
