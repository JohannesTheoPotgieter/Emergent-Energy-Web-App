# Migration Path: Current State → Target Architecture

> **Status:** Plan only — no implementation without sign-off
> **Approach:** Incremental, additive, non-breaking. Each phase delivers value independently.
> **Principle:** Build the target tables alongside legacy. Migrate reads/writes progressively. Never drop legacy until the new table is fully validated.

---

## Current State vs Target: Gap Matrix

| Target Entity | Exists Today? | Current Equivalent | Gap |
|---|---|---|---|
| `department` | No | Hardcoded in app code | New table needed |
| `role_definition` | No | `role_permissions.role` (flat text) | New table needed |
| `strategic_priority` | No | `mytool_company_priorities` + `priority_projects` | Restructure |
| `party` | Partial | `core.parties` (167 rows, counterparties only) | Needs to absorb users + clients |
| `party_role` | No | Implicit in table membership | New table needed |
| `contact_method` | No | Inline columns on clients/counterparties | Extract to rows |
| `user_account` | No | `public.users` (25 rows) | New table, link to party |
| `microsoft_identity` | No | `users.microsoft_id` (inline column) | Extract to table |
| `role_assignment` | No | `users.role` (flat text) | New table |
| `project_type` | No | Implicit | New table needed |
| `project_type_parameter_definition` | No | N/A | New table needed |
| `project_instance` | Partial | `core.projects` (79 cols, denormalized) | Narrow to spine columns |
| `project_info` (new) | No | `core.projects` has these fields inline | Extract typed parameters |
| `project_info_parameter_value` | No | Inline columns on project_info | New EAV pattern |
| `project_party_link` | No | Inline `client_id`, `pm_user_id`, `pd_user_id` on projects | Extract to junction table |
| `phase_definition` | Partial | `stage_definitions` (10 rows) | Rename + enrich |
| `project_phase_history` | Partial | `core.project_state_history` (snapshots, not clean phase transitions) | Restructure |
| `work_package` | No | N/A (workstream field on work_items) | New table needed |
| `work_item` (clean) | Partial | `core.work_items` (85 cols, overloaded) | Narrow, add FK to work_package |
| `work_item_dependency` | Exists | `work_item_dependencies` | Minor rename |
| `governed_process` | No | Scattered: handover, financial review, gate review — all separate | New unified table |
| `governed_process_checklist_item` | No | `handover_checklist_items`, `project_stage_requirements` | Unify into one |
| `deliverable_definition` | No | `eng_deliverable_templates` (partial) | New table |
| `deliverable_instance` | Partial | `documentation.documents` (36 cols) | Restructure |
| `approval_requirement` | No | Hardcoded in app logic | New table |
| `approval_instance` | Partial | `documentation.document_approvals` (34 cols) | Restructure |
| `finance_record` | No | `finance.cost_lines` + `finance.revenue_lines` (separate tables) | Unify into one |
| `external_resource` | No | `sp_files`, `deliverable_files`, scattered SP columns | New table |
| `resource_link` | No | Inline FKs everywhere | New junction table |
| `activity_log` | Partial | `project_events`, `domain_events` | Restructure |
| `audit_log` | Partial | `audit_events` | Restructure |
| `import_batch` | Partial | `imports.import_runs` + `imports.smart_import_runs` | Simplify |
| `legacy_id_map` | No | Inline `legacy_*_id` columns | New central table |

---

## Migration Phases

### Phase A: Foundation Layer (party + auth + departments)
**Duration estimate:** 1-2 weeks
**Risk:** Low (all additive)
**Dependencies:** None

This is the most impactful structural change — the unified party model replaces 3 separate identity systems.

#### A.1: Create department + role_definition tables
```
New tables:
  - core.departments (id, code, name)
  - core.role_definitions (id, name, department_id)

Seed from:
  - Hardcoded department list in app
  - role_permissions.role distinct values

Impact: None until reads are wired
```

#### A.2: Expand core.parties to unified party model
```
Current: core.parties has 167 counterparties + 3 clients
Target:  core.parties absorbs users (25) as party_kind='person'

Steps:
  1. ALTER TABLE core.parties ADD COLUMN party_kind TEXT DEFAULT 'organisation'
  2. ALTER TABLE core.parties ADD COLUMN legal_name TEXT
  3. INSERT INTO core.parties (party_kind, display_name, ...) SELECT 'person', name, ... FROM public.users
  4. Create core.party_roles junction table
  5. Create core.contact_methods table (extract from inline columns)
  6. Backfill party_roles from current table membership
```

#### A.3: Create user_account + microsoft_identity
```
New tables:
  - core.user_accounts (id, party_id, username_or_email, status, last_login_at)
  - core.microsoft_identities (id, user_account_id, microsoft_user_id, tenant_id, email)

Backfill from:
  - public.users → user_accounts (1:1)
  - public.users.microsoft_id → microsoft_identities

Bridge: user_accounts.party_id → core.parties.id
```

