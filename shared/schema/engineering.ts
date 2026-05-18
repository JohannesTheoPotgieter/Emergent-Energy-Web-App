import { pgTable, text, integer, timestamp, pgEnum, serial, boolean, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo } from "./projects";
import { workItems } from "./tasks";

// ===================== ENGINEERING DELIVERABLES =====================

// C6: canonical lowercase_underscore.
export const DELIVERABLE_STATUSES = [
  "to_do", "in_progress", "needs_approval", "provide_feedback",
  "qc_approved", "operational_approval", "complete"
] as const;
export type DeliverableStatus = typeof DELIVERABLE_STATUSES[number];

export const deliverables = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  deliverableType: text("deliverable_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  phase: text("phase"),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  qcReviewerUserId: integer("qc_reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("to_do"),
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
export const insertDeliverableSchema = createInsertSchema(deliverables).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeliverable = z.infer<typeof insertDeliverableSchema>;
export type Deliverable = typeof deliverables.$inferSelect;

export const deliverableVersions = pgTable("deliverable_versions", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  versionNumber: integer("version_number").notNull(),
  changeReason: text("change_reason"),
  impactJson: jsonb("impact_json"),
  status: text("status").notNull().default("in_progress"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableVersionSchema = createInsertSchema(deliverableVersions).omit({ id: true, createdAt: true });
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
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
export const insertDeliverableFileSchema = createInsertSchema(deliverableFiles).omit({ id: true, uploadedAt: true });
export type InsertDeliverableFile = z.infer<typeof insertDeliverableFileSchema>;
export type DeliverableFile = typeof deliverableFiles.$inferSelect;

export const deliverableEvents = pgTable("deliverable_events", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  feedbackText: text("feedback_text"),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableEventSchema = createInsertSchema(deliverableEvents).omit({ id: true, createdAt: true });
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
  /**
   * Human-readable definition of done for the stage. Shown in UI next to the
   * gate; consulted by engineers to know what "complete" means. Additive —
   * legacy rows stay null.
   */
  definitionOfDone: text("definition_of_done").array(),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertEngStageTemplateSchema = createInsertSchema(engStageTemplates).omit({ id: true, createdAt: true });
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
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by").references(() => users.id, { onDelete: "set null" }),
});
export const insertEngTaskTemplateSchema = createInsertSchema(engTaskTemplates).omit({ id: true });
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
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by").references(() => users.id, { onDelete: "set null" }),
});
export const insertEngDeliverableTemplateSchema = createInsertSchema(engDeliverableTemplates).omit({ id: true });
export type InsertEngDeliverableTemplate = z.infer<typeof insertEngDeliverableTemplateSchema>;
export type EngDeliverableTemplate = typeof engDeliverableTemplates.$inferSelect;

