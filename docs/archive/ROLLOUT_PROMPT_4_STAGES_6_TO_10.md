# ROLLOUT PROMPT 4 OF 7 — STAGE WORKSPACES 6–10

Continuation of stage workspaces. Same layout pattern as Prompt 3: top stage header, left department checklists, middle evidence & documents, right dependencies/meetings/decisions.

---

## STAGE 6: CONSTRUCTION

**Route:** `/project/:projectId/current-gate?stage=construction`

**Purpose:** Execute the build — manage inflows, installer relations, timelines, and plan adherence. Control the transition from "paper project" to "physical project."

**Stage owner:** Construction Manager (under PM department)
**Contributors:** PM, Engineering, Procurement, HSE, Compliance, Finance
**Approver:** Program Manager or COO
**Quality:** Consulted (pre-commissioning quality items)

### Construction Manager checklist:
- Construction schedule baselined and shared
- Installer(s) assigned and contracted
- Installer mobilisation confirmed
- Material inflow tracker set up
- Key equipment delivery dates confirmed
- Site access and logistics confirmed
- Weekly site progress reporting established
- Subcontractor performance tracking active
- Installer relations log maintained (issues, escalations, quality flags)

### PM checklist:
- Project plan aligned with construction schedule
- Client communication schedule active (weekly updates — recurring obligation starts here)
- Risk register updated for construction phase
- Variation tracking active

### Engineering checklist:
- Construction drawings issued for build (IFC)
- Technical queries (TQ) response process active
- Design change control in place (no side-channel changes)

### Procurement checklist:
- All POs placed for critical path items
- Delivery tracking active
- Supplier lead time exceptions flagged
- Long-lead items on track / escalated

### HSE checklist:
- Site-specific HSE plan in place
- Contractor HSE induction complete
- PPE requirements confirmed
- Incident reporting active
- Safe to energise checklist started (pre-commissioning)

### Compliance checklist:
- SSEG application submitted (where required)
- Authority approvals tracked
- Municipal / utility notifications done

### Finance checklist:
- Progress-based payment triggers aligned with milestones
- Cost tracking active vs baseline
- Variation orders captured with financial impact

### Required fields:
- `construction_start_date_planned`
- `construction_start_date_actual`
- `construction_schedule_url`
- `installer_name`
- `installer_contract_status`
- `installer_mobilised` (boolean)
- `material_inflow_status` (on_track / delayed / critical)
- `key_equipment_status` (on_track / delayed / critical)
- `site_access_confirmed` (boolean)
- `weekly_progress_reporting_active` (boolean)
- `open_tq_count` (technical queries)
- `open_variation_count`
- `hse_plan_approved` (boolean)
- `hse_induction_complete` (boolean)
- `sseg_application_status`
- `practical_completion_target`
- `construction_progress_pct`
- `construction_gate_status`

### Evidence:
- Construction schedule (Gantt or equivalent)
- IFC drawings issued log
- Material delivery confirmations
- Site progress photos (dated)
- HSE induction records
- PO confirmations for critical path
- Weekly progress reports
- TQ log
- Variation register

### Dependencies panel:
- Construction Manager waiting on Procurement for material delivery
- Construction Manager waiting on Engineering for TQ responses
- Construction Manager waiting on Compliance for SSEG approval
- PM waiting on Construction Manager for progress report
- Finance waiting on PM for milestone evidence

### Decision log:
- Installer change decisions
- Schedule acceleration or delay decisions
- Material substitution decisions
- Scope variation decisions

### Collaboration rules:
- Construction cannot progress to Commissioning until: practical completion target is set, installer sign-off received, HSE safe-to-energise checklist started, and critical equipment confirmed on site. Bypass allowed with admin override + reason.
- Weekly client updates are enforced as a recurring obligation from this stage onward. Overdue updates flag on the project and on Exco dashboard.

### Actions:
- Update construction progress
- Log site visit / progress report
- Flag inflow delay
- Create TQ
- Log installer issue
- Request HSE review
- Upload evidence
- Raise exception
- Mark practical completion
- Progress to commissioning

---

## STAGE 7: COMMISSIONING

**Route:** `/project/:projectId/current-gate?stage=commissioning`

**Purpose:** Control the move from "installed" to "safe, tested, producing, proven."

