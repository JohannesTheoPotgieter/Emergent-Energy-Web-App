import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo, opportunities } from "./projects";
import { workItems } from "./tasks";

// ── Legacy personal-task enums — retained for Drizzle migration compatibility ──
// These enums existed on the now-removed mytool_tasks and mytool_task_dependencies tables.
// Kept so Drizzle does not attempt to recreate them during migration diffing.
export const mytoolTaskStatusEnum = pgEnum('mytool_task_status', ['inbox', 'planned', 'in_progress', 'blocked', 'waiting', 'done', 'cancelled']);
export const mytoolTaskPriorityEnum = pgEnum('mytool_task_priority', ['low', 'normal', 'high', 'critical']);
export const mytoolRecurrenceFrequencyEnum = pgEnum('mytool_recurrence_frequency', ['daily', 'weekly', 'monthly']);
export const mytoolTaskTypeEnum = pgEnum('mytool_task_type', ['task', 'milestone']);
export const mytoolDependencyTypeEnum = pgEnum('mytool_dependency_type', ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish']);
export const mytoolTaskBucketEnum = pgEnum('mytool_task_bucket', ['project', 'company_ops', 'personal']);

// ── Active enums used by independent mytool entities ──
export const mytoolPriorityHorizonEnum = pgEnum('mytool_priority_horizon', ['today', 'week', 'month', 'quarter']);
export const mytoolPrioritySeverityEnum = pgEnum('mytool_priority_severity', ['normal', 'important', 'critical']);
export const mytoolPriorityStatusEnum = pgEnum('mytool_priority_status', ['active', 'monitoring', 'closed', 'not_started', 'in_progress', 'complete']);
export const mytoolPriorityScopeEnum = pgEnum('mytool_priority_scope', ['company', 'department', 'role']);

// ── mytool_tasks: REMOVED (Phase 6) ──
// Table had 0 active rows. All personal tasks live in work_items (workstream='PERSONAL').
// Schema definition removed. Table archived via migration 20260401_remap_mytool_fks.sql.
// All FK references from dependent tables (timeblocks, email_links) remapped to work_items.

// ── mytool_task_dependencies: DROPPED (Phase 5B) ──
// Table had 0 rows. Dependencies now use canonical work_item_dependencies.

// ── mytool_recurrence_instances: ARCHIVED (Phase 6) ──
// Table had 0 orphan records. No server or frontend code references it.

export const mytoolRecurrenceTemplates = pgTable("mytool_recurrence_templates", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  defaultAssigneeRole: text("default_assignee_role"),
  checklistItems: jsonb("checklist_items"),
  frequency: mytoolRecurrenceFrequencyEnum("frequency").notNull(),
  interval: integer("interval").notNull().default(1),
  daysOfWeek: text("days_of_week"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolRecurrenceTemplateSchema = createInsertSchema(mytoolRecurrenceTemplates).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMytoolRecurrenceTemplate = z.infer<typeof insertMytoolRecurrenceTemplateSchema>;
export type MytoolRecurrenceTemplate = typeof mytoolRecurrenceTemplates.$inferSelect;

// ── mytool_recurrence_instances: ARCHIVED (Phase 6) ──
// Table had 0 orphan records. No server or frontend code references it.
// Schema definition removed. Table archived via migration 20260401_remap_mytool_fks.sql.

export const mytoolTimeblocks = pgTable("mytool_timeblocks", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  label: text("label").notNull(),
  linkedTaskId: integer("linked_task_id").references(() => workItems.id),
  outlookEventId: text("outlook_event_id"),
  outlookCalendarId: text("outlook_calendar_id"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolTimeblockSchema = createInsertSchema(mytoolTimeblocks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMytoolTimeblock = z.infer<typeof insertMytoolTimeblockSchema>;
export type MytoolTimeblock = typeof mytoolTimeblocks.$inferSelect;

export const mytoolDailyReviews = pgTable("mytool_daily_reviews", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  topOutcomes: text("top_outcomes"),
  whatMoved: text("what_moved"),
  blocked: text("blocked"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolDailyReviewSchema = createInsertSchema(mytoolDailyReviews).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMytoolDailyReview = z.infer<typeof insertMytoolDailyReviewSchema>;
export type MytoolDailyReview = typeof mytoolDailyReviews.$inferSelect;

export const mytoolCompanyPriorities = pgTable("mytool_company_priorities", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  department: text("department"),
  horizon: mytoolPriorityHorizonEnum("horizon").notNull().default('week'),
  ownerRole: text("owner_role"),
  linkedProjectName: text("linked_project_name"),
  linkedProjectId: integer("linked_project_id").references(() => projectInfo.id),
  severity: mytoolPrioritySeverityEnum("severity").notNull().default('normal'),
  status: mytoolPriorityStatusEnum("status").notNull().default('active'),
  priorityRank: integer("priority_rank"),
  assignedTo: text("assigned_to"),
  nextAction: text("next_action"),
  support: text("support").array(),
  definitionOfDone: text("definition_of_done"),
  dueDate: text("due_date"),
  linkedTaskId: integer("linked_task_id"),
  linkedTaskType: text("linked_task_type"),
  // Strategic layer columns
  accountableExecId: integer("accountable_exec_id").references(() => users.id),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  targetStartDate: text("target_start_date"),
  targetOutcome: text("target_outcome"),
  sortOrder: integer("sort_order").notNull().default(0),
  manualHealth: text("manual_health"),
  manualProgress: integer("manual_progress"),
  // Progress source linking (migration 0009).
  // When `progressSourceType` is set + non-null, the priority's effective
  // progress is computed from the linked source (project phase, project %,
  // revenue milestone, or tasks roll-up) instead of `manualProgress`.
  // Compute lives in server/lib/priorities/progress-source.ts.
  progressSourceType: text("progress_source_type"),
  progressSourceRef: jsonb("progress_source_ref"),
  // Cascading priority columns
  scope: mytoolPriorityScopeEnum("scope").notNull().default('company'),
  parentId: integer("parent_id"),
  departmentKey: text("department_key"),
  assignedUserId: integer("assigned_user_id").references(() => users.id),
  escalated: boolean("escalated").notNull().default(false),
  escalatedAt: timestamp("escalated_at"),
  escalationReason: text("escalation_reason"),
  // Soft-delete (archive) flag. NULL = live, non-null = archived.
  // All list/detail reads filter `deleted_at IS NULL` by default;
  // admins opt in via `include_archived=true`. See migration 0069.
  // mode: "string" — better-sqlite3 stores this as TEXT (ISO string),
  // and Drizzle's default Date parsing returns "Invalid Date" for
  // SQLite TEXT timestamps. Keeping it as a string round-trips
  // correctly across both drivers.
  deletedAt: timestamp("deleted_at", { mode: "string" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolCompanyPrioritySchema = createInsertSchema(mytoolCompanyPriorities).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMytoolCompanyPriority = z.infer<typeof insertMytoolCompanyPrioritySchema>;
export type MytoolCompanyPriority = typeof mytoolCompanyPriorities.$inferSelect;

// ── Priority activity log ─────────────────────────────────────────────
// Append-only audit trail of what happened to a priority. One row per
// observable event — created, updated, escalated, closed, reopened,
// broken_down, project_linked, project_unlinked, health_changed, etc.
// Used by the "Activity" tab on the priority detail page so reviewers
// can trace how a priority got to its current state.
export const priorityActivity = pgTable("priority_activity", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Denormalised snapshot of the actor's name at the time of the event. */
  actorName: text("actor_name"),
  /** Event kind — see the union in server/departments/priority-activity-log.ts */
  action: text("action").notNull(),
  /** Old value serialised to string (e.g. 'active', 'healthy', 'normal'). Null for inserts. */
  fromValue: text("from_value"),
  /** New value serialised to string. Null for purely "marker" events. */
  toValue: text("to_value"),
  /** Free-form context (e.g. escalation reason, linked project IDs). */
  details: jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPriorityActivitySchema = createInsertSchema(priorityActivity).omit({ id: true, createdAt: true } as any);
export type InsertPriorityActivity = z.infer<typeof insertPriorityActivitySchema>;
export type PriorityActivity = typeof priorityActivity.$inferSelect;

export const priorityLinks = pgTable("priority_links", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  taskId: integer("task_id"),
  taskType: text("task_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPriorityLinkSchema = createInsertSchema(priorityLinks).omit({ id: true, createdAt: true } as any);
export type InsertPriorityLink = z.infer<typeof insertPriorityLinkSchema>;
export type PriorityLink = typeof priorityLinks.$inferSelect;

// Priority-Project junction table for strategic alignment
export const priorityProjects = pgTable("priority_projects", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  linkedBy: integer("linked_by").references(() => users.id, { onDelete: "set null" }),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
}, (table) => ({
  uniquePriorityProject: unique("priority_projects_unique").on(table.priorityId, table.projectId),
}));

export const insertPriorityProjectSchema = createInsertSchema(priorityProjects).omit({ id: true, linkedAt: true } as any);
export type InsertPriorityProject = z.infer<typeof insertPriorityProjectSchema>;
export type PriorityProject = typeof priorityProjects.$inferSelect;

// ── Priority Comments ─────────────────────────────────────────────────
// Free-text notes and discussion on a priority. Append-only from the
// client; soft-deleted via deletedAt so the author count stays consistent.
export const priorityComments = pgTable("priority_comments", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  body: text("body").notNull(),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPriorityCommentSchema = createInsertSchema(priorityComments).omit({ id: true, createdAt: true } as any);
export type InsertPriorityComment = z.infer<typeof insertPriorityCommentSchema>;
export type PriorityComment = typeof priorityComments.$inferSelect;

// ── Priority Watches ─────────────────────────────────────────────────
// Users can watch a priority to receive notifications on escalation and
// status changes. One row per (user, priority) pair; unique constraint
// enforced at DB level.
export const priorityWatches = pgTable("priority_watches", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ name: "priority_watches_unique", columns: [table.userId, table.priorityId] }),
}));

export type PriorityWatch = typeof priorityWatches.$inferSelect;

// Priority ↔ Opportunity junction — Tier 4 · PR 2.
// Lets a Priority attach to a *pre-contract* deal (opportunity) as well as
// to a signed project. Needed so the strategic view can see pipeline risk
// (stalled proposals, overdue feasibility work) not just post-signature work.
export const priorityOpportunities = pgTable("priority_opportunities", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  linkedBy: integer("linked_by").references(() => users.id, { onDelete: "set null" }),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
}, (table) => ({
  uniquePriorityOpportunity: unique("priority_opportunities_unique").on(table.priorityId, table.opportunityId),
}));

export const insertPriorityOpportunitySchema = createInsertSchema(priorityOpportunities).omit({ id: true, linkedAt: true } as any);
export type InsertPriorityOpportunity = z.infer<typeof insertPriorityOpportunitySchema>;
export type PriorityOpportunity = typeof priorityOpportunities.$inferSelect;

export const mytoolUserPreferences = pgTable("mytool_user_preferences", {
  ownerUserId: integer("owner_user_id").primaryKey().references(() => users.id),
  todayLayout: text("today_layout"),
  defaultView: text("default_view").notNull().default('today'),
  workdayStartTime: text("workday_start_time").notNull().default('08:00'),
  workdayEndTime: text("workday_end_time").notNull().default('17:00'),
  showCompanyPriorities: boolean("show_company_priorities").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolUserPreferencesSchema = createInsertSchema(mytoolUserPreferences).omit({ updatedAt: true } as any);
export type InsertMytoolUserPreferences = z.infer<typeof insertMytoolUserPreferencesSchema>;
export type MytoolUserPreferences = typeof mytoolUserPreferences.$inferSelect;

export const mytoolEmailLinks = pgTable("mytool_email_links", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  sender: text("sender"),
  emailDate: text("email_date"),
  snippet: text("snippet"),
  outlookMessageId: text("outlook_message_id"),
  webLink: text("web_link"),
  linkedTaskId: integer("linked_task_id").references(() => workItems.id, { onDelete: "cascade" }),
  linkedOperationalTaskId: integer("linked_operational_task_id").references(() => workItems.id, { onDelete: "cascade" }),
  linkedPriorityId: integer("linked_priority_id").references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMytoolEmailLinkSchema = createInsertSchema(mytoolEmailLinks).omit({ id: true, createdAt: true } as any);
export type InsertMytoolEmailLink = z.infer<typeof insertMytoolEmailLinkSchema>;
export type MytoolEmailLink = typeof mytoolEmailLinks.$inferSelect;

export const mytoolDodTemplates = pgTable("mytool_dod_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  department: text("department"),
  content: text("content").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMytoolDodTemplateSchema = createInsertSchema(mytoolDodTemplates).omit({ id: true, createdAt: true } as any);
export type InsertMytoolDodTemplate = z.infer<typeof insertMytoolDodTemplateSchema>;
export type MytoolDodTemplate = typeof mytoolDodTemplates.$inferSelect;

export const mytoolSettings = pgTable("mytool_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  allowedRoles: text("allowed_roles").notNull().default('admin'),
  defaultPriorityHorizon: text("default_priority_horizon").notNull().default('week'),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ===================== EMAIL TRIAGE RULES =====================

export const triageRuleTypeEnum = pgEnum('triage_rule_type', ['keyword', 'sender', 'domain']);

export const triageRules = pgTable("triage_rules", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  ruleType: triageRuleTypeEnum("rule_type").notNull(),
  value: text("value").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTriageRuleSchema = createInsertSchema(triageRules).omit({ id: true, createdAt: true } as any);
export type InsertTriageRule = z.infer<typeof insertTriageRuleSchema>;
export type TriageRule = typeof triageRules.$inferSelect;
