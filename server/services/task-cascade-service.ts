/**
 * Task Cascade Service
 *
 * Handles cascading behavior between parent and child tasks:
 * 1. Date rollup: child date changes → parent start/end updated (min start, max end)
 * 2. Status cascading: all children complete → parent auto-completes;
 *    parent HOLD/CANCELLED → children cascade
 * 3. Percent complete rollup: parent pct = average of children's pct
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { workItems } from "@shared/schema";

// ── Types ───────────────────────────────────────────────────────────

interface CascadeResult {
  parentUpdated: boolean;
  childrenUpdated: number;
  changes: Record<string, unknown>;
}

// ── Completed statuses ──────────────────────────────────────────────

const COMPLETED_STATUSES = new Set([
  "Complete", "COMPLETE", "complete", "done", "Done", "DONE",
  "Closed", "CLOSED", "closed",
]);

const CANCELLED_STATUSES = new Set([
  "Cancelled", "CANCELLED", "cancelled",
]);

const HOLD_STATUSES = new Set([
  "HOLD", "Hold", "hold", "On Hold", "ON_HOLD",
]);

const TERMINAL_STATUSES = new Set([
  ...COMPLETED_STATUSES, ...CANCELLED_STATUSES,
]);

// ── Date Rollup (child → parent) ───────────────────────────────────

/**
 * After a child task's dates change, recalculate the parent's
 * start_date (min of children) and end_date (max of children).
 */
export async function cascadeDatesToParent(childTaskId: number): Promise<CascadeResult> {
  const result: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };

  const [child] = await db.select({
    parentId: workItems.parentId,
  }).from(workItems).where(eq(workItems.id, childTaskId));

  if (!child?.parentId) return result;

  return rollupParentDates(child.parentId);
}

/**
 * Recalculate a parent task's dates from its children.
 */
export async function rollupParentDates(parentId: number): Promise<CascadeResult> {
  const result: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };

  const children = await db.select({
    startDate: workItems.startDate,
    endDate: workItems.endDate,
    percentComplete: workItems.percentComplete,
    duration: workItems.duration,
  }).from(workItems).where(
    and(eq(workItems.parentId, parentId), isNull(workItems.deletedAt))
  );

  if (children.length === 0) return result;

  let minStart: Date | null = null;
  let maxEnd: Date | null = null;
  let totalPct = 0;
  let totalWeight = 0;

  for (const c of children) {
    if (c.startDate) {
      const d = new Date(c.startDate);
      if (!minStart || d < minStart) minStart = d;
    }
    if (c.endDate) {
      const d = new Date(c.endDate);
      if (!maxEnd || d > maxEnd) maxEnd = d;
    }
    // Weight by duration (default 1 if no duration)
    const weight = c.duration && c.duration > 0 ? c.duration : 1;
    totalPct += (c.percentComplete ?? 0) * weight;
    totalWeight += weight;
  }

  const avgPct = totalWeight > 0 ? Math.round(totalPct / totalWeight) : 0;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (minStart) {
    updates.startDate = minStart;
    result.changes.startDate = minStart.toISOString();
  }
  if (maxEnd) {
    updates.endDate = maxEnd;
    result.changes.endDate = maxEnd.toISOString();
  }
  updates.percentComplete = avgPct;
  result.changes.percentComplete = avgPct;

  await db.update(workItems).set(updates).where(eq(workItems.id, parentId));
  result.parentUpdated = true;

  // Recurse up: if this parent also has a parent, roll up further
  const [parent] = await db.select({ parentId: workItems.parentId }).from(workItems).where(eq(workItems.id, parentId));
  if (parent?.parentId) {
    await rollupParentDates(parent.parentId);
  }

  return result;
}

// ── Status Cascading ────────────────────────────────────────────────

/**
 * After a child task's status changes, check if all siblings are complete
 * and auto-update the parent status accordingly.
 */
export async function cascadeStatusToParent(childTaskId: number): Promise<CascadeResult> {
  const result: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };

  const [child] = await db.select({
    parentId: workItems.parentId,
  }).from(workItems).where(eq(workItems.id, childTaskId));

  if (!child?.parentId) return result;

  const siblings = await db.select({
    id: workItems.id,
    status: workItems.status,
  }).from(workItems).where(
    and(eq(workItems.parentId, child.parentId), isNull(workItems.deletedAt))
  );

  if (siblings.length === 0) return result;

  const allComplete = siblings.every((s: { id: number; status: string | null }) => TERMINAL_STATUSES.has(s.status || ""));

  if (allComplete) {
    const [parent] = await db.select({ status: workItems.status }).from(workItems).where(eq(workItems.id, child.parentId));
    if (parent && !TERMINAL_STATUSES.has(parent.status || "")) {
      await db.update(workItems).set({
        status: "Complete",
        percentComplete: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(workItems.id, child.parentId));
      result.parentUpdated = true;
      result.changes.status = "Complete";
      result.changes.percentComplete = 100;
    }
  }

  return result;
}

