import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { safeLegacyWrite } from "./legacy-table-guard";
import { operationalTasks, workItems } from "@shared/schema";

/**
 * Runtime boundary guardrails.
 * Canonical writes happen in work_items first; legacy mirrors are best-effort only.
 */
export async function mirrorWorkItemToOperationalTask(args: {
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
  let legacyTaskId: number | null = null;
  await safeLegacyWrite(async () => {
    const [task] = await db
      .insert(operationalTasks)
      .values({
        projectName: args.projectName,
        title: args.title,
        status: args.status,
        priority: args.priority,
        startDate: args.startDate || null,
        dueDate: args.dueDate || null,
        isMilestone: args.isMilestone || false,
        parentTaskId: null,
        percentComplete: 0,
        createdBy: args.createdBy ?? null,
        importedTaskId: args.workItemId,
      })
      .returning({ id: operationalTasks.id });
    legacyTaskId = task?.id ?? null;
  });
  return legacyTaskId;
}

export async function syncOperationalTaskFromWorkItemUpdate(args: {
  workItemId: number;
  updates: {
    title?: string;
    status?: string;
    priority?: string;
    startDate?: string | null;
    dueDate?: string | null;
    percentComplete?: number;
    comment?: string;
  };
}): Promise<void> {
  const legacyUpdates: Record<string, unknown> = {};
  if (args.updates.title != null) legacyUpdates.title = args.updates.title;
  if (args.updates.status != null) legacyUpdates.status = args.updates.status;
  if (args.updates.priority != null) legacyUpdates.priority = args.updates.priority;
  if (args.updates.startDate != null) legacyUpdates.startDate = args.updates.startDate;
  if (args.updates.dueDate != null) legacyUpdates.dueDate = args.updates.dueDate;
  if (args.updates.percentComplete != null) legacyUpdates.percentComplete = args.updates.percentComplete;
  if (args.updates.comment != null) legacyUpdates.comment = args.updates.comment;
  if (Object.keys(legacyUpdates).length === 0) return;

  await safeLegacyWrite(async () => {
    await db
      .update(operationalTasks)
      .set(legacyUpdates)
      .where(and(eq(operationalTasks.importedTaskId, args.workItemId), isNull(operationalTasks.deletedAt)));
  });
}

export async function softDeleteLegacyOperationalTaskByWorkItemId(workItemId: number): Promise<void> {
  await safeLegacyWrite(async () => {
    await db
      .update(operationalTasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(operationalTasks.importedTaskId, workItemId), isNull(operationalTasks.deletedAt)));
  });
}

export async function softDeleteCanonicalWorkItemByLegacyTaskId(legacyTaskId: number): Promise<void> {
  await db
    .update(workItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workItems.id, legacyTaskId),
        isNull(workItems.deletedAt),
      ),
    );

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
