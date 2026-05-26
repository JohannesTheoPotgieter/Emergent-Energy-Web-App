/**
 * TF-10 (audit V3) — Project handover finance close-out gate.
 *
 * Before this gate existed, a project could be marked S_DONE (closed)
 * with outstanding AR / AP, open POs, and unresolved disputes. The
 * operational stage transitioned cleanly while the books were still
 * open — a real defect surfaced by the V3 business-workflow audit.
 *
 * The gate runs whenever `markProjectDone` is about to fire. It
 * returns a structured result:
 *
 *   - `ok: true`  — finance is clean; closure can proceed.
 *   - `ok: false` — finance has unresolved items; closure should be
 *                   blocked unless the caller has explicit override
 *                   authority and supplies a reason.
 *
 * Per the V1 audit § 0A Override Principle: this gate records and
 * surfaces; it refuses only when the math hasn't been done. Owners
 * (COO, CFO) can override with a written reason — the override is
 * recorded against the project closure decision.
 *
 * The check is purposely strict on what counts as "open":
 *
 *   AR — any revenue line with status NOT IN ('paid', 'in_bank',
 *        'realised', 'written_off') AND no dispute open.
 *   AP — any cost line with status NOT IN ('paid', 'realised') AND
 *        no dispute open.
 *   POs — purchase_orders rows for the project with status NOT IN
 *        ('paid', 'cancelled', 'closed').
 *   Disputes — any open dispute on cost or revenue lines.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  purchaseOrders,
} from "@shared/schema";

export interface FinanceCloseOutGateResult {
  ok: boolean;
  outstandingArAmount: number;
  outstandingArCount: number;
  outstandingApAmount: number;
  outstandingApCount: number;
  openPoCount: number;
  openRevenueDisputeCount: number;
  openCostDisputeCount: number;
  blockers: string[];
}

const REVENUE_CLOSED_STATUSES = ["paid", "in_bank", "realised", "written_off"];
const COST_CLOSED_STATUSES = ["paid"];
// `realised` here is the canonical COS-realised state; closed PO statuses
// follow whatever the procurement enum settles on. We bias toward the
// strict reading — anything that isn't unambiguously closed counts as
// open and blocks closure.
const PO_CLOSED_STATUSES = ["paid", "cancelled", "closed", "rejected"];

/**
 * Evaluate the finance close-out gate for a project.
 *
 * Pure read — no writes. Safe to call multiple times. The result is
 * suitable for surfacing on a "Pre-handover checklist" UI panel before
 * the operator commits to closure.
 */
export async function evaluateFinanceCloseOutGate(
  projectId: number,
): Promise<FinanceCloseOutGateResult> {
  // AR — revenue lines that aren't closed and aren't disputed.
  const [arRows] = await Promise.all([
    db
      .select({
        amount: sql<string>`COALESCE(SUM(CAST(${normalizedRevenueLines.amountExVat} AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          sql`${normalizedRevenueLines.status} NOT IN (${sql.join(REVENUE_CLOSED_STATUSES.map(s => sql`${s}`), sql`, `)})`,
          // Exclude lines under active dispute — they're surfaced separately
          // below so the operator sees the dispute count as its own line item.
          isNull(normalizedRevenueLines.disputeOpenedAt),
        ),
      ),
  ]);

  // AP — cost lines that aren't paid and aren't disputed.
  const [apRows] = await Promise.all([
    db
      .select({
        amount: sql<string>`COALESCE(SUM(CAST(${normalizedCostLines.amountExVat} AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          sql`${normalizedCostLines.status} NOT IN (${sql.join(COST_CLOSED_STATUSES.map(s => sql`${s}`), sql`, `)})`,
          isNull(normalizedCostLines.disputeOpenedAt),
        ),
      ),
  ]);

  // Open POs — purchase_orders rows still in flight.
  const poRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.projectId, projectId),
        sql`${purchaseOrders.status} NOT IN (${sql.join(PO_CLOSED_STATUSES.map(s => sql`${s}`), sql`, `)})`,
      ),
    );

  // Open disputes — revenue and cost separately so the surface can
  // route the operator to the right resolution flow.
  const [openRevenueDisputeRows, openCostDisputeRows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          isNotNull(normalizedRevenueLines.disputeOpenedAt),
          isNull(normalizedRevenueLines.disputeResolvedAt),
        ),
      ),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          isNotNull(normalizedCostLines.disputeOpenedAt),
          isNull(normalizedCostLines.disputeResolvedAt),
        ),
      ),
  ]);

  const outstandingArAmount = Number(arRows?.amount ?? 0);
  const outstandingArCount = Number(arRows?.count ?? 0);
  const outstandingApAmount = Number(apRows?.amount ?? 0);
  const outstandingApCount = Number(apRows?.count ?? 0);
  const openPoCount = Number(poRows[0]?.count ?? 0);
  const openRevenueDisputeCount = Number(openRevenueDisputeRows[0]?.count ?? 0);
  const openCostDisputeCount = Number(openCostDisputeRows[0]?.count ?? 0);

  const blockers: string[] = [];
  if (outstandingArCount > 0) {
    blockers.push(
      `Outstanding AR: R ${outstandingArAmount.toFixed(2)} across ${outstandingArCount} invoice${outstandingArCount === 1 ? "" : "s"}.`,
    );
  }
  if (outstandingApCount > 0) {
    blockers.push(
      `Outstanding AP: R ${outstandingApAmount.toFixed(2)} across ${outstandingApCount} invoice${outstandingApCount === 1 ? "" : "s"}.`,
    );
  }
  if (openPoCount > 0) {
    blockers.push(
      `${openPoCount} open purchase order${openPoCount === 1 ? "" : "s"} — close or cancel before handover.`,
    );
  }
  if (openRevenueDisputeCount > 0) {
    blockers.push(
      `${openRevenueDisputeCount} open revenue dispute${openRevenueDisputeCount === 1 ? "" : "s"} — resolve before handover.`,
    );
  }
  if (openCostDisputeCount > 0) {
    blockers.push(
      `${openCostDisputeCount} open cost dispute${openCostDisputeCount === 1 ? "" : "s"} — resolve before handover.`,
    );
  }

  return {
    ok: blockers.length === 0,
    outstandingArAmount,
    outstandingArCount,
    outstandingApAmount,
    outstandingApCount,
    openPoCount,
    openRevenueDisputeCount,
    openCostDisputeCount,
    blockers,
  };
}
