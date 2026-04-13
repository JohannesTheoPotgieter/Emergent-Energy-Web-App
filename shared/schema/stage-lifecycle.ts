// ============================================================
// STAGE LIFECYCLE SCHEMA — Gate-driven 10-stage project lifecycle
// ============================================================
// Tables: stage_definitions, stage_checklist_templates,
//   project_stage_instances, project_stage_requirements,
//   project_stage_evidence, project_stage_decisions,
//   project_stage_exceptions, project_stage_dependencies
// ============================================================

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// ===================== CONSTANTS =====================

export const STAGE_CODES = [
  'S01_FIRST_ASSESSMENT',
  'S02_DESIGN_COST_PROPOSAL',
  'S03_SIGNATURE_FINANCIAL_CLOSE',
  'S04_PD_PM_HANDOVER',
  'S05_FINANCIAL_REVIEW',
  'S06_CONSTRUCTION',
  'S07_COMMISSIONING',
  'S08_OM_HANDOVER',
  'S09_CLIENT_HANDOVER',
  'S10_POST_HANDOVER_REVIEW',
] as const;
export type StageCode = typeof STAGE_CODES[number];

export const STAGE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'APPROVED',
  'PROGRESSED',
  'EXCEPTION_APPROVED',
  'BLOCKED',
] as const;
export type StageStatus = typeof STAGE_STATUSES[number];

export const LIFECYCLE_DEPARTMENTS = [
  'PD',
  'ENGINEERING',
  'PM',
  'CONSTRUCTION',
  'QUALITY',
  'FINANCE',
  'HSE',
  'COMPLIANCE',
  'PROCUREMENT',
  'KAM',
  'OM',
  'EXCO',
] as const;
export type LifecycleDepartment = typeof LIFECYCLE_DEPARTMENTS[number];

export const REQUIREMENT_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETE',
  'NOT_APPLICABLE',
  'WAIVED',
] as const;
export type RequirementStatus = typeof REQUIREMENT_STATUSES[number];