**Workspace type:** Commissioning readiness room.

**Dual ownership:**
- **PM** owns operationally (scheduling, coordination, evidence collection)
- **Quality Manager** is governance control (acceptance criteria, defect review, sign-off authority)

**Contributors:** Engineering, Compliance, HSE, Finance, O&M (as observer)
**Approver:** Quality Manager

### PM checklist:
- Commissioning date set
- Commissioning plan uploaded
- Punch list compiled and tracked
- Installer sign-off obtained
- Client sign-off obtained (where required)

### Quality Manager checklist:
- Commissioning checklist reviewed and approved
- Test results reviewed
- Snags/NCRs logged with categories
- Acceptance criteria met (Y/N per item)
- Quality review sign-off

### Engineering checklist:
- Commissioning tests planned and executed
- Inverter configuration verified
- System behaviour vs design checked
- Performance monitoring period defined

### Compliance checklist:
- SSEG application and approval complete
- Regulator documentation aligned
- **Techsitter / metering confirmation — THIS IS AN EXPLICIT GATE ITEM** (reduces billing delays and wrong CT ratio issues)

### HSE checklist:
- Safe to energise confirmation issued

### Finance checklist:
- Billing readiness evidence collected:
  - Billing trigger conditions met
  - Production readings for start-of-billing (if required)
- Billing readiness risk flagged if not met

### O&M (observer):
- Soft monitoring plan understood
- Monitoring access tested

### Required fields:
- `commissioning_plan_url`
- `commissioning_date`
- `test_results_uploaded` (boolean)
- `snag_count_open`
- `snag_count_closed`
- `ncr_count_open`
- `ncr_count_closed`
- `practical_completion_status`
- `practical_completion_date`
- `techsitter_confirmed` (boolean) — **EXPLICIT GATE**
- `metering_confirmed` (boolean) — **EXPLICIT GATE**
- `monitoring_live` (boolean)
- `internet_connectivity_confirmed` (boolean)
- `quality_review_status`
- `engineering_acceptance_status`
- `hse_safe_to_energise` (boolean)
- `billing_readiness_status`
- `commissioning_gate_status`
- `installer_signoff_date`
- `client_signoff_date`

### Evidence pack (the full commissioning/handover evidence — substantial):
- Signed cost proposal
- Structural assessment
- SSEG application & approval
- Engineering pack
- COC (Certificate of Compliance)
- PrEng sign-off
- Datasheets (PV, inverter, meter, battery)
- Monitoring details
- Warranties
- O&M agreement
- O&M manual & shutdown procedures
- Serial number list
- Commissioning test records
- Snag register
- Photos

Evidence inheritance: documents uploaded in earlier stages (e.g., proposal docs from stage 2, design pack from stage 4) should auto-populate into the commissioning evidence requirements rather than requiring re-upload.

### Dependencies panel:
- PM waiting on Engineering for test results
- PM waiting on Compliance for SSEG approval
- PM waiting on Quality for review sign-off
- Quality waiting on PM for evidence upload
- Finance waiting on Compliance for Techsitter/metering confirmation
- O&M observing for handover readiness

### Collaboration rule:
- Commissioning cannot close without: Techsitter/metering confirmation, document pack completeness, quality sign-off, and downstream O&M handover readiness confirmed. Bypass allowed with admin override + reason.

### Actions:
- Upload evidence
- Create snag/NCR
- Request quality review
- Mark practical completion
- Confirm Techsitter operational
- Confirm metering
- Start soft monitoring
- Raise exception
- Approve progression to O&M handover

### Integration with existing quality schema:
- Use existing `shared/schema/quality.ts` QC templates, checklists, and NCR workflows
- Commissioning checklist items map to `qcChecklist` + `qcItemInstance`
- Snags/NCRs map to `ncrNonConformance` + `ncrCorrectiveAction`

---

## STAGE 8: O&M HANDOVER

**Route:** `/project/:projectId/current-gate?stage=om-handover`

**Purpose:** Make sure Matriarch receives a live, understandable, accepted site.

**Workspace type:** Formal transfer workspace between EE and MAM/O&M.

**Stage owner:** PM (responsible for preparing and submitting)
**Contributors:** Quality, Compliance, O&M/Matriarch
**Approver:** Receiving O&M function (Matriarch)

