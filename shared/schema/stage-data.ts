// ============================================================
// STAGE DATA SCHEMA — Stage-specific fields + Project Charters
// ============================================================
// Tables: project_stage_data, project_charters
// ============================================================

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb, unique, index, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// ===================== PROJECT STAGE DATA =====================
// Flexible JSONB storage for stage-specific fields (one row per project per stage)

export const projectStageData = pgTable("project_stage_data", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  data: jsonb("data").notNull().default({}),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectStageUnique: unique("project_stage_data_project_stage_uq").on(table.projectId, table.stageCode),
  projectIdIdx: index("psd_data_project_id_idx").on(table.projectId),
}));

export const insertProjectStageDataSchema = createInsertSchema(projectStageData).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectStageData = z.infer<typeof insertProjectStageDataSchema>;
export type ProjectStageData = typeof projectStageData.$inferSelect;

// ===================== PROJECT CHARTERS =====================
// Structured charter form for Stage 4 PD→PM Handover (one row per project)

export const projectCharters = pgTable("project_charters", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }).unique(),

  // ── Section 1: Overview ──
  charterProjectName: text("charter_project_name"),
  charterSiteName: text("charter_site_name"),
  charterSiteAddress: text("charter_site_address"),
  charterGpsCoordinates: text("charter_gps_coordinates"),
  charterFacilityType: text("charter_facility_type"),
  charterUtilitySupplier: text("charter_utility_supplier"),
  charterExistingInfrastructure: text("charter_existing_infrastructure"),
  charterRoofType: text("charter_roof_type"),
  charterAccessMethod: text("charter_access_method"),
  charterSpecialSiteNotes: text("charter_special_site_notes"),
  charterStructuralAssessmentDone: boolean("charter_structural_assessment_done").default(false),
  charterStructuralAssessmentNotes: text("charter_structural_assessment_notes"),

  // ── Section 2: Stakeholders — External ──
  charterClientName: text("charter_client_name"),
  charterClientType: text("charter_client_type"),
  charterPrimaryContactName: text("charter_primary_contact_name"),
  charterPrimaryContactEmail: text("charter_primary_contact_email"),
  charterPrimaryContactPhone: text("charter_primary_contact_phone"),
  charterClientRelationshipNotes: text("charter_client_relationship_notes"),

  // ── Section 2: Stakeholders — Internal ──
  charterPdUserId: integer("charter_pd_user_id").references(() => users.id),
  charterProgrammeManagerUserId: integer("charter_programme_manager_user_id").references(() => users.id),
  charterProjectManagerUserId: integer("charter_project_manager_user_id").references(() => users.id),
  charterProcurementManagerUserId: integer("charter_procurement_manager_user_id").references(() => users.id),
  charterOmManagerUserId: integer("charter_om_manager_user_id").references(() => users.id),
  charterAssetManagerUserId: integer("charter_asset_manager_user_id").references(() => users.id),
  charterComplianceOfficerUserId: integer("charter_compliance_officer_user_id").references(() => users.id),
  charterSafetyOfficerUserId: integer("charter_safety_officer_user_id").references(() => users.id),
  charterDesignerUserId: integer("charter_designer_user_id").references(() => users.id),
  charterPreferredInstaller: text("charter_preferred_installer"),

  // ── Section 3: Scope — System Specification ──
  charterSystemType: text("charter_system_type"),
  charterSystemSizeKwp: real("charter_system_size_kwp"),
  charterInverterCapacityKva: real("charter_inverter_capacity_kva"),
  charterBatteryCapacityKwh: real("charter_battery_capacity_kwh"),
  charterModuleSpec: text("charter_module_spec"),
  charterInverterSpec: text("charter_inverter_spec"),
  charterMountingType: text("charter_mounting_type"),
  charterMonitoringSystem: text("charter_monitoring_system"),
  charterMetering: text("charter_metering"),
  charterDieselGenIntegration: boolean("charter_diesel_gen_integration").default(false),
  charterDedicatedFeeder: boolean("charter_dedicated_feeder").default(false),
  charterTransformerDetails: text("charter_transformer_details"),
  charterTieInPoints: text("charter_tie_in_points"),
  charterMainBreakerDetails: text("charter_main_breaker_details"),
  charterInternetProvision: text("charter_internet_provision"),

  // ── Section 3: Scope — HSE ──
  charterHseContactEstablished: boolean("charter_hse_contact_established").default(false),
  charterLifelinesRequired: boolean("charter_lifelines_required").default(false),
  charterAdditionalSecurityRequired: boolean("charter_additional_security_required").default(false),
  charterHseNotes: text("charter_hse_notes"),

  // ── Section 3: Scope — SSEG / Compliance ──
  charterSsegApplicationStatus: text("charter_sseg_application_status"),
  charterGridStudyStatus: text("charter_grid_study_status"),
  charterNotificationNumber: text("charter_notification_number"),

  // ── Section 3: Scope — O&M ──
  charterOmContractType: text("charter_om_contract_type"),
  charterWaterpointsAvailable: boolean("charter_waterpoints_available").default(false),
  charterMeteringBillingRequired: boolean("charter_metering_billing_required").default(false),
  charterOmSpecialNotes: text("charter_om_special_notes"),

  // ── Section 4: Schedule ──
  charterAlignmentMeetingDate: date("charter_alignment_meeting_date"),
  charterInstallerWalkthroughDate: date("charter_installer_walkthrough_date"),
  charterExternalIntroMeetingDate: date("charter_external_intro_meeting_date"),
  charterInternalReviewDate: date("charter_internal_review_date"),
  charterClientKickoffDate: date("charter_client_kickoff_date"),
  charterSiteEstablishmentDate: date("charter_site_establishment_date"),
  charterExpectedCompletionDate: date("charter_expected_completion_date"),
  charterHandoverDateTarget: date("charter_handover_date_target"),

  // ── Section 5: Budget ──
  charterFundingModel: text("charter_funding_model"),
  charterPaymentTermsText: text("charter_payment_terms_text"),
  charterInvoiceConditionsText: text("charter_invoice_conditions_text"),
  charterFundingPartner: text("charter_funding_partner"),
  charterDepositStatus: text("charter_deposit_status"),
  charterBdpCommission: text("charter_bdp_commission"),
  charterBudgetNotes: text("charter_budget_notes"),

  // ── Section 6: Risks / Opportunities / Triage ──
  charterOverviewRiskSummary: text("charter_overview_risk_summary"),
  charterStakeholderRiskSummary: text("charter_stakeholder_risk_summary"),
  charterScopeRiskSummary: text("charter_scope_risk_summary"),
  charterScheduleRiskSummary: text("charter_schedule_risk_summary"),
  charterBudgetRiskSummary: text("charter_budget_risk_summary"),
  charterTriageLevel: text("charter_triage_level"),
  charterOpportunitiesText: text("charter_opportunities_text"),

  // ── Meta ──
  status: text("status").notNull().default("draft"),  // draft, complete, reviewed, accepted
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectCharterSchema = createInsertSchema(projectCharters).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectCharter = z.infer<typeof insertProjectCharterSchema>;
export type ProjectCharter = typeof projectCharters.$inferSelect;

