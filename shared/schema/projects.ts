import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique, uniqueIndex, index } from "drizzle-orm/pg-core";

// ==================== STATUS ENUMS ====================
export const archivedStatusEnum = pgEnum("archived_status_enum", ["ACTIVE", "ARCHIVED", "ARCHIVED_MERGED", "GONE"]);
// Canonical project status (orthogonal to phase). Mirrors the DB enum
// `project_status_enum` created by 20260420_canonical_phase_cycle.sql.
export const projectStatusEnum = pgEnum("project_status_enum", ["active", "hold", "internal", "closed", "tbc"]);
export const executionGateStatusEnum = pgEnum("execution_gate_status_enum", ["NOT_ELIGIBLE", "ELIGIBLE", "APPROVED"]);
export const signedStatusEnum = pgEnum("signed_status_enum", ["NONE", "PENDING", "SIGNED"]);
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { smartImportRuns } from "./imports";

// ===================== ENUMS =====================

export const phaseSourceEnum = pgEnum('phase_source', ['EXCEL_IMPORT', 'MANUAL']);

// ===================== CLIENTS =====================

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // B1: Enriched client fields
  legalEntityName: text("legal_entity_name"),
  tradingName: text("trading_name"),
  clientType: text("client_type"),             // 'commercial', 'industrial', 'residential', 'government'
  billingEntity: text("billing_entity"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  secondaryContactName: text("secondary_contact_name"),
  secondaryContactEmail: text("secondary_contact_email"),
  industry: text("industry"),
  pipedriveOrgId: text("pipedrive_org_id"),
  status: text("status").default("active"),    // 'active', 'inactive', 'prospect'
  // Email-linking foundations — used to auto-attribute incoming Outlook
  // emails to this client when the sender's domain matches.
  // See docs/overhaul/04-overnight-progress.md for the email-linking design.
  primaryEmailDomain: text("primary_email_domain"),     // e.g. "clientabc.com"
  additionalEmailDomains: jsonb("additional_email_domains").$type<string[]>().default([]),
}, (table) => ({
  // Defence-in-depth against duplicate clients for the same Pipedrive org.
  // Backed by migration 0018_clients_unique_pipedrive_org.sql.
  pipedriveOrgIdUniq: uniqueIndex("clients_pipedrive_org_id_uniq")
    .on(table.pipedriveOrgId)
    .where(sql`${table.pipedriveOrgId} IS NOT NULL`),
}));
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ===================== SITES (B2) =====================

export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  siteName: text("site_name").notNull(),
  address: text("address"),
  gpsLat: decimal("gps_lat", { precision: 10, scale: 7 }),
  gpsLng: decimal("gps_lng", { precision: 10, scale: 7 }),
  municipality: text("municipality"),
  utilityAuthority: text("utility_authority"),
  landlord: text("landlord"),
  tenant: text("tenant"),
  roofType: text("roof_type"),               // 'flat_roof', 'pitched_roof', 'ground_mount', 'carport', 'other'
  siteConstraints: text("site_constraints"),
  hseConstraints: text("hse_constraints"),
  accessRules: text("access_rules"),
  status: text("status").default("active"),  // 'active', 'inactive', 'decommissioned'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  // Defence-in-depth against duplicate sites for the same client+name.
  // Backed by migration 0022_sites_pdtickets_natural_key_uniques.sql.
  clientSiteNameUniq: uniqueIndex("sites_client_site_name_uniq")
    .on(table.clientId, table.siteName)
    .where(sql`${table.deletedAt} IS NULL AND ${table.clientId} IS NOT NULL AND ${table.siteName} IS NOT NULL`),
}));

export const insertSiteSchema = createInsertSchema(sites).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sites.$inferSelect;

// ===================== OPPORTUNITIES (B3) =====================

