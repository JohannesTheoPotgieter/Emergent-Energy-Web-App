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

import { pgTable, text, integer, timestamp, pgEnum, serial, date, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";
import { workItems } from "./tasks";

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

// ===================== MILESTONE TRACKER LINKS =====================
//
// The Milestone Tracker links payment milestones (normalized_revenue_lines —
// the inflow side, from the revenue tracking sheet) to the plan tasks
// (work_items) that make them invoiceable, and links those tasks to the
// expenditure-breakdown cost lines (normalized_cost_lines — the outflow side).
// The task is the hub: milestone <-> task and task <-> cost are each
// many-to-many, so a milestone's outflows roll up through its linked tasks.
//
// IMPORTANT: the finance line tables are temporal SNAPSHOTS whose serial id
// changes on every re-import. Links therefore reference the STABLE
// (project_id, row_hash) identity — NOT the serial id — and reads resolve the
// live row via effective_to IS NULL. work_items are upserted in place, so their
// serial id is stable and safe to reference directly.

export const revenueMilestoneTaskLinks = pgTable("revenue_milestone_task_links", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** Stable (project_id, row_hash) identity of the normalized_revenue_lines milestone. */
  revenueRowHash: text("revenue_row_hash").notNull(),
  /** work_items.id (upserted in place — stable across re-imports). */
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("revenue_milestone_task_links_uniq").on(t.projectId, t.revenueRowHash, t.workItemId),
  byProject: index("revenue_milestone_task_links_project_idx").on(t.projectId),
  byTask: index("revenue_milestone_task_links_task_idx").on(t.workItemId),
}));

export const taskCostLineLinks = pgTable("task_cost_line_links", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** work_items.id (stable). */
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  /** Stable (project_id, row_hash) identity of the normalized_cost_lines outflow. */
  costRowHash: text("cost_row_hash").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("task_cost_line_links_uniq").on(t.projectId, t.workItemId, t.costRowHash),
  byProject: index("task_cost_line_links_project_idx").on(t.projectId),
  byTask: index("task_cost_line_links_task_idx").on(t.workItemId),
}));

export const insertRevenueMilestoneTaskLinkSchema = createInsertSchema(revenueMilestoneTaskLinks).omit({ id: true, createdAt: true } as any);
export type InsertRevenueMilestoneTaskLink = z.infer<typeof insertRevenueMilestoneTaskLinkSchema>;
export type RevenueMilestoneTaskLink = typeof revenueMilestoneTaskLinks.$inferSelect;

export const insertTaskCostLineLinkSchema = createInsertSchema(taskCostLineLinks).omit({ id: true, createdAt: true } as any);
export type InsertTaskCostLineLink = z.infer<typeof insertTaskCostLineLinkSchema>;
export type TaskCostLineLink = typeof taskCostLineLinks.$inferSelect;

// ===================== ACTIVITY-PLANNING LINK TEMPLATES =====================
//
// A reusable, project-agnostic set of word rules that recreate the inflow→task→
// outflow links on a new project. Built by saving an already-linked project's
// links as keyword rules; applied by matching milestone / task / outflow text.
// `rules` shape (ActivityTemplateRule[]):
//   { label, milestoneKeywords[], taskKeywords[], outflowKeywords[] }
export const activityPlanTemplates = pgTable("activity_plan_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rules: jsonb("rules").notNull().default([]),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
export type ActivityPlanTemplate = typeof activityPlanTemplates.$inferSelect;
