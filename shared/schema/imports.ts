import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";
import { counterparties, counterpartyTypeEnum } from "./finance";

export const smartImportStatusEnum = pgEnum('smart_import_status', ['PREVIEW', 'AWAITING_REVIEW', 'COMMITTED', 'ROLLED_BACK', 'FAILED', 'SUPERSEDED']);
export const importIssueSeverityEnum = pgEnum('import_issue_severity', ['INFO', 'WARNING', 'BLOCKER']);
export const importSectionEnum = pgEnum('import_section', ['PLAN', 'REVENUE', 'EXPENDITURE', 'CASHFLOW', 'GENERAL']);
export const importTriggerTypeEnum = pgEnum('import_trigger_type', ['schedule', 'manual', 'webhook']);
export const importRunStatusEnum = pgEnum('import_run_status', ['running', 'success', 'partial', 'fail']);
export const changeEventTypeEnum = pgEnum('change_event_type', ['created', 'modified', 'deleted', 'renamed']);
export const importStatusEnum = pgEnum('import_status_type', ['pending', 'imported', 'failed', 'skipped']);
export const changeSetSourceEnum = pgEnum('change_set_source', ['IMPORT', 'MANUAL_EDIT', 'OVERRIDE', 'CONFLICT_RESOLUTION', 'PATTERN_LEARNING', 'COUNTERPARTY_UPDATE', 'SYSTEM']);

export const spSettings = pgTable("sp_settings", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  folderItemId: text("folder_item_id"),
  folderPath: text("folder_path"),
  intervalMinutes: integer("interval_minutes").notNull().default(30),
  enabled: boolean("enabled").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});

export const insertSpSettingsSchema = createInsertSchema(spSettings).omit({ id: true, updatedAt: true } as any);
export type InsertSpSettings = z.infer<typeof insertSpSettingsSchema>;
export type SpSettings = typeof spSettings.$inferSelect;

export const spFiles = pgTable("sp_files", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  itemId: text("item_id").notNull(),
  path: text("path"),
  fileName: text("file_name").notNull(),
  lastSeenEtag: text("last_seen_etag"),
  lastSeenCtag: text("last_seen_ctag"),
  spLastModifiedAt: timestamp("sp_last_modified_at"),
  spLastModifiedByName: text("sp_last_modified_by_name"),
  spLastModifiedByEmail: text("sp_last_modified_by_email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSpFileSchema = createInsertSchema(spFiles).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSpFile = z.infer<typeof insertSpFileSchema>;
export type SpFile = typeof spFiles.$inferSelect;

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  triggerType: importTriggerTypeEnum("trigger_type").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: importRunStatusEnum("status").notNull().default('running'),
  deltaTokenUsed: text("delta_token_used"),
  triggeredBy: text("triggered_by").notNull().default('system'),
  summaryJson: jsonb("summary_json"),
});

export const insertImportRunSchema = createInsertSchema(importRuns).omit({ id: true, startedAt: true } as any);
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;
export type ImportRun = typeof importRuns.$inferSelect;

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id").notNull().references(() => spFiles.id),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  sourceEtag: text("source_etag"),
  contentHash: text("content_hash").notNull(),
  rowCountTotal: integer("row_count_total"),
  parserVersion: text("parser_version").notNull().default('1.0'),
  storageRef: text("storage_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({ id: true, importedAt: true, createdAt: true } as any);
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;

export const changeLedger = pgTable("change_ledger", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => importRuns.id),
  fileId: integer("file_id").notNull().references(() => spFiles.id),
  eventType: changeEventTypeEnum("event_type").notNull(),
  oldEtag: text("old_etag"),
  newEtag: text("new_etag"),
  spModifiedAt: timestamp("sp_modified_at"),
  spModifiedByName: text("sp_modified_by_name"),
  spModifiedByEmail: text("sp_modified_by_email"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  importStatus: importStatusEnum("import_status").notNull().default('pending'),
  snapshotId: integer("snapshot_id").references(() => snapshots.id),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
});

export const insertChangeLedgerSchema = createInsertSchema(changeLedger).omit({ id: true, detectedAt: true } as any);
export type InsertChangeLedger = z.infer<typeof insertChangeLedgerSchema>;
export type ChangeLedger = typeof changeLedger.$inferSelect;

