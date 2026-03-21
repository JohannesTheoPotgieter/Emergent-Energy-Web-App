import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo, clients, pdTickets } from "./projects";

// ===================== TASK CONSTANTS =====================

export const TASK_STATUSES = [
  "TO DO", "IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE",
  "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK",
  "OPERATIONAL APPROVAL", "COMPLETE"
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_WORKSTREAMS = [
  "PD", "Engineering", "Quality", "PM", "Procurement",
  "Construction", "Commissioning", "Handover"
] as const;
export type TaskWorkstream = typeof TASK_WORKSTREAMS[number];

export const TASK_PRIORITIES = ["Low", "Med", "High", "Urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export const TASK_BUCKETS = ['project', 'company_ops', 'personal'] as const;
export type TaskBucket = typeof TASK_BUCKETS[number];
export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  project: "Project",
  company_ops: "Company Ops",
  personal: "Personal",
};

// ===================== OPERATIONAL TASKS — DROPPED =====================
// Table operational_tasks dropped; data lives in work_items.
// Schema definition removed — see work_items below.

export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({ id: true, createdAt: true } as any);
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TaskComment = typeof taskComments.$inferSelect;

export const taskChecklists = pgTable("task_checklists", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskChecklistSchema = createInsertSchema(taskChecklists).omit({ id: true, createdAt: true } as any);
export type InsertTaskChecklist = z.infer<typeof insertTaskChecklistSchema>;
export type TaskChecklist = typeof taskChecklists.$inferSelect;

export const taskChecklistItems = pgTable("task_checklist_items", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => taskChecklists.id, { onDelete: 'cascade' }),
  content: text("content").notNull(),
  isDone: boolean("is_done").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskChecklistItemSchema = createInsertSchema(taskChecklistItems).omit({ id: true, createdAt: true } as any);
export type InsertTaskChecklistItem = z.infer<typeof insertTaskChecklistItemSchema>;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;

export const taskAttachments = pgTable("task_attachments", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskAttachmentSchema = createInsertSchema(taskAttachments).omit({ id: true, createdAt: true } as any);
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;
export type TaskAttachment = typeof taskAttachments.$inferSelect;

export const taskDeliverables = pgTable("task_deliverables", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: integer("file_size"),
  note: text("note"),
  sentByUserId: integer("sent_by_user_id").notNull().references(() => users.id),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskDeliverableSchema = createInsertSchema(taskDeliverables).omit({ id: true, createdAt: true, acknowledged: true, acknowledgedAt: true } as any);
export type InsertTaskDeliverable = z.infer<typeof insertTaskDeliverableSchema>;
export type TaskDeliverable = typeof taskDeliverables.$inferSelect;

export const taskActivityLog = pgTable("task_activity_log", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => users.id),
  actionType: text("action_type").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskActivityLogSchema = createInsertSchema(taskActivityLog).omit({ id: true, createdAt: true } as any);
export type InsertTaskActivityLog = z.infer<typeof insertTaskActivityLogSchema>;
export type TaskActivityLog = typeof taskActivityLog.$inferSelect;

// ===================== TASK WATCHER JUNCTION =====================

export const taskWatchers = pgTable("task_watchers", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTaskWatcherSchema = createInsertSchema(taskWatchers).omit({ id: true, createdAt: true } as any);
export type InsertTaskWatcher = z.infer<typeof insertTaskWatcherSchema>;
export type TaskWatcher = typeof taskWatchers.$inferSelect;

// ===================== WORK ITEMS =====================

export const workItemWorkstreamEnum = pgEnum('work_item_workstream', ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE']);
export const workItemSourceEnum = pgEnum('work_item_source', ['SMART_IMPORT', 'UI', 'INTEGRATION', 'SYSTEM']);
export const workItemAssignmentRoleEnum = pgEnum('work_item_assignment_role', ['OWNER', 'ASSIGNEE', 'REVIEWER', 'VIEWER']);
export const workItemDepTypeEnum = pgEnum('work_item_dep_type', ['FS', 'SS', 'FF', 'SF']);

export const workItems = pgTable("work_items", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  workstream: workItemWorkstreamEnum("workstream").notNull(),
  type: text("type"),
  source: workItemSourceEnum("source").notNull().default("UI"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("Not Started"),
  priority: text("priority"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  duration: integer("duration"),
  percentComplete: real("percent_complete").default(0),
  expectedPctComplete: real("expected_pct_complete"),
  wbsCode: text("wbs_code"),
  outlineNumber: text("outline_number"),
  indentLevel: integer("indent_level").default(0),
  parentId: integer("parent_id"),
  isMilestone: boolean("is_milestone").default(false),
  phase: text("phase"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  ownerName: text("owner_name"),
  isShared: boolean("is_shared").notNull().default(false),
  externalRef: text("external_ref").unique(),
  legacyTable: text("legacy_table"),
  legacyId: integer("legacy_id"),
  sourceRow: integer("source_row"),
  sourceSheet: text("source_sheet"),
  importRunId: integer("import_run_id"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  baselineStart: text("baseline_start"),
  baselineEnd: text("baseline_end"),
  baselineDuration: integer("baseline_duration"),
  taskMode: text("task_mode").default("auto"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  actualDuration: integer("actual_duration"),
  sortOrder: integer("sort_order").default(0),
  estimateMinutes: integer("estimate_minutes"),
  taskCategory: text("task_category"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceFrequency: text("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: text("recurrence_end_date"),
  recurrenceParentId: integer("recurrence_parent_id"),
  subProjectName: text("sub_project_name"),
  // Engineering-specific columns (migrated from operational_tasks)
  holdReason: text("hold_reason"),
  blockedType: text("blocked_type"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  linkedPlanItemId: integer("linked_plan_item_id"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedQualityItemInstanceId: integer("linked_quality_item_instance_id"),
  completedAt: timestamp("completed_at"),
  trackingRag: text("tracking_rag"),
  taskTypeTag: text("task_type_tag"),
  blockerReason: text("blocker_reason"),
});
export const insertWorkItemSchema = createInsertSchema(workItems).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkItem = z.infer<typeof insertWorkItemSchema>;
export type WorkItem = typeof workItems.$inferSelect;

// ── Work Item Extension Tables (Prompt 5 — lean core + domain extensions) ──

/**
 * PM Extension — project management, tracking, approval, and linking fields.
 * 1:1 with work_items via work_item_id UNIQUE FK.
 */
export const workItemPm = pgTable("work_item_pm", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }).unique(),
  duration: integer("duration"),
  percentComplete: real("percent_complete").default(0),
  expectedPctComplete: real("expected_pct_complete"),
  phase: text("phase"),
  isMilestone: boolean("is_milestone").default(false),
  indentLevel: integer("indent_level").default(0),
  ownerName: text("owner_name"),
  isShared: boolean("is_shared").notNull().default(false),
  holdReason: text("hold_reason"),
  blockedType: text("blocked_type"),
  blockerReason: text("blocker_reason"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  trackingRag: text("tracking_rag"),
  taskTypeTag: text("task_type_tag"),
  subProjectName: text("sub_project_name"),
  completedAt: timestamp("completed_at"),
  linkedPlanItemId: integer("linked_plan_item_id"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedQualityItemInstanceId: integer("linked_quality_item_instance_id"),
});
export const insertWorkItemPmSchema = createInsertSchema(workItemPm).omit({ id: true } as any);
export type InsertWorkItemPm = z.infer<typeof insertWorkItemPmSchema>;
export type WorkItemPm = typeof workItemPm.$inferSelect;

/**
 * Engineering Extension — import provenance and work-breakdown-structure fields.
 * 1:1 with work_items via work_item_id UNIQUE FK.
 */
export const workItemEngineering = pgTable("work_item_engineering", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }).unique(),
  wbsCode: text("wbs_code"),
  outlineNumber: text("outline_number"),
  legacyTable: text("legacy_table"),
  legacyId: integer("legacy_id"),
  sourceRow: integer("source_row"),
  sourceSheet: text("source_sheet"),
  importRunId: integer("import_run_id"),
});
export const insertWorkItemEngineeringSchema = createInsertSchema(workItemEngineering).omit({ id: true } as any);
export type InsertWorkItemEngineering = z.infer<typeof insertWorkItemEngineeringSchema>;
export type WorkItemEngineering = typeof workItemEngineering.$inferSelect;

/**
 * Scheduling Extension — calendar, recurrence, baseline/actual tracking, time estimation.
 * 1:1 with work_items via work_item_id UNIQUE FK.
 */
export const workItemScheduling = pgTable("work_item_scheduling", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }).unique(),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  estimateMinutes: integer("estimate_minutes"),
  taskCategory: text("task_category"),
  baselineStart: text("baseline_start"),
  baselineEnd: text("baseline_end"),
  baselineDuration: integer("baseline_duration"),
  taskMode: text("task_mode").default("auto"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  actualDuration: integer("actual_duration"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceFrequency: text("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: text("recurrence_end_date"),
  recurrenceParentId: integer("recurrence_parent_id"),
});
export const insertWorkItemSchedulingSchema = createInsertSchema(workItemScheduling).omit({ id: true } as any);
export type InsertWorkItemScheduling = z.infer<typeof insertWorkItemSchedulingSchema>;
export type WorkItemScheduling = typeof workItemScheduling.$inferSelect;

export const workItemAssignments = pgTable("work_item_assignments", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  role: workItemAssignmentRoleEnum("role").notNull().default("ASSIGNEE"),
  allocationPct: real("allocation_pct"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertWorkItemAssignmentSchema = createInsertSchema(workItemAssignments).omit({ id: true, createdAt: true } as any);
export type InsertWorkItemAssignment = z.infer<typeof insertWorkItemAssignmentSchema>;
export type WorkItemAssignment = typeof workItemAssignments.$inferSelect;

export const workItemDependencies = pgTable("work_item_dependencies", {
  id: serial("id").primaryKey(),
  predecessorId: integer("predecessor_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  successorId: integer("successor_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  depType: workItemDepTypeEnum("dep_type").notNull().default("FS"),
  lagDays: integer("lag_days").default(0),
});
export const insertWorkItemDependencySchema = createInsertSchema(workItemDependencies).omit({ id: true } as any);
export type InsertWorkItemDependency = z.infer<typeof insertWorkItemDependencySchema>;
export type WorkItemDependency = typeof workItemDependencies.$inferSelect;

export const workItemStatusHistory = pgTable("work_item_status_history", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedBy: integer("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  reason: text("reason"),
});
export const insertWorkItemStatusHistorySchema = createInsertSchema(workItemStatusHistory).omit({ id: true, changedAt: true } as any);
export type InsertWorkItemStatusHistory = z.infer<typeof insertWorkItemStatusHistorySchema>;
export type WorkItemStatusHistory = typeof workItemStatusHistory.$inferSelect;

// ── Task Tags & Time Entries ─────────────────────────────────────────

export const taskTagCategoryEnum = pgEnum('task_tag_category', ['BUG', 'IMPROVEMENT', 'FEATURE', 'CUSTOM']);

export const taskTags = pgTable("task_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#6366f1"),
  category: taskTagCategoryEnum("category").notNull().default("CUSTOM"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTaskTagSchema = createInsertSchema(taskTags).omit({ id: true, createdAt: true } as any);
export type InsertTaskTag = z.infer<typeof insertTaskTagSchema>;
export type TaskTag = typeof taskTags.$inferSelect;

export const workItemTags = pgTable("work_item_tags", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => taskTags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueWorkItemTag: unique("work_item_tags_unique").on(table.workItemId, table.tagId),
}));
export const insertWorkItemTagSchema = createInsertSchema(workItemTags).omit({ id: true, createdAt: true } as any);
export type InsertWorkItemTag = z.infer<typeof insertWorkItemTagSchema>;
export type WorkItemTag = typeof workItemTags.$inferSelect;

export const taskTimeEntries = pgTable("task_time_entries", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  durationMinutes: integer("duration_minutes").notNull(),
  description: text("description"),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTaskTimeEntrySchema = createInsertSchema(taskTimeEntries).omit({ id: true, createdAt: true } as any);
export type InsertTaskTimeEntry = z.infer<typeof insertTaskTimeEntrySchema>;
export type TaskTimeEntry = typeof taskTimeEntries.$inferSelect;
