# ROLLOUT PROMPT 3 OF 7 — STAGE WORKSPACES 1–5

Each stage workspace uses the gate engine pattern from Prompt 1 and lives inside the project at `/project/:projectId/current-gate?stage=<stage-code>`.

All stage screens share the same layout:
- **Top:** Stage header (stage name, owner, status, readiness %, target exit date, last updated, "Request review" button, "Approve / send back" button)
- **Left:** Department checklists
- **Middle:** Evidence & documents
- **Right:** Dependencies, meetings, decision log

---

## STAGE 1: FIRST ASSESSMENT

**Route:** `/project/:projectId/current-gate?stage=first-assessment`

**Purpose:** Qualify the opportunity — determine site viability, client fit, and rough feasibility before committing design resources.

**Stage owner:** PD
**Contributors:** Engineering (preliminary technical input), Finance (high-level commercial viability)
**Approver:** Head of PD or COO (for larger deals)

### PD checklist:
- Client enquiry / lead source captured
- Client need summary (business driver, energy goals, timeline expectations)
- Site identified (address, access, basic physical characteristics)
- Preliminary site photos or satellite imagery
- Grid connection type identified (Eskom, municipal, embedded)
- Rough system size estimate (kWp)
- Funding model indication (self-funded, third-party, PPA, lease)
- Client creditworthiness / risk flag
- Strategic fit assessment (aligns with EE target market Y/N)
- Go / No-Go recommendation

### Engineering checklist (light touch):
- Roof or ground suitability flag (obvious constraints)
- SSEG requirement identified (Y/N)
- Preliminary irradiation / yield estimate (if available)

### Finance checklist (light touch):
- Rough deal value estimate
- Funding model viability flag

### Evidence:
- Client enquiry record or Pipedrive link
- Site photos / satellite imagery
- Any preliminary correspondence

### Dependencies panel:
- PD waiting on Engineering for site feasibility flag
- PD waiting on Finance for commercial viability flag

### Decision:
- Go to Design & Cost Proposal → progress to stage 2
- Park → put on hold with reason
- No-Go → close with reason

### Collaboration rule:
- First Assessment cannot progress to Design & Cost Proposal until PD confirms Go recommendation. Bypass allowed with admin override + reason.

### Required fields:
- `client_enquiry_source`
- `client_need_summary`
- `site_address`
- `site_type` (roof / ground / carport / other)
- `grid_connection_type`
- `estimated_kwp`
- `funding_model_indication`
- `client_risk_flag`
- `strategic_fit`
- `go_no_go_recommendation`
- `go_no_go_reason`
- `assessment_date`

---

## STAGE 2: DESIGN & COST PROPOSAL BUILD

**Route:** `/project/:projectId/current-gate?stage=design-costing`

**Purpose:** Make sure the proposed solution is accurate, buildable, commercially safe, and aligned to the client need.

**Workspace type:** Shared proposal room for PD and Design Engineer, with COO visibility where required.

**Stage owner:** PD
**Contributors:** Design Engineer, Engineering Manager, Finance, Quality (optional design peer review for larger projects)
**Approver:** PD + Design Engineer dual confirmation

### PD checklist:
- Client need captured (site, load, business need)
- Scope statement finalized
- Funding structure outline
- Client constraints logged (roof access, production targets, outage constraints, etc.)
- O&M quote trigger raised where applicable (MAM pricing required for some cost proposals)
- Scope-change alerts reviewed (any change from First Assessment flagged)

### Engineering checklist:
- Site data complete (irradiation, grid, structural assumption)
- Preliminary design done
- Design assumptions register populated
- SSEG requirements identified
- Preliminary metering concept defined
- Structural and electrical constraints documented

### Finance checklist:
- Cost build-up complete
- Margin baseline set
- PD price vs cost vs funding structure aligned

### Quality checklist:
- Optional design peer review flag (for larger projects)

### Evidence & documents:
- Proposal versions (with version control)
- Structural pre-check (if available)
- High-level single-line diagram or layout
- Cost model file
- Design basis document

### Dependencies panel:
- PD waiting on Engineering for design assumptions
- PD waiting on Finance for cost finalization
- PD waiting on O&M for MAM pricing (where applicable)

### Decision log (examples):
- "Selected battery OEM X for this site because..."
- "Client insists on tariff Y; margin adjusted"
- "Excluded carport from scope due to structural constraint"

