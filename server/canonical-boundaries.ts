import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { workItems } from "@shared/schema";

/**
 * Canonical work-item soft-delete helpers.
 *
 * With work_items as the single source of truth, all writes go directly
 * to work_items. Bidirectional sync functions have been removed.
 */

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
