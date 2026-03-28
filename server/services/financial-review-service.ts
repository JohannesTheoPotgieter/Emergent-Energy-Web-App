import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  approvals,
  budgetBaselines,
  normalizedCostLines,
  procurementItems,
  projectExecutionState,
  projectFinancialReviews,
  projectInfo,
  projectRevenueSummary,
  workItems,
} from "@shared/schema";
import { db } from "../db";
import { createProjectEvent } from "./project-event-service";

// ===================== TYPES =====================

export type ReviewStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "DEFERRED";
export type ReviewOutcome = "GO" | "CONDITIONAL_GO" | "NO_GO" | "DEFERRED";

const VALID_TRANSITIONS: Record<string, ReviewStatus[]> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED", "REJECTED", "DEFERRED"],
  REJECTED: ["DRAFT"], // re-open for new version
  DEFERRED: ["DRAFT", "IN_REVIEW"],
};

// ===================== SNAPSHOT COMPUTATION =====================

export async function computeFinancialSnapshot(projectId: number) {
  // Budget baseline (latest locked)
  const [baseline] = await db
    .select()
    .from(budgetBaselines)
    .where(and(eq(budgetBaselines.projectId, projectId), eq(budgetBaselines.changeLocked, true)))
    .orderBy(desc(budgetBaselines.version))
    .limit(1);

  // Actual costs (amount_ex_vat is text — cast and sum)
  const costResult = await db
    .select({ total: sql<string>`COALESCE(SUM(NULLIF(amount_ex_vat, '')::numeric), 0)` })
    .from(normalizedCostLines)
    .where(eq(normalizedCostLines.projectId, projectId));
  const actualTotal = Number(costResult[0]?.total || 0);

  // Revenue summary
  const [revSummary] = await db
    .select()
    .from(projectRevenueSummary)
    .where(eq(projectRevenueSummary.projectId, projectId))
    .orderBy(desc(projectRevenueSummary.capturedAt))
    .limit(1);

  // Procurement readiness — items with quotes received or PO issued
  const procResult = await db
    .select({
      total: sql<number>`count(*)::int`,
      withQuotes: sql<number>`count(*) FILTER (WHERE quote_received_date IS NOT NULL OR requisition_status IN ('quoted', 'po_issued'))::int`,
    })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, projectId));
  const procTotal = Number(procResult[0]?.total || 0);
  const procWithQuotes = Number(procResult[0]?.withQuotes || 0);
  const procurementReadiness = procTotal > 0 ? procWithQuotes / procTotal : 0;

  // Open finance/governance work items
  const openTaskResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        sql`${workItems.workstream} IN ('FINANCE', 'GOVERNANCE')`,
        sql`${workItems.status} NOT IN ('Complete', 'Cancelled')`,
      ),
    );
  const openFinanceTasks = Number(openTaskResult[0]?.count || 0);

  const budgetTotal = baseline ? Number(baseline.cosBaseline || 0) : 0;
  const variance = budgetTotal - actualTotal;
  const variancePct = budgetTotal > 0 ? (variance / budgetTotal) * 100 : 0;
  const margin = revSummary ? Number(revSummary.plannedMargin || 0) : 0;
  const contingency = baseline ? Number(baseline.contingency || 0) : 0;

  // Computed warnings
  const warnings: Array<{ code: string; severity: string; message: string }> = [];
  if (Math.abs(variancePct) > 10) {
    warnings.push({ code: "BUDGET_VARIANCE", severity: "HIGH", message: `Budget variance ${variancePct.toFixed(1)}% exceeds 10% threshold` });
  }
  if (margin > 0 && margin < 0.15) {
    warnings.push({ code: "LOW_MARGIN", severity: "HIGH", message: `Forecast margin ${(margin * 100).toFixed(1)}% is below 15% target` });
  }
  if (procTotal > 0 && procurementReadiness < 0.5) {
    warnings.push({ code: "LOW_PROCUREMENT_READINESS", severity: "MED", message: `Only ${(procurementReadiness * 100).toFixed(0)}% of procurement items have multiple quotes` });
  }
  if (openFinanceTasks > 0) {
    warnings.push({ code: "OPEN_FINANCE_TASKS", severity: "MED", message: `${openFinanceTasks} open finance/governance task(s)` });
  }

  return {
    budgetBaselineId: baseline?.id ?? null,
    snapshotBudgetTotal: budgetTotal.toFixed(2),
    snapshotActualTotal: actualTotal.toFixed(2),
    snapshotVariance: variance.toFixed(2),
    snapshotVariancePct: variancePct.toFixed(4),
    snapshotMargin: margin.toFixed(4),
    snapshotContingencyRemaining: contingency.toFixed(2),
    snapshotProcurementReadiness: procurementReadiness,
    snapshotData: {
      warnings,
      openFinanceTasks,
      procurementSummary: { total: procTotal, withMultipleQuotes: procWithQuotes },
      revenueSnapshot: revSummary
        ? {
            plannedRevenue: revSummary.plannedRevenue,
            actualRevenue: revSummary.actualRevenue,
            plannedMargin: revSummary.plannedMargin,
          }
        : null,
    },
    snapshotCapturedAt: new Date(),
  };
}

