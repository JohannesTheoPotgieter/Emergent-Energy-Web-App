import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo, clients, engineeringTickets } from "./projects";

// ===================== TASK CONSTANTS =====================

// C6: canonical lowercase_underscore. Migration 20260413_status_casing
// rewrites every existing work_items.status row. "not_started" was
// historically the default but missing from the union — added now so
// the default matches the type.
export const TASK_STATUSES = [
  "not_started", "to_do", "in_progress", "hold", "projects_assistance",
  "needs_approval", "qc_approved", "provide_feedback",
  "operational_approval", "complete"
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
  authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
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
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
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
  sentByUserId: integer("sent_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
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
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
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
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTaskWatcherSchema = createInsertSchema(taskWatchers).omit({ id: true, createdAt: true } as any);
export type InsertTaskWatcher = z.infer<typeof insertTaskWatcherSchema>;
export type TaskWatcher = typeof taskWatchers.$inferSelect;

// ===================== WORK ITEMS =====================

export const workItemWorkstreamEnum = pgEnum('work_item_workstream', ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE', 'HANDOVER']);
export const workItemSourceEnum = pgEnum('work_item_source', ['SMART_IMPORT', 'UI', 'INTEGRATION', 'SYSTEM']);
export const workItemAssignmentRoleEnum = pgEnum('work_item_assignment_role', ['OWNER', 'ASSIGNEE', 'REVIEWER', 'VIEWER']);
export const workItemDepTypeEnum = pgEnum('work_item_dep_type', ['FS', 'SS', 'FF', 'SF']);

export const workItems = pgTable("work_items", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  workstream: workItemWorkstreamEnum("workstream").notNull(),
  type: text("type"),
  source: workItemSourceEnum("source").notNull().default("UI"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  duration: integer("duration"),
  // Canonical 0..1 scale (e.g. 0.75 means "75%"). Smart Import v2 routes
  // every write through `clampPercent` in
  // server/lib/import/value-normalization.ts; the migration
  // `migrations/00XX_normalise_work_items_pct_scale.sql` scaled any legacy
  // 0..100 stored values down. Readers must NOT assume 0..100 — go through
  // `pctTo100()` in server/lib/kpi-formulas.ts when they need percentage
  // points. See docs/smart-import-v2-task-dedup-audit.md (Fix 4a).
  percentComplete: real("percent_complete").default(0),
  // Same 0..1 scale as `percentComplete`. Smart Import writes this from
  // the workbook's "expected %" column; readers that need to derive it
  // from dates must use `expectedPctFromDates` in
  // server/lib/kpi-formulas.ts (SA working days) for cross-page parity.
  expectedPctComplete: real("expected_pct_complete"),
  wbsCode: text("wbs_code"),
  outlineNumber: text("outline_number"),
  indentLevel: integer("indent_level").default(0),
  parentId: integer("parent_id"),  // FK to work_items (self-ref) managed via migration
  isMilestone: boolean("is_milestone").default(false),
  phase: text("phase"),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerName: text("owner_name"),
  isShared: boolean("is_shared").notNull().default(false),
  externalRef: text("external_ref"),
  legacyTable: text("legacy_table"),
  legacyId: integer("legacy_id"),
  sourceRow: integer("source_row"),
  sourceSheet: text("source_sheet"),
  importRunId: integer("import_run_id"),
  createdBy: integer("created_by").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  scheduledDate: date("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  baselineStart: date("baseline_start"),
  baselineEnd: date("baseline_end"),
  baselineDuration: integer("baseline_duration"),
  taskMode: text("task_mode").default("auto"),
  actualStart: date("actual_start"),
  actualEnd: date("actual_end"),
  actualDuration: integer("actual_duration"),
  sortOrder: integer("sort_order").default(0),
  estimateMinutes: integer("estimate_minutes"),
  taskCategory: text("task_category"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceFrequency: text("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: date("recurrence_end_date"),
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
  // Renamed from `pd_ticket_id` to `engineering_ticket_id` in migration 0025
  // (vocabulary phase 2, task #58). A backwards-compat generated column
  // named `pd_ticket_id` mirrors this for one release.
  engineeringTicketId: integer("engineering_ticket_id"),
  // Personal-task columns (unified from mytool_tasks)
  bucket: text("bucket"),  // 'project' | 'company_ops' | 'personal'
  pinnedToday: boolean("pinned_today").default(false),
  pinnedWeek: boolean("pinned_week").default(false),
  sourceEmailId: text("source_email_id"),
  sourceEmailSubject: text("source_email_subject"),
  nextStep: text("next_step"),
  definitionOfDone: text("definition_of_done"),
  completionNote: text("completion_note"),
  // Solar/site engineering metadata — added by migration
  // 0040_work_items_engineering_metadata.sql (Path 2 consolidation).
  // Mirrors the fields the "Add Engineering Ticket" form on
  // /opportunities collects, so a sibling work_items row carries the
  // full payload (the engineering_tickets row remains for back-compat
  // with finance/FYE/PD-dashboard/gate-evaluator/Pipedrive readers).
  fundingType: text("funding_type"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  province: text("province"),
  gpsCoordinates: text("gps_coordinates"),
  batteriesNeeded: boolean("batteries_needed").default(false),
  batterySize: decimal("battery_size", { precision: 12, scale: 2 }),
  lead: text("lead"),
  resource1: text("resource_1"),
  resource2: text("resource_2"),
  trackerComments: text("tracker_comments"),
  workDays: integer("work_days"),
  cellFormat: jsonb("cell_format"),
  // Stable-ID + 3-way-merge support. See identical fields on
  // normalizedRevenueLines (in shared/schema/finance.ts) for full
  // documentation. work_items uses deletedAt soft-delete (not the
  // effectiveFrom/To temporal model), so the partial index filters on
  // deletedAt IS NULL.
  rowHash: text("row_hash"),
  importSnapshot: jsonb("import_snapshot"),
  manualOverrides: jsonb("manual_overrides"),
}, (table) => ({
  projectIdIdx: index("work_items_project_id_idx").on(table.projectId),
  ownerUserIdIdx: index("work_items_owner_user_id_idx").on(table.ownerUserId),
  statusIdx: index("work_items_status_idx").on(table.status),
  endDateIdx: index("work_items_end_date_idx").on(table.endDate),
  parentIdIdx: index("work_items_parent_id_idx").on(table.parentId),
  rowHashActiveIdx: index("work_items_row_hash_active_idx")
    .on(table.projectId, table.rowHash)
    .where(sql`${table.deletedAt} IS NULL`),
  uqWorkItemsExternalRefActive: uniqueIndex("uq_work_items_external_ref_active")
    .on(table.externalRef)
    .where(sql`${table.deletedAt} IS NULL`),
  // Partial index supports the `getProjectDevelopmentWorkspaceRollup`
  // engineeringTicketTaskRows aggregation. The matching FK on
  // `engineering_ticket_id` is hand-managed in migrations
  // 0019_foundation_linkage_hardening.sql (added) and
  // 0025_engineering_tickets_physical_rename.sql (renamed).
  engineeringTicketIdIdx: index("idx_work_items_engineering_ticket_id")
    .on(table.engineeringTicketId)
    .where(sql`${table.engineeringTicketId} IS NOT NULL`),
  // Drawer board query (Path 2): one card per engineering ticket on
  // the linked project, scoped to ENG-lane sibling rows only.
  engTicketActiveIdx: index("idx_work_items_eng_ticket_active")
    .on(table.workstream, table.engineeringTicketId, table.projectId)
    .where(sql`${table.deletedAt} IS NULL AND ${table.engineeringTicketId} IS NOT NULL`),
}));
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
  scheduledDate: date("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  estimateMinutes: integer("estimate_minutes"),
  taskCategory: text("task_category"),
  baselineStart: date("baseline_start"),
  baselineEnd: date("baseline_end"),
  baselineDuration: integer("baseline_duration"),
  taskMode: text("task_mode").default("auto"),
  actualStart: date("actual_start"),
  actualEnd: date("actual_end"),
  actualDuration: integer("actual_duration"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceFrequency: text("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: date("recurrence_end_date"),
  recurrenceParentId: integer("recurrence_parent_id"),
});
export const insertWorkItemSchedulingSchema = createInsertSchema(workItemScheduling).omit({ id: true } as any);
export type InsertWorkItemScheduling = z.infer<typeof insertWorkItemSchedulingSchema>;
export type WorkItemScheduling = typeof workItemScheduling.$inferSelect;

export const workItemAssignments = pgTable("work_item_assignments", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  role: workItemAssignmentRoleEnum("role").notNull().default("ASSIGNEE"),
  allocationPct: real("allocation_pct"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueWorkItemUserRole: unique("uq_work_item_user_role").on(table.workItemId, table.userId, table.role),
}));
export const insertWorkItemAssignmentSchema = createInsertSchema(workItemAssignments).omit({ id: true, createdAt: true } as any);
export type InsertWorkItemAssignment = z.infer<typeof insertWorkItemAssignmentSchema>;
export type WorkItemAssignment = typeof workItemAssignments.$inferSelect;

export const workItemDependencies = pgTable("work_item_dependencies", {
  id: serial("id").primaryKey(),
  predecessorId: integer("predecessor_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  successorId: integer("successor_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  depType: workItemDepTypeEnum("dep_type").notNull().default("FS"),
  lagDays: integer("lag_days").default(0),
  // Provenance so re-imports can re-derive plan dependencies from the workbook
  // without clobbering links a user created by hand. "SMART_IMPORT" rows are
  // owned by the importer; "MANUAL" rows are never touched by it.
  source: text("source").notNull().default("MANUAL"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertWorkItemDependencySchema = createInsertSchema(workItemDependencies).omit({ id: true, deletedAt: true, deletedBy: true } as any);
export type InsertWorkItemDependency = z.infer<typeof insertWorkItemDependencySchema>;
export type WorkItemDependency = typeof workItemDependencies.$inferSelect;

export const workItemStatusHistory = pgTable("work_item_status_history", {
  id: serial("id").primaryKey(),
  workItemId: integer("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
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
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertTaskTagSchema = createInsertSchema(taskTags).omit({ id: true, createdAt: true, deletedAt: true, deletedBy: true } as any);
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
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  durationMinutes: integer("duration_minutes").notNull(),
  description: text("description"),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertTaskTimeEntrySchema = createInsertSchema(taskTimeEntries).omit({ id: true, createdAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertTaskTimeEntry = z.infer<typeof insertTaskTimeEntrySchema>;
export type TaskTimeEntry = typeof taskTimeEntries.$inferSelect;
