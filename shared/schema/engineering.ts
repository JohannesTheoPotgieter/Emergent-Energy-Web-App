import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users, organizations } from "./users";
import { projectInfo, companyLifecyclePhaseEnum } from "./projects";
import { workItems } from "./tasks";

// ===================== ENGINEERING DELIVERABLES =====================

export const DELIVERABLE_STATUSES = [
  "TO DO", "IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK",
  "QC APPROVED", "OPERATIONAL APPROVAL", "COMPLETE"
] as const;
export type DeliverableStatus = typeof DELIVERABLE_STATUSES[number];

export const deliverables = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  deliverableType: text("deliverable_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  phase: text("phase"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id),
  qcReviewerUserId: integer("qc_reviewer_user_id").references(() => users.id),
  status: text("status").notNull().default("TO DO"),
  currentVersion: integer("current_version").notNull().default(1),
  sharepointFolderSiteId: text("sharepoint_folder_site_id"),
  sharepointFolderDriveId: text("sharepoint_folder_drive_id"),
  sharepointFolderItemId: text("sharepoint_folder_item_id"),
  linkedPlanItemId: integer("linked_plan_item_id"),
  linkedQualityItemInstanceId: integer("linked_quality_item_instance_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
});
export const insertDeliverableSchema = createInsertSchema(deliverables).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertDeliverable = z.infer<typeof insertDeliverableSchema>;
export type Deliverable = typeof deliverables.$inferSelect;

