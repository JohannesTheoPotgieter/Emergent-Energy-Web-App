# Data-integrity cleanup plan (safe-first)
Date: 2026-04-14

## Findings

### Verified current-state hypotheses in code
- `work_items.project_id` has explicit `ON DELETE CASCADE` to `project_info.id`, so project deletion can remove execution tasks transitively. This is currently a hard-delete path.  
- `project_eng_tasks.work_item_id` references `work_items.id` **without** explicit `onDelete`, so behavior defaults to `NO ACTION`/`RESTRICT` at DB level.  
- `work_item_engineering.work_item_id` is 1:1 with `work_items.id` and `ON DELETE CASCADE`, which is good for extension cleanup.  
- Legacy and canonical task models still co-exist (`project_eng_tasks` + `work_items` + `work_item_engineering`). Canonical comments indicate `work_items` is intended write-master, but the legacy tables are still read/written by active routes.  
- Project deletion in lifecycle routes performs explicit table-by-table deletions and then `DELETE FROM project_info`, so any FK policy drift can surface as failed deletes or accidental cascades depending on table policy.  

### Drift report (dev/prod compatibility checkpoints)
- **Schema drift risk:** many `project_info` references in schema omit explicit `onDelete` (defaults vary by DB migration history), so behavior may differ between environments that were bootstrapped differently.  
- **Migration drift risk:** task-system migrations include additive unification (`20260370_unify_task_system.sql`) and extensions (`20260331_work_item_extensions.sql`), but legacy task tables remain present and populated paths still exist.  
- **Route registration drift risk:** engineering stage routes and lifecycle routes still depend on legacy entities (`project_eng_tasks`, `project_eng_stages`) while many other routes assume canonical `work_items`.  
- **Permissions drift risk:** permission catalog grants `work_items.write`; no parallel `project_eng_tasks.write` permission boundary exists, meaning legacy writes can bypass the canonical permission vocabulary if not uniformly routed.  
- **Feature-flag drift risk:** `server/work-items-adapter.ts` references `canonical_work_items_v1`, but rollout flags are not defined in `shared/feature-flags.ts`; this can create inconsistent gating assumptions across environments.  
- **Environment assumptions risk:** startup DDL repair/backfill code paths can mutate schema in-place at boot; if enabled differently in dev vs prod, FK/index behavior can drift.  

## Risk register

| Area | Relationship / behavior | Current observation | Risk | Recommended `on_delete` policy |
|---|---|---|---|---|
| Project root | `work_items.project_id -> project_info.id` | Explicit `CASCADE` | High blast radius on project delete | Keep `CASCADE` **only** with guarded delete workflow + preflight dependency snapshot |
| Legacy bridge | `project_eng_tasks.work_item_id -> work_items.id` | Implicit/default delete behavior | Orphan/blocking uncertainty | Set explicit `SET NULL` while legacy table remains, then remove table at cutover |
| Task extension | `work_item_engineering.work_item_id -> work_items.id` | Explicit `CASCADE` + unique | Low | Keep `CASCADE` (1:1 extension semantics) |
| Stage lineage | `project_eng_tasks.project_eng_stage_id -> project_eng_stages.id` | `CASCADE` | Medium if stage deletes are broad | Keep `CASCADE`, but route all destructive actions through preflight counts |
| Project-linked reference data | nullable `project_id` refs without explicit policy | Mixed/default | Silent behavior differences env-to-env | Standardize: `SET NULL` for reference/history tables; `CASCADE` for owned child artifacts |

## Safe now changes

### A. Safe tonight (implemented)
1. Added **read-only FK risk register SQL** to inventory actual FK delete semantics and orphan indicators before any migration.  
   - `scripts/data-integrity/fk-risk-register.sql`
2. Added **read-only task-model proof SQL** to compare legacy vs canonical counts/completions and detect extension duplication or bridge gaps.  
   - `scripts/data-integrity/task-model-proof.sql`
3. No production data mutations, no schema-destructive operations, no table/column drops, no hidden data reshaping.

### B. Needs approval
1. Add idempotent migration to make all `project_info` FKs explicit (`CASCADE` / `SET NULL` / `RESTRICT`) based on ownership class.
2. Add guarded project deletion gate requiring:
   - dependency preflight snapshot,
   - explicit operator confirmation token,
   - rollback runbook pointer.
3. Add dual-write/dual-read reconciliation checkpoints for `project_eng_tasks` sunset.

### C. Later structural cleanup
1. Consolidate engineering task writes fully into `work_items` + `work_item_engineering`.
2. Freeze legacy `project_eng_tasks` mutations, then archive/retire table after parity SLA window.
3. Move aggregate/reporting reads to parity-checked canonical views.

## Backfill and validation plan

### Phase 1 — Observe only (no writes)
- Run `fk-risk-register.sql` and `task-model-proof.sql` in dev and prod snapshots.
- Persist outputs as baseline evidence artifacts.

### Phase 2 — Additive hardening
- Introduce explicit FK `ON DELETE` migrations (idempotent `DO $$ ... EXCEPTION WHEN duplicate_object` style where required).
- Add missing FK indexes for high-volume relationship columns before enforcement.

### Phase 3 — Backfill/reconciliation
- Backfill `project_eng_tasks.work_item_id` links where missing using deterministic mapping (`project_eng_stage`, template id, title/date fallback).
- For ambiguous matches, do **not** auto-merge; log to manual reconciliation queue.

### Phase 4 — Controlled cutover
- Switch ENG route writes to canonical only.
- Keep legacy reads as fallback for one release window with parity alerts.
- Retire fallback only after proof queries show stable parity.

## Needs approval (explicit)
- Any migration that changes existing FK constraints on production tables.
- Any change to project delete behavior in API routes.
- Any backfill that writes to legacy rows with ambiguous lineage.

## Rollback
- SQL-only changes are additive-first; rollback is:
  1. disable new code path/feature gate,
  2. drop newly added constraints/indexes if needed,
  3. restore previous route behavior,
  4. re-run proof queries to confirm parity restored.
- For any approved destructive action later, require snapshot/backup ID captured in runbook before execution.
