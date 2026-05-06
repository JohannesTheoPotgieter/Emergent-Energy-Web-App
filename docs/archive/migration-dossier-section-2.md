# Migration Dossier — Section 2 (Current Data Model Deep Map)

## Completed scope

Section 2 from the chunked plan: build a table/model-level map of current entities, identify duplicate concepts, and call out critical relational paths that must remain intact during migration.

> Note: This section is schema-first analysis based on Drizzle definitions and migration artifacts. Runtime usage weighting (hot vs cold tables) will be tightened in Section 3 via API-route tracing.

---

## 1) Current canonical entity groups (schema inventory)

## A. Identity, org, role, and permission backbone
- `organizations`
- `users`
- `role_credentials`
- `role_permissions`
- `user_permission_overrides`
- `permission_audit_log`
- `pd_visibility_config`
- `workstream_visibility_config`

**Observations**
- Users hold both core identity (`email`, `name`) and role/department attributes.
- Permission model is additive and layered (role defaults + user overrides + audit table).

## B. Project and lifecycle core
- `project_info` (project identity anchor)
- `project_execution_state` (split execution/status dates and gate state)
- `project_settings`
- `project_phase_history`
- `project_team_members`
- `project_events`
- Gate/lifecycle adjuncts:
  - `stage_gate_definitions`, `project_gate_evaluations`, `stage_gate_overrides`, `execution_gate_log`
- Stage-lifecycle engine:
  - `stage_definitions`, `project_stage_instances`, `project_stage_requirements`, `project_stage_evidence`, `project_stage_decisions`, `project_stage_exceptions`, `project_stage_dependencies`
- Stage data extension:
  - `project_stage_data` (JSONB per project+stage)
  - `project_charters` (structured handover charter)

**Observations**
- Project identity and execution state are already split (compatibility-oriented step).
- Parallel lifecycle representations coexist (phase/gate fields, gate tables, and stage-lifecycle tables).

## C. Work/task model
- Unified work core:
  - `work_items`
  - extension tables: `work_item_pm`, `work_item_engineering`, `work_item_scheduling`
  - relationships: `work_item_assignments`, `work_item_dependencies`, `work_item_status_history`
- Task adjuncts around work items:
  - `task_comments`, `task_checklists`, `task_checklist_items`, `task_attachments`, `task_deliverables`, `task_activity_log`, `task_watchers`, `task_tags`, `work_item_tags`, `task_time_entries`
- Additional task-like sets:
  - `project_plan` (+ `project_plan_dependency`)
  - `normalized_plan_tasks`
  - `intake_tasks` + `intake_task_templates`
  - `project_eng_tasks` (engineering-specific staged tasks)

**Observations**
- `work_items` is the consolidation direction, but several parallel task concepts still exist for planning/import/stage workflows.

## D. Approval, evidence, and quality/governance
- Generic/collaboration approvals:
  - `approvals`, `approval_workflows`
- Engineering approvals and deliverables:
  - `project_eng_approvals`, `deliverables`, `deliverable_versions`, `deliverable_files`, `deliverable_events`, `project_eng_deliverables`
- Stage-gate decisions/evidence:
  - `project_stage_decisions`, `project_stage_evidence`, `project_gate_evaluations`
- Quality assurance model:
  - templates: `qc_template*`
  - instances/evidence: `qc_checklist`, `qc_item_instance`, `qc_item_evidence`
  - warnings/postmortem: `qc_warning`, `qc_warning_event`, `qc_postmortem*`
  - commissioning/evidence governance: `commissioning_items`, `evidence_requirement_definitions`, `evidence_collected_items`, `evidence_evaluations`, `evidence_override_records`

**Observations**
- Approval/evidence truth appears intentionally distributed by domain (generic, engineering, quality, stage lifecycle).
- Migration will require a deliberate normalization plan, not immediate consolidation.

## E. Finance and procurement
- Legacy-compatible financials with strong project FK backfill:
  - `program_expense`, `program_inflows`, `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly`
  - all retain `projectName` (deprecated) plus `projectId` (new canonical FK)
- Planning/forecast/control:
  - `working_plan_scenario`, `working_plan_dependency_override`, `schedule_change_notice`
  - `budget_baselines`, `weekly_reviews`, `fye_*`
- Party/financial ecosystem:
  - `counterparties`, `counterparty_contacts`
- Procurement and payment execution:
  - `procurement_items`, `purchase_orders`, `po_review_assignments`, `payment_requests`, `payment_batches`, `payment_batch_items`, `proof_of_payment`

**Observations**
- Major finance tables clearly preserve route compatibility via dual identity (`projectName` + `projectId`).
- Procurement/payment models are now substantial and may map to future `finance_record` + workflow subtypes.

## F. Party/client/site and development pipeline
- `clients`, `sites`, `opportunities`
- `project_client_history`, `project_subcontractor_assignments`
- `pd_tickets`, `project_pd_pm_handover`, `project_handover_*`
- `handover_packs`, `handover_checklist_items`, `handover_stakeholders`, `lessons_learnt`, `sseg_items`