export const deliverableVersions = pgTable("deliverable_versions", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  versionNumber: integer("version_number").notNull(),
  changeReason: text("change_reason"),
  impactJson: jsonb("impact_json"),
  status: text("status").notNull().default("IN PROGRESS"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableVersionSchema = createInsertSchema(deliverableVersions).omit({ id: true, createdAt: true } as any);
export type InsertDeliverableVersion = z.infer<typeof insertDeliverableVersionSchema>;
export type DeliverableVersion = typeof deliverableVersions.$inferSelect;

export const deliverableFiles = pgTable("deliverable_files", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  versionId: integer("version_id").references(() => deliverableVersions.id, { onDelete: 'cascade' }),
  siteId: text("site_id"),
  driveId: text("drive_id"),
  fileItemId: text("file_item_id"),
  fileName: text("file_name").notNull(),
  webUrl: text("web_url"),
  isApproved: boolean("is_approved").notNull().default(false),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
export const insertDeliverableFileSchema = createInsertSchema(deliverableFiles).omit({ id: true, uploadedAt: true } as any);
export type InsertDeliverableFile = z.infer<typeof insertDeliverableFileSchema>;
export type DeliverableFile = typeof deliverableFiles.$inferSelect;

export const deliverableEvents = pgTable("deliverable_events", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  feedbackText: text("feedback_text"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableEventSchema = createInsertSchema(deliverableEvents).omit({ id: true, createdAt: true } as any);
export type InsertDeliverableEvent = z.infer<typeof insertDeliverableEventSchema>;
export type DeliverableEvent = typeof deliverableEvents.$inferSelect;

// ===================== ENHANCED WARNING ENGINE =====================

export const WARNING_TYPES = [
  "overdue_task", "missing_approval", "missing_evidence", "orphan_task",
  "milestone_risk", "invalid_dates", "deliverable_version_risk",
  "folder_mismatch", "risk_trigger", "review_stuck", "task_complete_unapproved"
] as const;
export type WarningType = typeof WARNING_TYPES[number];

export const WARNING_SEVERITIES = ["HIGH", "MED", "LOW"] as const;
export type WarningSeverity = typeof WARNING_SEVERITIES[number];

export const WARNING_STATUSES = ["open", "in_progress", "resolved", "accepted_risk"] as const;
export type WarningStatus = typeof WARNING_STATUSES[number];

// ===================== ENGINEERING TASKS — DROPPED =====================
// Table engineering_tasks dropped; data lives in work_items (workstream='ENG').
// Schema definition removed — see work_items in tasks.ts.

export const engTaskStatusEnum = pgEnum('eng_task_status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'ON_HOLD']);

// ===================== ENGINEERING STAGE TEMPLATES (Part E2) =====================

export const engStageStatusEnum = pgEnum('eng_stage_status', ['not_started', 'in_progress', 'blocked', 'ready_for_review', 'complete']);
export const engTaskInstanceStatusEnum = pgEnum('eng_task_instance_status', ['pending', 'in_progress', 'complete', 'skipped']);
export const engApprovalStatusEnum = pgEnum('eng_approval_status', ['pending', 'approved', 'rejected']);

export const engStageTemplates = pgTable("eng_stage_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  purpose: text("purpose"),
  inputs: text("inputs").array(),
  raciResponsible: text("raci_responsible"),
  raciAccountable: text("raci_accountable"),
  raciConsulted: text("raci_consulted"),
  raciInformed: text("raci_informed"),
  failureModes: text("failure_modes").array(),
  stageGateRules: jsonb("stage_gate_rules"),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Multi-tenancy (Prompt 11)
  organizationId: integer("organization_id").notNull().default(1).references(() => organizations.id),
});
export const insertEngStageTemplateSchema = createInsertSchema(engStageTemplates).omit({ id: true, createdAt: true, organizationId: true } as any);
export type InsertEngStageTemplate = z.infer<typeof insertEngStageTemplateSchema>;
export type EngStageTemplate = typeof engStageTemplates.$inferSelect;

export const engTaskTemplates = pgTable("eng_task_templates", {
  id: serial("id").primaryKey(),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  sequence: integer("sequence").notNull().default(0),
  defaultOwnerRole: text("default_owner_role"),
});
export const insertEngTaskTemplateSchema = createInsertSchema(engTaskTemplates).omit({ id: true } as any);
export type InsertEngTaskTemplate = z.infer<typeof insertEngTaskTemplateSchema>;
export type EngTaskTemplate = typeof engTaskTemplates.$inferSelect;

export const engDeliverableTemplates = pgTable("eng_deliverable_templates", {
  id: serial("id").primaryKey(),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  allowedFileTypes: text("allowed_file_types").array(),
  requiredCount: integer("required_count").notNull().default(1),
});
export const insertEngDeliverableTemplateSchema = createInsertSchema(engDeliverableTemplates).omit({ id: true } as any);
export type InsertEngDeliverableTemplate = z.infer<typeof insertEngDeliverableTemplateSchema>;
export type EngDeliverableTemplate = typeof engDeliverableTemplates.$inferSelect;

export const projectEngStages = pgTable("project_eng_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id),
  status: engStageStatusEnum("status").notNull().default('not_started'),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  overrideReason: text("override_reason"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngStageSchema = createInsertSchema(projectEngStages).omit({ id: true, createdAt: true } as any);
export type InsertProjectEngStage = z.infer<typeof insertProjectEngStageSchema>;
export type ProjectEngStage = typeof projectEngStages.$inferSelect;

export const projectEngTasks = pgTable("project_eng_tasks", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  taskTemplateId: integer("task_template_id").notNull().references(() => engTaskTemplates.id),
  status: engTaskInstanceStatusEnum("status").notNull().default('pending'),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  notes: text("notes"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id),
  hasDeliverable: boolean("has_deliverable").notNull().default(false),
  workItemId: integer("work_item_id").references(() => workItems.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngTaskSchema = createInsertSchema(projectEngTasks).omit({ id: true, createdAt: true } as any);
export type InsertProjectEngTask = z.infer<typeof insertProjectEngTaskSchema>;
export type ProjectEngTask = typeof projectEngTasks.$inferSelect;

export const projectEngDeliverables = pgTable("project_eng_deliverables", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  deliverableTemplateId: integer("deliverable_template_id").references(() => engDeliverableTemplates.id),
  projectEngTaskId: integer("project_eng_task_id").references(() => projectEngTasks.id, { onDelete: 'set null' }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageRef: text("storage_ref").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  versionTag: text("version_tag"),
  notes: text("notes"),
  sharepointFolderPath: text("sharepoint_folder_path"),
  approvalStatus: text("approval_status").default("pending"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
});
export const insertProjectEngDeliverableSchema = createInsertSchema(projectEngDeliverables).omit({ id: true, uploadedAt: true } as any);
export type InsertProjectEngDeliverable = z.infer<typeof insertProjectEngDeliverableSchema>;
export type ProjectEngDeliverable = typeof projectEngDeliverables.$inferSelect;

export const projectEngApprovals = pgTable("project_eng_approvals", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  approverRole: text("approver_role").notNull(),
  approverUserId: integer("approver_user_id").references(() => users.id),
  status: engApprovalStatusEnum("status").notNull().default('pending'),
  comments: text("comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProjectEngApprovalSchema = createInsertSchema(projectEngApprovals).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectEngApproval = z.infer<typeof insertProjectEngApprovalSchema>;
export type ProjectEngApproval = typeof projectEngApprovals.$inferSelect;
