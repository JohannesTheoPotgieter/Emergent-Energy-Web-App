# Slice D.1: Create core.governed_processes + core.governed_process_checklist_items

> **Status:** Implemented  
> **Predecessor:** Phase B (project_instances, phase_definitions, parties)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Design

### Unified Governance Spine

`core.governed_processes` consolidates 6 scattered governance systems into a single model:

| Source Table | process_type | Rows (est.) |
|---|---|---|
| `project_pd_pm_handover` | `pd_to_pm_handover` | ~100 |
| `project_financial_reviews` | `financial_review` | ~50 |
| `project_gate_evaluations` | `phase_gate_review` | ~200 |
| `project_stage_exceptions` | `gate_exception` | ~50 |
| `change_requests` | `change_request` | ~50 |
| `payment_batches` | `payment_batch` | ~100 |
| `project_stage_instances` | `stage_gate` | ~1000 |

### Type-Specific Data

Common fields are columns on the spine. Type-specific data stored in `process_data JSONB`:

- **`pd_to_pm_handover`**: pd_owner, pm_owner, readiness_score, sign-offs, risks, assumptions
- **`financial_review`**: snapshot totals, variance, margin, review_date, outcome
- **`phase_gate_review`**: gate_name, from/target stage, missing_items, override
- **`gate_exception`**: risk_level, mitigation, conditions, closeout_due_date
- **`change_request`**: change_type, cost/schedule/revenue impact, final_decision
- **`payment_batch`**: batch_number, cutoff_date, total_amount, item_count

### Checklist Items

`core.governed_process_checklist_items` unifies:
- `handover_checklist_items` (linked to handover processes)
- `project_stage_requirements` (linked to stage_gate processes, only non-NOT_STARTED items)

---

## Scope In

- [x] DDL: `governed_processes` + `governed_process_checklist_items`
- [x] Backfill: 6 process types from their respective tables
- [x] Backfill: stage_gate processes from `project_stage_instances`
- [x] Backfill: checklist items from handover + stage requirements
- [x] Owner/reviewer party resolution from user_ids
- [x] Rollback: drops both tables in FK order
- [x] Idempotency: ON CONFLICT + NOT EXISTS guards
- [x] Schema validation tests + slice doc

## Scope Out

- No Drizzle ORM schema
- No app code changes
- Legacy tables remain untouched
- `approvalWorkflows` deferred (different pattern)