// ===================== CREATE REVIEW =====================

export async function createFinancialReview(params: {
  projectId: number;
  requestedByUserId: number;
}) {
  // Determine version (increment if previous reviews exist)
  const existing = await db
    .select({ maxVersion: sql<number>`COALESCE(MAX(version), 0)` })
    .from(projectFinancialReviews)
    .where(eq(projectFinancialReviews.projectId, params.projectId));
  const nextVersion = Number(existing[0]?.maxVersion || 0) + 1;

  // Compute snapshot
  const snapshot = await computeFinancialSnapshot(params.projectId);

  const [review] = await db
    .insert(projectFinancialReviews)
    .values({
      projectId: params.projectId,
      status: "DRAFT",
      version: nextVersion,
      requestedByUserId: params.requestedByUserId,
      ...snapshot,
    })
    .returning();

  // Update execution state
  await db
    .update(projectExecutionState)
    .set({
      financialReviewStatus: "IN_PROGRESS",
      financialReviewId: review.id,
      updatedAt: new Date(),
    })
    .where(eq(projectExecutionState.projectId, params.projectId));

  await createProjectEvent({
    projectId: params.projectId,
    eventType: "financial_review.created",
    actorUserId: params.requestedByUserId,
    actorRole: null,
    sourceEntityType: "project_financial_reviews",
    sourceEntityId: String(review.id),
    summary: `Financial Review v${nextVersion} created`,
    details: { reviewId: review.id, version: nextVersion },
    idempotencyKey: `financial-review-create:${review.id}`,
  });

  return review;
}

// ===================== GET REVIEW =====================

export async function getLatestFinancialReview(projectId: number) {
  const [review] = await db
    .select()
    .from(projectFinancialReviews)
    .where(and(eq(projectFinancialReviews.projectId, projectId), isNull(projectFinancialReviews.deletedAt)))
    .orderBy(desc(projectFinancialReviews.version))
    .limit(1);
  return review ?? null;
}

export async function getFinancialReview(reviewId: number) {
  const [review] = await db
    .select()
    .from(projectFinancialReviews)
    .where(eq(projectFinancialReviews.id, reviewId));
  return review ?? null;
}

export async function getFinancialReviewHistory(projectId: number) {
  return db
    .select()
    .from(projectFinancialReviews)
    .where(and(eq(projectFinancialReviews.projectId, projectId), isNull(projectFinancialReviews.deletedAt)))
    .orderBy(desc(projectFinancialReviews.version));
}

// ===================== UPDATE REVIEW =====================

export async function updateFinancialReview(
  reviewId: number,
  updates: {
    reviewDate?: string;
    reviewMeetingRef?: string;
    participants?: any;
    budgetReview?: any;
    procurementReview?: any;
    scopeReview?: any;
    logisticsReview?: any;
    hseReview?: any;
    outcomeConditions?: string;
    outcomeNotes?: string;
  },
) {
  const [review] = await db
    .update(projectFinancialReviews)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(projectFinancialReviews.id, reviewId))
    .returning();
  return review ?? null;
}

// ===================== REFRESH SNAPSHOT =====================

export async function refreshSnapshot(reviewId: number) {
  const existing = await getFinancialReview(reviewId);
  if (!existing) throw new Error("Review not found");
  if (existing.status !== "DRAFT" && existing.status !== "IN_REVIEW") {
    throw new Error("Cannot refresh snapshot on a finalized review");
  }

  const snapshot = await computeFinancialSnapshot(existing.projectId);
  const [updated] = await db
    .update(projectFinancialReviews)
    .set({ ...snapshot, updatedAt: new Date() })
    .where(eq(projectFinancialReviews.id, reviewId))
    .returning();
  return updated ?? null;
}

// ===================== SUBMIT REVIEW (DRAFT → IN_REVIEW) =====================