#### A.4: Create role_assignment
```
New table:
  - core.role_assignments (id, user_account_id, role_definition_id, department_id, start_date, end_date)

Backfill from:
  - public.users.role → match to role_definitions
  - public.role_permissions → role_definitions
```

---

### Phase B: Project Spine (project_instance + phase + project_party_link)
**Duration estimate:** 2-3 weeks
**Risk:** Medium (touches the most-read table)
**Dependencies:** Phase A (needs party_id)

#### B.1: Create project_type + project_type_parameter_definition
```
New tables:
  - core.project_types (id, code, name, is_active)
  - core.project_type_parameter_definitions (id, project_type_id, parameter_code, label, data_type, unit, required, default_value, sort_order)

Seed: electricity, water, hybrid, other
Parameter definitions: size_kwp, contract_value, funding_model, grid_connection_type, etc.
```

#### B.2: Create project_instance (narrow spine)
```
New table:
  - core.project_instances (id, project_code, project_name, client_party_id, status, current_phase_definition_id, planned_start_date, planned_end_date, ...)

Backfill from:
  - core.projects (existing 79-column table)
  - Map client_id → party_id via core.parties

Keep core.projects as compatibility view until all reads migrate
```

#### B.3: Create project_info (typed parameters)
```
New tables:
  - core.project_info_v2 (id, project_id, project_type_id, funding_model, contract_type, ...)
  - core.project_info_parameter_values (id, project_info_id, parameter_definition_id, value_text, value_number, ...)

Backfill from:
  - core.projects type-specific columns (size_kwp, contract_value, etc.)
```

#### B.4: Create project_party_link
```
New table:
  - core.project_party_links (id, project_id, party_id, project_role, is_primary, start_date, end_date)

Backfill from:
  - core.projects.client_id → project_party_link (role=client)
  - core.projects.pm_user_id → project_party_link (role=pm)
  - core.projects.pd_user_id → project_party_link (role=pd)
  - project_execution_state.*_user_id columns
  - entity_assignments
```

#### B.5: Create phase_definition + project_phase_history
```
New tables:
  - core.phase_definitions (id, code, name, phase_group, sequence_order, department_owner, is_gate, is_active)
  - core.project_phase_history (id, project_id, phase_definition_id, entered_at, exited_at, is_current, ...)

Backfill from:
  - stage_definitions (10 rows) → phase_definitions
  - core.project_state_history → project_phase_history (extract phase transitions)
  - project_execution_state.phase → current phase mapping
```

---

### Phase C: Work Engine (work_package + clean work_item)
**Duration estimate:** 2 weeks
**Risk:** Medium-High (work_items is the most-written table)
**Dependencies:** Phase B (needs project_instance)

#### C.1: Create work_package
```
New table:
  - core.work_packages (id, project_id, phase_definition_id, work_package_type, workstream, title, status, owner_party_id, ...)

Backfill from:
  - Derive from work_items.workstream groupings
  - Each unique (project_id, workstream) combo → one work_package
```

#### C.2: Narrow work_items to clean model
```
Steps:
  1. Create core.work_items_v2 with target schema
  2. Backfill from core.work_items (85 cols → clean subset)
  3. Map work_package_id from workstream
  4. Map assigned_to_party_id from owner_user_id → party
  5. Keep core.work_items view for backward compat
```

#### C.3: Clean work_item_dependency
```
Already exists as work_item_dependencies — minor schema alignment
```

---

### Phase D: Governed Process Engine
**Duration estimate:** 2-3 weeks
**Risk:** Medium (unifies several scattered systems)
**Dependencies:** Phase B

#### D.1: Create governed_process + checklist_item
```
New tables:
  - core.governed_processes (id, project_id, process_type, status, owner_from_party_id, owner_to_party_id, ...)
  - core.governed_process_checklist_items (id, governed_process_id, checklist_code, title, status, ...)

Backfill from:
  - project_financial_reviews → governed_process (type=financial_review)
  - project_pd_pm_handover → governed_process (type=pd_to_pm_handover)
  - project_gate_evaluations → governed_process (type=phase_gate_review)
  - change_requests → governed_process (type=change_request)
  - payment_batches → governed_process (type=payment_batch)
  - handover_checklist_items → governed_process_checklist_items
  - project_stage_requirements → governed_process_checklist_items
```

---

### Phase E: Deliverables + Approvals (clean model)
**Duration estimate:** 1-2 weeks
**Risk:** Low-Medium
**Dependencies:** Phase B, D

#### E.1: Create deliverable_definition + deliverable_instance
```
New tables:
  - core.deliverable_definitions (id, name, code, applies_to_scope, ...)
  - core.deliverable_instances (id, project_id, deliverable_definition_id, status, owner_party_id, ...)

Backfill from:
  - eng_deliverable_templates → deliverable_definitions
  - documentation.documents → deliverable_instances
```

#### E.2: Create approval_requirement + approval_instance
```
New tables:
  - core.approval_requirements (id, entity_type, approval_type, required_role, ...)
  - core.approval_instances (id, project_id, entity_type, entity_id, status, ...)

Backfill from:
  - documentation.document_approvals → approval_instances
  - Hardcoded approval rules → approval_requirements
```

