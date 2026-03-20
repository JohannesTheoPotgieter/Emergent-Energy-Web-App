import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { workItems } from "@shared/schema";

/**
 * Canonical boundary guardrails — Prompt 8 revision.
 *
 * With work_items as the single source of truth, the bidirectional sync
 * functions (mirrorWorkItemToOperationalTask, syncOperationalTaskFromWorkItemUpdate)
 * are no longer needed. All writes go directly to work_items.
 *
 * Kept:
 *   - softDeleteCanonicalWorkItem: canonical delete by work_item ID
 *   - softDeleteCanonicalWorkItemByLegacyTaskId: delete by legacy reference
 *
 * Removed:
 *   - mirrorWorkItemToOperationalTask (was: create OT mirror from WI)
 *   - syncOperationalTaskFromWorkItemUpdate (was: sync WI fields → OT)
 *   - softDeleteLegacyOperationalTaskByWorkItemId (was: soft-delete OT mirror)
 */

export async function softDeleteCanonicalWorkItem(workItemId: number): Promise<void> {
  await db
    .update(workItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workItems.id, workItemId),
        isNull(workItems.deletedAt),
      ),
    );
}

export async function softDeleteCanonicalWorkItemByLegacyTaskId(legacyTaskId: number): Promise<void> {
  // Try by direct ID first
  await db
    .update(workItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workItems.id, legacyTaskId),
        isNull(workItems.deletedAt),
      ),
    );

  // Also try by legacy reference
  await db
    .update(workItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workItems.legacyTable, "operational_tasks"),
        eq(workItems.legacyId, legacyTaskId),
        isNull(workItems.deletedAt),
      ),
    );
}

// ── Deprecated stubs (no-ops kept for call-site compat) ──

/** @deprecated Legacy operational_tasks table removed. Returns null. */
export async function mirrorWorkItemToOperationalTask(_args: {
  workItemId: number;
  projectName: string;
  title: string;
  status: string;
  priority: string;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  createdBy?: number | null;
}): Promise<number | null> {
  return null;
}

/** @deprecated Legacy operational_tasks table removed. No-op. */
export async function syncOperationalTaskFromWorkItemUpdate(_args: {
  workItemId: number;
  updates: Record<string, unknown>;
}): Promise<void> {
  // no-op
}

/** @deprecated Legacy operational_tasks table removed. No-op. */
export async function softDeleteLegacyOperationalTaskByWorkItemId(_workItemId: number): Promise<void> {
  // no-op
}
