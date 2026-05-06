# Migration Dossier — Section 4 (Current-to-Target Mapping)

## Completed scope

Section 4 from the chunked plan: explicit current→target mapping across core entities, routes, and UI sections with classification labels.

---

## 1) Current table/model → target model mapping

| Current | Target | Classification | Notes |
|---|---|---|---|
| `organizations` | `workspace` | transform needed | workspace abstraction can seed from org + tenancy data |
| `users` | `user_account` | transform needed | preserve existing auth/session compatibility |
| `users.microsoft_id`, `ms_accounts` | `microsoft_identity` | merge needed | unify identity provider linkage |
| `role_permissions`, `user_permission_overrides` | `role_definition`, `role_assignment` | split needed | role definitions vs per-user assignments |
| `clients`, `counterparties`, `handover_stakeholders`, `project_team_members` | `party`, `party_role`, `contact_method`, `project_party_link` | merge needed | keep legacy tables via compatibility views/adapters |
| `mytool_company_priorities`, `priority_links` | `strategic_priority`, `strategic_priority_link` | transform needed | retain existing priority APIs while remapping |
| `project_info` | `project_instance` + `project_info` | split needed | route compatibility on `projectName` must remain |
| `project_execution_state` | `project_phase_history` + execution state facets | keep as compatibility layer | explicitly requested bridge table remains during migration |
| `project_phase_history` | `project_phase_history` | direct fit | already aligned conceptually |
| `phase_template`, `phase_template_item` | `phase_template`, `phase_template_version` | transform needed | add versioning spine without breaking template endpoints |
| `work_items` | `work_item` | direct fit | current unified work core |
| `work_item_dependencies` | `work_item_dependency` | direct fit | maintain dependency integrity |
| `work_item_pm/engineering/scheduling` | `work_package` + work-item extension strategy | transform needed | infer work_package boundaries incrementally |
| `project_stage_requirements` | `governed_process_checklist_item` | transform needed | preserve lifecycle semantics |
| `stage_definitions` | `phase_definition` | transform needed | stage/phase terminology bridge needed |
| `project_stage_instances` | `project_phase_history` + process state | merge needed | avoid losing readiness/owner fields |
| `deliverables`, `project_eng_deliverables`, `task_deliverables` | `deliverable_definition`, `deliverable_instance` | merge needed | keep evidence linkage during dual-write period |
| `project_eng_approvals`, `approvals`, gate decision/evaluation tables | `approval_requirement`, `approval_instance` | merge needed | maintain queue behavior via compatibility adapters |
| `program_expense`, `program_inflows`, `finance_*`, procurement/payment tables | `finance_record` | merge needed | preserve projectName+projectId dual identity until cutover |
| `project_links`, `file_versions`, evidence tables | `external_resource`, `resource_link`, `deliverable_evidence_link` | transform needed | avoid orphaning documents/files |
| `task_activity_log`, `audit_events`, `audit_trail`, `permission_audit_log` | `activity_log`, `audit_log` | merge needed | federated read first, no early writes-only cutover |
| `smart_import_runs`, `import_runs`, `import_logs` | `import_batch` | merge needed | preserve rollback and issue reconciliation |
| `*_legacy ids`, `task_migration_map` | `legacy_id_map` | direct fit | formalize existing migration mapping artifacts |

---

## 2) Compatibility/bridge entities explicitly retained

| Required bridge | Current evidence | Section 4 classification |
|---|---|---|
| `users` | active auth + permissions + nav role model | keep as compatibility layer |
| `project_execution_state` | active stage/phase/gate fields and routes | keep as compatibility layer |
| `project_stage_requirements` | stage lifecycle APIs depend on it | keep as compatibility layer |
| `project_stage_evidence` | lifecycle evidence APIs + UI | keep as compatibility layer |
| `project_stage_decisions` | gate decision workflows | keep as compatibility layer |
| workstream filters | hooks/routes include workstream-specific behaviors | keep as compatibility layer |
| `project_info.projectName` route contract | `/project/:projectName` + name-based APIs | keep as compatibility layer |

---

## 3) Specialized operational domains (outside core spine candidate)

| Specialized area requested | Current table evidence | Section 4 disposition |
|---|---|---|
| `sseg_case` / `sseg_submission` intent | `sseg_items`, HSE/SSEG routes | keep outside core spine (candidate) |
| commissioning records/tests | `commissioning_items`, commissioning routes | keep outside core spine (candidate) |
| inspection/snag/issues | quality/NCR and warning ecosystems | unknown / needs decision on exact table mapping |
| handover pack domain | `handover_packs`, `handover_checklist_items` | keep outside core spine (candidate) |
| drawing register/revisions | `drawing_register`, `drawing_revisions` | keep outside core spine (candidate) |
| client updates | `project_client_updates`, `client_updates`, gates updates views | keep outside core spine (candidate) |

---

## 4) Current route/API → target route/API bridge mapping

| Current route/API pattern | Future posture | Classification |
|---|---|---|
| `/project/:projectName` | keep + add projectId canonical alias | keep as compatibility layer |
| `/api/v2/projects/:projectId/*` | canonical project aggregate APIs | direct fit |
| `/api/projects/:projectId/stages*` | mapped to governed process/lifecycle APIs | transform needed |
| `/api/gates/*` | remains aggregate domain facade over normalized models | keep as compatibility layer |
| `/api/approvals*` | maps to approval_instance aggregate queries | transform needed |
| `/api/*/:projectName` legacy endpoints | maintain adapter then migrate to projectId/resource IDs | keep as compatibility layer |
| legacy redirects/aliases in page registry | keep until traffic cutoff validated | keep as compatibility layer |

---

## 5) Current UI section → future department section mapping

| Current top sections | Target department structure | Classification |
|---|---|---|
| Home | Home | direct fit |
| Project Development | Project Development | direct fit |
| Project Delivery + Company/Portfolio + parts of Reports | Project Management | merge needed |
| Engineering | Engineering | direct fit |
| Quality (+ commissioning portions) | Quality | direct fit |
| Finance | Finance | direct fit |
| Clients/Counterparties/Handover stakeholder surfaces | Parties | split needed |
| Admin (+ knowledge/system pages) | Admin | transform needed |
| HSE | unknown (Admin vs Quality vs dedicated non-target section) | unknown / needs decision |
| Priorities | likely Home/Admin overlay or cross-department filter | unknown / needs decision |

---

## Section 4 feedback

- Completed scope: current→target mapping for entities, routes/APIs, and UI sections with classification labels.
- Key findings: target spine is achievable through compatibility-first transforms; multiple areas require merge/split strategies rather than direct renames.
- Risks identified now: identity, approvals, and finance need bridge-first migration or live regressions are likely.
- Blockers/ambiguities: HSE/Priorities final placement in the target 8-section UI requires product decision.
- Recommendation before proceeding: Section 5 should lock must-survive live functions and explicit breakage-by-order warnings.
- Ready for next section: **Yes**.