export const snapshotMetrics = pgTable("snapshot_metrics", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id),
  tableName: text("table_name").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  checksum: text("checksum"),
  minDate: text("min_date"),
  maxDate: text("max_date"),
  totalsJson: jsonb("totals_json"),
});

export const insertSnapshotMetricSchema = createInsertSchema(snapshotMetrics).omit({ id: true } as any);
export type InsertSnapshotMetric = z.infer<typeof insertSnapshotMetricSchema>;
export type SnapshotMetric = typeof snapshotMetrics.$inferSelect;

export const spFilePointers = pgTable("sp_file_pointers", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  folderItemId: text("folder_item_id"),
  fileItemId: text("file_item_id").notNull(),
  fileName: text("file_name").notNull(),
  webUrl: text("web_url"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
export const insertSpFilePointerSchema = createInsertSchema(spFilePointers).omit({ id: true, uploadedAt: true } as any);
export type InsertSpFilePointer = z.infer<typeof insertSpFilePointerSchema>;
export type SpFilePointer = typeof spFilePointers.$inferSelect;

export const smartImportRuns = pgTable("smart_import_runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  sourceFileName: text("source_file_name").notNull(),
  sourceFileHash: text("source_file_hash"),
  status: smartImportStatusEnum("status").notNull().default('PREVIEW'),
  templateProfileId: integer("template_profile_id"),
  summaryJson: jsonb("summary_json"),
  committedAt: timestamp("committed_at"),
  committedBy: integer("committed_by").references(() => users.id),
  recordsAttempted: integer("records_attempted"),
  recordsSucceeded: integer("records_succeeded"),
  recordsFailed: integer("records_failed"),
  importType: text("import_type"),
});
export const insertSmartImportRunSchema = createInsertSchema(smartImportRuns).omit({ id: true, uploadedAt: true } as any);
export type InsertSmartImportRun = z.infer<typeof insertSmartImportRunSchema>;
export type SmartImportRun = typeof smartImportRuns.$inferSelect;

export const importIssues = pgTable("import_issues", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  severity: importIssueSeverityEnum("severity").notNull(),
  section: importSectionEnum("section").notNull(),
  message: text("message").notNull(),
  suggestedAction: text("suggested_action"),
  issueType: text("issue_type"),
  issueFingerprint: text("issue_fingerprint"),
  resolved: boolean("resolved").notNull().default(false),
  resolution: text("resolution"),
  resolutionNote: text("resolution_note"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  autoResolved: boolean("auto_resolved").notNull().default(false),
  matchedRuleId: integer("matched_rule_id"),
  overrideData: jsonb("override_data"),
  payloadJson: jsonb("payload_json"),
});
export const insertImportIssueSchema = createInsertSchema(importIssues).omit({ id: true } as any);
export type InsertImportIssue = z.infer<typeof insertImportIssueSchema>;
export type ImportIssue = typeof importIssues.$inferSelect;

export const issueResolutionRules = pgTable("issue_resolution_rules", {
  id: serial("id").primaryKey(),
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  issueType: text("issue_type").notNull(),
  fingerprint: text("fingerprint").notNull(),
  section: importSectionEnum("section").notNull(),
  resolution: text("resolution").notNull(),
  resolutionNote: text("resolution_note"),
  overrideData: jsonb("override_data"),
  applyAlways: boolean("apply_always").notNull().default(false),
  timesApplied: integer("times_applied").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAppliedAt: timestamp("last_applied_at"),
  active: boolean("active").notNull().default(true),
});
export const insertIssueResolutionRuleSchema = createInsertSchema(issueResolutionRules).omit({ id: true, createdAt: true } as any);
export type InsertIssueResolutionRule = z.infer<typeof insertIssueResolutionRuleSchema>;
export type IssueResolutionRule = typeof issueResolutionRules.$inferSelect;

export const templateProfiles = pgTable("template_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  signatureJson: jsonb("signature_json"),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertTemplateProfileSchema = createInsertSchema(templateProfiles).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertTemplateProfile = z.infer<typeof insertTemplateProfileSchema>;
export type TemplateProfile = typeof templateProfiles.$inferSelect;

export const mappingRules = pgTable("mapping_rules", {
  id: serial("id").primaryKey(),
  templateProfileId: integer("template_profile_id").notNull().references(() => templateProfiles.id),
  section: importSectionEnum("section").notNull(),
  sourceHeader: text("source_header").notNull(),
  canonicalField: text("canonical_field").notNull(),
  confidenceWeight: real("confidence_weight").notNull().default(1.0),
  examplesJson: jsonb("examples_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMappingRuleSchema = createInsertSchema(mappingRules).omit({ id: true, createdAt: true } as any);
export type InsertMappingRule = z.infer<typeof insertMappingRuleSchema>;
export type MappingRule = typeof mappingRules.$inferSelect;

export const normalizedPlanTasks = pgTable("normalized_plan_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  taskName: text("task_name").notNull(),
  taskNo: text("task_no"),
  phase: text("phase"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  durationDays: integer("duration_days"),
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
  actualDurationDays: integer("actual_duration_days"),
  owner: text("owner"),
  assigneeUserId: integer("assignee_user_id").references(() => users.id),
  status: text("status"),
  pctComplete: real("pct_complete"),
  expectedPctComplete: real("expected_pct_complete"),
  comment: text("comment"),
  isMilestone: boolean("is_milestone").default(false),
  parentTaskNo: text("parent_task_no"),
  indentLevel: integer("indent_level").default(0),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertNormalizedPlanTaskSchema = createInsertSchema(normalizedPlanTasks).omit({ id: true, createdAt: true } as any);
export type InsertNormalizedPlanTask = z.infer<typeof insertNormalizedPlanTaskSchema>;
export type NormalizedPlanTask = typeof normalizedPlanTasks.$inferSelect;

export const INTAKE_REQUEST_TYPES = [
  "First Assessment",
  "Cost Proposal",
  "Site Visit Report",
  "Meter Installation",
  "Data Analysis Request",
  "Sizing Rational Request",
] as const;
export type IntakeRequestType = typeof INTAKE_REQUEST_TYPES[number];

export const INTAKE_STATUSES = [
  "NOT STARTED", "IN PROGRESS", "COMPLETED", "ON HOLD", "CANCELLED",
] as const;

export const FIELD_OWNERSHIP = ["SP_OWNED", "APP_OWNED", "SHARED"] as const;
export type FieldOwnership = typeof FIELD_OWNERSHIP[number];

export const spListConfig = pgTable("sp_list_config", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  listId: text("list_id").notNull(),
  siteName: text("site_name"),
  listName: text("list_name"),
  siteUrl: text("site_url"),
  columnMappingJson: jsonb("column_mapping_json"),
  fieldOwnershipJson: jsonb("field_ownership_json"),
  lastPulledAt: timestamp("last_pulled_at"),
  lastPushedAt: timestamp("last_pushed_at"),
  lastDeltaToken: text("last_delta_token"),
  syncViewFilter: text("sync_view_filter").default("IN PROGRESS"),
  configuredByRole: text("configured_by_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSpListConfigSchema = createInsertSchema(spListConfig).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSpListConfig = z.infer<typeof insertSpListConfigSchema>;
export type SpListConfig = typeof spListConfig.$inferSelect;

export const intakeRequests = pgTable("intake_requests", {
  id: serial("id").primaryKey(),
  spItemId: text("sp_item_id").notNull().unique(),
  projectId: integer("project_id").references(() => projectInfo.id),
  clientKey: text("client_key").notNull(),
  clientName: text("client_name").notNull(),
  requestType: text("request_type"),
  status: text("status"),
  priority: text("priority"),
  dueDate: text("due_date"),
  daysInProgress: integer("days_in_progress"),
  projectDeveloper: text("project_developer"),
  designer: text("designer"),
  sizeKwp: text("size_kwp"),
  province: text("province"),
  gpsCoordinates: text("gps_coordinates"),
  fundingType: text("funding_type"),
  billsTariffData: text("bills_tariff_data"),
  meteringData: text("metering_data"),
  siteInspectionForm: text("site_inspection_form"),
  comments: text("comments"),
  workingSchedule: text("working_schedule"),
  batteriesNeeded: text("batteries_needed"),
  batterySize: text("battery_size"),
  dieselGenNeeded: text("diesel_gen_needed"),
  roofReplacementNeeded: text("roof_replacement_needed"),
  hseDiscussed: text("hse_discussed"),
  numberOfReworks: integer("number_of_reworks"),
  clickUpSynced: text("clickup_synced"),
  itemType: text("item_type"),
  spPath: text("sp_path"),
  spEtag: text("sp_etag"),
  spRawJson: jsonb("sp_raw_json"),
  appNotes: text("app_notes"),
  appInternalBlockers: text("app_internal_blockers"),
  cpSigned: boolean("cp_signed").notNull().default(false),
  cpSignedDate: text("cp_signed_date"),
  cpSignedBy: text("cp_signed_by"),
  cpEvidenceType: text("cp_evidence_type"),
  cpEvidenceRef: text("cp_evidence_ref"),
  pmCreated: boolean("pm_created").notNull().default(false),
  tasksGenerated: boolean("tasks_generated").notNull().default(false),
  lastPulledAt: timestamp("last_pulled_at"),
  lastPushedAt: timestamp("last_pushed_at"),
  lastPulledHash: text("last_pulled_hash"),
  lastAppEditAt: timestamp("last_app_edit_at"),
  syncConflict: boolean("sync_conflict").notNull().default(false),
  conflictFieldsJson: jsonb("conflict_fields_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertIntakeRequestSchema = createInsertSchema(intakeRequests).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertIntakeRequest = z.infer<typeof insertIntakeRequestSchema>;
export type IntakeRequest = typeof intakeRequests.$inferSelect;

export const intakeTaskTemplates = pgTable("intake_task_templates", {
  id: serial("id").primaryKey(),
  requestType: text("request_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dodItems: jsonb("dod_items"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertIntakeTaskTemplateSchema = createInsertSchema(intakeTaskTemplates).omit({ id: true, createdAt: true } as any);
export type InsertIntakeTaskTemplate = z.infer<typeof insertIntakeTaskTemplateSchema>;
export type IntakeTaskTemplate = typeof intakeTaskTemplates.$inferSelect;

export const intakeTasks = pgTable("intake_tasks", {
  id: serial("id").primaryKey(),
  intakeRequestId: integer("intake_request_id").notNull().references(() => intakeRequests.id, { onDelete: 'cascade' }),
  templateItemId: integer("template_item_id").references(() => intakeTaskTemplates.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("NOT_STARTED"),
  dodItems: jsonb("dod_items"),
  dodCompletedJson: jsonb("dod_completed_json"),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertIntakeTaskSchema = createInsertSchema(intakeTasks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertIntakeTask = z.infer<typeof insertIntakeTaskSchema>;
export type IntakeTask = typeof intakeTasks.$inferSelect;

export const syncAuditLog = pgTable("sync_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorRole: text("actor_role").notNull(),
  direction: text("direction").notNull(),
  summary: jsonb("summary"),
  errorsJson: jsonb("errors_json"),
  conflictsJson: jsonb("conflicts_json"),
  itemCount: integer("item_count").notNull().default(0),
  newProjectsCount: integer("new_projects_count").notNull().default(0),
  newRequestsCount: integer("new_requests_count").notNull().default(0),
  updatedRequestsCount: integer("updated_requests_count").notNull().default(0),
  conflictsCount: integer("conflicts_count").notNull().default(0),
  errorsCount: integer("errors_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertSyncAuditLogSchema = createInsertSchema(syncAuditLog).omit({ id: true, createdAt: true } as any);
export type InsertSyncAuditLog = z.infer<typeof insertSyncAuditLogSchema>;
export type SyncAuditLog = typeof syncAuditLog.$inferSelect;

export const SP_OWNED_FIELDS = [
  "clientName", "dueDate", "requestType", "projectDeveloper", "designer",
  "fundingType", "sizeKwp", "province", "workingSchedule", "gpsCoordinates",
  "billsTariffData", "meteringData", "siteInspectionForm",
  "batteriesNeeded", "batterySize", "dieselGenNeeded", "roofReplacementNeeded",
  "hseDiscussed", "numberOfReworks", "daysInProgress",
] as const;

export const APP_OWNED_FIELDS = [
  "appNotes", "appInternalBlockers", "cpSigned", "cpSignedDate", "cpSignedBy",
  "cpEvidenceType", "cpEvidenceRef", "pmCreated", "tasksGenerated",
] as const;

export const SHARED_FIELDS = ["status", "comments", "priority"] as const;

export const mockSpItems = pgTable("mock_sp_items", {
  id: serial("id").primaryKey(),
  mockItemId: text("mock_item_id").notNull().unique(),
  fields: jsonb("fields").notNull(),
  etag: text("etag"),
  createdDateTime: text("created_date_time"),
  lastModifiedDateTime: text("last_modified_date_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MockSpItem = typeof mockSpItems.$inferSelect;

// ===================== CHANGE SET AUDIT =====================

export const changeSets = pgTable("change_sets", {
  id: serial("id").primaryKey(),
  actorRole: text("actor_role"),
  actorUserId: integer("actor_user_id"),
  source: changeSetSourceEnum("source").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  projectId: integer("project_id"),
  projectName: text("project_name"),
  importRunId: integer("import_run_id"),
  smartImportRunId: integer("smart_import_run_id"),
  action: text("action").notNull(),
  summary: text("summary"),
  overrideCategory: text("override_category"),
  overrideComment: text("override_comment"),
  correlationId: text("correlation_id"),
  fileMetadata: jsonb("file_metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertChangeSetSchema = createInsertSchema(changeSets).omit({ id: true, createdAt: true } as any);
export type InsertChangeSet = z.infer<typeof insertChangeSetSchema>;
export type ChangeSet = typeof changeSets.$inferSelect;

export const fieldChanges = pgTable("field_changes", {
  id: serial("id").primaryKey(),
  changeSetId: integer("change_set_id").notNull().references(() => changeSets.id),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  dataType: text("data_type").default("text"),
});
export const insertFieldChangeSchema = createInsertSchema(fieldChanges).omit({ id: true } as any);
export type InsertFieldChange = z.infer<typeof insertFieldChangeSchema>;
export type FieldChange = typeof fieldChanges.$inferSelect;

// ===================== PLAN EDIT NOTIFICATIONS =====================

export const planEditNotifications = pgTable("plan_edit_notifications", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  taskId: integer("task_id"),
  taskName: text("task_name"),
  editType: text("edit_type").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  editedByUserId: integer("edited_by_user_id").references(() => users.id),
  editedByName: text("edited_by_name"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertPlanEditNotificationSchema = createInsertSchema(planEditNotifications).omit({ id: true, createdAt: true } as any);
export type InsertPlanEditNotification = z.infer<typeof insertPlanEditNotificationSchema>;
export type PlanEditNotification = typeof planEditNotifications.$inferSelect;

// Import logs — structured log of every import attempt (successful or not)
export const importLogs = pgTable("import_logs", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  fileName: text("file_name").notNull(),
  importedByUserId: integer("imported_by_user_id").references(() => users.id),
  importedByName: text("imported_by_name"),
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  status: text("status").notNull(), // SUCCESS, PARTIAL, FAILED, REJECTED
  rowsAttempted: integer("rows_attempted").default(0),
  rowsWritten: integer("rows_written").default(0),
  rowsSkipped: integer("rows_skipped").default(0),
  rowsRejected: integer("rows_rejected").default(0),
  conflictsDetected: integer("conflicts_detected").default(0),
  conflictsResolved: integer("conflicts_resolved").default(0),
  errorMessage: text("error_message"),
  summaryJson: jsonb("summary_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ImportLog = typeof importLogs.$inferSelect;

// Manual edit flags — tracks fields manually edited in the UI that should be protected from import overwrite
export const manualEditFlags = pgTable("manual_edit_flags", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // normalized_cost_lines, normalized_revenue_lines, work_items, etc.
  entityId: integer("entity_id").notNull(),
  fieldName: text("field_name").notNull(),
  editedByUserId: integer("edited_by_user_id").references(() => users.id),
  editedByName: text("edited_by_name"),
  editedAt: timestamp("edited_at").notNull().defaultNow(),
  isProtected: boolean("is_protected").notNull().default(false), // true = "Keep Manual Edit" chosen
  protectedAt: timestamp("protected_at"),
  protectedByUserId: integer("protected_by_user_id").references(() => users.id),
});
export type ManualEditFlag = typeof manualEditFlags.$inferSelect;

// Conflict resolution log — records each field-level resolution decision during import
export const conflictResolutionLog = pgTable("conflict_resolution_log", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  fieldName: text("field_name").notNull(),
  manualValue: text("manual_value"),
  importValue: text("import_value"),
  decision: text("decision").notNull(), // KEEP_MANUAL, OVERWRITE_WITH_IMPORT
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at").notNull().defaultNow(),
})
export type ConflictResolutionLogEntry = typeof conflictResolutionLog.$inferSelect;