/**
 * When a parent's status is set to HOLD or CANCELLED, cascade to all active children.
 */
export async function cascadeStatusToChildren(parentId: number, newStatus: string): Promise<CascadeResult> {
  const result: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };

  const shouldCascade = HOLD_STATUSES.has(newStatus) || CANCELLED_STATUSES.has(newStatus);
  if (!shouldCascade) return result;

  const children = await db.select({
    id: workItems.id,
    status: workItems.status,
  }).from(workItems).where(
    and(eq(workItems.parentId, parentId), isNull(workItems.deletedAt))
  );

  const childrenToUpdate = children.filter((c: { id: number; status: string | null }) => !TERMINAL_STATUSES.has(c.status || "") && c.status !== newStatus);

  if (childrenToUpdate.length === 0) return result;

  const ids = childrenToUpdate.map((c: { id: number; status: string | null }) => c.id);
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (HOLD_STATUSES.has(newStatus)) {
    updates.holdReason = "Parent task placed on hold";
  }

  await db.update(workItems).set(updates).where(
    sql`${workItems.id} IN (${sql.join(ids.map((id: number) => sql`${id}`), sql`, `)})`
  );

  result.childrenUpdated = ids.length;
  result.changes.status = newStatus;
  result.changes.affectedChildIds = ids;

  // Recursively cascade to grandchildren
  for (const childId of ids) {
    await cascadeStatusToChildren(childId, newStatus);
  }

  return result;
}

/**
 * Validate that a parent can be marked complete (all children must be done).
 * Returns an error message if invalid, null if ok.
 */
export async function validateParentCompletion(parentId: number): Promise<string | null> {
  const children = await db.select({
    id: workItems.id,
    title: workItems.title,
    status: workItems.status,
  }).from(workItems).where(
    and(eq(workItems.parentId, parentId), isNull(workItems.deletedAt))
  );

  if (children.length === 0) return null; // No children, can complete freely

  const incomplete = children.filter((c: { id: number; title: string | null; status: string | null }) => !TERMINAL_STATUSES.has(c.status || ""));

  if (incomplete.length > 0) {
    const names = incomplete.slice(0, 3).map((c: { id: number; title: string | null; status: string | null }) => `"${c.title}"`).join(", ");
    const more = incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : "";
    return `Cannot complete: ${incomplete.length} subtask${incomplete.length > 1 ? "s" : ""} still open (${names}${more})`;
  }

  return null;
}

// ── Combined cascade (call after any task update) ───────────────────

/**
 * Run all applicable cascades after a task is updated.
 * Call this after status or date changes.
 */
export async function runCascadesAfterUpdate(
  taskId: number,
  updates: { status?: string; startDate?: string | Date | null; endDate?: string | Date | null; dueDate?: string | Date | null }
): Promise<{ dateResult: CascadeResult; statusResult: CascadeResult; childStatusResult: CascadeResult }> {
  const dateResult: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };
  const statusResult: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };
  const childStatusResult: CascadeResult = { parentUpdated: false, childrenUpdated: 0, changes: {} };

  // Date rollup to parent
  if (updates.startDate !== undefined || updates.endDate !== undefined || updates.dueDate !== undefined) {
    Object.assign(dateResult, await cascadeDatesToParent(taskId));
  }

  // Status cascade
  if (updates.status) {
    // If setting to complete, first check children
    if (COMPLETED_STATUSES.has(updates.status)) {
      // Status rollup: child complete → check if parent can auto-complete
      Object.assign(statusResult, await cascadeStatusToParent(taskId));
    }

    // If parent set to HOLD/CANCEL, cascade down to children
    if (HOLD_STATUSES.has(updates.status) || CANCELLED_STATUSES.has(updates.status)) {
      Object.assign(childStatusResult, await cascadeStatusToChildren(taskId, updates.status));
    }
  }

  return { dateResult, statusResult, childStatusResult };
}
