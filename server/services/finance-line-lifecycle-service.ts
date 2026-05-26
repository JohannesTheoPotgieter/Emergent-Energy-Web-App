/**
 * TF-7 / TF-8 (audit V3) — Finance line lifecycle operations for disputes
 * and bad-debt write-offs.
 *
 * Before this service existed, an operator who wanted to capture a
 * disputed invoice or write off bad debt had to create a manual negative-
 * amount line (workaround documented in the V3 audit as the headline
 * "missing workflow" finding). This service is the canonical path for
 * both operations:
 *
 *   - openDisputeOnRevenueLine / resolveDisputeOnRevenueLine
 *   - openDisputeOnCostLine / resolveDisputeOnCostLine
 *   - writeOffRevenueLine
 *
 * Design contract:
 *
 *   1. Dispute and write-off transitions ALWAYS write an audit_events
 *      row. The dispute lifecycle is workflow data; we must be able to
 *      reconstruct "who opened this dispute, when, why, who resolved it
 *      with what outcome".
 *
 *   2. Write-off requires `requirePermission("financials", "approve")`
 *      at the route layer (enforced by the route, not the service). The
 *      service trusts its caller has gated correctly.
 *
 *   3. Aggregates (outstanding AR / AP, overdue lists) EXCLUDE lines
 *      where status='disputed' or status='written_off'. The exclusion
 *      lives in the repository / KPI layer (next phase of this PR).
 *
 *   4. The temporal snapshot guard is preserved: writes target the
 *      active snapshot row (effective_to IS NULL, deleted_at IS NULL).
 *      A dispute is not a new revision; it's a status change on the
 *      live row.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
} from "@shared/schema";
import { recordAudit } from "../api/v2/services/audit-service";
import { badRequest, notFound } from "../lib/api-error";
import { recomputeDerivedKpisForProject } from "./derived-project-kpis-materializer";

// ---------------------------------------------------------------------------
// Revenue-line dispute
// ---------------------------------------------------------------------------

export interface OpenDisputeArgs {
  lineId: number;
  reason: string;
  openedByUserId: number | null;
}

export async function openDisputeOnRevenueLine(args: OpenDisputeArgs): Promise<void> {
  if (!args.reason || args.reason.trim().length === 0) {
    throw badRequest("Dispute reason is required.");
  }
  const [existing] = await db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.id, args.lineId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("Revenue line");
  if (existing.status === "written_off") {
    throw badRequest("Cannot open a dispute on a line that has been written off.");
  }
  if (existing.disputeOpenedAt && !existing.disputeResolvedAt) {
    throw badRequest("This revenue line already has an open dispute.");
  }

  const previousStatus = existing.status;
  await db
    .update(normalizedRevenueLines)
    .set({
      status: "disputed",
      disputeOpenedAt: new Date(),
      disputeResolvedAt: null,
      disputeReason: args.reason.trim(),
      disputeOpenedByUserId: args.openedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(normalizedRevenueLines.id, args.lineId));

  await recordAudit({
    userId: args.openedByUserId ?? undefined,
    entityType: "revenue_line",
    entityId: String(args.lineId),
    action: "dispute_opened",
    changesJson: {
      previousStatus,
      newStatus: "disputed",
      reason: args.reason.trim(),
    },
  });

  if (existing.projectId !== null) {
    void recomputeDerivedKpisForProject(existing.projectId);
  }
}

export interface ResolveDisputeArgs {
  lineId: number;
  outcome: "accepted" | "rejected" | "renegotiated";
  newStatus: "invoiced" | "paid" | "in_bank" | "realised" | "written_off";
  resolutionNote: string;
  resolvedByUserId: number | null;
}

export async function resolveDisputeOnRevenueLine(args: ResolveDisputeArgs): Promise<void> {
  if (!args.resolutionNote || args.resolutionNote.trim().length === 0) {
    throw badRequest("Resolution note is required.");
  }
  const [existing] = await db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.id, args.lineId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("Revenue line");
  if (!existing.disputeOpenedAt || existing.disputeResolvedAt) {
    throw badRequest("No open dispute on this revenue line.");
  }

  await db
    .update(normalizedRevenueLines)
    .set({
      status: args.newStatus,
      disputeResolvedAt: new Date(),
      // Preserve dispute_reason so the audit trail stays whole; append the
      // resolution note via the audit event below.
      updatedAt: new Date(),
    })
    .where(eq(normalizedRevenueLines.id, args.lineId));

  await recordAudit({
    userId: args.resolvedByUserId ?? undefined,
    entityType: "revenue_line",
    entityId: String(args.lineId),
    action: "dispute_resolved",
    changesJson: {
      previousStatus: "disputed",
      newStatus: args.newStatus,
      outcome: args.outcome,
      resolutionNote: args.resolutionNote.trim(),
    },
  });

  if (existing.projectId !== null) {
    void recomputeDerivedKpisForProject(existing.projectId);
  }
}

// ---------------------------------------------------------------------------
// Cost-line dispute
// ---------------------------------------------------------------------------

export async function openDisputeOnCostLine(args: OpenDisputeArgs): Promise<void> {
  if (!args.reason || args.reason.trim().length === 0) {
    throw badRequest("Dispute reason is required.");
  }
  const [existing] = await db
    .select()
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.id, args.lineId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("Cost line");
  if (existing.disputeOpenedAt && !existing.disputeResolvedAt) {
    throw badRequest("This cost line already has an open dispute.");
  }

  const previousStatus = existing.status;
  await db
    .update(normalizedCostLines)
    .set({
      status: "disputed",
      disputeOpenedAt: new Date(),
      disputeResolvedAt: null,
      disputeReason: args.reason.trim(),
      disputeOpenedByUserId: args.openedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(normalizedCostLines.id, args.lineId));

  await recordAudit({
    userId: args.openedByUserId ?? undefined,
    entityType: "cost_line",
    entityId: String(args.lineId),
    action: "dispute_opened",
    changesJson: {
      previousStatus,
      newStatus: "disputed",
      reason: args.reason.trim(),
    },
  });

  if (existing.projectId !== null) {
    void recomputeDerivedKpisForProject(existing.projectId);
  }
}

export interface ResolveCostDisputeArgs {
  lineId: number;
  outcome: "accepted" | "rejected" | "renegotiated";
  newStatus: "invoiced" | "approved" | "paid";
  resolutionNote: string;
  resolvedByUserId: number | null;
}

export async function resolveDisputeOnCostLine(args: ResolveCostDisputeArgs): Promise<void> {
  if (!args.resolutionNote || args.resolutionNote.trim().length === 0) {
    throw badRequest("Resolution note is required.");
  }
  const [existing] = await db
    .select()
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.id, args.lineId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("Cost line");
  if (!existing.disputeOpenedAt || existing.disputeResolvedAt) {
    throw badRequest("No open dispute on this cost line.");
  }

  await db
    .update(normalizedCostLines)
    .set({
      status: args.newStatus,
      disputeResolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(normalizedCostLines.id, args.lineId));

  await recordAudit({
    userId: args.resolvedByUserId ?? undefined,
    entityType: "cost_line",
    entityId: String(args.lineId),
    action: "dispute_resolved",
    changesJson: {
      previousStatus: "disputed",
      newStatus: args.newStatus,
      outcome: args.outcome,
      resolutionNote: args.resolutionNote.trim(),
    },
  });

  if (existing.projectId !== null) {
    void recomputeDerivedKpisForProject(existing.projectId);
  }
}

// ---------------------------------------------------------------------------
// Bad-debt write-off (TF-8) — revenue side only
// ---------------------------------------------------------------------------

export interface WriteOffArgs {
  lineId: number;
  reason: string;
  authorisedByUserId: number | null;
}

export async function writeOffRevenueLine(args: WriteOffArgs): Promise<void> {
  if (!args.reason || args.reason.trim().length === 0) {
    throw badRequest("Write-off reason is required.");
  }
  if (!args.authorisedByUserId) {
    throw badRequest("Authorising user is required.");
  }
  const [existing] = await db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.id, args.lineId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("Revenue line");
  if (existing.status === "written_off") {
    throw badRequest("This revenue line has already been written off.");
  }
  if (existing.status === "in_bank" || existing.status === "realised") {
    throw badRequest(
      "Cannot write off a revenue line that has already been received. Reverse the receipt first.",
    );
  }

  const previousStatus = existing.status;
  await db
    .update(normalizedRevenueLines)
    .set({
      status: "written_off",
      writeOffAuthorisedByUserId: args.authorisedByUserId,
      writeOffAuthorisedAt: new Date(),
      writeOffReason: args.reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(normalizedRevenueLines.id, args.lineId));

  await recordAudit({
    userId: args.authorisedByUserId,
    entityType: "revenue_line",
    entityId: String(args.lineId),
    action: "write_off_authorised",
    changesJson: {
      previousStatus,
      newStatus: "written_off",
      reason: args.reason.trim(),
    },
  });

  if (existing.projectId !== null) {
    void recomputeDerivedKpisForProject(existing.projectId);
  }
}
