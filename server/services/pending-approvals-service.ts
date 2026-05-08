import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  pendingApprovals,
  pendingApprovalHistory,
  PENDING_APPROVAL_KINDS,
  type PendingApproval,
  type PendingApprovalKind,
  type PendingApprovalStatus,
} from "@shared/schema";
import { recordAudit } from "../api/v2/services/audit-service";

export type ProposeApprovalInput = {
  kind: PendingApprovalKind;
  targetTable: string;
  summary: string;
  payload: Record<string, unknown>;
  sourceLabel: string;
  sourceRef?: string | null;
};

export type ProposeApprovalResult = {
  id: number;
  status: "created" | "duplicate";
};

/**
 * Stage a row for human approval instead of inserting it directly. The
 * caller passes the full target-table payload; on approval the registered
 * `kind` handler replays exactly that payload into the destination table.
 *
 * Idempotency: if a `sourceRef` is provided and another pending row already
 * exists for the same (kind, sourceRef), we return the existing id with
 * `status: 'duplicate'` instead of creating a second proposal. This is
 * enforced by a partial unique index in migration 0028.
 */
export async function proposeApproval(input: ProposeApprovalInput): Promise<ProposeApprovalResult> {
  if (!PENDING_APPROVAL_KINDS.includes(input.kind)) {
    throw new Error(`proposeApproval: unknown kind '${input.kind}'`);
  }

  if (input.sourceRef) {
    const existing = await db
      .select({ id: pendingApprovals.id })
      .from(pendingApprovals)
      .where(and(
        eq(pendingApprovals.kind, input.kind),
        eq(pendingApprovals.sourceRef, input.sourceRef),
        eq(pendingApprovals.status, "pending"),
      ))
      .limit(1);
    if (existing.length > 0) {
      return { id: existing[0].id, status: "duplicate" };
    }
  }

  const [row] = await db
    .insert(pendingApprovals)
    .values({
      kind: input.kind,
      targetTable: input.targetTable,
      summary: input.summary,
      payload: input.payload as any,
      sourceLabel: input.sourceLabel,
      sourceRef: input.sourceRef ?? null,
    })
    .returning({ id: pendingApprovals.id });

  return { id: row.id, status: "created" };
}

/**
 * Per-kind apply handler. Receives the original payload and must return
 * a string id of the created/affected record (used for the audit trail).
 * Throwing here marks the approval as `failed` with the error message.
 */
export type ApplyHandler = (payload: Record<string, unknown>, ctx: { decidedByUserId: number }) => Promise<string>;

const HANDLERS = new Map<PendingApprovalKind, ApplyHandler>();

export function registerApprovalHandler(kind: PendingApprovalKind, handler: ApplyHandler) {
  HANDLERS.set(kind, handler);
}

export function getRegisteredHandlerKinds(): PendingApprovalKind[] {
  return Array.from(HANDLERS.keys());
}

