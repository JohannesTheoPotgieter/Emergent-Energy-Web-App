/**
 * Priority activity-log helper.
 *
 * Records observable events on `mytool_company_priorities` rows to
 * `priority_activity`. The `recordActivity` function is fire-and-forget
 * from the caller's perspective — failures are logged but never thrown,
 * because a missing audit row must not cascade into a failed mutation.
 */
import { db } from "../db";
import { priorityActivity, users } from "@shared/schema";
import { eq } from "drizzle-orm";

export type PriorityActivityAction =
  | "created"
  | "updated"
  | "closed"
  | "reopened"
  | "marked_complete"
  | "escalated"
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "broken_down"
  | "project_linked"
  | "project_unlinked"
  | "status_changed"
  | "severity_changed"
  | "manual_health_changed"
  | "manual_progress_changed"
  | "due_date_changed"
  | "owner_changed"
  | "accountable_exec_changed";

export interface RecordActivityInput {
  priorityId: number;
  actorUserId: number | null | undefined;
  action: PriorityActivityAction;
  fromValue?: string | number | null;
  toValue?: string | number | null;
  details?: Record<string, unknown>;
}

async function resolveActorName(actorUserId: number | null | undefined): Promise<string | null> {
  if (!actorUserId) return null;
  try {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorUserId)).limit(1);
    return u?.name ?? null;
  } catch {
    return null;
  }
}

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    const actorName = await resolveActorName(input.actorUserId);
    await db.insert(priorityActivity).values({
      priorityId: input.priorityId,
      actorUserId: input.actorUserId ?? null,
      actorName,
      action: input.action,
      fromValue: input.fromValue != null ? String(input.fromValue) : null,
      toValue: input.toValue != null ? String(input.toValue) : null,
      details: input.details ?? null,
    });
  } catch (err: any) {
    // Never let audit failure break the parent mutation.
    console.warn("[PriorityActivity] recordActivity failed:", err?.message || err);
  }
}

/**
 * Computes the set of field-change activities for an UPDATE. Pure so it can
 * be unit-tested without the DB. Compares `before` and `after` snapshots of
 * the fields we care about and yields one activity per changed field.
 */
export interface PriorityUpdateDiffInput {
  before: {
    status?: string | null;
    severity?: string | null;
    manualHealth?: string | null;
    manualProgress?: number | null;
    dueDate?: string | null;
    assignedUserId?: number | null;
    ownerUserId?: number | null;
    accountableExecId?: number | null;
  };
  after: {
    status?: string | null;
    severity?: string | null;
    manualHealth?: string | null;
    manualProgress?: number | null;
    dueDate?: string | null;
    assignedUserId?: number | null;
    ownerUserId?: number | null;
    accountableExecId?: number | null;
  };
}

export interface PriorityUpdateDiffEvent {
  action: PriorityActivityAction;
  fromValue: string | null;
  toValue: string | null;
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

export function computeUpdateActivities(input: PriorityUpdateDiffInput): PriorityUpdateDiffEvent[] {
  const events: PriorityUpdateDiffEvent[] = [];
  const { before, after } = input;

  // Status is special — translate to friendlier events where possible.
  if (after.status !== undefined && after.status !== before.status) {
    if (after.status === "closed") {
      events.push({ action: "closed", fromValue: stringify(before.status), toValue: "closed" });
    } else if (after.status === "complete") {
      events.push({ action: "marked_complete", fromValue: stringify(before.status), toValue: "complete" });
    } else if (before.status === "closed" || before.status === "complete") {
      events.push({ action: "reopened", fromValue: stringify(before.status), toValue: stringify(after.status) });
    } else {
      events.push({ action: "status_changed", fromValue: stringify(before.status), toValue: stringify(after.status) });
    }
  }

  if (after.severity !== undefined && after.severity !== before.severity) {
    events.push({ action: "severity_changed", fromValue: stringify(before.severity), toValue: stringify(after.severity) });
  }

  if (after.manualHealth !== undefined && after.manualHealth !== before.manualHealth) {
    events.push({ action: "manual_health_changed", fromValue: stringify(before.manualHealth), toValue: stringify(after.manualHealth) });
  }

  if (after.manualProgress !== undefined && after.manualProgress !== before.manualProgress) {
    events.push({ action: "manual_progress_changed", fromValue: stringify(before.manualProgress), toValue: stringify(after.manualProgress) });
  }

  if (after.dueDate !== undefined && after.dueDate !== before.dueDate) {
    events.push({ action: "due_date_changed", fromValue: stringify(before.dueDate), toValue: stringify(after.dueDate) });
  }

  if (after.assignedUserId !== undefined && after.assignedUserId !== before.assignedUserId) {
    if (before.assignedUserId == null && after.assignedUserId != null) {
      events.push({ action: "assigned", fromValue: null, toValue: String(after.assignedUserId) });
    } else if (before.assignedUserId != null && after.assignedUserId == null) {
      events.push({ action: "unassigned", fromValue: String(before.assignedUserId), toValue: null });
    } else {
      events.push({ action: "reassigned", fromValue: stringify(before.assignedUserId), toValue: stringify(after.assignedUserId) });
    }
  }

  if (after.ownerUserId !== undefined && after.ownerUserId !== before.ownerUserId) {
    events.push({ action: "owner_changed", fromValue: stringify(before.ownerUserId), toValue: stringify(after.ownerUserId) });
  }

  if (after.accountableExecId !== undefined && after.accountableExecId !== before.accountableExecId) {
    events.push({ action: "accountable_exec_changed", fromValue: stringify(before.accountableExecId), toValue: stringify(after.accountableExecId) });
  }

  return events;
}
