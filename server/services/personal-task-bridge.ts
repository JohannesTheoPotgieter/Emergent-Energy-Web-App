/**
 * Personal Task Bridge Service
 *
 * Provides a unified API for personal tasks backed by the canonical work_items
 * table (workstream = 'PERSONAL'). This replaces direct mytool_tasks access.
 *
 * The bridge delegates to the work-management-repository which already reads
 * from work_items and maps to/from the legacy mytool task shape.
 *
 * Compatibility shim: getMytoolTasksLegacy() returns data in the old response
 * shape for temporary backward compatibility. Planned removal: after one release
 * window of verified parity with zero legacy-path usage in logs.
 *
 * Security: all operations are user-scoped via ownerUserId. Admin/manager
 * override is handled at the route layer (resolveMyToolUserId in routes.ts).
 */

import { db } from "../db";
import { workItems, workItemAssignments } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getWorkItemsAsMytoolTasks } from "../work-items-adapter";

/** Get personal tasks for a user from the canonical work_items table. */
export async function getPersonalTasks(userId: number) {
  const rows = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.workstream, "PERSONAL"),
        eq(workItems.ownerUserId, userId),
        isNull(workItems.deletedAt),
      ),
    )
    .orderBy(workItems.sortOrder);
  return rows;
}

/** Create a personal task in the canonical work_items table. */
export async function createPersonalTask(userId: number, task: {
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  startDate?: string | null;
  endDate?: string | null;
  scheduledDate?: string | null;
  projectId?: number | null;
  bucket?: string;
  sortOrder?: number;
  definitionOfDone?: string | null;
  pinnedToday?: boolean;
  pinnedWeek?: boolean;
}) {
  const [created] = await db
    .insert(workItems)
    .values({
      workstream: "PERSONAL",
      source: "UI",
      ownerUserId: userId,
      createdBy: userId,
      title: task.title,
      description: task.description ?? null,
      status: task.status || "Not Started",
      priority: task.priority || "Med",
      startDate: task.startDate ?? null,
      endDate: task.endDate ?? null,
      scheduledDate: task.scheduledDate ?? null,
      projectId: task.projectId ?? null,
      bucket: task.bucket || "personal",
      sortOrder: task.sortOrder ?? 0,
      definitionOfDone: task.definitionOfDone ?? null,
      pinnedToday: task.pinnedToday ?? false,
      pinnedWeek: task.pinnedWeek ?? false,
    })
    .returning();

  // Create OWNER assignment
  await db.insert(workItemAssignments).values({
    workItemId: created.id,
    userId,
    role: "OWNER",
  }).onConflictDoNothing();

  return created;
}

/** Update a personal task. Caller must verify ownership before calling. */
export async function updatePersonalTask(userId: number, taskId: number, patch: Record<string, unknown>) {
  const [updated] = await db
    .update(workItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(workItems.id, taskId),
        eq(workItems.ownerUserId, userId),
        eq(workItems.workstream, "PERSONAL"),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Temporary backward-compatibility shim.
 * Returns canonical workItems data mapped into the legacy mytoolTask response shape.
 *
 * Planned removal: after one release window once logs confirm zero legacy-path usage.
 */
export async function getMytoolTasksLegacy(userId: number) {
  return getWorkItemsAsMytoolTasks(userId);
}
