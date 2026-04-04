# Phase E Migration Manifest

> **Phase:** E — Deliverables + Approvals  
> **Status:** Schema DDL + backfill complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 8 (2 DDL + 3 backfill/seed + 1 backfill + 2 rollback)

---

## Execution Order (alphabetical sort = dependency order)

| # | File | Purpose |
|---|---|---|
| 1 | `20260403_e01_create_deliverable_definitions.sql` | Create `core.deliverable_definitions` + `core.deliverable_instances` |
| 2 | `20260403_e02_backfill_deliverable_definitions.sql` | Backfill definitions from `eng_deliverable_templates` |
| 3 | `20260403_e03_backfill_deliverable_instances.sql` | Backfill instances from 3 deliverable tables + resolve parties |
| 4 | `20260403_e04_create_approval_rules_instances.sql` | Create `core.approval_rules` + `core.approval_instances` |
| 5 | `20260403_e05_seed_approval_rules.sql` | Seed 15 approval business rules |
| 6 | `20260403_e06_backfill_approval_instances.sql` | Backfill instances from 4 approval tables + resolve parties |

---

## Rollback

| # | File | Drops |
|---|---|---|
| 1 | `20260403_e07_rollback_approvals.sql` | `approval_instances` → `approval_rules` |
| 2 | `20260403_e08_rollback_deliverables.sql` | `deliverable_instances` → `deliverable_definitions` |

---

## New Tables

| Table | Rows (est.) | Type |
|---|---|---|
| `core.deliverable_definitions` | ~50 | Template catalog from eng_deliverable_templates |
| `core.deliverable_instances` | ~1,000 | Unified deliverables (3 sources) |
| `core.approval_rules` | ~15 | Configurable business rules (admin settings) |
| `core.approval_instances` | ~1,600 | Unified approvals (4 sources) |

---

## Backfill Sources

### Deliverables

| Source Table | → deliverable type | Key Fields in deliverable_data |
|---|---|---|
| `deliverables` | engineering | SharePoint refs, versions, QC reviewer |
| `project_eng_deliverables` | stage-gated | File metadata, storage ref, approval status |
| `task_deliverables` | task-level | Filename, acknowledgment, work item link |

### Approvals

| Source Table | → entity type | Key Fields in approval_data |
|---|---|---|
| `approvals` | varies (general) | Type, category, token, evidence links |
| `project_eng_approvals` | eng_stage | Approver role, stage context |
| `documentation.document_approvals` | document | Document ID, source table |
| `approval_workflows` | workflow | Workflow type, payload JSONB |
