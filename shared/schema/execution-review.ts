// ===================== EXECUTION REVIEW (augmentation layer) =====================
//
// The Execution tab is a program-wide delivery control tower that READS from
// canonical surfaces (the imported program plan, subcontractor assignments,
// procurement, engineering, quality). The ONLY data this feature WRITES is the
// per-project "flagged items" augmentation captured here — review notes raised
// in the weekly Execution Review that hang off a project (and optionally off a
// specific program-plan task line).
//
// This is NOT a parallel comms / activity table. It is a deliberate, narrow
// augmentation surface owned by the Execution review.

import { pgTable, text, integer, timestamp, pgEnum, serial, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

export const executionReviewStatusEnum = pgEnum("execution_review_status", [
  "open",
  "flagged",
  "actioned",
  "closed",
]);

export const executionReviewSeverityEnum = pgEnum("execution_review_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const executionReviewItems = pgTable("execution_review_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectInfo.id),
  /** Free-text bucket, e.g. "schedule", "procurement", "engineering", "quality". */
  category: text("category").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  status: executionReviewStatusEnum("status").notNull().default("open"),
  severity: executionReviewSeverityEnum("severity").notNull().default("medium"),
  tags: text("tags").array().notNull().default([]),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  dueDate: date("due_date"),
  /** The Execution Review meeting this item was raised in (optional). */
  meetingDate: date("meeting_date"),
  // ── Optional link to a program-plan line (verbatim import backbone). ──
  /** normalized_plan_tasks.task_no of the linked WBS line. */
  planTaskNo: text("plan_task_no"),
  /** normalized_plan_tasks.id of the linked WBS line. */
  planWorkItemId: integer("plan_work_item_id"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertExecutionReviewItemSchema = createInsertSchema(executionReviewItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);

export type InsertExecutionReviewItem = z.infer<typeof insertExecutionReviewItemSchema>;
export type ExecutionReviewItem = typeof executionReviewItems.$inferSelect;
export type ExecutionReviewStatus = (typeof executionReviewStatusEnum.enumValues)[number];
export type ExecutionReviewSeverity = (typeof executionReviewSeverityEnum.enumValues)[number];
