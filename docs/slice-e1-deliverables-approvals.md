# Slice E.1: Deliverables + Approvals (Clean Model)

> **Status:** Implemented  
> **Predecessor:** Phase B (project_instances, phase_definitions, parties), Phase C (work_items_clean), Phase D (governed_processes)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Design

### Deliverable Definitions (Template Catalog)

`core.deliverable_definitions` captures what deliverables should exist per stage/project:

| Source | Rows (est.) |
|---|---|
| `eng_deliverable_templates` | ~50 |

Supports ad-hoc definitions via `is_ad_hoc` flag. Templates guide but don't constrain.

### Deliverable Instances (Actual Per Project)

`core.deliverable_instances` consolidates 3 scattered deliverable systems:

| Source Table | Rows (est.) | Type-Specific Data |
|---|---|---|
| `deliverables` | ~500 | SharePoint refs, versions, QC reviewer |
| `project_eng_deliverables` | ~300 | File metadata, storage ref, approval status |
| `task_deliverables` | ~200 | Filename, acknowledgment, work item link |

Owner/reviewer resolved via `core.user_accounts` → `core.parties`.

### Approval Rules (Configurable Business Rules)

`core.approval_rules` formalizes approval patterns currently hardcoded in the app:

- 15 seed rules covering: gate, budget, handover, procurement, exception, HSE, quality, contract, SSEG, general
- Admin-managed via settings (is_active toggle, escalation_days, rule_data JSONB)
- Unique on (entity_type, approval_type, required_role)

### Approval Instances (Actual Records)

`core.approval_instances` consolidates 4 scattered approval systems:

| Source Table | Rows (est.) | Type-Specific Data |
|---|---|---|
| `approvals` | ~1000 | Type, category, token, evidence links |
| `project_eng_approvals` | ~200 | Approver role, stage context |
| `documentation.document_approvals` | ~300 | Document ID, source table |
| `approval_workflows` | ~100 | Workflow type, payload JSONB |

Requested-by/decided-by resolved via `core.user_accounts` → `core.parties`.

---

## Scope In

- [x] DDL: `deliverable_definitions` + `deliverable_instances`
- [x] DDL: `approval_rules` + `approval_instances`
- [x] Backfill: deliverable_definitions from eng_deliverable_templates
- [x] Backfill: deliverable_instances from 3 source tables
- [x] Seed: 15 approval rules from known business patterns
- [x] Backfill: approval_instances from 4 source tables
- [x] Owner/reviewer/requester/decider party resolution
- [x] Safety warnings for unresolvable references
- [x] Rollback: drops in FK order (separate for approvals + deliverables)
- [x] Idempotency: ON CONFLICT + NOT EXISTS guards
- [x] Schema validation tests + slice doc

## Scope Out

- No Drizzle ORM schema
- No app code changes
- No admin UI for approval rules (future feature)
- Legacy tables remain untouched