export const EXCEPTION_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'CLOSED',
  'RE_OPENED',
] as const;
export type ExceptionStatus = typeof EXCEPTION_STATUSES[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = typeof RISK_LEVELS[number];

export const DECISION_TYPES = [
  'GATE_PASS',
  'GATE_FAIL',
  'EXCEPTION_GRANTED',
  'EXCEPTION_DENIED',
  'STAGE_OVERRIDE',
  'STAGE_ROLLBACK',
] as const;
export type DecisionType = typeof DECISION_TYPES[number];

export const DEPENDENCY_STATUSES = [
  'WAITING',
  'RESOLVED',
  'ESCALATED',
  'BYPASSED',
] as const;
export type DependencyStatus = typeof DEPENDENCY_STATUSES[number];

// ===================== STAGE DEFINITIONS =====================
// Admin-managed stage configuration, seeded with 10 stages

export const stageDefinitions = pgTable("stage_definitions", {
  id: serial("id").primaryKey(),
  stageCode: text("stage_code").notNull().unique(),
  stageName: text("stage_name").notNull(),
  stageSequence: integer("stage_sequence").notNull(),
  description: text("description"),
  defaultOwnerRole: text("default_owner_role"),
  defaultApproverRole: text("default_approver_role"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});

export const insertStageDefinitionSchema = createInsertSchema(stageDefinitions).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertStageDefinition = z.infer<typeof insertStageDefinitionSchema>;
export type StageDefinition = typeof stageDefinitions.$inferSelect;

// ===================== STAGE CHECKLIST TEMPLATES =====================
// Admin-managed default checklists per stage per department

export const stageChecklistTemplates = pgTable("stage_checklist_templates", {
  id: serial("id").primaryKey(),
  stageCode: text("stage_code").notNull(),
  department: text("department").notNull(),
  itemName: text("item_name").notNull(),
  itemCode: text("item_code").notNull(),
  blocksGate: boolean("blocks_gate").notNull().default(false),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  // Template governance
  version: integer("version").notNull().default(1),
  isCurrentVersion: boolean("is_current_version").notNull().default(true),
  isSystemDefault: boolean("is_system_default").notNull().default(false),
  editedBy: integer("edited_by"),
  editedAt: timestamp("edited_at"),
  editReason: text("edit_reason"),
});

export const insertStageChecklistTemplateSchema = createInsertSchema(stageChecklistTemplates).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertStageChecklistTemplate = z.infer<typeof insertStageChecklistTemplateSchema>;
export type StageChecklistTemplate = typeof stageChecklistTemplates.$inferSelect;

// ===================== PROJECT STAGE INSTANCES =====================
// One row per project per stage (10 rows per project)

export const projectStageInstances = pgTable("project_stage_instances", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  stageStatus: text("stage_status").notNull().default("NOT_STARTED"),
  stageOwnerUserId: integer("stage_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  approverUserId: integer("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  readinessPct: integer("readiness_pct").notNull().default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  targetExitDate: date("target_exit_date"),
  waitingOnDepartment: text("waiting_on_department"),
  waitingOnUserId: integer("waiting_on_user_id").references(() => users.id, { onDelete: "set null" }),
  nextRequiredAction: text("next_required_action"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectStageUnique: unique("project_stage_instances_project_stage_uq").on(table.projectId, table.stageCode),
  projectIdIdx: index("psi_project_id_idx").on(table.projectId),
  stageStatusIdx: index("psi_stage_status_idx").on(table.stageStatus),
}));

export const insertProjectStageInstanceSchema = createInsertSchema(projectStageInstances).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectStageInstance = z.infer<typeof insertProjectStageInstanceSchema>;
export type ProjectStageInstance = typeof projectStageInstances.$inferSelect;

// ===================== PROJECT STAGE REQUIREMENTS =====================
// Checklist items per stage per department

export const projectStageRequirements = pgTable("project_stage_requirements", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageInstanceId: integer("stage_instance_id").notNull().references(() => projectStageInstances.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  department: text("department").notNull(),
  itemName: text("item_name").notNull(),
  itemCode: text("item_code").notNull(),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  status: text("status").notNull().default("NOT_STARTED"),
  blocksGate: boolean("blocks_gate").notNull().default(false),
  evidenceUrl: text("evidence_url"),
  evidenceAttached: boolean("evidence_attached").notNull().default(false),
  completedByUserId: integer("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedDate: timestamp("completed_date"),
  contributors: jsonb("contributors").default([]),  // Array of { userId, department, name }
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  stageInstanceIdx: index("psr_stage_instance_idx").on(table.stageInstanceId),
  departmentIdx: index("psr_department_idx").on(table.department),
  statusIdx: index("psr_status_idx").on(table.status),
}));

export const insertProjectStageRequirementSchema = createInsertSchema(projectStageRequirements).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectStageRequirement = z.infer<typeof insertProjectStageRequirementSchema>;
export type ProjectStageRequirement = typeof projectStageRequirements.$inferSelect;

// ===================== PROJECT STAGE EVIDENCE =====================
// Evidence documents per stage

export const projectStageEvidence = pgTable("project_stage_evidence", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageInstanceId: integer("stage_instance_id").notNull().references(() => projectStageInstances.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  evidenceType: text("evidence_type"),   // 'document', 'photo', 'certificate', 'approval', 'minutes', 'report'
  title: text("title").notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  inheritedFromStage: text("inherited_from_stage"),
  reviewStatus: text("review_status").default("pending"),   // 'pending', 'reviewed', 'accepted', 'rejected'
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
});

export const insertProjectStageEvidenceSchema = createInsertSchema(projectStageEvidence).omit({ id: true, uploadedAt: true } as any);
export type InsertProjectStageEvidence = z.infer<typeof insertProjectStageEvidenceSchema>;
export type ProjectStageEvidence = typeof projectStageEvidence.$inferSelect;

// ===================== PROJECT STAGE DECISIONS =====================
// Decision register — log once, visible downstream

export const projectStageDecisions = pgTable("project_stage_decisions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  decisionType: text("decision_type").notNull(),
  decisionSummary: text("decision_summary").notNull(),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedDate: timestamp("decided_date").notNull().defaultNow(),
  rationale: text("rationale"),
  impactedDepartments: jsonb("impacted_departments").default([]),
  impactedDownstreamStages: jsonb("impacted_downstream_stages").default([]),
  evidenceUrl: text("evidence_url"),
  relatedExceptionId: integer("related_exception_id"),   // FK added after exceptions table
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectStageDecisionSchema = createInsertSchema(projectStageDecisions).omit({ id: true, createdAt: true } as any);
export type InsertProjectStageDecision = z.infer<typeof insertProjectStageDecisionSchema>;
export type ProjectStageDecision = typeof projectStageDecisions.$inferSelect;

// ===================== PROJECT STAGE EXCEPTIONS =====================
// Exception/bypass records

export const projectStageExceptions = pgTable("project_stage_exceptions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  requirementCode: text("requirement_code"),
  reasonText: text("reason_text").notNull(),
  riskLevel: text("risk_level").notNull().default("MEDIUM"),
  mitigationText: text("mitigation_text"),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  approverUserId: integer("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("REQUESTED"),
  conditionsText: text("conditions_text"),
  closeoutDueDate: date("closeout_due_date"),
  downstreamBlockingStage: text("downstream_blocking_stage"),
  approvedAt: timestamp("approved_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("pse_project_id_idx").on(table.projectId),
  statusIdx: index("pse_status_idx").on(table.status),
}));

export const insertProjectStageExceptionSchema = createInsertSchema(projectStageExceptions).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectStageException = z.infer<typeof insertProjectStageExceptionSchema>;
export type ProjectStageException = typeof projectStageExceptions.$inferSelect;

// ===================== PROJECT STAGE DEPENDENCIES =====================
// Cross-department waiting-on tracking

export const projectStageDependencies = pgTable("project_stage_dependencies", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  fromDepartment: text("from_department").notNull(),
  fromUserId: integer("from_user_id").references(() => users.id, { onDelete: "set null" }),
  toDepartment: text("to_department").notNull(),
  toUserId: integer("to_user_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("WAITING"),
  escalated: boolean("escalated").notNull().default(false),
  escalationReason: text("escalation_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ({
  projectIdIdx: index("psd_project_id_idx").on(table.projectId),
  statusIdx: index("psd_status_idx").on(table.status),
}));

export const insertProjectStageDependencySchema = createInsertSchema(projectStageDependencies).omit({ id: true, createdAt: true } as any);
export type InsertProjectStageDependency = z.infer<typeof insertProjectStageDependencySchema>;
export type ProjectStageDependency = typeof projectStageDependencies.$inferSelect;

// ===================== STAGE GATE EVIDENCE SNAPSHOTS =====================
// B1 (audit closeout) — Audit-only capture of what was present at the moment
// of every stage transition. NOT a blocker. Stage transitions always proceed;
// this table records what evidence was captured vs missing so post-mortems can
// explain why a project went sideways.
//
// Population sources:
//   - transitionStageStatus() — writes one row per transition (approved,
//     progressed, gate_fail). Even when blockers are missing, the transition
//     proceeds and this row records the gap.
//   - advanceToStage() — writes one row per stage the admin bulk-advances so
//     the "why was this advanced without evidence" trail is preserved.

export const TRAFFIC_LIGHTS = ['green', 'amber', 'red'] as const;
export type TrafficLight = typeof TRAFFIC_LIGHTS[number];

export const STAGE_GATE_TRANSITION_TYPES = ['gate_approved', 'gate_progressed', 'admin_advance', 'gate_fail_audit'] as const;
export type StageGateTransitionType = typeof STAGE_GATE_TRANSITION_TYPES[number];

export const stageGateEvidenceSnapshots = pgTable("stage_gate_evidence_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  fromStageCode: text("from_stage_code").notNull(),
  toStageCode: text("to_stage_code").notNull(),
  transitionType: text("transition_type").notNull(),         // 'gate_approved' | 'gate_progressed' | 'admin_advance' | 'gate_fail_audit'
  advancedByUserId: integer("advanced_by_user_id").references(() => users.id, { onDelete: "set null" }),
  advancedAt: timestamp("advanced_at").notNull().defaultNow(),
  // Quantitative readiness
  readinessScore: integer("readiness_score").notNull(),      // 0..100 integer
  gatesTotal: integer("gates_total").notNull(),
  gatesPassed: integer("gates_passed").notNull(),
  gatesMissing: integer("gates_missing").notNull(),
  blockersSatisfied: boolean("blockers_satisfied").notNull(),
  trafficLight: text("traffic_light").notNull(),             // 'green' | 'amber' | 'red'
  // Detailed evidence snapshot
  requirementsSnapshot: jsonb("requirements_snapshot").notNull().default([]),
  // Shape: [{itemCode, itemName, department, status, blocksGate, evidenceAttached, notes?}]
  missingItems: jsonb("missing_items").notNull().default([]),
  // Shape: [{itemCode, itemName, department, reason}]
  reason: text("reason"),                                    // Free-text why advanced
  notes: text("notes"),                                      // Optional context
}, (table) => ({
  projectIdIdx: index("sges_project_id_idx").on(table.projectId),
  advancedAtIdx: index("sges_advanced_at_idx").on(table.advancedAt),
  fromStageIdx: index("sges_from_stage_idx").on(table.fromStageCode),
  trafficLightIdx: index("sges_traffic_light_idx").on(table.trafficLight),
}));

export const insertStageGateEvidenceSnapshotSchema = createInsertSchema(stageGateEvidenceSnapshots).omit({ id: true, advancedAt: true } as any);
export type InsertStageGateEvidenceSnapshot = z.infer<typeof insertStageGateEvidenceSnapshotSchema>;
export type StageGateEvidenceSnapshot = typeof stageGateEvidenceSnapshots.$inferSelect;

// ===================== PROJECT ACCESS =====================
// Project-level access control (Layer 2 of 3-layer permission model)

export const ACCESS_LEVELS = ['owner', 'contributor', 'viewer', 'none'] as const;
export type AccessLevel = typeof ACCESS_LEVELS[number];

export const PROJECT_ROLES = [
  'pm', 'pd', 'construction_manager', 'quality_lead', 'compliance',
  'kam', 'finance', 'engineering', 'hse', 'om',
] as const;
export type ProjectRole = typeof PROJECT_ROLES[number];

export const projectAccess = pgTable("project_access", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessLevel: text("access_level").notNull().default("viewer"),
  roleOnProject: text("role_on_project"),
  stagesVisible: text("stages_visible").array().notNull().default([]),   // empty = 'all'
  canEdit: boolean("can_edit").notNull().default(false),
  canApprove: boolean("can_approve").notNull().default(false),
  grantedByUserId: integer("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
}, (table) => ({
  projectUserUnique: unique("project_access_project_user_uq").on(table.projectId, table.userId),
  projectIdIdx: index("pa_project_id_idx").on(table.projectId),
  userIdIdx: index("pa_user_id_idx").on(table.userId),
}));

export const insertProjectAccessSchema = createInsertSchema(projectAccess).omit({ id: true, grantedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertProjectAccess = z.infer<typeof insertProjectAccessSchema>;
export type ProjectAccess = typeof projectAccess.$inferSelect;