// ===================== ZOD VALIDATION SCHEMAS =====================
// Per-stage field validation for stage data JSONB

export const stage1DataSchema = z.object({
  client_enquiry_source: z.string().optional(),
  client_need_summary: z.string().optional(),
  site_address: z.string().optional(),
  site_type: z.enum(["roof", "ground", "carport", "other"]).optional(),
  grid_connection_type: z.string().optional(),
  estimated_kwp: z.number().optional(),
  funding_model_indication: z.string().optional(),
  client_risk_flag: z.string().optional(),
  strategic_fit: z.enum(["yes", "no"]).optional(),
  go_no_go_recommendation: z.enum(["go", "park", "no_go"]).optional(),
  go_no_go_reason: z.string().optional(),
  assessment_date: z.string().optional(),
});
export type Stage1Data = z.infer<typeof stage1DataSchema>;

export const stage2DataSchema = z.object({
  site_visit_complete: z.boolean().optional(),
  site_visit_date: z.string().optional(),
  site_accuracy_status: z.string().optional(),
  design_basis_complete: z.boolean().optional(),
  design_basis_doc_url: z.string().optional(),
  system_design_version: z.string().optional(),
  cost_model_complete: z.boolean().optional(),
  cost_model_file_url: z.string().optional(),
  margin_pct: z.number().optional(),
  major_risks_text: z.string().optional(),
  assumptions_text: z.string().optional(),
  engineering_review_status: z.string().optional(),
  commercial_review_status: z.string().optional(),
  proposal_ready_status: z.string().optional(),
  pd_confirmed: z.boolean().optional(),
  design_engineer_confirmed: z.boolean().optional(),
});
export type Stage2Data = z.infer<typeof stage2DataSchema>;

