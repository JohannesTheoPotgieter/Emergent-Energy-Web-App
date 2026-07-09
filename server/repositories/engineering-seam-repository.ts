/**
 * Engineering seam handoffs — role-routed, validated, transactional (Batch 2).
 *
 * Split out of `engineering-tasks-repository.ts` (EE-QA-015 file-size ratchet):
 * seam routing is a self-contained concern. A seam handoff is a tracked ENG
 * `work_items` row owned by the role-routed recipient (SSEG Manager /
 * Construction Manager), with a status-history row, an OWNER assignment, a
 * dependency back-link to the originating task, and an audit event. Reuses
 * canonical tables — no parallel handoff entity.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  workItems,
  workItemAssignments,
  workItemStatusHistory,
  workItemDependencies,
  normalizeRoleForPermissions,
} from "@shared/schema";
import {
  SEAM_RECIPIENT_ROLE,
  SEAM_RECIPIENT_ROLE_LABEL,
  type EngineeringSeamTaskTypeTag,
} from "@shared/engineering/delivery-task-catalog";
import { buildSeamHandoffInsert, buildStatusHistoryInsert } from "../lib/engineering/task-builders";
import { runInTransaction } from "../lib/drizzle-helpers";
import { recordAudit } from "../api/v2/services/audit-service";
import { UsersRepository } from "./users-repository";
import { ApiError, notFound, badRequest, logApiError } from "../lib/api-error";

type WorkItemRow = typeof workItems.$inferSelect;

const seamUsersRepo = new UsersRepository();

/**
 * Resolve the user who owns a seam handoff FROM ITS ROLE. Every seam type maps
 * to a company role (`SEAM_RECIPIENT_ROLE`): `compliance_input` → SSEG_MANAGER,
 * `construction_snag` → CONSTRUCTION_MANAGER. If the caller passes an explicit
 * `toOwnerUserId` it is validated as an override — the user must be active and
 * hold the seam's role, else a coded `ApiError` is thrown so a raw id can never
 * misroute a handoff. When omitted, the active role-holder is resolved (lowest
 * id when several exist, so the choice is deterministic).
 */
async function resolveSeamRecipient(
  seamType: EngineeringSeamTaskTypeTag,
  explicitOwnerId: number | null | undefined,
): Promise<number> {
  const expectedRole = SEAM_RECIPIENT_ROLE[seamType];
  const roleLabel = SEAM_RECIPIENT_ROLE_LABEL[seamType];

  if (explicitOwnerId != null) {
    const user = await seamUsersRepo.getById(explicitOwnerId);
    if (!user || !user.isActive || user.deletedAt != null) throw notFound("Recipient");
    if (normalizeRoleForPermissions(user.role) !== expectedRole) {
      throw new ApiError(
        400,
        "SEAM_RECIPIENT_ROLE_MISMATCH",
        `A ${seamType} handoff must go to the ${roleLabel}, not this recipient.`,
      );
    }
    return user.id;
  }

  const candidates = await seamUsersRepo.listActiveByRole(expectedRole);
  if (candidates.length === 0) {
    throw new ApiError(
      422,
      "SEAM_RECIPIENT_UNRESOLVED",
      `No active ${roleLabel} is available to receive this handoff. Assign the ${roleLabel} role to a user first.`,
    );
  }
  return candidates[0].id;
}

/**
 * Create a tracked seam handoff. The recipient is resolved from the seam's role
 * (`resolveSeamRecipient`). The four spine writes (task + OWNER assignment +
 * status history + dependency) run inside ONE transaction, so a mid-write
 * failure leaves no orphan task; the audit is a post-commit side effect,
 * error-isolated so a failed audit can't roll back an already-created handoff.
 */
export async function createSeamHandoff(
  input: {
    seamType: EngineeringSeamTaskTypeTag;
    toOwnerUserId?: number | null;
    title: string;
    note?: string | null;
    projectId?: number | null;
    dueDate?: string | null;
    fromTaskId?: number | null;
  },
  actorId: number,
): Promise<WorkItemRow> {
  const recipientId = await resolveSeamRecipient(input.seamType, input.toOwnerUserId);

  // Validate the originating task exists and sits on the seam's project (the
  // route enforces the caller's ownership of it — this is the business-scope
  // check). Fetched directly to keep this module free of a cross-repo cycle.
  if (input.fromTaskId != null) {
    const [from] = await db
      .select({ projectId: workItems.projectId })
      .from(workItems)
      .where(and(eq(workItems.id, input.fromTaskId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
      .limit(1);
    if (!from) throw notFound("Source task");
    if (input.projectId != null && from.projectId !== input.projectId) {
      throw badRequest("The source task must be on the same project as the handoff.");
    }
  }

  const insert = buildSeamHandoffInsert(
    {
      seamType: input.seamType,
      toOwnerUserId: recipientId,
      title: input.title,
      note: input.note ?? null,
      projectId: input.projectId ?? null,
      dueDate: input.dueDate ?? null,
    },
    actorId,
  );

  const row = await runInTransaction(async (tx) => {
    const [created] = await tx.insert(workItems).values(insert).returning();
    await tx
      .insert(workItemAssignments)
      .values({ workItemId: created.id, userId: recipientId, role: "OWNER" })
      .onConflictDoNothing();
    await tx
      .insert(workItemStatusHistory)
      .values(buildStatusHistoryInsert(created.id, null, created.status, actorId, "seam handoff created"));
    if (input.fromTaskId != null) {
      await tx.insert(workItemDependencies).values({
        predecessorId: input.fromTaskId,
        successorId: created.id,
        depType: "FS",
        source: "MANUAL",
      });
    }
    return created;
  });

  // Post-commit side effect — a failed audit must NOT roll back the committed
  // handoff.
  try {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(row.id),
      action: "engineering.seam.create",
      changesJson: { seamType: input.seamType, fromTaskId: input.fromTaskId ?? null, toOwnerUserId: recipientId },
    });
  } catch (err) {
    logApiError("engineering.seam.audit", err);
  }
  return row;
}