export const projectEngStages = pgTable("project_eng_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id),
  status: engStageStatusEnum("status").notNull().default('not_started'),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  /** Set when the stage passes the IFC-issuance gate (rules.requireIfcIssuance). */
  ifcIssuedAt: timestamp("ifc_issued_at"),
  /** Set when the handover pack is marked handover-ready. */
  handoverReadyAt: timestamp("handover_ready_at"),
  overrideReason: text("override_reason"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngStageSchema = createInsertSchema(projectEngStages).omit({ id: true, createdAt: true });
export type InsertProjectEngStage = z.infer<typeof insertProjectEngStageSchema>;
export type ProjectEngStage = typeof projectEngStages.$inferSelect;

export const projectEngTasks = pgTable("project_eng_tasks", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  taskTemplateId: integer("task_template_id").notNull().references(() => engTaskTemplates.id),
  status: engTaskInstanceStatusEnum("status").notNull().default('pending'),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id, { onDelete: "set null" }),
  hasDeliverable: boolean("has_deliverable").notNull().default(false),
  workItemId: integer("work_item_id").references(() => workItems.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngTaskSchema = createInsertSchema(projectEngTasks).omit({ id: true, createdAt: true });
export type InsertProjectEngTask = z.infer<typeof insertProjectEngTaskSchema>;
export type ProjectEngTask = typeof projectEngTasks.$inferSelect;

/**
 * Controlled-document lifecycle for engineering deliverables.
 *
 * NOTE: this is intentionally distinct from `approvalStatus`. `approvalStatus`
 * is the QA/gate field ("has a reviewer signed this off?"). `releasedFor` is
 * the controlled-document field ("what is this drawing allowed to be used
 * for?"). A deliverable can be `approvalStatus='approved'` and still be
 * `releasedFor='under_review'`; **approval alone never implies issue for
 * construction**.
 *
 * Allowed transitions (enforced in server/eng-stage-routes.ts):
 *   draft → under_review → approved_for_review → issued_for_construction
 *                                                       ↓
 *                                                  as_built | superseded
 */
export const RELEASED_FOR_STATES = [
  "draft",
  "under_review",
  "approved_for_review",
  "issued_for_construction",
  "as_built",
  "superseded",
] as const;
export type ReleasedForState = typeof RELEASED_FOR_STATES[number];

export const RELEASED_FOR_TRANSITIONS: Record<ReleasedForState, ReleasedForState[]> = {
  draft: ["under_review", "superseded"],
  under_review: ["draft", "approved_for_review", "superseded"],
  approved_for_review: ["under_review", "issued_for_construction", "superseded"],
  issued_for_construction: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

export const projectEngDeliverables = pgTable("project_eng_deliverables", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  deliverableTemplateId: integer("deliverable_template_id").references(() => engDeliverableTemplates.id),
  projectEngTaskId: integer("project_eng_task_id").references(() => projectEngTasks.id, { onDelete: 'set null' }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageRef: text("storage_ref").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  versionTag: text("version_tag"),
  notes: text("notes"),
  sharepointFolderPath: text("sharepoint_folder_path"),
  approvalStatus: text("approval_status").default("pending"),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  // Controlled-document lifecycle (see RELEASED_FOR_STATES above).
  releasedFor: text("released_for").notNull().default("draft"),
  issuedForConstructionAt: timestamp("issued_for_construction_at"),
  issuedForConstructionBy: integer("issued_for_construction_by").references(() => users.id, { onDelete: "set null" }),
  asBuiltAt: timestamp("as_built_at"),
  asBuiltBy: integer("as_built_by").references(() => users.id, { onDelete: "set null" }),
  supersededById: integer("superseded_by_id"),
});
export const insertProjectEngDeliverableSchema = createInsertSchema(projectEngDeliverables).omit({ id: true, uploadedAt: true });
export type InsertProjectEngDeliverable = z.infer<typeof insertProjectEngDeliverableSchema>;
export type ProjectEngDeliverable = typeof projectEngDeliverables.$inferSelect;

export const projectEngApprovals = pgTable("project_eng_approvals", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  approverRole: text("approver_role").notNull(),
  approverUserId: integer("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  status: engApprovalStatusEnum("status").notNull().default('pending'),
  comments: text("comments"),
  scheduledDate: date("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProjectEngApprovalSchema = createInsertSchema(projectEngApprovals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectEngApproval = z.infer<typeof insertProjectEngApprovalSchema>;
export type ProjectEngApproval = typeof projectEngApprovals.$inferSelect;

// ===================== DRAWING REGISTER =====================

export const DRAWING_STATUSES = [
  "draft",
  "for_review",
  "for_approval",
  "approved",
  "ifc",
  "as_built",
  "superseded",
] as const;
export type DrawingStatus = typeof DRAWING_STATUSES[number];

/**
 * Allowed transitions for drawing_register.status. Enforced in
 * server/departments/drawing-register-routes.ts. "approved" is intentionally
 * NOT the same as "ifc" — approval is a review signoff, ifc is a controlled
 * release for construction use.
 */
export const DRAWING_STATUS_TRANSITIONS: Record<DrawingStatus, DrawingStatus[]> = {
  draft: ["for_review", "superseded"],
  for_review: ["draft", "for_approval", "superseded"],
  for_approval: ["for_review", "approved", "superseded"],
  approved: ["ifc", "for_review", "superseded"],
  ifc: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

export const drawingRegister = pgTable("drawing_register", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  drawingNumber: text("drawing_number").notNull(),
  title: text("title").notNull(),
  discipline: text("discipline"),           // 'electrical', 'structural', 'mechanical', 'civil', 'architectural'
  currentRevision: text("current_revision").default("A"),
  revisionDate: date("revision_date"),
  status: text("status").default("draft"),  // see DRAWING_STATUSES
  authorUserId: integer("author_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  approverUserId: integer("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  sharepointLink: text("sharepoint_link"),
  sheetSize: text("sheet_size"),
  notes: text("notes"),
  issuedForConstructionAt: timestamp("issued_for_construction_at"),
  issuedForConstructionBy: integer("issued_for_construction_by").references(() => users.id, { onDelete: "set null" }),
  asBuiltAt: timestamp("as_built_at"),
  asBuiltBy: integer("as_built_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertDrawingRegisterSchema = createInsertSchema(drawingRegister).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDrawingRegister = z.infer<typeof insertDrawingRegisterSchema>;
export type DrawingRegister = typeof drawingRegister.$inferSelect;

export const drawingRevisions = pgTable("drawing_revisions", {
  id: serial("id").primaryKey(),
  drawingId: integer("drawing_id").notNull().references(() => drawingRegister.id),
  revision: text("revision").notNull(),
  revisionDate: date("revision_date").notNull(),
  description: text("description"),
  revisedByUserId: integer("revised_by_user_id").references(() => users.id, { onDelete: "set null" }),
  sharepointLink: text("sharepoint_link"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DrawingRevision = typeof drawingRevisions.$inferSelect;

// ===================== TRANSMITTAL REGISTER =====================
//
// Records each formal issue event: "this document was issued to
// recipient X for purpose Y on date Z with transmittal number N".
// This is the engineering equivalent of a shipping manifest — it
// proves that the right version of the right document reached the
// right person for the right reason, with an audit trail.
//
// A single transmittal can cover multiple deliverables (e.g., "IFC
// Drawing Pack for Solar Farm Phase 1" may contain 12 drawings).

export const TRANSMITTAL_PURPOSES = [
  "for_information",
  "for_review",
  "for_approval",
  "for_construction",
  "for_procurement",
  "for_as_built_record",
  "for_handover",
] as const;
export type TransmittalPurpose = typeof TRANSMITTAL_PURPOSES[number];

export const engTransmittals = pgTable("eng_transmittals", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  transmittalNumber: text("transmittal_number").notNull(),
  title: text("title").notNull(),
  purpose: text("purpose").notNull(),           // see TRANSMITTAL_PURPOSES
  recipientName: text("recipient_name").notNull(),
  recipientOrg: text("recipient_org"),           // external org name if applicable
  recipientUserId: integer("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  issuedByUserId: integer("issued_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  notes: text("notes"),
  // Optional link to the stage this transmittal belongs to
  projectEngStageId: integer("project_eng_stage_id").references(() => projectEngStages.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertEngTransmittalSchema = createInsertSchema(engTransmittals).omit({ id: true, createdAt: true });
export type InsertEngTransmittal = z.infer<typeof insertEngTransmittalSchema>;
export type EngTransmittal = typeof engTransmittals.$inferSelect;

/** Join table: which deliverables and/or drawings were included in a transmittal. */
export const engTransmittalItems = pgTable("eng_transmittal_items", {
  id: serial("id").primaryKey(),
  transmittalId: integer("transmittal_id").notNull().references(() => engTransmittals.id, { onDelete: "cascade" }),
  deliverableId: integer("deliverable_id").references(() => projectEngDeliverables.id, { onDelete: "set null" }),
  drawingId: integer("drawing_id").references(() => drawingRegister.id, { onDelete: "set null" }),
  revision: text("revision"),                    // revision at time of issue
  releasedForAtIssue: text("released_for_at_issue"), // snapshot of releasedFor at time of transmittal
  notes: text("notes"),
});
export const insertEngTransmittalItemSchema = createInsertSchema(engTransmittalItems).omit({ id: true });
export type InsertEngTransmittalItem = z.infer<typeof insertEngTransmittalItemSchema>;
export type EngTransmittalItem = typeof engTransmittalItems.$inferSelect;