---

### Phase F: Unified Finance
**Duration estimate:** 2-3 weeks
**Risk:** High (most complex data, highest volume)
**Dependencies:** Phase A (party_id), Phase B (project_instance)

#### F.1: Create finance_record (unified)
```
New table:
  - finance.finance_records (id, project_id, financial_type, direction, party_id, amount_ex_vat, vat_amount, event_date, due_date, paid_or_received_date, status, ...)

Backfill from:
  - finance.cost_lines → finance_records (direction=outflow, financial_type based on context)
  - finance.revenue_lines → finance_records (direction=inflow)
  - purchase_orders → finance_records (financial_type=po)
  - payment_requests → finance_records (financial_type=payment_request_out/in)
  - change_requests (financial VOs) → finance_records (financial_type=vo)
```

---

### Phase G: External Resources + Activity Log
**Duration estimate:** 1 week
**Risk:** Low
**Dependencies:** Phase B

#### G.1: Create external_resource + resource_link
```
Unify: sp_files, deliverable_files, scattered SharePoint columns → external_resource
Junction: resource_link (entity_type, entity_id, resource_id)
```

#### G.2: Create activity_log + audit_log (clean)
```
Restructure: project_events, domain_events, audit_events → clean split
```

---

### Phase H: Strategic Priorities + Import + Legacy Cleanup
**Duration estimate:** 1 week
**Risk:** Low
**Dependencies:** All above

#### H.1: strategic_priority + strategic_priority_link
```
Restructure: mytool_company_priorities, priority_projects → clean model
```

#### H.2: import_batch + legacy_id_map
```
Consolidate: import_runs, smart_import_runs → import_batch
Central: legacy_id_map replaces inline legacy_*_id columns
```

#### H.3: Compatibility layer deprecation
```
Drop views: public.approvals, public.deliverables, public.work_items
Drop _legacy tables
Drop inline legacy_*_id columns (replaced by legacy_id_map)
```

---

## Execution Order Summary

```
Phase A: party + auth + departments          [Week 1-2]     Foundation
Phase B: project spine + phases              [Week 3-5]     Core structure
Phase C: work engine                         [Week 5-7]     Operational backbone
Phase D: governed processes                  [Week 7-9]     Process unification
Phase E: deliverables + approvals            [Week 9-10]    Document/approval cleanup
Phase F: unified finance                     [Week 10-13]   Highest complexity
Phase G: resources + activity log            [Week 13-14]   Supporting infrastructure
Phase H: priorities + import + cleanup       [Week 14-15]   Final cleanup
```

---

## Key Principles

1. **Additive first** — Every new table is created alongside legacy. No drops until fully validated.

2. **View compatibility** — When a new table replaces a legacy table, create a view with the legacy name that reads from the new table. This is the pattern we already proved with approvals/deliverables/work_items.

3. **Party-first** — The unified party model (Phase A) is the foundation everything else depends on. `project_party_link` replaces inline `client_id`, `pm_user_id`, etc. `assigned_to_party_id` replaces `owner_user_id`.

4. **One write engine** — After each phase, bridge writes ensure the new table stays in sync. The view swap pattern gives us 100% coverage with zero code changes.

5. **Reads follow writes** — Once a new table has bridge writes + backfilled data, flip the read path. The app sees no difference because views maintain the old API shape.

6. **Feature flags for reads** — Each domain's read cutover is gated by a feature flag, same pattern we already have for `promoted_core_projects_read`.

7. **No Big Bang** — Each phase is independently deployable and rollbackable. If Phase C fails, Phases A and B are still live.

---

## Data Volume Estimates

| Target Table | Source Row Count | Complexity |
|---|---|---|
| party | ~195 (25 users + 3 clients + 167 counterparties) | Low |
| user_account | 25 | Low |
| project_instance | 100 | Low |
| project_party_link | ~500 (100 projects × ~5 roles each) | Low |
| phase_definition | ~10 | Low |
| project_phase_history | ~200 (100 projects × ~2 transitions) | Low |
| work_package | ~300 (100 projects × ~3 workstreams) | Medium |
| work_item (clean) | ~3,000 | Medium |
| governed_process | ~200 | Medium |
| deliverable_instance | ~0 (currently empty) | Low |
| approval_instance | ~0 (currently empty) | Low |
| finance_record | ~87,000 (74k costs + 6k revenue + 7k normalized) | High |
| external_resource | ~0 (files currently empty) | Low |

---

## Risk Assessment

| Phase | Risk | Mitigation |
|---|---|---|
| A (Party) | User authentication must not break | user_account links to party; users table stays as compat view |
| B (Project) | Most-read table; any regression visible immediately | project_instance coexists with core.projects; view swap only after validation |
| C (Work) | Most-written table; INSTEAD OF triggers already active | work_items_v2 coexists with core.work_items; swap view target |
| F (Finance) | Highest volume; complex merge logic | finance_records coexists with cost_lines/revenue_lines; promote reads last |
| D (Governed Process) | Unifies 5+ scattered systems | Each process type migrated independently; old tables remain |