export async function submitReview(reviewId: number, actorUserId: number) {
  const review = await getFinancialReview(reviewId);
  if (!review) throw new Error("Review not found");

  assertTransition(review.status as ReviewStatus, "IN_REVIEW");

  const [updated] = await db
    .update(projectFinancialReviews)
    .set({ status: "IN_REVIEW", reviewedByUserId: actorUserId, updatedAt: new Date() })
    .where(eq(projectFinancialReviews.id, reviewId))
    .returning();

  await createProjectEvent({
    projectId: review.projectId,
    eventType: "financial_review.submitted",
    actorUserId,
    actorRole: null,
    sourceEntityType: "project_financial_reviews",
    sourceEntityId: String(reviewId),
    summary: `Financial Review v${review.version} submitted for review`,
    details: { reviewId, version: review.version },
    idempotencyKey: `financial-review-submit:${reviewId}`,
  });

  return updated;
}

// ===================== APPROVE / DECIDE =====================

export async function decideReview(params: {
  reviewId: number;
  outcome: ReviewOutcome;
  outcomeConditions?: string;
  outcomeNotes?: string;
  actorUserId: number;
  actorRole: string;
}) {
  const review = await getFinancialReview(params.reviewId);
  if (!review) throw new Error("Review not found");

  assertTransition(review.status as ReviewStatus, params.outcome === "DEFERRED" ? "DEFERRED" : params.outcome === "NO_GO" ? "REJECTED" : "APPROVED");

  const newStatus: ReviewStatus =
    params.outcome === "GO" || params.outcome === "CONDITIONAL_GO"
      ? "APPROVED"
      : params.outcome === "DEFERRED"
        ? "DEFERRED"
        : "REJECTED";

  let approvalId: number | null = null;

  // Create approval record for GO / CONDITIONAL_GO
  if (newStatus === "APPROVED") {
    const [approval] = await db
      .insert(approvals)
      .values({
        type: "gate",
        title: `Financial Review Gate — ${review.version > 1 ? `v${review.version}` : "Initial"}`,
        description: params.outcomeNotes || `Financial Review ${params.outcome}`,
        status: "approved",
        requestedBy: review.requestedByUserId ?? params.actorUserId,
        decidedBy: params.actorUserId,
        decidedAt: new Date(),
        decisionNote: params.outcomeConditions || params.outcomeNotes || null,
        projectId: review.projectId,
        approvalCategory: "financial_review",
        approvalType: "gate",
        urgency: "normal",
      })
      .returning();
    approvalId = approval.id;
  }

  const [updated] = await db
    .update(projectFinancialReviews)
    .set({
      status: newStatus,
      outcome: params.outcome,
      outcomeConditions: params.outcomeConditions ?? null,
      outcomeNotes: params.outcomeNotes ?? null,
      approvedByUserId: newStatus === "APPROVED" ? params.actorUserId : null,
      approvedAt: newStatus === "APPROVED" ? new Date() : null,
      approvalId,
      updatedAt: new Date(),
    })
    .where(eq(projectFinancialReviews.id, params.reviewId))
    .returning();

  // Update execution state
  await db
    .update(projectExecutionState)
    .set({
      financialReviewStatus: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(projectExecutionState.projectId, review.projectId));

  await createProjectEvent({
    projectId: review.projectId,
    eventType: `financial_review.${params.outcome.toLowerCase()}`,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    sourceEntityType: "project_financial_reviews",
    sourceEntityId: String(params.reviewId),
    summary: `Financial Review v${review.version} outcome: ${params.outcome}`,
    details: {
      reviewId: params.reviewId,
      version: review.version,
      outcome: params.outcome,
      conditions: params.outcomeConditions,
      approvalId,
    },
    idempotencyKey: `financial-review-decide:${params.reviewId}:${params.outcome}`,
  });

  return updated;
}

// ===================== PENDING REVIEWS QUEUE =====================

export async function getPendingReviews() {
  return db
    .select({
      review: projectFinancialReviews,
      projectName: projectInfo.projectName,
      pm: projectInfo.pm,
    })
    .from(projectFinancialReviews)
    .innerJoin(projectInfo, eq(projectFinancialReviews.projectId, projectInfo.id))
    .where(
      and(
        sql`${projectFinancialReviews.status} IN ('DRAFT', 'IN_REVIEW')`,
        isNull(projectFinancialReviews.deletedAt),
      ),
    )
    .orderBy(desc(projectFinancialReviews.updatedAt));
}

// ===================== HELPERS =====================

function assertTransition(current: ReviewStatus, target: ReviewStatus) {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new Error(`Invalid status transition: ${current} → ${target}`);
  }
}
