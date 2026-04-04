# Phase D Migration Manifest

> **Phase:** D — Governed Processes  
> **Status:** Schema DDL + backfill complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 4 (1 DDL + 2 backfill + 1 rollback)

---

## Execution Order (alphabetical sort = dependency order)

| # | File | Purpose |
|---|---|---|
| 1 | `20260403_d01_create_governed_processes.sql` | Create `core.governed_processes` + `core.governed_process_checklist_items` |
| 2 | `20260403_d02_backfill_governed_processes.sql` | Backfill 6 process types + resolve owner/reviewer parties |
| 3 | `20260403_d03_backfill_governed_process_checklist_items.sql` | Backfill checklist items from handover + stage requirements |

---

## Rollback

| # | File | Drops |
|---|---|---|
| 1 | `20260403_d04_create_governed_processes_rollback.sql` | `governed_process_checklist_items` → `governed_processes` |

---

## New Tables

| Table | Rows (est.) | Type |
|---|---|---|
| `core.governed_processes` | ~1,550 | Unified governance spine (7 process types) |
| `core.governed_process_checklist_items` | ~2,000+ | Unified checklist (handover + stage requirements) |

---

## Backfill Sources

| Source Table | → process_type | Key Fields in process_data |
|---|---|---|
| `project_pd_pm_handover` | `pd_to_pm_handover` | pd/pm_owner, readiness, sign-offs |
| `project_financial_reviews` | `financial_review` | budget snapshot, variance, outcome |
| `project_gate_evaluations` | `phase_gate_review` | gate_name, stages, missing items |
| `project_stage_exceptions` | `gate_exception` | risk_level, mitigation, conditions |
| `change_requests` | `change_request` | cost/schedule impact, decision |
| `payment_batches` | `payment_batch` | batch_number, amount, item_count |
| `project_stage_instances` | `stage_gate` | stage status, phase_definition_id |

## Checklist Sources

| Source Table | Linked Process | Filter |
|---|---|---|
| `handover_checklist_items` | `pd_to_pm_handover` | All items |
| `project_stage_requirements` | `stage_gate` | `status <> 'NOT_STARTED'` only |