export const stage3DataSchema = z.object({
  // Track 1
  cost_proposal_signed: z.boolean().optional(),
  cost_proposal_signed_date: z.string().optional(),
  cost_proposal_document_url: z.string().optional(),
  // Track 2
  epc_contract_signed: z.boolean().optional(),
  epc_contract_signed_date: z.string().optional(),
  epc_contract_document_url: z.string().optional(),
  // Track 3
  funding_contract_signed: z.boolean().optional(),
  funding_contract_signed_date: z.string().optional(),
  funding_contract_document_url: z.string().optional(),
  funding_type: z.string().optional(),
  funding_partner_status: z.string().optional(),
  // Track 4
  om_contract_signed: z.boolean().optional(),
  om_contract_signed_date: z.string().optional(),
  om_contract_document_url: z.string().optional(),
  // Track configuration
  tracks_enabled: z.object({
    cost_proposal: z.boolean().optional(),
    epc: z.boolean().optional(),
    funding: z.boolean().optional(),
    om: z.boolean().optional(),
  }).optional(),
  // Additional fields
  financial_close_status: z.string().optional(),
  conditions_precedent_open_count: z.number().optional(),
  conditions_precedent_notes: z.string().optional(),
  commercial_exception_count: z.number().optional(),
  contract_changes_from_proposal_text: z.string().optional(),
  margin_bridge_text: z.string().optional(),
  key_obligations_for_pm_text: z.string().optional(),
  execution_enablement_status: z.string().optional(),
  contractual_dates_text: z.string().optional(),
  // Conditional
  fedgroup_status: z.string().optional(),
  ppa_status: z.string().optional(),
  isa_status: z.string().optional(),
});
export type Stage3Data = z.infer<typeof stage3DataSchema>;

export const stage4DataSchema = z.object({
  project_charter_status: z.enum(["draft", "complete", "reviewed", "accepted"]).optional(),
  scope_summary_text: z.string().optional(),
  commercial_summary_text: z.string().optional(),
  design_pack_url: z.string().optional(),
  stakeholder_list_complete: z.boolean().optional(),
  risk_register_started: z.boolean().optional(),
  special_conditions_text: z.string().optional(),
  long_lead_items_text: z.string().optional(),
  permits_and_approvals_text: z.string().optional(),
  handover_meeting_date: z.string().optional(),
  handover_minutes_url: z.string().optional(),
  pm_review_status: z.string().optional(),
  pm_acceptance_status: z.enum(["accepted", "accepted_with_reservations", "rejected"]).optional(),
  pm_rejection_reason: z.string().optional(),
  reserved_items_json: z.array(z.object({
    item: z.string(),
    owner: z.string(),
    deadline: z.string(),
    status: z.string(),
  })).optional(),
});
export type Stage4Data = z.infer<typeof stage4DataSchema>;

export const stage5DataSchema = z.object({
  baseline_revenue: z.number().optional(),
  baseline_cos: z.number().optional(),
  committed_cost: z.number().optional(),
  actual_invoiced_cost: z.number().optional(),
  forecast_cost: z.number().optional(),
  forecast_margin_pct: z.number().optional(),
  margin_drift_pct: z.number().optional(),
  open_vo_count: z.number().optional(),
  procurement_risk_text: z.string().optional(),
  po_payment_dependencies_text: z.string().optional(),
  milestone_evidence_status: z.string().optional(),
  variance_commentary_text: z.string().optional(),
  financial_review_notes: z.string().optional(),
  financial_review_status: z.string().optional(),
  financial_review_date: z.string().optional(),
});
export type Stage5Data = z.infer<typeof stage5DataSchema>;

export const stage6DataSchema = z.object({
  construction_start_date_planned: z.string().optional(),
  construction_start_date_actual: z.string().optional(),
  construction_schedule_url: z.string().optional(),
  installer_name: z.string().optional(),
  installer_contract_status: z.string().optional(),
  installer_mobilised: z.boolean().optional(),
  material_inflow_status: z.enum(["on_track", "delayed", "critical"]).optional(),
  key_equipment_status: z.enum(["on_track", "delayed", "critical"]).optional(),
  site_access_confirmed: z.boolean().optional(),
  weekly_progress_reporting_active: z.boolean().optional(),
  open_tq_count: z.number().optional(),
  open_variation_count: z.number().optional(),
  hse_plan_approved: z.boolean().optional(),
  hse_induction_complete: z.boolean().optional(),
  sseg_application_status: z.string().optional(),
  practical_completion_target: z.string().optional(),
  construction_progress_pct: z.number().optional(),
  construction_gate_status: z.string().optional(),
});
export type Stage6Data = z.infer<typeof stage6DataSchema>;