### Collaboration rule:
- Proposal cannot be marked ready until PD and Design Engineer both confirm site accuracy, solution fit, and costing basis. This is a gate, not just a PD ticket. Bypass allowed with admin override + reason.

### Required fields:
- `site_visit_complete` (boolean)
- `site_visit_date`
- `site_accuracy_status`
- `design_basis_complete` (boolean)
- `design_basis_doc_url`
- `system_design_version`
- `cost_model_complete` (boolean)
- `cost_model_file_url`
- `margin_pct`
- `major_risks_text`
- `assumptions_text`
- `engineering_review_status`
- `commercial_review_status`
- `proposal_ready_status`
- `pd_confirmed` (boolean)
- `design_engineer_confirmed` (boolean)

### Actions:
- Save
- Mark ready for review
- Request engineering review
- Request commercial review
- Raise exception
- Progress to next stage

---

## STAGE 3: SIGNATURE & FINANCIAL CLOSE

**Route:** `/project/:projectId/current-gate?stage=financial-close`

**Purpose:** Turn "client likes it" into "project is commercially and contractually real."

**Workspace type:** Commercial close workspace shared by PD, COO, and Finance.

**Stage owner:** COO (accountable)
**Contributors:** PD (responsible), Finance (consulted)
**Approver:** COO

### 4 Deliverable Tracks (configurable per project):

Not all tracks are required on every project. Admin selects which apply at project setup.

**Track 1 — Cost Proposal Signed:**
- `cost_proposal_signed` (boolean)
- `cost_proposal_signed_date`
- `cost_proposal_document_url`

**Track 2 — EPC Signed:**
- `epc_contract_signed` (boolean)
- `epc_contract_signed_date`
- `epc_contract_document_url`

**Track 3 — Funding Contract Signed:**
- `funding_contract_signed` (boolean)
- `funding_contract_signed_date`
- `funding_contract_document_url`
- `funding_type` (self_funded / fedgroup / other)
- `funding_partner_status`

**Track 4 — O&M Signed:**
- `om_contract_signed` (boolean)
- `om_contract_signed_date`
- `om_contract_document_url`

### PD checklist:
- Contract documents uploaded
- Deviations from proposal captured
- Client commitments that deviate from standard template logged
- "Changes since proposal" summary prepared for handover

### Finance checklist:
- Funding approval from partner confirmed (where applicable)
- Payment schedule aligned with milestones
- Platform fees and drawdown flows set (where applicable)
- Deposit required / received

### Exco checklist:
- Strategic risk reviewed (client, site, credit, complexity)
- GO / NO GO sign-off

### Additional required fields:
- `financial_close_status`
- `conditions_precedent_open_count`
- `conditions_precedent_notes`
- `commercial_exception_count`
- `contract_changes_from_proposal_text`
- `margin_bridge_text` (proposal margin vs contracted margin)
- `key_obligations_for_pm_text`
- `execution_enablement_status`
- `contractual_dates_text`

### Conditional sections (show only when relevant):
- `fedgroup_status`
- `ppa_status`
- `isa_status`

### Evidence:
- Signed agreements (per track)
- Financial close notice
- Conditions precedent list
- Commercial exceptions register

### Dependencies:
- PM cannot be assigned until this stage is approved
- MAM pricing confirmed (if O&M track applies)

### Decision log:
- Contract type (ISA / PPA / PG)
- Any late design changes with financial impact

### Collaboration rule:
- PM cannot receive a clean handover (stage 4) if commercial changes are not translated into delivery implications. Financial Close gates PD-PM Handover. Bypass allowed with admin override + reason.

### Actions:
- Mark ready for review
- Add condition precedent
- Mark CP closed
- Raise exception
- Approve financial close
- Progress to PD-PM handover

---

## STAGE 4: PD → PM HANDOVER

**Route:** `/project/:projectId/current-gate?stage=pd-pm-handover`

**Purpose:** Transfer complete project context into execution. This should be the most collaborative screen in the whole app because this is where knowledge transfer either works or collapses. Outputs must be clear enough for a new PM to run the workflow without guessing.

**Extends the existing PD-PM Handover v2 — do not replace it.**

**Stage owner:** PD (until accepted), then PM (once accepted)
**Contributors:** Engineering, Quality, Finance
**Approver:** PM (accepts or rejects)

