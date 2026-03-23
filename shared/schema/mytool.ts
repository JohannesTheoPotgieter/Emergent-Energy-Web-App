import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo } from "./projects";
import { workItems } from "./tasks";

export const mytoolTaskStatusEnum = pgEnum('mytool_task_status', ['inbox', 'planned', 'in_progress', 'blocked', 'waiting', 'done', 'cancelled']);
export const mytoolTaskPriorityEnum = pgEnum('mytool_task_priority', ['low', 'normal', 'high', 'critical']);
export const mytoolPriorityHorizonEnum = pgEnum('mytool_priority_horizon', ['today', 'week', 'month', 'quarter']);
export const mytoolPrioritySeverityEnum = pgEnum('mytool_priority_severity', ['normal', 'important', 'critical']);
export const mytoolPriorityStatusEnum = pgEnum('mytool_priority_status', ['active', 'monitoring', 'closed', 'not_started', 'in_progress', 'complete']);

export const mytoolRecurrenceFrequencyEnum = pgEnum('mytool_recurrence_frequency', ['daily', 'weekly', 'monthly']);
export const mytoolTaskTypeEnum = pgEnum('mytool_task_type', ['task', 'milestone']);
export const mytoolDependencyTypeEnum = pgEnum('mytool_dependency_type', ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish']);

export const mytoolTaskBucketEnum = pgEnum('mytool_task_bucket', ['project', 'company_ops', 'personal']);

export const mytoolTasks = pgTable("mytool_tasks", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: mytoolTaskStatusEnum("status").notNull().default('inbox'),
  priority: mytoolTaskPriorityEnum("priority").notNull().default('normal'),
  plannedForDate: text("planned_for_date"),
  dueAt: timestamp("due_at"),
  startDate: text("start_date"),
  notes: text("notes"),
  bucket: mytoolTaskBucketEnum("bucket").default('personal'),
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  department: text("department"),
  tag: text("tag"),
  sourceEmailId: text("source_email_id"),
  sourceEmailSubject: text("source_email_subject"),
  blockedReason: text("blocked_reason"),
  nextStep: text("next_step"),
  definitionOfDone: text("definition_of_done"),
  completionNote: text("completion_note"),
  pinnedToday: boolean("pinned_today").notNull().default(false),
  pinnedWeek: boolean("pinned_week").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceFrequency: mytoolRecurrenceFrequencyEnum("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: text("recurrence_end_date"),
  recurrenceParentId: integer("recurrence_parent_id"),
  taskType: mytoolTaskTypeEnum("task_type").notNull().default('task'),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertMytoolTaskSchema = createInsertSchema(mytoolTasks).omit({ id: true, deletedAt: true, createdAt: true, updatedAt: true, completedAt: true } as any);
export type InsertMytoolTask = z.infer<typeof insertMytoolTaskSchema>;
export type MytoolTask = typeof mytoolTasks.$inferSelect;

export const mytoolTaskDependencies = pgTable("mytool_task_dependencies", {
  id: serial("id").primaryKey(),
  predecessorTaskId: integer("predecessor_task_id").notNull().references(() => mytoolTasks.id, { onDelete: "cascade" }),
  successorTaskId: integer("successor_task_id").notNull().references(() => mytoolTasks.id, { onDelete: "cascade" }),
  dependencyType: mytoolDependencyTypeEnum("dependency_type").notNull().default("finish_to_start"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueDependency: unique("mytool_task_dependencies_unique_link").on(table.predecessorTaskId, table.successorTaskId),
}));

export const insertMytoolTaskDependencySchema = createInsertSchema(mytoolTaskDependencies).omit({ id: true, createdAt: true } as any);
export type InsertMytoolTaskDependency = z.infer<typeof insertMytoolTaskDependencySchema>;
export type MytoolTaskDependency = typeof mytoolTaskDependencies.$inferSelect;

export const mytoolRecurrenceTemplates = pgTable("mytool_recurrence_templates", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
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

export const mytoolRecurrenceInstances = pgTable("mytool_recurrence_instances", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => mytoolRecurrenceTemplates.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => mytoolTasks.id, { onDelete: "cascade" }),
  instanceDate: text("instance_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueTemplateDate: unique("mytool_recurrence_instances_unique_template_date").on(table.templateId, table.instanceDate),
}));

export const insertMytoolRecurrenceInstanceSchema = createInsertSchema(mytoolRecurrenceInstances).omit({ id: true, createdAt: true } as any);
export type InsertMytoolRecurrenceInstance = z.infer<typeof insertMytoolRecurrenceInstanceSchema>;
export type MytoolRecurrenceInstance = typeof mytoolRecurrenceInstances.$inferSelect;

export const mytoolTimeblocks = pgTable("mytool_timeblocks", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  label: text("label").notNull(),
  linkedTaskId: integer("linked_task_id").references(() => mytoolTasks.id),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolCompanyPrioritySchema = createInsertSchema(mytoolCompanyPriorities).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMytoolCompanyPriority = z.infer<typeof insertMytoolCompanyPrioritySchema>;
export type MytoolCompanyPriority = typeof mytoolCompanyPriorities.$inferSelect;

export const priorityLinks = pgTable("priority_links", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
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
  linkedTaskId: integer("linked_task_id").references(() => mytoolTasks.id, { onDelete: "cascade" }),
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
