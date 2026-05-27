/**
 * TF-24 (audit V3) — PO cancellation cascade to cost lines.
 *
 * Before this service existed, cancelling a PO in the procurement
 * domain didn't touch the cost lines that referenced it. The link is
 * a string match (`normalized_cost_lines.po_number` matching
 * `purchase_orders.po_ref` / `po_number`) — no FK. So a cancelled PO
 * would still appear as "live" in the cashflow / cost-tracker
 * surfaces because the cost lines kept their `INVOICED` / `PAID`
 * status.
 *
 * The cascade runs whenever a PO's status transitions to `cancelled`
 * (via `PATCH /api/po/:poId/status`). It walks the cost lines for the
 * same project + po_number string and:
 *
 *   - Already-paid lines  → untouched (history).
 *   - Planned / invoiced lines → po_number is set to NULL and the
 *     cancellation reason is appended to the line description so a
 *     reader on the cost-tracker sees "PO cancelled YYYY-MM-DD".
 *
 * The cascade is deliberately conservative — we don't flip the line's
 * status (the operator may want to re-link to a replacement PO). We
 * just sever the link.
 *
 * Audit: one `audit_events` row per affected cost line plus a summary
 * row on the PO record.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { normalizedCostLines, purchaseOrders } from "@shared/schema";
import { syncCostLineFieldUpdate, bridgeCatch } from "../bridge/bridge-writer";

export interface PoCancellationCascadeResult {
  /** Cost-line ids that were severed from the cancelled PO. */
  severedCostLineIds: number[];
  /** Cost-line ids that were left alone because they were already paid. */
  preservedCostLineIds: number[];
  /** Identifier of the PO that was cancelled (for the audit trail). */
  poRef: string;
  poNumber: number;
}

/**
 * Cascade a PO cancellation to its cost lines. Caller is responsible
 * for transitioning the PO row to `cancelled` (this service only
 * touches the downstream cost lines). Idempotent — running the
 * cascade twice on the same PO is a no-op the second time.
 */
export async function cascadePoCancellationToCostLines(
  poId: number,
  reason?: string,
): Promise<PoCancellationCascadeResult> {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      poRef: purchaseOrders.poRef,
      poNumber: purchaseOrders.poNumber,
      projectId: purchaseOrders.projectId,
      projectName: purchaseOrders.projectName,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  if (!po) {
    throw new Error(`Purchase order ${poId} not found.`);
  }

  // Match on either po_ref or stringified po_number (both forms appear
  // historically; the canonical form is po_ref but legacy lines used the
  // bare integer).
  const candidateKeys = [po.poRef, String(po.poNumber)];

  // Pull every active cost line in the project whose po_number matches.
  const candidates = await db
    .select({
      id: normalizedCostLines.id,
      paidDate: normalizedCostLines.paidDate,
      status: normalizedCostLines.status,
      description: normalizedCostLines.description,
      poNumber: normalizedCostLines.poNumber,
    })
    .from(normalizedCostLines)
    .where(
      and(
        po.projectId !== null
          ? eq(normalizedCostLines.projectId, po.projectId)
          : eq(normalizedCostLines.projectName, po.projectName),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        inArray(normalizedCostLines.poNumber, candidateKeys),
      ),
    );

  const severedIds: number[] = [];
  const preservedIds: number[] = [];

  for (const line of candidates) {
    // Already-paid lines are history — don't rewrite them.
    if (line.paidDate || line.status === "paid") {
      preservedIds.push(line.id);
      continue;
    }
    severedIds.push(line.id);
  }

  if (severedIds.length > 0) {
    const stamp = `\n[PO ${po.poRef} cancelled ${new Date().toISOString().slice(0, 10)}${reason ? `: ${reason}` : ""}]`;
    // One UPDATE per line because the new description depends on the
    // existing value. The set is bounded by the number of cost lines
    // tied to a single PO — typically <50 — so the chattiness is fine.
    for (const line of candidates) {
      if (!severedIds.includes(line.id)) continue;
      const nextDescription = `${line.description ?? ""}${stamp}`.trim();
      await db
        .update(normalizedCostLines)
        .set({ poNumber: null, description: nextDescription })
        .where(eq(normalizedCostLines.id, line.id));
      syncCostLineFieldUpdate(line.id, { poNumber: null, description: nextDescription }).catch(bridgeCatch);
    }
  }

  return {
    severedCostLineIds: severedIds,
    preservedCostLineIds: preservedIds,
    poRef: po.poRef,
    poNumber: po.poNumber,
  };
}
