/**
 * Manual Edit Flag — shared helper for recording inline edits
 * that may conflict with smart-import data.
 *
 * Extracted from server/routes.ts to allow shared usage across
 * route modules without circular dependencies.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { manualEditFlags } from "@shared/schema";

/** Record a manual edit flag for conflict detection during smart import */
export async function recordManualEditFlag(opts: {
  entityType: string;
  entityId: number;
  fieldName: string;
  editedByUserId?: number;
  editedByName?: string;
}) {
  try {
    // Upsert: update editedAt if flag already exists, otherwise create
    const existing = await db
      .select({ id: manualEditFlags.id })
      .from(manualEditFlags)
      .where(and(
        eq(manualEditFlags.entityType, opts.entityType),
        eq(manualEditFlags.entityId, opts.entityId),
        eq(manualEditFlags.fieldName, opts.fieldName),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(manualEditFlags)
        .set({ editedAt: new Date(), editedByUserId: opts.editedByUserId || null, editedByName: opts.editedByName || null })
        .where(eq(manualEditFlags.id, existing[0].id));
    } else {
      await db.insert(manualEditFlags).values({
        entityType: opts.entityType,
        entityId: opts.entityId,
        fieldName: opts.fieldName,
        editedByUserId: opts.editedByUserId || null,
        editedByName: opts.editedByName || null,
      });
    }
  } catch (err) {
    console.warn("[manual-edit-flag] Failed to record:", err instanceof Error ? err.message : String(err));
  }
}