**Observations**
- Party-like concepts are fragmented across client/counterparty/stakeholder/team-member constructs.
- This is a key candidate for future `party` + `party_role` + `contact_method` harmonization.

## G. Import, sync, lineage, and audit surfaces
- Import/sync runs and issue governance:
  - `smart_import_runs`, `import_runs`, `import_issues`, `issue_resolution_rules`, `mapping_rules`
- Snapshot and delta lineage:
  - `snapshots`, `change_ledger`, `change_sets`, `field_changes`, `snapshot_metrics`
- Integration intake/sync controls:
  - `intake_requests`, `sp_*`, `sync_audit_log`, `conflict_resolution_log`, `manual_edit_flags`, `import_logs`, `import_history`
- Audit/event constellation:
  - `audit_events`, `audit_trail`, `permission_audit_log`, `task_activity_log`, `merge_audit_log`, `writeback_audit_log`

**Observations**
- Audit/event/history capability exists but is distributed across subsystem-specific tables.
- Future `activity_log` and `audit_log` should likely federate existing streams before any deprecation.

---

## 2) Duplicate-concept matrix (critical for safe migration)

| Concept | Current representations | Risk if merged too early | Section 2 disposition |
|---|---|---|---|
| Project identity/state | `project_info`, `project_execution_state`, `project_settings` | Breaking legacy reads expecting flat project fields | Keep split + adapter mapping |
| Lifecycle progression | `project_execution_state.phase/current_stage_code`, stage-gate tables, stage-lifecycle tables | Divergent progression status and gate decisions | Treat as parallel authoritative streams pending Section 3 route trace |
| Task/work | `work_items` + extension + task adjunct tables + `project_plan` + `normalized_plan_tasks` + `intake_tasks` + `project_eng_tasks` | Lost task lineage, broken board/planner/import features | Keep multi-model; define canonical-by-workflow |
| Approvals | `approvals`, `approval_workflows`, `project_eng_approvals`, gate/stage decision tables | Approval regressions and misrouted queues | No consolidation yet; map per domain |
| Evidence | `task_deliverables`, `project_stage_evidence`, `qc_item_evidence`, engineering deliverable tables | Orphaned evidence and broken auditability | Preserve all evidence stores with bridge links |
| Finance records | `program_*`, `finance_*`, procurement/payment tables, FYE tables | Reconciliation/reporting drift | Retain dual identifiers and lineage columns |
| Party model | `users`, `clients`, `counterparties`, `counterparty_contacts`, `handover_stakeholders`, `project_team_members` | Broken assignments and contact resolution | Map to future party graph incrementally |
| Audit logs | `audit_events`, `audit_trail`, `permission_audit_log`, `task_activity_log`, etc. | Historic trace loss | Build federated audit view first |

---

## 3) Critical relational paths that must not break

1. **Project anchor chain**
   - `project_info.id` is referenced broadly (execution state, stages, finance rows, work items, lifecycle artifacts).
   - This is the highest-impact FK root and must remain stable throughout migration.

2. **Work-item dependency and assignment chain**
   - `work_items` → (`work_item_assignments`, `work_item_dependencies`, `work_item_status_history`) and task adjunct tables.
   - Breaking this chain can invalidate task boards, ownership views, and dependency logic.

3. **Stage-lifecycle chain**
   - `project_stage_instances` → `project_stage_requirements` / `project_stage_evidence` plus `project_stage_decisions` / exceptions / dependencies.
   - This supports gate readiness and cross-department progression controls.

4. **Finance lineage chain**
   - Financial line tables include both `projectName` (compat) and `projectId` (FK), often with `importRunId`, snapshots, temporal fields.
   - Removing either identity early risks import reconciliation and historical comparisons.

5. **Import-governance chain**
   - `smart_import_runs` + issue tables + change/snapshot tables + audit logs.
   - This chain underpins safe import commit/rollback behavior and cannot be flattened prematurely.

---

## 4) Immediate schema-level ambiguities to resolve in Section 3

1. Which approval table drives each production screen/queue (generic approvals vs eng approvals vs gate evaluations)?
2. Which task models are read-write vs read-only derived (especially `project_plan` vs `work_items` vs normalized import tasks)?
3. Which lifecycle source takes precedence in conflicts (`project_execution_state` vs stage-lifecycle instances vs gate evaluations)?
4. Which party table is canonical for user-visible “owner/contact/stakeholder” data in each department surface?

---

## Section 2 feedback

- Completed scope: Current entity map, duplicate-concept matrix, and critical relationship chains.
- Artifacts inspected: `shared/schema/*.ts` focus on users, projects, tasks, finance, lifecycle, stage data, quality, engineering, imports, collaboration, handover.
- Key findings: Multi-model coexistence is deliberate; compatibility and lineage fields are heavily used.
- Risks identified now: premature consolidation across tasks/approvals/lifecycle/finance will likely regress live workflows.
- Blockers/ambiguities: runtime source-of-truth per endpoint still needs route/service tracing.
- Recommendation before proceeding: Section 3 should trace API read/write paths to assign effective authority per concept.
- Ready for next section: **Yes**.