export async function approvePending(id: number, decidedByUserId: number): Promise<PendingApproval> {
  const [row] = await db
    .select()
    .from(pendingApprovals)
    .where(eq(pendingApprovals.id, id))
    .limit(1);
  if (!row) throw new Error(`pending approval #${id} not found`);
  if (row.status !== "pending") throw new Error(`pending approval #${id} already ${row.status}`);

  const handler = HANDLERS.get(row.kind as PendingApprovalKind);
  if (!handler) {
    return db.transaction(async (tx: typeof db) => {
      const [updated] = await tx
        .update(pendingApprovals)
        .set({
          status: "failed",
          applyError: `No handler registered for kind '${row.kind}'`,
          decidedAt: new Date(),
          decidedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(pendingApprovals.id, id))
        .returning();
      // Plan v3 § 2.3 / D.5 (β): canonical transition history.
      await tx.insert(pendingApprovalHistory).values({
        pendingApprovalId: id,
        fromStatus: row.status,
        toStatus: "failed",
        changedByUserId: decidedByUserId,
        reason: `No handler registered for kind '${row.kind}'`,
        detailsJson: { kind: row.kind },
      });
      return updated;
    });
  }

  // The handler runs OUTSIDE the transaction so external side effects
  // (e.g., SharePoint writes, Pipedrive calls) aren't held in a long
  // open transaction. The status flip + history insert are then wrapped
  // together in a single short transaction.
  let appliedRecordId: string;
  try {
    appliedRecordId = await handler(row.payload as Record<string, unknown>, { decidedByUserId });
  } catch (err: any) {
    return db.transaction(async (tx: typeof db) => {
      const errorMessage = err?.message ?? String(err);
      const [failed] = await tx
        .update(pendingApprovals)
        .set({
          status: "failed",
          applyError: errorMessage,
          decidedAt: new Date(),
          decidedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(pendingApprovals.id, id))
        .returning();
      await tx.insert(pendingApprovalHistory).values({
        pendingApprovalId: id,
        fromStatus: row.status,
        toStatus: "failed",
        changedByUserId: decidedByUserId,
        reason: errorMessage,
        detailsJson: { kind: row.kind, errorSource: "handler_threw" },
      });
      return failed;
    });
  }

  return db.transaction(async (tx: typeof db) => {
    const [approved] = await tx
      .update(pendingApprovals)
      .set({
        status: "approved",
        appliedRecordId,
        decidedAt: new Date(),
        decidedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(pendingApprovals.id, id))
      .returning();
    await tx.insert(pendingApprovalHistory).values({
      pendingApprovalId: id,
      fromStatus: row.status,
      toStatus: "approved",
      changedByUserId: decidedByUserId,
      detailsJson: { kind: row.kind, appliedRecordId },
    });
    await recordAudit({
      userId: decidedByUserId,
      entityType: "pending_approval",
      entityId: String(id),
      action: "APPROVE_PENDING",
      changesJson: { kind: row.kind, fromStatus: row.status, toStatus: "approved", appliedRecordId },
    });
    return approved;
  });
}

export async function rejectPending(id: number, decidedByUserId: number, reason: string | null): Promise<PendingApproval> {
  const [row] = await db
    .select()
    .from(pendingApprovals)
    .where(eq(pendingApprovals.id, id))
    .limit(1);
  if (!row) throw new Error(`pending approval #${id} not found`);
  if (row.status !== "pending") throw new Error(`pending approval #${id} already ${row.status}`);

  return db.transaction(async (tx: typeof db) => {
    const [rejected] = await tx
      .update(pendingApprovals)
      .set({
        status: "rejected",
        rejectionReason: reason,
        decidedAt: new Date(),
        decidedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(pendingApprovals.id, id))
      .returning();
    // Plan v3 § 2.3 / D.5 (β): canonical transition history.
    await tx.insert(pendingApprovalHistory).values({
      pendingApprovalId: id,
      fromStatus: row.status,
      toStatus: "rejected",
      changedByUserId: decidedByUserId,
      reason,
      detailsJson: { kind: row.kind },
    });
    await recordAudit({
      userId: decidedByUserId,
      entityType: "pending_approval",
      entityId: String(id),
      action: "REJECT_PENDING",
      changesJson: { kind: row.kind, fromStatus: row.status, toStatus: "rejected", reason },
    });
    return rejected;
  });
}

export async function listPendingApprovals(opts: {
  status?: PendingApprovalStatus;
  kind?: PendingApprovalKind;
  limit?: number;
} = {}) {
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 200, 500);
  const where = opts.kind
    ? and(eq(pendingApprovals.status, status), eq(pendingApprovals.kind, opts.kind))
    : eq(pendingApprovals.status, status);
  return db
    .select()
    .from(pendingApprovals)
    .where(where)
    .orderBy(desc(pendingApprovals.createdAt))
    .limit(limit);
}

export async function summarizePendingApprovals() {
  const rows = await db
    .select({
      kind: pendingApprovals.kind,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(pendingApprovals)
    .where(eq(pendingApprovals.status, "pending"))
    .groupBy(pendingApprovals.kind);
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byKind[r.kind] = r.n;
    total += r.n;
  }
  return { total, byKind };
}