export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  pipedriveDealId: text("pipedrive_deal_id"),
  /**
   * Origin of this row. `'pipedrive'` means it was created / is maintained
   * by the Pipedrive sync engine and most CRM-owned fields get overwritten
   * on every sync run. `'internal'` means it was created through the
   * in-app opportunity form and is app-owned end-to-end.
   *
   * See migration 20260415_pd_workflow_separation.sql.
   */
  source: text("source").notNull().default("internal"),  // 'internal' | 'pipedrive'
  clientId: integer("client_id").references(() => clients.id),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  /**
   * @deprecated Not populated by any code path today. The Pipedrive
   * sync parses `deal.owner_id` from the API response but never writes
   * it into this column (see `server/services/pipedrive-sync-service.ts`),
   * and the in-app opportunity form does not expose an owner picker.
   * Kept for schema stability; do not rely on it for reporting.
   * Tracked as "structural fix #2" in docs/runbooks/pipedrive-integration-review-2026-04-15.md.
   */
  dealOwnerUserId: integer("deal_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  stage: text("stage").default("prospect"),              // 'prospect', 'qualification', 'proposal', 'negotiation', 'won', 'lost'
  contractType: text("contract_type"),                   // 'PPA', 'EPC', 'lease', 'hybrid'
  fundingType: text("funding_type"),                     // 'self_funded', 'third_party', 'blended'
  estimatedValue: decimal("estimated_value", { precision: 15, scale: 2 }),
  estimatedKwp: decimal("estimated_kwp", { precision: 12, scale: 2 }),
  /**
   * @deprecated Not populated by any code path today. No UI field; not
   * written by the Pipedrive sync. Retained only so drizzle types stay
   * aligned with the physical column. Tracked in
   * docs/runbooks/pd-data-trust-review-2026-04-15.md.
   */
  estimatedKwh: decimal("estimated_kwh", { precision: 15, scale: 2 }),
  /**
   * @deprecated Not populated by any code path today. No UI field; not
   * written by the Pipedrive sync. Retained only so drizzle types stay
   * aligned with the physical column.
   */
  proposalIssuedDate: date("proposal_issued_date"),
  expectedCloseDate: date("expected_close_date"),
  signedDate: date("signed_date"),
  /**
   * @deprecated Use `projectPdPmHandover.status` as the authoritative
   * handover readiness signal. This column is kept for backward
   * compatibility with existing reads but is NOT maintained by any of
   * the handover code paths. New code must read handover state from
   * the `project_pd_pm_handover` table scoped to the related
   * `project_info.id`. See docs/runbooks/pd-workflow-review-2026-04-15.md.
   */
  handoverReadiness: text("handover_readiness").default("not_ready"), // 'not_ready', 'in_preparation', 'awaiting_approval', 'ready', 'submitted', 'accepted', 'returned'
  commercialRisks: text("commercial_risks"),
  notes: text("notes"),
  status: text("status").default("active"),              // 'active', 'won', 'lost', 'on_hold'
  // Project location. Populated by Pipedrive sync (when address custom-field
  // is mapped) or copied from the PD shadow on backfill. See migration
  // 20260420_opportunity_province.sql.
  province: text("province"),
  // === Pipedrive enrichment (added 2026-04-20, migration
  // 20260420_opportunity_merge_pipedrive_enrich.sql). All optional;
  // populated by `pipedrive-sync-service.ts` when a deal is synced.
  // App-side opportunities ('source' = 'internal') leave them null. ===
  dealName: text("deal_name"),
  dealOwnerName: text("deal_owner_name"),                // snapshot when no users-table match
  currency: text("currency").notNull().default("ZAR"),
  pipedriveUpdatedAt: timestamp("pipedrive_updated_at"), // Pipedrive's update_time
  pipedriveStageChangedAt: timestamp("pipedrive_stage_changed_at"),
  probability: decimal("probability", { precision: 5, scale: 2 }),
  weightedValue: decimal("weighted_value", { precision: 15, scale: 2 }),
  lostReason: text("lost_reason"),
  lostTime: timestamp("lost_time"),
  personName: text("person_name"),
  personEmail: text("person_email"),
  personPhone: text("person_phone"),
  activitiesCount: integer("activities_count").notNull().default(0),
  lastActivityDate: date("last_activity_date"),
  nextActivityDate: date("next_activity_date"),
  nextActivitySubject: text("next_activity_subject"),
  labels: text("labels"),                                // CSV for now
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

// ===================== PROJECT INFO =====================

// Project Info Table (parsed from Project Plan sheet fixed cells)
export const projectInfo = pgTable("project_info", {
  // === IDENTITY (stays here) ===
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  pd: text("pd"),
  pm: text("pm"),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  canonicalProjectId: integer("canonical_project_id").references((): any => projectInfo.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id),
  pmUserId: integer("pm_user_id").references(() => users.id, { onDelete: "set null" }),
  pdUserId: integer("pd_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  // B2/B3/B4: Entity linking and enrichment
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  opportunityId: integer("opportunity_id").references(() => opportunities.id),
  deliveryModel: text("delivery_model"),     // 'turnkey', 'design_build', 'epc', 'consulting'
  projectCode: text("project_code"),
  // Canonical phase cycle (added 2026-04-20). Hold/Internal/Closed/TBC are
  // no longer phases — they live here as an orthogonal status. DLP is a
  // flag that auto-pushes RAG to red while the project is in any handover
  // phase. See shared/phases.ts for the canonical 10-phase list.
  projectStatus: projectStatusEnum("project_status").notNull().default("active"),
  inDlp: boolean("in_dlp").notNull().default(false),
}, (table) => ({
  uqProjectInfoProjectNameActive: uniqueIndex("uq_project_info_project_name_active")
    .on(table.projectName)
    .where(sql`${table.deletedAt} IS NULL`),
}));

export const insertProjectInfoSchema = createInsertSchema(projectInfo).omit({ id: true, updatedAt: true } as any);
export type InsertProjectInfo = z.infer<typeof insertProjectInfoSchema>;
export type ProjectInfo = typeof projectInfo.$inferSelect;

// ===================== PROJECT EXECUTION STATE =====================
// Split from project_info — contains all execution/lifecycle/status columns

export const projectExecutionState = pgTable("project_execution_state", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").unique().notNull().references(() => projectInfo.id, { onDelete: "cascade" }),

  // Phase lifecycle
  phase: text("phase"),
  phaseUpdatedAt: timestamp("phase_updated_at"),
  phaseUpdatedByUserId: integer("phase_updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  phaseNotes: text("phase_notes"),

  // Key dates (planned) — migrated from text to date in 20260331_convert_project_dates_to_date.sql
  pdHandoverDate: date("pd_handover_date"),
  constructionStartDate: date("construction_start_date"),
  commissioningDate: date("commissioning_date"),
  omHandoverDate: date("om_handover_date"),
  clientHandoverDate: date("client_handover_date"),

  // Key dates (actual)
  constructionStartActual: date("construction_start_actual"),
  pdHandoverActual: date("pd_handover_actual"),
  commissioningActual: date("commissioning_actual"),
  clientHandoverActual: date("client_handover_actual"),

  // Escalation
  escalationLevel: text("escalation_level"),

  // RAG status
  ragStatus: text("rag_status"),
  ragComment: text("rag_comment"),
  ragUpdatedAt: timestamp("rag_updated_at"),
  ragUpdatedByUserId: integer("rag_updated_by_user_id").references(() => users.id, { onDelete: "set null" }),

  // Active / archived
  /** @deprecated 2026-03-31: Use deletedAt IS NULL instead. Drop after 30-day observation. */
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  archivedStatus: text("archived_status").notNull().default("ACTIVE"),

  // Execution gate
  executionEnabled: boolean("execution_enabled").notNull().default(false),
  executionGateStatus: text("execution_gate_status").notNull().default("NOT_ELIGIBLE"),
  executionGateReason: text("execution_gate_reason"),
  executionPhase: text("execution_phase"),

  // Signing
  signedStatus: text("signed_status").notNull().default("NONE"),
  signedDate: date("signed_date"),
  signedDocumentLink: text("signed_document_link"),

  // CP signed gate
  cpSigned: boolean("cp_signed").notNull().default(false),
  cpSignedDate: date("cp_signed_date"),
  cpSignedByUserId: integer("cp_signed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  cpEvidenceType: text("cp_evidence_type"),
  cpEvidenceRef: text("cp_evidence_ref"),

  // Task pack flags
  pmTaskPackCreated: boolean("pm_task_pack_created").notNull().default(false),
  engPostCpTaskPackCreated: boolean("eng_post_cp_task_pack_created").notNull().default(false),

  // B4: Role assignments
  constructionManagerUserId: integer("construction_manager_user_id").references(() => users.id, { onDelete: "set null" }),
  qualityLeadUserId: integer("quality_lead_user_id").references(() => users.id, { onDelete: "set null" }),
  engineeringLeadUserId: integer("engineering_lead_user_id").references(() => users.id, { onDelete: "set null" }),
  programManagerUserId: integer("program_manager_user_id").references(() => users.id, { onDelete: "set null" }),
  projectFinanceUserId: integer("project_finance_user_id").references(() => users.id, { onDelete: "set null" }),

  // B4: Milestone targets
  matriarchHandoverTarget: date("matriarch_handover_target"),
  practicalCompletionTarget: date("practical_completion_target"),
  practicalCompletionActual: date("practical_completion_actual"),

  // B4: Financial baselines (quick reference — formal baselines in budget_baselines table)
  costBaseline: decimal("cost_baseline", { precision: 15, scale: 2 }),
  marginBaseline: decimal("margin_baseline", { precision: 8, scale: 4 }),

  // Stage lifecycle
  currentStageCode: text("current_stage_code"),
  gateStatus: text("gate_status"),
  gateReadinessPct: integer("gate_readiness_pct"),
  waitingOnDepartment: text("waiting_on_department"),
  waitingOnUserId: integer("waiting_on_user_id").references(() => users.id, { onDelete: "set null" }),
  nextRequiredAction: text("next_required_action"),
  stageOwnerUserId: integer("stage_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  stageApproverUserId: integer("stage_approver_user_id").references(() => users.id, { onDelete: "set null" }),
  kamUserId: integer("kam_user_id").references(() => users.id, { onDelete: "set null" }),

  // Financial review gate
  siteEstablishmentDate: date("site_establishment_date"),
  siteEstablishmentActual: date("site_establishment_actual"),
  financialReviewStatus: text("financial_review_status").notNull().default("NOT_STARTED"),
  financialReviewId: integer("financial_review_id"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  phaseIdx: index("project_execution_state_phase_idx").on(table.phase),
  archivedStatusIdx: index("project_execution_state_archived_status_idx").on(table.archivedStatus),
}));

export const insertProjectExecutionStateSchema = createInsertSchema(projectExecutionState).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectExecutionState = z.infer<typeof insertProjectExecutionStateSchema>;
export type ProjectExecutionState = typeof projectExecutionState.$inferSelect;

/** Combined ProjectInfo + ProjectExecutionState for backward-compat reads */
export type ProjectInfoWithExecState = ProjectInfo & Partial<Omit<ProjectExecutionState, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>;

// ===================== PROJECT SETTINGS =====================
// Split from project_info — contains config/link/preference columns

export const projectSettings = pgTable("project_settings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").unique().notNull().references(() => projectInfo.id, { onDelete: "cascade" }),

  // Excel / SharePoint links
  excelTrackerLink: text("excel_tracker_link"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSettingsSchema = createInsertSchema(projectSettings).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectSettings = z.infer<typeof insertProjectSettingsSchema>;
export type ProjectSettings = typeof projectSettings.$inferSelect;

// ===================== PROJECT PHASE HISTORY =====================

export const projectPhaseHistory = pgTable("project_phase_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  fromPhase: text("from_phase"),
  toPhase: text("to_phase").notNull(),
  changedByUserId: integer("changed_by_user_id").notNull().references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  reason: text("reason").notNull(),
});

export const insertProjectPhaseHistorySchema = createInsertSchema(projectPhaseHistory).omit({ id: true, changedAt: true } as any);
export type InsertProjectPhaseHistory = z.infer<typeof insertProjectPhaseHistorySchema>;
export type ProjectPhaseHistory = typeof projectPhaseHistory.$inferSelect;

// ===================== PROJECT RAG AUDIT =====================

export const projectRagAudit = pgTable("project_rag_audit", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  fromRag: text("from_rag"),
  toRag: text("to_rag").notNull(),
  comment: text("comment").notNull(),
  changedByUserId: integer("changed_by_user_id").notNull().references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertProjectRagAuditSchema = createInsertSchema(projectRagAudit).omit({ id: true, changedAt: true } as any);
export type InsertProjectRagAudit = z.infer<typeof insertProjectRagAuditSchema>;
export type ProjectRagAudit = typeof projectRagAudit.$inferSelect;

// ===================== PROJECT REVENUE SUMMARY =====================

// Project Revenue Summary Table (top summary block values)
export const projectRevenueSummary = pgTable("project_revenue_summary", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull().unique(),
  plannedRevenue: decimal("planned_revenue", { precision: 15, scale: 2 }),
  plannedExpenditure: decimal("planned_expenditure", { precision: 15, scale: 2 }),
  plannedProfit: decimal("planned_profit", { precision: 15, scale: 2 }),
  plannedMargin: decimal("planned_margin", { precision: 6, scale: 4 }),
  actualRevenue: decimal("actual_revenue", { precision: 15, scale: 2 }),
  actualExpenditure: decimal("actual_expenditure", { precision: 15, scale: 2 }),
  actualProfit: decimal("actual_profit", { precision: 15, scale: 2 }),
  actualMargin: decimal("actual_margin", { precision: 6, scale: 4 }),
  voPmLimit: decimal("vo_pm_limit", { precision: 15, scale: 2 }),
  currentVoTotal: decimal("current_vo_total", { precision: 15, scale: 2 }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
});

export const insertProjectRevenueSummarySchema = createInsertSchema(projectRevenueSummary).omit({ id: true, capturedAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertProjectRevenueSummary = z.infer<typeof insertProjectRevenueSummarySchema>;
export type ProjectRevenueSummary = typeof projectRevenueSummary.$inferSelect;

// ===================== HOME NOTES =====================

// Home Notes Table - persisted notes for the Home/Projects Report page
export const homeNotes = pgTable("home_notes", {
  id: serial("id").primaryKey(),
  reportDate: text("report_date").notNull(), // YYYY-MM-DD
  preparedBy: text("prepared_by"),
  highlightsNotes: text("highlights_notes"), // Key issues / highlights
  constructionNotes: text("construction_notes"), // Construction risks / notes
  financeNotes: text("finance_notes"), // Finance notes / actions
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertHomeNotesSchema = createInsertSchema(homeNotes).omit({ id: true, updatedAt: true } as any);
export type InsertHomeNotes = z.infer<typeof insertHomeNotesSchema>;
export type HomeNotes = typeof homeNotes.$inferSelect;

// ===================== PROJECT EDITABLE FIELDS =====================

export const projectEditableFields = pgTable("project_editable_fields", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull().unique(),
  projectId: integer("project_id").references(() => projectInfo.id),
  // C5 (audit closeout): legacy `cost_proposal_signed` and `epc_contract_signed`
  // text columns were dropped by migration 20260412_drop_legacy_signed_text_fields.sql.
  // The canonical source of truth for contract-signed state is now:
  //   - projectExecutionState.cpSigned (boolean) for cost proposal
  //   - projectExecutionState.signedStatus (NONE/PENDING/SIGNED) for the EPC contract
  // The remaining fields below are document-storage metadata, not signed-status.
  fundingSigned: text("funding_signed"),
  costProposalType: text("cost_proposal_type"),
  costProposalLink: text("cost_proposal_link"),
  costProposalNaReason: text("cost_proposal_na_reason"),
  fundingType: text("funding_type"),
  fundingLink: text("funding_link"),
  fundingNaReason: text("funding_na_reason"),
  epcContractType: text("epc_contract_type"),
  epcContractLink: text("epc_contract_link"),
  epcContractNaReason: text("epc_contract_na_reason"),
  province: text("province"),
  currentVoTotal: decimal("current_vo_total", { precision: 15, scale: 2 }),
  comments: text("comments"),
  latestUpdate: text("latest_update"),
  latestUpdateAt: timestamp("latest_update_at"),
  latestUpdateBy: text("latest_update_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectEditableFieldsSchema = createInsertSchema(projectEditableFields).omit({ id: true, updatedAt: true } as any);
export type InsertProjectEditableFields = z.infer<typeof insertProjectEditableFieldsSchema>;
export type ProjectEditableFields = typeof projectEditableFields.$inferSelect;

// ===================== LIFECYCLE PHASES =====================

/**
 * @deprecated 2026-04-20 — import {@link import('../phases').PHASES} instead.
 *
 * This list is kept as a transitional shim so existing call sites still
 * compile. It is the union of the canonical 10-phase cycle PLUS the
 * legacy labels (Cost Proposal, QA, Handover, Commercial Close Out, DLP,
 * Internal, Hold, Closed, TBC) — these legacy values are no longer stored
 * in the database after migration 20260420_canonical_phase_cycle but are
 * tolerated as TypeScript types until every call site is migrated.
 *
 * Canonical 10 phases (in order): First Assessment, Design & Cost Proposal,
 * Financial Close, Planning, Construction, Commissioning, O&M Handover,
 * Client Handover, Compliance Handover, Post-Handover Review.
 *
 * Hold / Internal / Closed / TBC live on `project_info.project_status`.
 * DLP lives on `project_info.in_dlp` and forces RAG=red during handover.
 */
export const LIFECYCLE_PHASES = [
  // Canonical 10:
  "First Assessment",
  "Design & Cost Proposal",
  "Financial Close",
  "Planning",
  "Construction",
  "Commissioning",
  "O&M Handover",
  "Client Handover",
  "Compliance Handover",
  "Post-Handover Review",
  // Legacy labels — DEPRECATED, kept for compile-time tolerance only:
  "Cost Proposal",
  "QA",
  "Handover",
  "Commercial Close Out",
  "DLP",
  "Internal",
  "Hold",
  "Closed",
  "TBC",
] as const;
export type LifecyclePhase = typeof LIFECYCLE_PHASES[number];

/**
 * The canonical 10-phase cycle as a string-literal tuple. Use this
 * (and not LIFECYCLE_PHASES) in new code that needs the active list.
 */
export const CANONICAL_LIFECYCLE_PHASES = [
  "First Assessment",
  "Design & Cost Proposal",
  "Financial Close",
  "Planning",
  "Construction",
  "Commissioning",
  "O&M Handover",
  "Client Handover",
  "Compliance Handover",
  "Post-Handover Review",
] as const satisfies ReadonlyArray<LifecyclePhase>;
export type CanonicalLifecyclePhase = typeof CANONICAL_LIFECYCLE_PHASES[number];

export const PROJECT_PHASES = [
  ...LIFECYCLE_PHASES,
  "P0_FIRST_ASSESSMENT",
  "P1_COST_PROPOSAL_DESIGN",
  "P2_PD_PM_HANDOVER",
  "P3_DETAILED_DESIGN_PROC_RELEASE",
  "P4_CONSTRUCTION_INSTALLATION",
  "P5_COMMISSIONING_TESTING",
  "P6_HANDOVER_CLIENT_MATRIARCH",
  "P7_CLOSEOUT_POSTMORTEM",
] as const;
export type ProjectPhase = typeof PROJECT_PHASES[number];

export const PROJECT_PHASE_LABELS: Record<string, string> = {
  // Canonical labels (preferred)
  "First Assessment":       "First Assessment",
  "Design & Cost Proposal": "Design & Cost Proposal",
  "Financial Close":        "Financial Close",
  "Planning":               "Planning",
  "Construction":           "Construction",
  "Commissioning":          "Commissioning",
  "O&M Handover":           "O&M Handover",
  "Client Handover":        "Client Handover",
  "Compliance Handover":    "Compliance Handover",
  "Post-Handover Review":   "Post-Handover Review",
  // Legacy labels normalised to canonical display
  "Cost Proposal":        "Design & Cost Proposal",
  "QA":                   "Commissioning",
  "Handover":             "O&M Handover",
  "Commercial Close Out": "Post-Handover Review",
  "DLP":                  "O&M Handover",  // surfaced as in_dlp badge
  "Internal":             "Internal",      // surfaced via project_status badge
  "Hold":                 "On Hold",       // surfaced via project_status badge
  "Closed":               "Closed",        // surfaced via project_status badge
  "TBC":                  "TBC",           // surfaced via project_status badge
  // Legacy P-codes from import era
  P0_FIRST_ASSESSMENT:                "First Assessment",
  P1_COST_PROPOSAL_DESIGN:            "Design & Cost Proposal",
  P2_PD_PM_HANDOVER:                  "Financial Close",
  P3_DETAILED_DESIGN_PROC_RELEASE:    "Planning",
  P4_CONSTRUCTION_INSTALLATION:       "Construction",
  P5_COMMISSIONING_TESTING:           "Commissioning",
  P6_HANDOVER_CLIENT_MATRIARCH:       "O&M Handover",
  P7_CLOSEOUT_POSTMORTEM:             "Post-Handover Review",
};

export const LEGACY_TO_LIFECYCLE: Record<string, LifecyclePhase> = {
  P0_FIRST_ASSESSMENT: "First Assessment",
  P1_COST_PROPOSAL_DESIGN: "Cost Proposal",
  P2_PD_PM_HANDOVER: "Planning",
  P3_DETAILED_DESIGN_PROC_RELEASE: "Planning",
  P4_CONSTRUCTION_INSTALLATION: "Construction",
  P5_COMMISSIONING_TESTING: "QA",
  P6_HANDOVER_CLIENT_MATRIARCH: "Handover",
  P7_CLOSEOUT_POSTMORTEM: "Commercial Close Out",
};

export const PHASE_TEXT_TO_ENUM: Record<string, ProjectPhase> = {
  "first assessment": "First Assessment",
  "cost proposal": "Cost Proposal",
  "cost proposal/design": "Cost Proposal",
  "design": "Cost Proposal",
  "pd": "Cost Proposal",
  "planning & design": "Planning",
  "planning": "Planning",
  "development": "Planning",
  "pd handover": "Planning",
  "pd -> pm handover": "Planning",
  "handover pd": "Planning",
  "detailed design": "Planning",
  "procurement": "Planning",
  "procurement release": "Planning",
  "construction": "Construction",
  "installation": "Construction",
  "construction / installation": "Construction",
  "commissioning": "QA",
  "testing": "QA",
  "commissioning & testing": "QA",
  "qa": "QA",
  "handover": "Handover",
  "client handover": "Handover",
  "o&m": "Handover",
  "compliance handover": "Compliance Handover",
  "complete": "Commercial Close Out",
  "completed": "Commercial Close Out",
  "close-out": "Commercial Close Out",
  "closeout": "Commercial Close Out",
  "commercial close out": "Commercial Close Out",
  "post-mortem": "Commercial Close Out",
  "internal": "Internal",
  "hold": "Hold",
  "closed": "Closed",
  "tbc": "TBC",
  "financial close": "Financial Close",
  "dlp": "DLP",
};

export const PHASE_TO_ENG_STAGES: Record<string, string[]> = {
  // Canonical labels:
  "First Assessment":       ["First Assessment"],
  "Design & Cost Proposal": ["Cost Proposal"],
  "Financial Close":        ["Cost Proposal"],
  "Planning":               ["IFC Planning"],
  "Construction":           ["IFC Planning", "Construction Support"],
  "Commissioning":          ["Handover Pack"],
  "O&M Handover":           ["Handover Pack"],
  "Client Handover":        ["Handover Pack"],
  "Compliance Handover":    ["Handover Pack"],
  "Post-Handover Review":   ["Handover Pack"],
  // Legacy labels (kept for tolerant lookup)
  "Cost Proposal":        ["Cost Proposal"],
  "QA":                   ["Handover Pack"],
  "Handover":             ["Handover Pack"],
};

// ===================== PROJECT DEVELOPMENT (PD) =====================

// ── Renamed from `pd_tickets` to `engineering_tickets` in vocabulary phase 2
// (task #58, migrations 0024 + 0025). The old `pdTickets` export below is a
// backwards-compat alias kept for one release. New code should use
// `engineeringTickets`.
export const engineeringTickets = pgTable("engineering_tickets", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  clientNameSnapshot: text("client_name_snapshot"),
  projectId: integer("project_id").references(() => projectInfo.id),
  /**
   * Optional link to the commercial opportunity that triggered this PD
   * work. Nullable because PD tickets can exist without a matching CRM
   * deal (internal R&D, retrofits, etc.) and because we do not want to
   * break the existing `projectId`-based workflow. Added by migration
   * 20260415_pd_workflow_separation.sql.
   */
  opportunityId: integer("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  projectSiteName: text("project_site_name").notNull(),
  dueDate: text("due_date"),
  requestType: text("request_type").notNull(),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Draft"),
  numberOfReworks: integer("number_of_reworks").notNull().default(0),
  projectDeveloperUserId: integer("project_developer_user_id").references(() => users.id),
  designerUserId: integer("designer_user_id").references(() => users.id),
  fundingType: text("funding_type"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  province: text("province"),
  gpsCoordinates: text("gps_coordinates"),
  billsOrTariffData: boolean("bills_or_tariff_data").default(false),
  meteringDataAvailable: boolean("metering_data_available").default(false),
  siteInspectionForm: boolean("site_inspection_form").default(false),
  siteInspectionLink: text("site_inspection_link"),
  workingSchedule: text("working_schedule"),
  batteriesNeeded: boolean("batteries_needed").default(false),
  batterySize: decimal("battery_size", { precision: 12, scale: 2 }),
  dieselGenIntegration: boolean("diesel_gen_integration").default(false),
  roofReplacementNeeded: boolean("roof_replacement_needed").default(false),
  hseDiscussed: boolean("hse_discussed").default(false),
  comments: text("comments"),
  estimatedProjectValue: decimal("estimated_project_value", { precision: 14, scale: 2 }),
  estimatedCost: decimal("estimated_cost", { precision: 14, scale: 2 }),
  estimatedMargin: decimal("estimated_margin", { precision: 14, scale: 2 }),
  estimatedMarginPercent: decimal("estimated_margin_percent", { precision: 6, scale: 2 }),
  financialNotes: text("financial_notes"),
  /**
   * @deprecated ClickUp integration was never completed. No ClickUp
   * client, sync service, or lifecycle manager exists in the codebase.
   * This column was part of an abandoned integration stub and is never
   * read or written by any active code path. Retained for schema
   * stability; do not rely on it.
   */
  clickUpSynced: boolean("clickup_synced").default(false),
  /**
   * Timestamp set once when sub-tasks are spawned from the ticket's
   * request-type template. Used as an idempotency guard by the spawn
   * endpoint (`POST /api/pd/tickets/:id/spawn-tasks`) to prevent
   * duplicate task creation. A null value means tasks have not been
   * spawned yet. Note: there is no "force re-spawn" flow today — once
   * set, the user cannot spawn again even if the tasks are deleted.
   * A re-spawn workflow is tracked as future work.
   */
  tasksSpawnedAt: timestamp("tasks_spawned_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  // Defence-in-depth against duplicate project-bound PD tickets for the
  // same (opportunity, project, request_type). Complements the existing
  // shadow-ticket unique index (`pd_tickets_opportunity_shadow_unique`,
  // migrations 0019/0020) by covering project-bound tickets.
  // Backed by migration 0022_sites_pdtickets_natural_key_uniques.sql.
  // Index renamed alongside the table in migration 0025.
  phasePerProjectUniq: uniqueIndex("engineering_tickets_phase_per_project_uniq")
    .on(table.opportunityId, table.projectId, table.requestType)
    .where(sql`${table.deletedAt} IS NULL AND ${table.opportunityId} IS NOT NULL AND ${table.projectId} IS NOT NULL AND ${table.requestType} IS NOT NULL`),
}));
export const insertEngineeringTicketSchema = createInsertSchema(engineeringTickets).omit({ id: true, createdAt: true, updatedAt: true, tasksSpawnedAt: true, deletedAt: true } as any);
export type InsertEngineeringTicket = z.infer<typeof insertEngineeringTicketSchema>;
export type EngineeringTicket = typeof engineeringTickets.$inferSelect;

// ── Backwards-compat re-exports (drop one release after migration 0025) ──
// Vocabulary phase 2 (task #58). Allows any straggler import that still
// references `pdTickets`/`PdTicket`/`insertPdTicketSchema` to compile
// while the codebase migrates to the new names.
export const pdTickets = engineeringTickets;
export const insertPdTicketSchema = insertEngineeringTicketSchema;
export type InsertPdTicket = InsertEngineeringTicket;
export type PdTicket = EngineeringTicket;

export const PD_REQUEST_TYPE_TASK_TEMPLATES: Record<string, { title: string; priority: string }[]> = {
  "Cost Proposal": [
    { title: "Prepare Cost Proposal Document", priority: "High" },
    { title: "Review Site Technical Data", priority: "Medium" },
    { title: "Financial Model & Pricing", priority: "High" },
    { title: "Client Presentation Pack", priority: "Medium" },
  ],
  "IFC Planning": [
    { title: "IFC Design Package", priority: "High" },
    { title: "Structural Assessment", priority: "High" },
    { title: "Electrical Single Line Diagram", priority: "High" },
    { title: "Cable Schedule & Layout", priority: "Medium" },
    { title: "Construction Timeline", priority: "Medium" },
  ],
  "Site Assessment": [
    { title: "Site Visit & Survey", priority: "High" },
    { title: "Roof Assessment Report", priority: "High" },
    { title: "Electrical Infrastructure Review", priority: "Medium" },
    { title: "HSE Risk Assessment", priority: "Medium" },
  ],
  "Feasibility Study": [
    { title: "Solar Resource Assessment", priority: "High" },
    { title: "Energy Yield Analysis", priority: "High" },
    { title: "Feasibility Report", priority: "High" },
    { title: "Financial Viability Summary", priority: "Medium" },
  ],
  "Grid Application": [
    { title: "Grid Connection Application", priority: "High" },
    { title: "Utility Liaison & Documentation", priority: "High" },
    { title: "Grid Compliance Check", priority: "Medium" },
  ],
  "Design Review": [
    { title: "Review Existing Design", priority: "High" },
    { title: "Design Revision Notes", priority: "Medium" },
    { title: "Updated Design Package", priority: "High" },
  ],
  "Battery Assessment": [
    { title: "Battery Sizing & Selection", priority: "High" },
    { title: "Integration Design", priority: "High" },
    { title: "Battery Cost Analysis", priority: "Medium" },
  ],
  "Full EPC": [
    { title: "Full EPC Design Package", priority: "High" },
    { title: "Procurement Schedule", priority: "High" },
    { title: "Construction Plan", priority: "High" },
    { title: "QA/QC Plan", priority: "Medium" },
    { title: "Commissioning Checklist", priority: "Medium" },
    { title: "Handover Documentation", priority: "Medium" },
  ],
};

// ===================== CALENDAR HOLIDAYS =====================

export const calendarHoliday = pgTable("calendar_holiday", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull().default("ZA"),
});

// ===================== PROJECT TEAM MEMBERSHIP =====================

export const projectTeamMembers = pgTable("project_team_members", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  userId: integer("user_id").notNull().references(() => users.id),
  roleOnProject: text("role_on_project").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectTeamMemberSchema = createInsertSchema(projectTeamMembers).omit({ id: true, createdAt: true } as any);
export type InsertProjectTeamMember = z.infer<typeof insertProjectTeamMemberSchema>;
export type ProjectTeamMember = typeof projectTeamMembers.$inferSelect;

// ===================== PHASE TEMPLATES (Lifecycle Governance) =====================

export const TEMPLATE_ITEM_TYPES = ["TASK", "DELIVERABLE", "QUALITY_LINK", "VIEW_SHORTCUT"] as const;
export type TemplateItemType = typeof TEMPLATE_ITEM_TYPES[number];

export const TEMPLATE_WORKSTREAMS = [
  "PD", "Engineering", "Quality", "PM", "Procurement",
  "Construction", "Commissioning", "Handover", "Finance", "OandM"
] as const;
export type TemplateWorkstream = typeof TEMPLATE_WORKSTREAMS[number];

export const TEMPLATE_LINK_TARGET_TYPES = ["NONE", "PLAN", "DELIVERABLE", "QUALITY"] as const;
export type TemplateLinkTargetType = typeof TEMPLATE_LINK_TARGET_TYPES[number];

export const phaseTemplate = pgTable("phase_template", {
  id: serial("id").primaryKey(),
  phase: text("phase").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPhaseTemplateSchema = createInsertSchema(phaseTemplate).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPhaseTemplate = z.infer<typeof insertPhaseTemplateSchema>;
export type PhaseTemplate = typeof phaseTemplate.$inferSelect;

export const phaseTemplateItem = pgTable("phase_template_item", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => phaseTemplate.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  itemType: text("item_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  primaryWorkstream: text("primary_workstream"),
  defaultStatus: text("default_status"),
  defaultPriority: text("default_priority"),
  offsetDaysFromPhaseStart: integer("offset_days_from_phase_start"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approverRole: text("approver_role"),
  linkTargetType: text("link_target_type").notNull().default("NONE"),
  linkTargetKey: text("link_target_key"),
  deliverableTypeKey: text("deliverable_type_key"),
  requiresQcApproval: boolean("requires_qc_approval").notNull().default(false),
  requiresOperationalApproval: boolean("requires_operational_approval").notNull().default(false),
  qualityItemKey: text("quality_item_key"),
  evidenceRequired: boolean("evidence_required").notNull().default(false),
  viewKey: text("view_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  isDeleted: boolean("is_deleted").notNull().default(false),
});
export const insertPhaseTemplateItemSchema = createInsertSchema(phaseTemplateItem).omit({ id: true } as any);
export type InsertPhaseTemplateItem = z.infer<typeof insertPhaseTemplateItemSchema>;
export type PhaseTemplateItem = typeof phaseTemplateItem.$inferSelect;

export const phaseTemplateItemHistory = pgTable("phase_template_item_history", {
  id: serial("id").primaryKey(),
  templateItemId: integer("template_item_id").notNull().references(() => phaseTemplateItem.id, { onDelete: "cascade" }),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changeJson: jsonb("change_json"),
});
export const insertPhaseTemplateItemHistorySchema = createInsertSchema(phaseTemplateItemHistory).omit({ id: true, changedAt: true } as any);
export type InsertPhaseTemplateItemHistory = z.infer<typeof insertPhaseTemplateItemHistorySchema>;
export type PhaseTemplateItemHistory = typeof phaseTemplateItemHistory.$inferSelect;

export const phaseTemplateApplication = pgTable("phase_template_application", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  templateId: integer("template_id").notNull().references(() => phaseTemplate.id),
  templateVersion: integer("template_version").notNull(),
  appliedByUserId: integer("applied_by_user_id").references(() => users.id),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  applicationKey: text("application_key").notNull().unique(),
  resultSummaryJson: jsonb("result_summary_json"),
});
export const insertPhaseTemplateApplicationSchema = createInsertSchema(phaseTemplateApplication).omit({ id: true, appliedAt: true } as any);
export type InsertPhaseTemplateApplication = z.infer<typeof insertPhaseTemplateApplicationSchema>;
export type PhaseTemplateApplication = typeof phaseTemplateApplication.$inferSelect;

// ===================== COMPANY LIFECYCLE PHASES (Part C) =====================

export const COMPANY_LIFECYCLE_PHASES = [
  'FIRST_ASSESSMENT',
  'COST_PROPOSAL_DESIGN',
  'PD_PM_HANDOVER',
  'EXECUTION',
  'AFTER_SALES',
] as const;
export type CompanyLifecyclePhase = typeof COMPANY_LIFECYCLE_PHASES[number];

export const COMPANY_LIFECYCLE_PHASE_LABELS: Record<CompanyLifecyclePhase, string> = {
  FIRST_ASSESSMENT: "First Assessment",
  COST_PROPOSAL_DESIGN: "Cost Proposal & Design",
  PD_PM_HANDOVER: "PD → PM Handover",
  EXECUTION: "Execution",
  AFTER_SALES: "After Sales",
};


// ===================== GOVERNANCE =====================

export const mergeAuditLog = pgTable("merge_audit_log", {
  id: serial("id").primaryKey(),
  primaryProjectId: integer("primary_project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  secondaryProjectId: integer("secondary_project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  primaryProjectName: text("primary_project_name").notNull(),
  secondaryProjectName: text("secondary_project_name").notNull(),
  mergedByUserId: integer("merged_by_user_id").references(() => users.id),
  mergedByRole: text("merged_by_role"),
  reason: text("reason"),
  conflictsJson: text("conflicts_json"),
  movedTaskCount: integer("moved_task_count").notNull().default(0),
  movedPlanCount: integer("moved_plan_count").notNull().default(0),
  mergedAt: timestamp("merged_at").notNull().defaultNow(),
});
export type MergeAuditLog = typeof mergeAuditLog.$inferSelect;

export const executionGateLog = pgTable("execution_gate_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  reason: text("reason"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedByRole: text("changed_by_role"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});
export type ExecutionGateLog = typeof executionGateLog.$inferSelect;

export const stageGateDefinitions = pgTable("stage_gate_definitions", {
  id: serial("id").primaryKey(),
  gateName: text("gate_name").notNull(),
  fromStage: text("from_stage").notNull(),
  targetStage: text("target_stage").notNull(),
  requirementType: text("requirement_type").notNull(),
  requirementKey: text("requirement_key").notNull(),
  requirementConfig: jsonb("requirement_config").notNull().default({}),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type StageGateDefinition = typeof stageGateDefinitions.$inferSelect;

export const projectGateEvaluations = pgTable("project_gate_evaluations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  gateName: text("gate_name").notNull(),
  fromStage: text("from_stage"),
  targetStage: text("target_stage").notNull(),
  status: text("status").notNull(),
  missingItems: jsonb("missing_items").notNull().default([]),
  hasOverride: boolean("has_override").notNull().default(false),
  overrideId: integer("override_id").references(() => stageGateOverrides.id, { onDelete: "set null" }),
  evaluatedByUserId: integer("evaluated_by_user_id").references(() => users.id),
  evaluatedByRole: text("evaluated_by_role"),
  evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
});
export type ProjectGateEvaluation = typeof projectGateEvaluations.$inferSelect;

export const stageGateOverrides = pgTable("stage_gate_overrides", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  gateName: text("gate_name").notNull(),
  targetStage: text("target_stage").notNull(),
  overrideReason: text("override_reason").notNull(),
  overriddenBy: integer("overridden_by").references(() => users.id),
  overriddenByRole: text("overridden_by_role").notNull(),
  note: text("note"),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});
export type StageGateOverride = typeof stageGateOverrides.$inferSelect;

// ===================== PORTFOLIO MANAGEMENT =====================

export const portfolios = pgTable("portfolios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clientName: text("client_name"),
  status: text("status").notNull().default("Active"),
  description: text("description"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertPortfolioSchema = createInsertSchema(portfolios).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfolios.$inferSelect;

export const portfolioRolloutPlans = pgTable("portfolio_rollout_plans", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertPortfolioRolloutPlanSchema = createInsertSchema(portfolioRolloutPlans).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertPortfolioRolloutPlan = z.infer<typeof insertPortfolioRolloutPlanSchema>;
export type PortfolioRolloutPlan = typeof portfolioRolloutPlans.$inferSelect;

export const portfolioRolloutPhases = pgTable("portfolio_rollout_phases", {
  id: serial("id").primaryKey(),
  rolloutPlanId: integer("rollout_plan_id").notNull().references(() => portfolioRolloutPlans.id, { onDelete: 'cascade' }),
  phaseName: text("phase_name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  targetKwp: decimal("target_kwp", { precision: 12, scale: 2 }),
  targetRevenue: decimal("target_revenue", { precision: 15, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertPortfolioRolloutPhaseSchema = createInsertSchema(portfolioRolloutPhases).omit({ id: true } as any);
export type InsertPortfolioRolloutPhase = z.infer<typeof insertPortfolioRolloutPhaseSchema>;
export type PortfolioRolloutPhase = typeof portfolioRolloutPhases.$inferSelect;

export const projectPortfolioAssignments = pgTable("project_portfolio_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id).unique(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  assignedBy: integer("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  movedBy: integer("moved_by").references(() => users.id),
  movedAt: timestamp("moved_at"),
});
export const insertProjectPortfolioAssignmentSchema = createInsertSchema(projectPortfolioAssignments).omit({ id: true, assignedAt: true } as any);
export type InsertProjectPortfolioAssignment = z.infer<typeof insertProjectPortfolioAssignmentSchema>;
export type ProjectPortfolioAssignment = typeof projectPortfolioAssignments.$inferSelect;

// ===================== PROJECT CLIENT HISTORY =====================

export const projectClientHistory = pgTable("project_client_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  oldClientId: integer("old_client_id").references(() => clients.id),
  newClientId: integer("new_client_id").references(() => clients.id),
  movedByUserId: integer("moved_by_user_id").notNull().references(() => users.id),
  movedAt: timestamp("moved_at").notNull().defaultNow(),
  reason: text("reason"),
});
export const insertProjectClientHistorySchema = createInsertSchema(projectClientHistory).omit({ id: true, movedAt: true } as any);
export type InsertProjectClientHistory = z.infer<typeof insertProjectClientHistorySchema>;
export type ProjectClientHistory = typeof projectClientHistory.$inferSelect;

// ===================== USER PROJECT FOLDERS =====================

export const userProjectFolders = pgTable("user_project_folders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  folderName: text("folder_name").notNull(),
  folderPath: text("folder_path"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type UserProjectFolder = typeof userProjectFolders.$inferSelect;

// ===================== CHANGE REQUESTS =====================

export const changeRequestTypeEnum = pgEnum('change_request_type', ['scope', 'cost', 'schedule', 'technical', 'commercial']);
export const changeRequestStatusEnum = pgEnum('change_request_status', ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented', 'closed']);

export const changeRequests = pgTable("change_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  title: text("title").notNull(),
  description: text("description"),
  changeType: changeRequestTypeEnum("change_type").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  impactSummary: text("impact_summary"),
  // C4 (audit closeout): converted from real() to decimal(15,2) for exact ZAR storage.
  // Migration: 20260412_financial_columns_to_numeric.sql
  costImpact: decimal("cost_impact", { precision: 15, scale: 2 }),
  scheduleImpact: integer("schedule_impact_days"),
  status: changeRequestStatusEnum("status").notNull().default('draft'),
  approvalId: integer("approval_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // B6: VO/Change enrichment — revenue/COS/margin impact and formal decision
  cause: text("cause"),
  clientLinked: boolean("client_linked").default(false),
  revenueImpact: decimal("revenue_impact", { precision: 15, scale: 2 }),
  cosImpact: decimal("cos_impact", { precision: 15, scale: 2 }),
  marginImpact: decimal("margin_impact", { precision: 15, scale: 2 }),
  evidenceLink: text("evidence_link"),
  finalDecision: text("final_decision"),       // 'approved', 'rejected', 'deferred'
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
});
export const insertChangeRequestSchema = createInsertSchema(changeRequests).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true, deleteReason: true } as any);
export type InsertChangeRequest = z.infer<typeof insertChangeRequestSchema>;
export type ChangeRequest = typeof changeRequests.$inferSelect;

// ===================== RAID ITEMS =====================

export const raidTypeEnum = pgEnum('raid_type', ['risk', 'assumption', 'issue', 'decision']);
export const raidStatusEnum = pgEnum('raid_status', ['open', 'mitigating', 'resolved', 'closed', 'accepted']);
export const raidPriorityEnum = pgEnum('raid_priority', ['low', 'medium', 'high', 'critical']);

export const raidItems = pgTable("raid_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  type: raidTypeEnum("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  status: raidStatusEnum("status").notNull().default('open'),
  priority: raidPriorityEnum("priority").notNull().default('medium'),
  dueDate: text("due_date"),
  mitigationResponse: text("mitigation_response"),
  linkedTaskId: integer("linked_task_id"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertRaidItemSchema = createInsertSchema(raidItems).omit({ id: true, createdAt: true, updatedAt: true, closedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertRaidItem = z.infer<typeof insertRaidItemSchema>;
export type RaidItem = typeof raidItems.$inferSelect;

// ===================== DERIVED PROJECT KPIs =====================

export const derivedProjectKpis = pgTable("derived_project_kpis", {
  id: serial("id").primaryKey(),
  projectKey: text("project_key").notNull().unique(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  phase: text("phase"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  ragStatus: text("rag_status"),
  pm: text("pm"),
  pd: text("pd"),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  totalPlannedRevenue: decimal("total_planned_revenue", { precision: 15, scale: 2 }),
  totalActualRevenue: decimal("total_actual_revenue", { precision: 15, scale: 2 }),
  revenueRealised: decimal("revenue_realised", { precision: 15, scale: 2 }),
  revenueOutstanding: decimal("revenue_outstanding", { precision: 15, scale: 2 }),
  totalPlannedExpenses: decimal("total_planned_expenses", { precision: 15, scale: 2 }),
  totalActualExpenses: decimal("total_actual_expenses", { precision: 15, scale: 2 }),
  cosRealised: decimal("cos_realised", { precision: 15, scale: 2 }),
  expensesOutstanding: decimal("expenses_outstanding", { precision: 15, scale: 2 }),
  grossProfit: decimal("gross_profit", { precision: 15, scale: 2 }),
  grossMarginPct: decimal("gross_margin_pct", { precision: 8, scale: 4 }),
  avgActualPctComplete: decimal("avg_actual_pct_complete", { precision: 8, scale: 4 }),
  avgExpectedPctComplete: decimal("avg_expected_pct_complete", { precision: 8, scale: 4 }),
  scheduleDelta: decimal("schedule_delta", { precision: 8, scale: 4 }),
  taskCount: integer("task_count").notNull().default(0),
  expenseLineCount: integer("expense_line_count").notNull().default(0),
  revenueLineCount: integer("revenue_line_count").notNull().default(0),
  needsReview: boolean("needs_review").notNull().default(false),
  needsReviewReason: text("needs_review_reason"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
});
export type DerivedProjectKpi = typeof derivedProjectKpis.$inferSelect;

// ===================== SCENARIOS =====================

export const scenarios = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScenarioSchema = createInsertSchema(scenarios).omit({ id: true, createdAt: true } as any);
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenarios.$inferSelect;

// ===================== KEY DATE MAPPINGS =====================

export const keyDateMappings = pgTable("key_date_mappings", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  keyDateName: text("key_date_name").notNull(),
  sourceTaskId: integer("source_task_id"),
  sourceTaskCode: text("source_task_code"),
  sourceTaskNameMatch: text("source_task_name_match"),
  dateField: text("date_field").notNull().default("dueDate"),
  precedenceRule: text("precedence_rule").notNull().default("actual_over_planned"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKeyDateMappingSchema = createInsertSchema(keyDateMappings).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertKeyDateMapping = z.infer<typeof insertKeyDateMappingSchema>;
export type KeyDateMapping = typeof keyDateMappings.$inferSelect;

// ===================== NORMALIZED EXECUTION PHASES =====================

export const normalizedExecutionPhases = pgTable("normalized_execution_phases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  phaseName: text("phase_name").notNull(),
  phaseDate: text("phase_date"),
  source: phaseSourceEnum("source").notNull().default('EXCEL_IMPORT'),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertNormalizedExecutionPhaseSchema = createInsertSchema(normalizedExecutionPhases).omit({ id: true, createdAt: true } as any);
export type InsertNormalizedExecutionPhase = z.infer<typeof insertNormalizedExecutionPhaseSchema>;
export type NormalizedExecutionPhase = typeof normalizedExecutionPhases.$inferSelect;

// ===================== DASHBOARD MATERIALIZED METRICS (Prompt 12) =====================

export const dashboardProjectMetrics = pgTable("dashboard_project_metrics", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").unique().notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  // Financial aggregates
  totalRevenue: decimal("total_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  receivedRevenue: decimal("received_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  outstandingRevenue: decimal("outstanding_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  paidCost: decimal("paid_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  outstandingCost: decimal("outstanding_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  marginPct: decimal("margin_pct", { precision: 8, scale: 4 }),
  // Task aggregates
  taskCount: integer("task_count").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  tasksInProgress: integer("tasks_in_progress").notNull().default(0),
  tasksOverdue: integer("tasks_overdue").notNull().default(0),
  tasksActive: integer("tasks_active").notNull().default(0),
  // QC aggregates
  openWarnings: integer("open_warnings").notNull().default(0),
  qcProgressPct: decimal("qc_progress_pct", { precision: 8, scale: 4 }),
  // Snapshot of current state
  healthScore: decimal("health_score", { precision: 5, scale: 2 }),
  phase: text("phase"),
  ragStatus: text("rag_status"),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  projectName: text("project_name"),
  pm: text("pm"),
  pd: text("pd"),
  // Metadata
  lastRefreshedAt: timestamp("last_refreshed_at").notNull().defaultNow(),
});
export type DashboardProjectMetrics = typeof dashboardProjectMetrics.$inferSelect;

export const dashboardProgramMetrics = pgTable("dashboard_program_metrics", {
  id: serial("id").primaryKey(),
  totalProjects: integer("total_projects").notNull().default(0),
  activeProjects: integer("active_projects").notNull().default(0),
  totalProgramRevenue: decimal("total_program_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  totalProgramCost: decimal("total_program_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  receivedRevenue: decimal("received_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  paidCost: decimal("paid_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  avgMargin: decimal("avg_margin", { precision: 8, scale: 4 }),
  projectsAtRisk: integer("projects_at_risk").notNull().default(0),
  totalTasksOverdue: integer("total_tasks_overdue").notNull().default(0),
  totalOpenWarnings: integer("total_open_warnings").notNull().default(0),
  lastRefreshedAt: timestamp("last_refreshed_at").notNull().defaultNow(),
});
export type DashboardProgramMetrics = typeof dashboardProgramMetrics.$inferSelect;

// ===================== PROJECT HANDOVER GATES =====================

export const projectHandoverGates = pgTable("project_handover_gates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  gateId: text("gate_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  checkedItems: jsonb("checked_items").default([]),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completedByName: text("completed_by_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueProjectGate: unique("project_handover_gates_project_gate_unique").on(table.projectId, table.gateId),
}));
export type ProjectHandoverGate = typeof projectHandoverGates.$inferSelect;

export const projectHandoverHistory = pgTable("project_handover_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  gateId: text("gate_id").notNull(),
  action: text("action").notNull(),
  performedByUserId: integer("performed_by_user_id").references(() => users.id),
  performedByName: text("performed_by_name"),
  performedByRole: text("performed_by_role"),
  details: jsonb("details"),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
});
export type ProjectHandoverHistory = typeof projectHandoverHistory.$inferSelect;

// ===================== PD → PM HANDOVER =====================

export const projectPdPmHandover = pgTable("project_pd_pm_handover", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectInfo.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("DRAFT"),
  handoverStatusText: text("handover_status_text"),
  pdOwner: text("pd_owner"),
  pmOwner: text("pm_owner"),
  summary: text("summary"),
  risks: text("risks"),
  assumptions: text("assumptions"),
  engineeringStatus: text("engineering_status"),
  qualityStatus: text("quality_status"),
  notesToPm: text("notes_to_pm"),
  handoverSummary: text("handover_summary"),
  deliverables: jsonb("deliverables").notNull().default({}),
  submittedBy: text("submitted_by"),
  submittedAt: timestamp("submitted_at"),
  acceptedBy: text("accepted_by"),
  acceptedAt: timestamp("accepted_at"),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  feasibilityStatus: text("feasibility_status"),
  feasibilityNotes: text("feasibility_notes"),
  dependencySummary: text("dependency_summary"),
  handoverReadinessStatus: text("handover_readiness_status"),
  handoverReadinessNotes: text("handover_readiness_notes"),
  // V2 enhanced handover fields
  handoverFormData: jsonb("handover_form_data").default({}),
  readinessChecklist: jsonb("readiness_checklist").default({}),
  readinessScore: integer("readiness_score").default(0),
  pdSignOffAt: timestamp("pd_sign_off_at"),
  pdSignOffBy: text("pd_sign_off_by"),
  pmSignOffAt: timestamp("pm_sign_off_at"),
  pmSignOffBy: text("pm_sign_off_by"),
  kickoffDate: date("kickoff_date"),
  lessonsReviewed: boolean("lessons_reviewed").default(false),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ProjectPdPmHandover = typeof projectPdPmHandover.$inferSelect;

// ===================== SUBCONTRACTOR ASSIGNMENTS =====================

export const subcontractorAssignmentStatusEnum = pgEnum('subcontractor_assignment_status', ['active', 'completed', 'suspended', 'terminated']);

export const projectSubcontractorAssignments = pgTable("project_subcontractor_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  counterpartyId: integer("counterparty_id").notNull(), // FK to counterparties(id) — defined in finance.ts (circular dep)
  workPackage: text("work_package"),
  scopeDescription: text("scope_description"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  status: subcontractorAssignmentStatusEnum("status").notNull().default("active"),
  keyDates: jsonb("key_dates"),
  performanceNotes: text("performance_notes"),
  linkedApprovalId: integer("linked_approval_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ProjectSubcontractorAssignment = typeof projectSubcontractorAssignments.$inferSelect;

// ===================== PROJECT LINKAGE REVIEW QUEUE =====================

export const projectLinkageReviewQueue = pgTable("project_linkage_review_queue", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  recordId: integer("record_id").notNull(),
  reason: text("reason").notNull(),
  contextJson: jsonb("context_json"),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueTableRecord: unique("project_linkage_review_queue_table_record_unique").on(table.tableName, table.recordId),
}));
export type ProjectLinkageReviewQueue = typeof projectLinkageReviewQueue.$inferSelect;

// ===================== MONTHLY REPORT SNAPSHOTS =====================

export const monthlyReportSnapshots = pgTable("monthly_report_snapshots", {
  id: serial("id").primaryKey(),
  reportType: varchar("report_type", { length: 20 }).notNull(),
  reportMonth: varchar("report_month", { length: 7 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  data: jsonb("data").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  regeneratedAt: timestamp("regenerated_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  publishedBy: integer("published_by").references(() => users.id),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueTypeMonth: unique("monthly_report_snapshots_type_month_unique").on(table.reportType, table.reportMonth),
}));
export const insertMonthlyReportSnapshotSchema = createInsertSchema(monthlyReportSnapshots).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertMonthlyReportSnapshot = z.infer<typeof insertMonthlyReportSnapshotSchema>;
export type MonthlyReportSnapshot = typeof monthlyReportSnapshots.$inferSelect;

// ===================== FINANCIAL REVIEW GATE =====================

export const projectFinancialReviews = pgTable("project_financial_reviews", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),

  // Review lifecycle
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),

  // Financial snapshot
  budgetBaselineId: integer("budget_baseline_id"),
  snapshotBudgetTotal: decimal("snapshot_budget_total", { precision: 15, scale: 2 }),
  snapshotActualTotal: decimal("snapshot_actual_total", { precision: 15, scale: 2 }),
  snapshotVariance: decimal("snapshot_variance", { precision: 15, scale: 2 }),
  snapshotVariancePct: decimal("snapshot_variance_pct", { precision: 8, scale: 4 }),
  snapshotMargin: decimal("snapshot_margin", { precision: 8, scale: 4 }),
  snapshotContingencyRemaining: decimal("snapshot_contingency_remaining", { precision: 15, scale: 2 }),
  snapshotProcurementReadiness: real("snapshot_procurement_readiness"),
  snapshotData: jsonb("snapshot_data").notNull().default({}),
  snapshotCapturedAt: timestamp("snapshot_captured_at"),

  // Review meeting
  reviewDate: date("review_date"),
  reviewMeetingRef: text("review_meeting_ref"),

  // Participants
  participants: jsonb("participants").notNull().default([]),

  // Five structured review sections
  budgetReview: jsonb("budget_review").notNull().default({}),
  procurementReview: jsonb("procurement_review").notNull().default({}),
  scopeReview: jsonb("scope_review").notNull().default({}),
  logisticsReview: jsonb("logistics_review").notNull().default({}),
  hseReview: jsonb("hse_review").notNull().default({}),

  // Overall outcome
  outcome: text("outcome"),
  outcomeConditions: text("outcome_conditions"),
  outcomeNotes: text("outcome_notes"),

  // Approval chain
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),

  // Links to canonical systems
  approvalId: integer("approval_id"),
  gateEvaluationId: integer("gate_evaluation_id"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  projectStatusIdx: index("idx_financial_reviews_project_status").on(table.projectId, table.status),
}));

export const insertProjectFinancialReviewSchema = createInsertSchema(projectFinancialReviews).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectFinancialReview = z.infer<typeof insertProjectFinancialReviewSchema>;
export type ProjectFinancialReview = typeof projectFinancialReviews.$inferSelect;

// ===================== PROJECT EVENTS (Timeline) =====================

export const projectEvents = pgTable("project_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  eventType: text("event_type").notNull(),
  eventTimestamp: timestamp("event_timestamp").notNull().defaultNow(),
  actorUserId: integer("actor_user_id"),
  actorRole: text("actor_role"),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceEntityId: text("source_entity_id").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details").default({}),
  visibility: jsonb("visibility").default({ scope: "project" }),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdempotencyUnique: unique("uq_project_events_idempotency").on(table.projectId, table.idempotencyKey),
}));
export type ProjectEvent = typeof projectEvents.$inferSelect;
