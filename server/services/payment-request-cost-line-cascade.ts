/**
 * TF-21 (audit V3) — payment_request → cost_line paid-date cascade.
 *
 * Before this service existed, marking a payment_request as "complete"
 * in the procurement domain did NOT touch normalized_cost_lines.paidDate
 * in the finance domain. Two domain owners reading "is this invoice
 * paid?" could get different answers from the same source data —
 * Cashflow showed "paid", Finance showed "outstanding".
 *
 * When a batch confirms and its payment_requests transition to
 * `complete`, this service proposes (NOT applies) an update to the
 * matching cost line(s) via `pending_approvals`. Matching uses:
 *
 *   1. Direct PO link: payment_requests.purchase_order_id →
 *      purchase_orders.po_ref → normalized_cost_lines.po_number.
 *   2. Counterparty + amount: payment_requests.counterparty_id +
 *      amount → normalized_cost_lines.counterparty_id + amount_ex_vat
 *      (when the PO link is missing).
 *
 * The proposal carries the matched cost_line_ids; the reviewer
 * (CFO / Program Finance Manager) confirms or rejects. On approve,
 * the cost lines' paid_date + paid_date_confirmed are set via the
 * canonical write service.
 *
 * Conservative match policy:
 *   - If 0 matches → no proposal, log only.
 *   - If 1 match  → propose with high confidence.
 *   - If >1 match → propose with low confidence (reviewer disambiguates).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  paymentRequests,
  pendingApprovals,
  purchaseOrders,
} from "@shared/schema";

export interface PaymentRequestCascadeResult {
  paymentRequestId: number;
  /** Cost-line ids matched. */
  candidateCostLineIds: number[];
  /** "high" when exactly one match, "low" otherwise. */
  confidence: "high" | "low" | "none";
  /** Pending-approval id created when ≥1 candidate. */
  pendingApprovalId?: number;
  /** Reason a proposal was NOT created (when applicable). */
  skipReason?: string;
}

interface MatchedPayment {
  paymentRequestId: number;
  projectId: number;
  amount: string | null;
  purchaseOrderId: number | null;
  counterpartyId: number | null;
}

async function findCandidateCostLines(match: MatchedPayment): Promise<number[]> {
  // Path 1 — direct PO link.
  if (match.purchaseOrderId) {
    const [po] = await db
      .select({ poRef: purchaseOrders.poRef, poNumber: purchaseOrders.poNumber })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, match.purchaseOrderId))
      .limit(1);
    if (po) {
      const candidates = await db
        .select({ id: normalizedCostLines.id })
        .from(normalizedCostLines)
        .where(
          and(
            eq(normalizedCostLines.projectId, match.projectId),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
            isNull(normalizedCostLines.paidDate),
            inArray(normalizedCostLines.poNumber, [po.poRef, String(po.poNumber)]),
          ),
        );
      if (candidates.length > 0) return candidates.map((c: { id: number }) => c.id);
    }
  }

  // Path 2 — counterparty + amount fallback (within 1c tolerance).
  if (match.counterpartyId && match.amount) {
    const target = Number(match.amount);
    if (Number.isFinite(target)) {
      const candidates = await db
        .select({ id: normalizedCostLines.id })
        .from(normalizedCostLines)
        .where(
          and(
            eq(normalizedCostLines.projectId, match.projectId),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
            isNull(normalizedCostLines.paidDate),
            eq(normalizedCostLines.counterpartyId, match.counterpartyId),
            // amount_ex_vat may be a string or numeric; tolerance 0.01 ZAR.
            sql`ABS(CAST(${normalizedCostLines.amountExVat} AS NUMERIC) - ${target}) <= 0.01`,
          ),
        );
      return candidates.map((c: { id: number }) => c.id);
    }
  }

  return [];
}

/**
 * Process a batch of payment_request ids that just transitioned to
 * `complete`. For each, finds matching cost line(s) and creates a
 * cascade proposal in pending_approvals. Returns one result per input id.
 *
 * Idempotent within a single call (one pending_approval per
 * payment_request even if multiple cost lines match — the reviewer
 * picks the right line from the candidates).
 */
export async function proposePaymentRequestCascade(
  paymentRequestIds: number[],
  options: { proposedByUserId?: number | null; paidDate?: string | null } = {},
): Promise<PaymentRequestCascadeResult[]> {
  if (paymentRequestIds.length === 0) return [];

  const matches = await db
    .select({
      paymentRequestId: paymentRequests.id,
      projectId: paymentRequests.projectId,
      amount: paymentRequests.amount,
      purchaseOrderId: paymentRequests.purchaseOrderId,
      counterpartyId: paymentRequests.counterpartyId,
    })
    .from(paymentRequests)
    .where(inArray(paymentRequests.id, paymentRequestIds));

  const results: PaymentRequestCascadeResult[] = [];
  const today = options.paidDate ?? new Date().toISOString().slice(0, 10);

  for (const m of matches) {
    const candidates = await findCandidateCostLines(m);
    if (candidates.length === 0) {
      results.push({
        paymentRequestId: m.paymentRequestId,
        candidateCostLineIds: [],
        confidence: "none",
        skipReason: "no matching cost lines",
      });
      continue;
    }
    const confidence: "high" | "low" = candidates.length === 1 ? "high" : "low";
    const [created] = await db
      .insert(pendingApprovals)
      .values({
        kind: "payment_request_cost_line_paid_sync",
        targetTable: "normalized_cost_lines",
        summary:
          `Payment request #${m.paymentRequestId} marked complete — propose paidDate=${today} on ${candidates.length} matching cost line${candidates.length === 1 ? "" : "s"}.`,
        payload: {
          paymentRequestId: m.paymentRequestId,
          projectId: m.projectId,
          paidDate: today,
          candidateCostLineIds: candidates,
          confidence,
          proposedByUserId: options.proposedByUserId ?? null,
          proposedAt: new Date().toISOString(),
        },
        sourceLabel: "finance:payment-request-cascade",
        sourceRef: `payment_request:${m.paymentRequestId}`,
      })
      .returning({ id: pendingApprovals.id });
    results.push({
      paymentRequestId: m.paymentRequestId,
      candidateCostLineIds: candidates,
      confidence,
      pendingApprovalId: created?.id,
    });
  }

  return results;
}
