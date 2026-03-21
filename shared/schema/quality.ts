import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users, organizations } from "./users";
import { projectInfo } from "./projects";

// ===================== QUALITY MODULE TABLES =====================

export const qcTemplate = pgTable("qc_template", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Multi-tenancy (Prompt 11)
  organizationId: integer("organization_id").notNull().default(1).references(() => organizations.id),
});
export const insertQcTemplateSchema = createInsertSchema(qcTemplate).omit({ id: true, createdAt: true, organizationId: true } as any);
export type InsertQcTemplate = z.infer<typeof insertQcTemplateSchema>;
export type QcTemplate = typeof qcTemplate.$inferSelect;

export const qcTemplatePhase = pgTable("qc_template_phase", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => qcTemplate.id, { onDelete: 'cascade' }),
  phaseKey: text("phase_key").notNull(),
  phaseName: text("phase_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertQcTemplatePhaseSchema = createInsertSchema(qcTemplatePhase).omit({ id: true } as any);
export type InsertQcTemplatePhase = z.infer<typeof insertQcTemplatePhaseSchema>;
export type QcTemplatePhase = typeof qcTemplatePhase.$inferSelect;

export const qcTemplateGroup = pgTable("qc_template_group", {
  id: serial("id").primaryKey(),
  templatePhaseId: integer("template_phase_id").notNull().references(() => qcTemplatePhase.id, { onDelete: 'cascade' }),
  groupName: text("group_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertQcTemplateGroupSchema = createInsertSchema(qcTemplateGroup).omit({ id: true } as any);
export type InsertQcTemplateGroup = z.infer<typeof insertQcTemplateGroupSchema>;
export type QcTemplateGroup = typeof qcTemplateGroup.$inferSelect;

export const qcTemplateItem = pgTable("qc_template_item", {
  id: serial("id").primaryKey(),
  templateGroupId: integer("template_group_id").notNull().references(() => qcTemplateGroup.id, { onDelete: 'cascade' }),
  itemName: text("item_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isEvidenceRequired: boolean("is_evidence_required").notNull().default(false),
  defaultSeverity: text("default_severity").notNull().default("Medium"),
});
export const insertQcTemplateItemSchema = createInsertSchema(qcTemplateItem).omit({ id: true } as any);
export type InsertQcTemplateItem = z.infer<typeof insertQcTemplateItemSchema>;
export type QcTemplateItem = typeof qcTemplateItem.$inferSelect;

export const qcTemplateRiskQuestion = pgTable("qc_template_risk_question", {
  id: serial("id").primaryKey(),
  templatePhaseId: integer("template_phase_id").notNull().references(() => qcTemplatePhase.id, { onDelete: 'cascade' }),
  questionText: text("question_text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  responseType: text("response_type").notNull().default("yesno"),
  triggersWarning: boolean("triggers_warning").notNull().default(false),
  triggerCondition: text("trigger_condition").default("yes"),
  triggerSeverity: text("trigger_severity").default("Medium"),
});
export const insertQcTemplateRiskQuestionSchema = createInsertSchema(qcTemplateRiskQuestion).omit({ id: true } as any);
export type InsertQcTemplateRiskQuestion = z.infer<typeof insertQcTemplateRiskQuestionSchema>;
export type QcTemplateRiskQuestion = typeof qcTemplateRiskQuestion.$inferSelect;

export const qcTemplatePostmortemMetric = pgTable("qc_template_postmortem_metric", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inputType: text("input_type").notNull().default("count"),
  scoringRuleJson: jsonb("scoring_rule_json"),
  metricGroup: text("metric_group").notNull().default("contractor_quality"),
});
export const insertQcTemplatePostmortemMetricSchema = createInsertSchema(qcTemplatePostmortemMetric).omit({ id: true } as any);
export type InsertQcTemplatePostmortemMetric = z.infer<typeof insertQcTemplatePostmortemMetricSchema>;
export type QcTemplatePostmortemMetric = typeof qcTemplatePostmortemMetric.$inferSelect;

export const qcChecklist = pgTable("qc_checklist", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  templateId: integer("template_id").notNull().references(() => qcTemplate.id),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcChecklistSchema = createInsertSchema(qcChecklist).omit({ id: true, createdAt: true } as any);
export type InsertQcChecklist = z.infer<typeof insertQcChecklistSchema>;
export type QcChecklist = typeof qcChecklist.$inferSelect;

export const qcItemInstance = pgTable("qc_item_instance", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => qcChecklist.id, { onDelete: 'cascade' }),
  templateItemId: integer("template_item_id").notNull().references(() => qcTemplateItem.id),
  isApplicable: boolean("is_applicable").notNull().default(true),
  startDate: text("start_date"),
  endDate: text("end_date"),
  approved: boolean("approved").notNull().default(false),
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  approvalComment: text("approval_comment"),
  notApplicableReason: text("not_applicable_reason"),
  workingDays: integer("working_days"),
  allowedWorkingDays: integer("allowed_working_days"),
  qmStatus: text("qm_status").notNull().default("not_started"),
  assigneeUserId: integer("assignee_user_id").references(() => users.id),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
});
export const insertQcItemInstanceSchema = createInsertSchema(qcItemInstance).omit({ id: true, lastUpdatedAt: true } as any);
export type InsertQcItemInstance = z.infer<typeof insertQcItemInstanceSchema>;
export type QcItemInstance = typeof qcItemInstance.$inferSelect;

export const qcItemEvidence = pgTable("qc_item_evidence", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: 'cascade' }),
  itemInstanceId: integer("item_instance_id").notNull().references(() => qcItemInstance.id, { onDelete: 'cascade' }),
  evidenceUrl: text("evidence_url").notNull(),
  evidenceNote: text("evidence_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcItemEvidenceSchema = createInsertSchema(qcItemEvidence).omit({ id: true, createdAt: true } as any);
export type InsertQcItemEvidence = z.infer<typeof insertQcItemEvidenceSchema>;
export type QcItemEvidence = typeof qcItemEvidence.$inferSelect;

export const qcRiskAnswer = pgTable("qc_risk_answer", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => qcChecklist.id, { onDelete: 'cascade' }),
  templateRiskQuestionId: integer("template_risk_question_id").notNull().references(() => qcTemplateRiskQuestion.id),
  answerYesno: boolean("answer_yesno"),
  answerText: text("answer_text"),
  answerNumber: real("answer_number"),
  lastUpdatedBy: integer("last_updated_by"),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
});
export const insertQcRiskAnswerSchema = createInsertSchema(qcRiskAnswer).omit({ id: true, lastUpdatedAt: true } as any);
export type InsertQcRiskAnswer = z.infer<typeof insertQcRiskAnswerSchema>;
export type QcRiskAnswer = typeof qcRiskAnswer.$inferSelect;

export const qcPlanLink = pgTable("qc_plan_link", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  planItemId: integer("plan_item_id").notNull(),
  itemInstanceId: integer("item_instance_id"),
  phaseId: integer("phase_id"),
  linkType: text("link_type").notNull().default("phase_task"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcPlanLinkSchema = createInsertSchema(qcPlanLink).omit({ id: true, createdAt: true } as any);
export type InsertQcPlanLink = z.infer<typeof insertQcPlanLinkSchema>;
export type QcPlanLink = typeof qcPlanLink.$inferSelect;

export const qcWarning = pgTable("qc_warning", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  severity: text("severity").notNull().default("Medium"),
  warningType: text("warning_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  relatedPlanItemId: integer("related_plan_item_id"),
  relatedItemInstanceId: integer("related_item_instance_id"),
  status: text("status").notNull().default("open"),
  ownerUserId: integer("owner_user_id"),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertQcWarningSchema = createInsertSchema(qcWarning).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertQcWarning = z.infer<typeof insertQcWarningSchema>;
export type QcWarning = typeof qcWarning.$inferSelect;

export const qcWarningEvent = pgTable("qc_warning_event", {
  id: serial("id").primaryKey(),
  warningId: integer("warning_id").notNull().references(() => qcWarning.id, { onDelete: 'cascade' }),
  eventType: text("event_type").notNull(),
  note: text("note"),
  actorUserId: integer("actor_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcWarningEventSchema = createInsertSchema(qcWarningEvent).omit({ id: true, createdAt: true } as any);
export type InsertQcWarningEvent = z.infer<typeof insertQcWarningEventSchema>;
export type QcWarningEvent = typeof qcWarningEvent.$inferSelect;

export const qcPostmortem = pgTable("qc_postmortem", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcPostmortemSchema = createInsertSchema(qcPostmortem).omit({ id: true, createdAt: true } as any);
export type InsertQcPostmortem = z.infer<typeof insertQcPostmortemSchema>;
export type QcPostmortem = typeof qcPostmortem.$inferSelect;

export const qcPostmortemMetricValue = pgTable("qc_postmortem_metric_value", {
  id: serial("id").primaryKey(),
  postmortemId: integer("postmortem_id").notNull().references(() => qcPostmortem.id, { onDelete: 'cascade' }),
  templateMetricId: integer("template_metric_id").notNull().references(() => qcTemplatePostmortemMetric.id),
  inputValueNumber: real("input_value_number"),
  inputValueChoice: text("input_value_choice"),
  score: real("score"),
});
export const insertQcPostmortemMetricValueSchema = createInsertSchema(qcPostmortemMetricValue).omit({ id: true } as any);
export type InsertQcPostmortemMetricValue = z.infer<typeof insertQcPostmortemMetricValueSchema>;
export type QcPostmortemMetricValue = typeof qcPostmortemMetricValue.$inferSelect;

export const qcPostmortemSummary = pgTable("qc_postmortem_summary", {
  id: serial("id").primaryKey(),
  postmortemId: integer("postmortem_id").notNull().references(() => qcPostmortem.id, { onDelete: 'cascade' }),
  contractorQualityScore: real("contractor_quality_score"),
  engineeringQualityScore: real("engineering_quality_score"),
  redFlag: boolean("red_flag").notNull().default(false),
});
export const insertQcPostmortemSummarySchema = createInsertSchema(qcPostmortemSummary).omit({ id: true } as any);
export type InsertQcPostmortemSummary = z.infer<typeof insertQcPostmortemSummarySchema>;
export type QcPostmortemSummary = typeof qcPostmortemSummary.$inferSelect;

export const qcAccessChallenge = pgTable("qc_access_challenge", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  failedAttemptsCount: integer("failed_attempts_count").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertQcAccessChallengeSchema = createInsertSchema(qcAccessChallenge).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertQcAccessChallenge = z.infer<typeof insertQcAccessChallengeSchema>;
export type QcAccessChallenge = typeof qcAccessChallenge.$inferSelect;

// ===================== COMMISSIONING & EVIDENCE =====================

export const commissioningStatusEnum = pgEnum('commissioning_status', ['not_started', 'in_progress', 'ready_for_review', 'approved', 'closed']);

export const commissioningItems = pgTable("commissioning_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  itemType: text("item_type").notNull().default('commissioning'),
  title: text("title").notNull(),
  description: text("description"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  dueDate: text("due_date"),
  status: commissioningStatusEnum("status").notNull().default('not_started'),
  evidenceNotes: text("evidence_notes"),
  approvalId: integer("approval_id"),
  gateId: text("gate_id"),
  category: text("category"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export const insertCommissioningItemSchema = createInsertSchema(commissioningItems).omit({ id: true, createdAt: true, updatedAt: true, completedAt: true } as any);
export type InsertCommissioningItem = z.infer<typeof insertCommissioningItemSchema>;
export type CommissioningItem = typeof commissioningItems.$inferSelect;

// ===================== EVIDENCE SCORING MODEL =====================

export const evidenceTypeEnum = pgEnum('evidence_type', ['document', 'photo', 'form', 'structured_field', 'sign_off', 'linked_record']);

export const evidenceRequirementDefinitions = pgTable("evidence_requirement_definitions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  completionType: text("completion_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref"),
  requirementKey: text("requirement_key").notNull(),
  label: text("label").notNull(),
  evidenceType: evidenceTypeEnum("evidence_type").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  weight: real("weight").notNull().default(1),
  minCount: integer("min_count").notNull().default(1),
  thresholdPercent: real("threshold_percent"),
  configJson: jsonb("config_json"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type EvidenceRequirementDefinition = typeof evidenceRequirementDefinitions.$inferSelect;

export const evidenceCollectedItems = pgTable("evidence_collected_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  completionType: text("completion_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  requirementKey: text("requirement_key"),
  evidenceType: evidenceTypeEnum("evidence_type").notNull(),
  title: text("title"),
  valueRef: text("value_ref"),
  valueJson: jsonb("value_json"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
export type EvidenceCollectedItem = typeof evidenceCollectedItems.$inferSelect;

export const evidenceEvaluations = pgTable("evidence_evaluations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  completionType: text("completion_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  thresholdPercent: real("threshold_percent").notNull(),
  scorePercent: real("score_percent").notNull(),
  totalRequired: integer("total_required").notNull(),
  totalPresent: integer("total_present").notNull(),
  missingItemsJson: jsonb("missing_items_json"),
  pass: boolean("pass").notNull(),
  evaluatedByUserId: integer("evaluated_by_user_id").references(() => users.id),
  evaluatedByName: text("evaluated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type EvidenceEvaluation = typeof evidenceEvaluations.$inferSelect;

export const evidenceOverrideRecords = pgTable("evidence_override_records", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  completionType: text("completion_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  scorePercent: real("score_percent").notNull(),
  thresholdPercent: real("threshold_percent").notNull(),
  reason: text("reason").notNull(),
  authorizedByUserId: integer("authorized_by_user_id").notNull().references(() => users.id),
  authorizedByName: text("authorized_by_name"),
  authorizedByRole: text("authorized_by_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type EvidenceOverrideRecord = typeof evidenceOverrideRecords.$inferSelect;