export const stage7DataSchema = z.object({
  commissioning_plan_url: z.string().optional(),
  commissioning_date: z.string().optional(),
  test_results_uploaded: z.boolean().optional(),
  snag_count_open: z.number().optional(),
  snag_count_closed: z.number().optional(),
  ncr_count_open: z.number().optional(),
  ncr_count_closed: z.number().optional(),
  practical_completion_status: z.string().optional(),
  practical_completion_date: z.string().optional(),
  techsitter_confirmed: z.boolean().optional(),
  metering_confirmed: z.boolean().optional(),
  monitoring_live: z.boolean().optional(),
  internet_connectivity_confirmed: z.boolean().optional(),
  quality_review_status: z.string().optional(),
  engineering_acceptance_status: z.string().optional(),
  hse_safe_to_energise: z.boolean().optional(),
  billing_readiness_status: z.string().optional(),
  commissioning_gate_status: z.string().optional(),
  installer_signoff_date: z.string().optional(),
  client_signoff_date: z.string().optional(),
});
export type Stage7Data = z.infer<typeof stage7DataSchema>;

export const stage8DataSchema = z.object({
  om_handover_checklist_status: z.string().optional(),
  as_builts_uploaded: z.boolean().optional(),
  warranties_uploaded: z.boolean().optional(),
  om_manual_uploaded: z.boolean().optional(),
  serial_numbers_uploaded: z.boolean().optional(),
  targets_confirmed: z.boolean().optional(),
  monitoring_access_confirmed: z.boolean().optional(),
  training_complete: z.boolean().optional(),
  om_handover_meeting_date: z.string().optional(),
  om_handover_minutes_url: z.string().optional(),
  matriarch_acceptance_status: z.enum(["accepted", "accepted_with_reservations", "rejected"]).optional(),
  matriarch_acceptance_date: z.string().optional(),
  matriarch_rejection_reason: z.string().optional(),
  asset_manager_assigned_user_id: z.number().optional(),
  soft_monitoring_end_date: z.string().optional(),
  review_sla_start_date: z.string().optional(),
  review_sla_due_date: z.string().optional(),
  open_workmanship_items_count: z.number().optional(),
  reserved_items_json: z.array(z.object({
    item: z.string(),
    owner: z.string(),
    deadline: z.string(),
    status: z.string(),
  })).optional(),
});
export type Stage8Data = z.infer<typeof stage8DataSchema>;

export const stage9DataSchema = z.object({
  client_handover_pack_status: z.string().optional(),
  client_handover_pack_delivered: z.boolean().optional(),
  client_training_complete: z.boolean().optional(),
  open_items_text: z.string().optional(),
  remaining_snag_obligations_text: z.string().optional(),
  warranty_route_confirmed: z.boolean().optional(),
  defects_contact_confirmed: z.boolean().optional(),
  sseg_status_for_client: z.string().optional(),
  operating_instructions_delivered: z.boolean().optional(),
  om_contact_transferred: z.boolean().optional(),
  client_handover_meeting_date: z.string().optional(),
  client_handover_minutes_url: z.string().optional(),
  client_acceptance_status: z.enum(["accepted", "accepted_with_reservations", "not_accepted"]).optional(),
  client_feedback_text: z.string().optional(),
  client_handover_gate_status: z.string().optional(),
});
export type Stage9Data = z.infer<typeof stage9DataSchema>;

export const stage10DataSchema = z.object({
  review_due_date: z.string().optional(),
  review_status: z.enum(["scheduled", "in_progress", "completed", "overdue"]).optional(),
  review_owner_user_id: z.number().optional(),
  review_meeting_date: z.string().optional(),
  actual_vs_expected_summary: z.string().optional(),
  loss_attribution_text: z.string().optional(),
  client_feedback_text: z.string().optional(),
  quality_issue_summary: z.string().optional(),
  compliance_issue_summary: z.string().optional(),
  matriarch_feedback_text: z.string().optional(),
  engineering_lessons_text: z.string().optional(),
  pd_lessons_text: z.string().optional(),
  pm_lessons_text: z.string().optional(),
  relationship_risk_level: z.enum(["low", "medium", "high"]).optional(),
  upsell_opportunity_text: z.string().optional(),
  lessons_learned_text: z.string().optional(),
  follow_up_action_count: z.number().optional(),
  review_completed_date: z.string().optional(),
  review_report_url: z.string().optional(),
});
export type Stage10Data = z.infer<typeof stage10DataSchema>;
