/**
 * C3 — Task reminder dedup state.
 *
 * One row per (work_item_id, reminder_kind). The reminder dispatcher
 * checks this table before sending a reminder so the same assignee
 * doesn't get spammed every cycle for the same milestone.
 */

import { pgTable, text, integer, timestamp, serial, uniqueIndex } from "drizzle-orm/pg-core";

export const TASK_REMINDER_KINDS = ["due_in_24h", "due_today", "overdue"] as const;
export type TaskReminderKind = (typeof TASK_REMINDER_KINDS)[number];

export const taskReminderState = pgTable(
  "task_reminder_state",
  {
    id: serial("id").primaryKey(),
    workItemId: integer("work_item_id").notNull(),
    reminderKind: text("reminder_kind").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    recipientUserId: integer("recipient_user_id"),
  },
  (table) => ({
    uqWorkKind: uniqueIndex("uq_task_reminder_state_work_kind").on(
      table.workItemId,
      table.reminderKind,
    ),
  }),
);

export type TaskReminderState = typeof taskReminderState.$inferSelect;
export type InsertTaskReminderState = typeof taskReminderState.$inferInsert;