### PROJECT CHARTER TEMPLATE (structured in-app, based on existing Emergent charter format)

The charter is the centrepiece of this stage. It must be filled by PD before the handover meeting and reviewed by PM during/after. The app should present this as a structured form with 6 sections, not a file upload. Prefill from existing project data where possible.

**Section 1 — OVERVIEW:**
- `charter_project_name` (prefill from project_info)
- `charter_site_name` (prefill from sites table)
- `charter_site_address`
- `charter_gps_coordinates`
- `charter_facility_type` (e.g., commercial rooftop, industrial, ground mount, carport)
- `charter_utility_supplier` (Eskom, municipal, Transnet, other)
- `charter_existing_infrastructure` (existing solar, generator, batteries, or all new)
- `charter_roof_type` (prefill from sites — flat, pitched, ground mount, ballast, penetrated)
- `charter_access_method` (stairs, ladder, crane, other)
- `charter_special_site_notes` (e.g., bird proofing needed, heritage constraints, tenant restrictions)
- `charter_structural_assessment_done` (boolean)
- `charter_structural_assessment_notes`

**Section 2 — STAKEHOLDERS:**

*External (client):*
- `charter_client_name` (prefill from clients table)
- `charter_client_type` (new / existing / referral)
- `charter_primary_contact_name` (prefill from clients)
- `charter_primary_contact_email`
- `charter_primary_contact_phone`
- `charter_client_relationship_notes` (context about the relationship, opportunity significance)

*Internal (Emergent team):*
- `charter_pd_name` (prefill from project_info.pdUserId)
- `charter_programme_manager` (prefill from projectExecutionState.programManagerUserId)
- `charter_project_manager` (prefill from project_info.pmUserId)
- `charter_procurement_manager`
- `charter_om_manager`
- `charter_asset_manager`
- `charter_compliance_officer`
- `charter_safety_officer`
- `charter_designer`
- `charter_preferred_installer`

**Section 3 — SCOPE:**

*System specification:*
- `charter_system_type` (grid-tied / hybrid / off-grid / hybrid + BESS)
- `charter_system_size_kwp`
- `charter_inverter_capacity_kva`
- `charter_battery_capacity_kwh` (if applicable)
- `charter_module_spec` (panel wattage, make, client-specified Y/N)
- `charter_inverter_spec` (make, model)
- `charter_mounting_type` (ballast / penetrated / ground mount / carport)
- `charter_monitoring_system` (to be recommended / specified)
- `charter_metering` (production only / production + consumption / Techsitter)
- `charter_diesel_gen_integration` (boolean)
- `charter_dedicated_feeder` (boolean)
- `charter_transformer_details`
- `charter_tie_in_points`
- `charter_main_breaker_details`
- `charter_internet_provision` (client-provided / self-provided / signal check needed)

*HSE:*
- `charter_hse_contact_established` (boolean)
- `charter_lifelines_required` (boolean)
- `charter_additional_security_required` (boolean)
- `charter_hse_notes`

*SSEG / Compliance:*
- `charter_sseg_application_status` (not started / pending / submitted / approved)
- `charter_grid_study_status` (not started / pending / complete)
- `charter_notification_number`

*O&M:*
- `charter_om_contract_type` (full performance guarantee / basic maintenance / monitoring only / none)
- `charter_waterpoints_available` (boolean)
- `charter_metering_billing_required` (boolean)
- `charter_om_special_notes` (e.g., client-specified equipment, structural assessment still needed)

**Section 4 — SCHEDULE:**
- `charter_alignment_meeting_date`
- `charter_installer_walkthrough_date`
- `charter_external_intro_meeting_date`
- `charter_internal_review_date`
- `charter_client_kickoff_date`
- `charter_site_establishment_date`
- `charter_expected_completion_date`
- `charter_handover_date_target` (Matriarch + Client)

All dates can be blank at charter creation — they are filled during the handover meeting and become the baseline schedule.

**Section 5 — BUDGET:**
- `charter_funding_model` (self-funded / third-party / blended / Fedgroup)
- `charter_payment_terms_text`
- `charter_invoice_conditions_text` (e.g., "client must approve before payment")
- `charter_funding_partner`
- `charter_deposit_status` (pending / received / not required)
- `charter_bdp_commission` (amount or "none")
- `charter_budget_notes`