### PM checklist:
- Handover pack compiled and complete
- Monitoring access handed over
- Soft monitoring period defined
- Training completed (where required)
- Handover meeting scheduled and held

### O&M / Matriarch checklist:
- Review pack within SLA (**5–7 business days**)
- Acceptance decision:
  - Accepted
  - Accepted with reservations (reservations listed, owners assigned, deadlines set)
  - Rejected (reasons captured, actions created)
- Targets loaded and agreed
- Monitoring access confirmed live
- Asset Manager assigned
- Client introduction complete
- Day-to-day contact formally established

### Compliance checklist:
- Final check that operational obligations are documented

### Quality checklist:
- Outstanding workmanship/warranty issues noted and assigned
- Quality items carried over correctly with owners

### Required fields:
- `om_handover_checklist_status`
- `as_builts_uploaded` (boolean)
- `warranties_uploaded` (boolean)
- `om_manual_uploaded` (boolean)
- `serial_numbers_uploaded` (boolean)
- `targets_confirmed` (boolean)
- `monitoring_access_confirmed` (boolean)
- `training_complete` (boolean)
- `om_handover_meeting_date`
- `om_handover_minutes_url`
- `matriarch_acceptance_status` (accepted / accepted_with_reservations / rejected)
- `matriarch_acceptance_date`
- `matriarch_rejection_reason`
- `asset_manager_assigned_user_id`
- `soft_monitoring_end_date`
- `review_sla_start_date`
- `review_sla_due_date`
- `open_workmanship_items_count`
- `reserved_items_json` (array of {item, owner, deadline, status})

### Evidence:
- Handover pack index (document completeness tracker)
- Monitoring access confirmation
- Training records
- Handover meeting minutes
- Asset Manager assignment record

### Dependencies:
- O&M waiting on PM for complete handover pack
- O&M waiting on Compliance for operational documentation
- PM waiting on Quality for workmanship issue resolution
- PM waiting on O&M for acceptance decision within SLA

### Critical rules:
- **EE soft monitoring must NOT be switched off before O&M acceptance.** This is explicit and non-negotiable. The `soft_monitoring_end_date` can only be set AFTER `matriarch_acceptance_status` = accepted or accepted_with_reservations.
- **Minimum review SLA clock:** 5–7 working days for O&M to review handover pack. System tracks this.
- **PM owns client communication until formal O&M handover is accepted.** Only then does Asset Manager become day-to-day contact.

### Collaboration rule:
- O&M handover stages must end with: accepted / accepted with reservations / rejected, with reasons captured. Bypass allowed with admin override + reason.

### Actions:
- Upload docs
- Request O&M review
- Record meeting
- Accept handover
- Accept with reservations
- Reject with reasons
- Return with changes
- Raise exception
- Progress to client handover

### Integration with existing handover schema:
- Build on existing `shared/schema/handover.ts` → `handoverPacks` (packType = 'matriarch_handover')
- Extend `handoverChecklistItems` for O&M-specific items

---

## STAGE 9: CLIENT HANDOVER

**Route:** `/project/:projectId/current-gate?stage=client-handover`

**Purpose:** Close the project with the client properly.

**Workspace type:** Unified screen for PM, Commercial, O&M, and Client-facing information.

**Stage owner:** PM
**Contributors:** O&M/Matriarch, Quality, Compliance (where SSEG/RMA affects closeout)
**Approver:** PM (with Quality consulted)

### PM checklist:
- Client handover meeting booked and held
- Client materials ready:
  - System summary
  - Contacts (O&M, escalation)
  - Operating instructions
  - Warranty highlights
- Final pack delivered to client
- Snags communicated with resolution timeline
- Training done (where required)
- Client feedback collected

### O&M checklist:
- Day-to-day contact formally introduced to client
- Support process explained to client

### Quality checklist:
- Remaining snag obligations documented with owners and dates

### Compliance checklist:
- SSEG status clearly stated to client
- RMA items resolved or communicated

### Required fields:
- `client_handover_pack_status`
- `client_handover_pack_delivered` (boolean)
- `client_training_complete` (boolean)
- `open_items_text`
- `remaining_snag_obligations_text`
- `warranty_route_confirmed` (boolean)
- `defects_contact_confirmed` (boolean)
- `sseg_status_for_client`
- `operating_instructions_delivered` (boolean)
- `om_contact_transferred` (boolean)
- `client_handover_meeting_date`
- `client_handover_minutes_url`
- `client_acceptance_status` (accepted / accepted_with_reservations / not_accepted)
- `client_feedback_text`
- `client_handover_gate_status`

