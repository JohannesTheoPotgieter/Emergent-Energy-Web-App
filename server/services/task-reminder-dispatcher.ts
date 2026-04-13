/**
 * C3 — Work-item due-date reminder dispatcher.
 *
 * Scans the work_items table for rows that are about to come due (or
 * already overdue) and dispatches one notification per (work_item,
 * milestone) pair. The dedup table task_reminder_state ensures we
 * only fire each milestone once per work item.
 *
 * Three milestones:
 *   - due_in_24h : end_date in [now, now + 24h]
 *   - due_today  : end_date == today (SAST)
 *   - overdue    : end_date < today, status != complete
 *
 * Status keys are intentionally permissive — the C6 normalization
 * pass will tighten the closed-status set later. For now we treat any
 * status containing "complete" or "done" (case-insensitive) as closed.
 *
 * The dispatcher is called by a scheduler (started in
 * start-runtime-services) on an hourly cadence — small enough to
 * catch the 24h milestone reliably, large enough not to thrash.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  taskReminderState,
  workItems,
  type TaskReminderKind,
  type WorkItem,
} from "@shared/schema";
import { db } from "../db";
import { dispatchAlert } from "./alert-dispatcher-service";

export const TASK_REMINDER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const CLOSED_STATUS_HINTS = ["complete", "done", "closed", "cancelled"];

/**
 * Pure helper — exposed for unit tests.
 * Returns true if the given status string represents a closed/done
 * work item that should NOT receive reminders.
 */
export function isClosedTaskStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return CLOSED_STATUS_HINTS.some((h) => s.includes(h));
}

/**
 * Pure helper — classify a work item's due date relative to "now"
 * into the appropriate reminder kind, or null if no reminder applies.
 *
 * We deliberately return only ONE kind per call — the milestone the
 * caller should fire if the dedup table allows it. Higher-priority
 * milestones win:
 *   overdue > due_today > due_in_24h
 */
export function classifyDueDate(params: {
  endDate: Date | null;
  now: Date;
}): TaskReminderKind | null {
  const { endDate, now } = params;
  if (!endDate) return null;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const due = new Date(endDate);
  due.setHours(0, 0, 0, 0);

  if (due.getTime() < todayStart.getTime()) return "overdue";
  if (due.getTime() === todayStart.getTime()) return "due_today";

  // due in the next 24h means the work item is due tomorrow at most.
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  if (due.getTime() === tomorrowStart.getTime()) return "due_in_24h";

  return null;
}

function buildTaskReminderCopy(
  kind: TaskReminderKind,
  item: WorkItem,
): { eventType: string; title: string; body: string } {
  switch (kind) {
    case "due_in_24h":
      return {
        eventType: "task_due_in_24h",
        title: `Task due tomorrow: ${item.title}`,
        body: `"${item.title}" is due ${item.endDate}. Update progress or push the date if you need more time.`,
      };
    case "due_today":
      return {
        eventType: "task_due_today",
        title: `Task due today: ${item.title}`,
        body: `"${item.title}" is due today. Mark complete or update status.`,
      };
    case "overdue":
      return {
        eventType: "task_overdue",
        title: `Task overdue: ${item.title}`,
        body: `"${item.title}" was due ${item.endDate} and is still open. Update status or push the date.`,
      };
  }
}

async function alreadyReminded(
  workItemId: number,
  kind: TaskReminderKind,
): Promise<boolean> {
  const [row] = await db
    .select({ id: taskReminderState.id })
    .from(taskReminderState)
    .where(
      and(
        eq(taskReminderState.workItemId, workItemId),
        eq(taskReminderState.reminderKind, kind),
      ),
    )
    .limit(1);
  return !!row;
}

async function recordReminderSent(
  workItemId: number,
  kind: TaskReminderKind,
  recipientUserId: number,
): Promise<void> {
  // Upsert by composite unique index (work_item_id, reminder_kind).
  await db
    .insert(taskReminderState)
    .values({
      workItemId,
      reminderKind: kind,
      recipientUserId,
      sentAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [taskReminderState.workItemId, taskReminderState.reminderKind],
      set: { sentAt: new Date(), recipientUserId },
    });
}

/**
 * Run one pass over work items that may need a reminder. Returns
 * counts so the scheduler can log progress.
 */
export async function runTaskReminderPass(params: { now?: Date } = {}): Promise<{
  scanned: number;
  fired: number;
  skipped: number;
}> {
  const now = params.now ?? new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const horizon = new Date(todayStart);
  horizon.setDate(horizon.getDate() + 2); // window: yesterday-ish through tomorrow + 1

  // Pull a bounded set of candidates: not soft-deleted, with an end
  // date in the relevant window OR overdue and still open.
  const candidates = await db
    .select()
    .from(workItems)
    .where(
      and(
        isNull(workItems.deletedAt),
        sql`${workItems.endDate} IS NOT NULL`,
        sql`${workItems.endDate}::date < ${horizon.toISOString().slice(0, 10)}::date`,
      ),
    )
    .limit(2000);

  let fired = 0;
  let skipped = 0;

  for (const raw of candidates) {
    const item = raw as WorkItem;
    if (isClosedTaskStatus(item.status)) {
      skipped += 1;
      continue;
    }
    if (!item.ownerUserId) {
      skipped += 1;
      continue;
    }
    const endDate = item.endDate ? new Date(item.endDate as unknown as string) : null;
    const kind = classifyDueDate({ endDate, now });
    if (!kind) {
      skipped += 1;
      continue;
    }
    if (await alreadyReminded(item.id, kind)) {
      skipped += 1;
      continue;
    }

    const copy = buildTaskReminderCopy(kind, item);
    await dispatchAlert({
      alertTarget: null,
      recipientUserIds: [item.ownerUserId],
      eventType: copy.eventType,
      title: copy.title,
      body: copy.body,
      entityType: "work_item",
      entityId: item.id,
      projectId: item.projectId ?? undefined,
    });
    await recordReminderSent(item.id, kind, item.ownerUserId);
    fired += 1;
  }

  return { scanned: candidates.length, fired, skipped };
}

// ===================== SCHEDULER =====================

let timer: NodeJS.Timeout | null = null;

export function startTaskReminderScheduler(): void {
  if (timer) return;
  // Kick one immediate pass after a short delay so we don't compete
  // with the rest of the boot sequence.
  setTimeout(() => {
    runTaskReminderPass()
      .then((r) =>
        console.log(
          `[TaskReminder] initial pass: scanned=${r.scanned} fired=${r.fired} skipped=${r.skipped}`,
        ),
      )
      .catch((err) => console.warn("[TaskReminder] initial pass error:", err));
  }, 60_000);

  timer = setInterval(() => {
    runTaskReminderPass()
      .then((r) => {
        if (r.fired > 0) {
          console.log(
            `[TaskReminder] cycle: scanned=${r.scanned} fired=${r.fired} skipped=${r.skipped}`,
          );
        }
      })
      .catch((err) => console.warn("[TaskReminder] cycle error:", err));
  }, TASK_REMINDER_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();
}

export function stopTaskReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