**Section 6 — RISKS / OPPORTUNITIES / TRIAGE:**
- `charter_overview_risk_summary`
- `charter_stakeholder_risk_summary`
- `charter_scope_risk_summary`
- `charter_schedule_risk_summary`
- `charter_budget_risk_summary`
- `charter_triage_level` (green / amber / purple)
- `charter_opportunities_text`

---

### PD checklist:
- Project charter completed (all 6 sections filled or explicitly marked N/A)
- Assumptions list finalized
- Open risks listed
- Commercial commitments logged
- Client stakeholders identified
- Special conditions documented
- "Changes since proposal" summary attached

### PM checklist:
- Read charter (all 6 sections)
- Clarification questions asked and answered
- Acceptance decision:
  - Accepted
  - Accepted with reservations (reservations listed, owners assigned, deadlines set)
  - Rejected (reason + required actions back to PD)

### Engineering checklist:
- Design pack ready (SLD, layouts, design reports where required)
- Open technical assumptions flagged

### Quality checklist:
- If large project: pre-kickoff QA items defined (Red Team requirement Y/N)

### Finance checklist:
- Budget version aligned with PD margin and contract terms
- Financial baseline set

### Required fields (stage-level, in addition to charter fields above):
- `project_charter_status` (draft / complete / reviewed / accepted)
- `scope_summary_text`
- `commercial_summary_text`
- `design_pack_url`
- `stakeholder_list_complete` (boolean)
- `risk_register_started` (boolean)
- `special_conditions_text`
- `long_lead_items_text`
- `permits_and_approvals_text`
- `handover_meeting_date`
- `handover_minutes_url`
- `pm_review_status`
- `pm_acceptance_status` (accepted / accepted_with_reservations / rejected)
- `pm_rejection_reason`
- `reserved_items_json` (array of {item, owner, deadline, status})

### Evidence:
- Charter document (structured in app)
- Design pack index
- Stakeholder list
- Client comms history
- Handover meeting minutes

### Dependencies:
- PM waiting on PD for answers to clarification questions
- PM waiting on Engineering for technical clarifications
- PM waiting on Finance for budget baseline

### Meetings sub-tab:
- Handover meeting record: date, attendees, outcome (accept / reservations / reject), actions created

### Collaboration rule:
- Handover is NOT "done" when the meeting is held. It is done when the PM confirms readiness and all reserved items are closed. PD remains owner until PM accepts. Bypass allowed with admin override + reason.

### Actions:
- Submit to PM review
- Return to PD
- Accept handover
- Accept with reservations
- Reject handover
- Request missing item
- Raise exception
- Progress to next stage

---

## STAGE 5: FINANCIAL REVIEW

**Route:** `/project/:projectId/current-gate?stage=financial-review`

**Purpose:** Protect margin and cash before execution pain arrives.

**Extends the existing financial review routes — do not replace them.**

**Stage owner:** COO (accountable)
**Contributors:** PM (responsible), Program Finance (responsible)
**Approver:** COO
**Consulted:** Procurement (where relevant)

### PM checklist:
- Updated forecast costs submitted
- Variations captured with reasons
- Milestone evidence uploaded

### Finance checklist:
- Committed vs budget comparison done
- Margin forecast updated
- Drawdowns vs plan reviewed
- Upcoming cash exposures flagged

### Exco checklist:
- Approves/acknowledges projects that cross thresholds (margin drop, cash risk)

### Required fields:
- `baseline_revenue`
- `baseline_cos`
- `committed_cost`
- `actual_invoiced_cost`
- `forecast_cost`
- `forecast_margin_pct`
- `margin_drift_pct`
- `open_vo_count`
- `procurement_risk_text`
- `po_payment_dependencies_text`
- `milestone_evidence_status`
- `variance_commentary_text`
- `financial_review_notes`
- `financial_review_status`
- `financial_review_date`

### Evidence:
- Cost reports
- Variation approvals
- PO documentation

### Dependencies:
- Finance waiting on PM for milestone evidence
- PM waiting on PD/Engineering for scope decisions
- PM waiting on Procurement for price confirmations

### Collaboration rule:
- Financial review should create actions for other teams directly rather than becoming a separate live-ready conversation. Review actions flow outward to PM, Engineering, Procurement. Bypass allowed with admin override + reason.

### Actions:
- Save review
- Escalate issue
- Approve
- Raise exception
- Assign action to PM / Finance / Procurement
- Progress to next stage