### Evidence:
- Client handover presentation / pack
- Client sign-off form
- Training records
- List of remaining snags and resolution dates
- Client feedback record

### Dependencies:
- Client Handover waiting on O&M acceptance (stage 8 must be complete or bypassed)
- PM waiting on Quality for snag resolution commitments
- PM waiting on Compliance for SSEG status confirmation

### Collaboration rule:
- **Internal O&M acceptance must happen before external client confidence messaging goes out.** O&M acceptance (stage 8) gates Client Handover (stage 9). Bypass allowed with admin override + reason.

### Auto-trigger:
- When Client Handover is marked as accepted → **automatically create 3-Month Post-Handover Review record** (stage 10) with:
  - `review_due_date` = client_handover_date + 3 months
  - `review_status` = scheduled
  - Owner = assignable (not auto-set — must be explicitly assigned at this point)

### Actions:
- Schedule meeting
- Upload final pack
- Record client comments
- Mark training complete
- Mark accepted
- Raise exception
- Assign 3-month review owner
- Progress to post-handover review

### Integration with existing handover schema:
- Build on existing `shared/schema/handover.ts` → `handoverPacks` (packType = 'client_handover')

---

## STAGE 10: 3-MONTH POST-HANDOVER REVIEW

**Route:** `/project/:projectId/post-handover-review`

**Purpose:** Close the loop between promise and reality. This is where asset management value comes from: verified data, loss attribution, performance advice, and fault classification — not just reactive maintenance.

**Stage owner:** Assignable per project at client handover acceptance. Could be KAM, PM, or Matriarch.

**Contributors:** O&M/Matriarch, Engineering, PD, PM, Finance, Quality
**Informed:** Exco (accepts key lessons, flags systemic issues requiring process change)

### Review owner checklist:
- Review meeting scheduled
- Contributors invited
- Performance data collected
- Client feedback gathered
- Review meeting held
- Report written
- Follow-up actions created and assigned
- Review marked complete

### O&M / Matriarch input:
- Performance vs expected (actual kWh vs modelled)
- Loss attribution (shading, soiling, equipment, grid, other)
- Major incidents / warranty events
- Monitoring system health
- Operational issues

### Engineering input:
- Lessons about design assumptions vs reality
- Defect patterns
- Equipment performance observations

### PD input:
- Commercial / client relationship feedback
- Client satisfaction assessment
- Sales expansion opportunity assessment

### PM input:
- Execution and process lessons
- What went well / what would change

### Finance input:
- Revenue vs expected
- Final margin outcome
- Penalties / PG implications (if applicable)
- Commercial issues

### Quality input:
- Warranty trends
- Defect patterns
- Quality process improvement recommendations

### Required fields:
- `review_due_date` (auto-set at client handover + 3 months)
- `review_status` (scheduled / in_progress / completed / overdue)
- `review_owner_user_id` (assignable)
- `review_meeting_date`
- `actual_vs_expected_summary`
- `loss_attribution_text`
- `client_feedback_text`
- `quality_issue_summary`
- `compliance_issue_summary`
- `matriarch_feedback_text`
- `engineering_lessons_text`
- `pd_lessons_text`
- `pm_lessons_text`
- `relationship_risk_level` (low / medium / high)
- `upsell_opportunity_text`
- `lessons_learned_text`
- `follow_up_action_count`
- `review_completed_date`
- `review_report_url`

### Evidence:
- Performance report (actual vs modelled)
- Client feedback record
- Follow-up action list
- Lessons learned summary
- Review meeting minutes

### Collaboration rule:
- 3-month reviews must be **automatically scheduled at the moment of client handover acceptance.** If not auto-scheduled, they will vanish into the void.
- Exco is informed of all completed reviews and accepts key lessons.
- Systemic issues (repeated across multiple projects) should be flagged for process change.

### Actions:
- Schedule review
- Invite contributors
- Record meeting
- Create follow-up actions
- Upload performance report
- Mark completed
- Escalate issue
- Link lessons to stage definitions / templates for future projects
