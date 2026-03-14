# Multi-schema migration blueprint (additive-first, reconciliation-driven)

## 1) Repository usage analysis

### Method used
- Parsed every `pgTable(...)` export from `shared/schema.ts`.
- Counted identifier references per area (`server`, `client`, `migrations`, `shared`) and persisted the full matrix to `docs/db/table_usage_matrix.csv`.
- Used the matrix to classify live vs. unreferenced tables and detect dual-write/dual-read risk clusters.

### Usage matrix (full)
- Full table-by-table matrix: `docs/db/table_usage_matrix.csv`.
- Current totals:
  - Total tables discovered in schema: **207**
  - Live (server-referenced) tables: **185**
  - Unreferenced candidates: **22**

### Current live dependencies (highest blast-radius tables)
1. `project_info` (highest server dependency)
2. `projects` and `tasks` (legacy but heavily used in app + client)
3. `work_items` **and** `operational_tasks` both live (parallel execution models)
4. `deliverables` family live and tied to route/UI workflows
5. `normalized_cost_lines` / `normalized_revenue_lines` and `smart_import_runs` live in backend import/finance flows

### Dead/noise candidates (no server/client refs from typed schema imports)
> These are **candidates only**; keep until SQL-level usage and operational jobs are confirmed.

- `company_projects`
- `program_expense`, `program_inflows` (no typed references, but still migration-critical due to business rule)
- `engineering_task_attachments`
- `import_field_mappings`
- `outlook_accounts`
- `ms_create_item_links`
- `planning_overrides`
- `project_client_history`
- `resource_capacity`
- `revenue_milestone_manual`
- `work_item_comments`, `work_item_attachments`, `work_item_status_history` (appear provisioned but not yet actively consumed)
- `import_diff_events`
- `migration_backups`, `migration_cleanup_log`

### Duplicate-concept clusters (must be reconciled with staged cutover)
1. **Project master**: `project_info` vs `projects`
2. **Execution/task engine**: `operational_tasks` / `task_*` vs `work_items` / `work_item_*`
3. **Deliverable/document**: `deliverables` family vs new `documentation.*` lifecycle model
4. **Finance facts**: `program_expense` + `program_inflows` + normalized imports vs promoted `finance.*`
5. **Import pipeline**: `import_runs` + `smart_import_runs` + snapshots/ledger with missing governed conflict workflow tables (now added)

---

## 2) Target schema design

### Schema list
- `core`
- `internal`
- `project_development`
- `engineering`
- `quality`
- `project_management`
- `finance`
- `imports`
- `documentation`
- `personal`

### Implemented in this phase (DDL created)
- `internal.users`
- `core.clients`, `core.projects`, `core.portfolios`, `core.project_portfolio_assignments`
- `core.work_items`, `core.work_item_comments`, `core.work_item_attachments`, `core.work_item_activity`, `core.work_item_watchers`
- `documentation.documents`, `documentation.document_versions`, `documentation.document_events`, `documentation.document_approvals`, `documentation.document_transmissions`, `documentation.document_views`
- `finance.revenue_lines`, `finance.cost_lines`, `finance.project_revenue_summaries`
- `imports.import_runs`, `imports.smart_import_runs`, `imports.source_update_requests`, `imports.source_update_acknowledgements`, `imports.data_conflicts`, `imports.conflict_resolutions`

### Naming conventions used
- Plural table names.
- FK-like identity with `*_id` fields.
- Legacy lineage columns (`legacy_*_id`, `source_table`) on migrated entities.
- Audit columns (`created_at`, `updated_at`) on promoted tables.

### Important FK relationship pattern
- `core.projects` anchors promoted domain links.
- `core.work_items` references `core.projects` and self (`parent_work_item_id`).
- `documentation.documents` references `core.projects` + optional linked `core.work_items`.
- `imports.data_conflicts` references `imports.smart_import_runs` and `core.projects`.
- `imports.source_update_acknowledgements` references `imports.source_update_requests` for role-governed source update approvals.

---

## 3) Migration mapping

> Detailed mapping for high-risk and active clusters (legacy tables are preserved and not dropped).

| Current table | Target | Action | Reason | Migration notes | Risk |
|---|---|---|---|---|---|
| `project_info` | `core.projects` | move+compat | Locked winner decision | ID-preserving backfill (`id = legacy id`) + `legacy_project_info_id` | High |
| `clients` | `core.clients` | move+compat | Shared business master | ID-preserving backfill | Medium |
| `portfolios` | `core.portfolios` | move+compat | Core governance | ID-preserving backfill | Medium |
| `project_portfolio_assignments` | `core.project_portfolio_assignments` | move+compat | Core relation | backfill with FKs | Medium |
| `users` | `internal.users` | move+compat | Internal identity spine | ID-preserving backfill | High |
| `work_items` | `core.work_items` | keep+promote | Shared task winner | direct backfill into promoted namespace | High |
| `operational_tasks` | `core.work_items` | merge | Remove competing execution model | mapped into offset ID range (`+1000000000`) with `legacy_operational_task_id` | High |
| `task_comments` | `core.work_item_comments` | merge | Consolidate activity stream | mapped to merged work item IDs | High |
| `task_attachments` | `core.work_item_attachments` | merge | Consolidate file history | mapped to merged work item IDs | High |
| `task_activity_log` | `core.work_item_activity` | merge | Preserve actor trail | mapped to merged work item IDs | High |
| `deliverables` | `documentation.documents` (+ core link) | split | Separate business context from document lifecycle | retains `legacy_deliverable_id`, links to project/work item | High |
| `deliverable_versions` | `documentation.document_versions` | move | Version history | `legacy_deliverable_version_id` | High |
| `deliverable_files` | `documentation.document_versions` | merge | file/version lifecycle | file rows mapped as version artifacts | High |
| `deliverable_events` | `documentation.document_events` | move | lifecycle audit | payload JSON preserves status transitions | High |
| `project_revenue_summary` | `finance.project_revenue_summaries` | move+compat | promoted finance summary | preserves legacy id | Medium |
| `program_inflows` | `finance.revenue_lines` | move+promote | promoted financial truth | numeric conversion + project linkage | High |
| `normalized_revenue_lines` | `finance.revenue_lines` | merge source feed | imports-to-finance promotion | preserve `import_run_id` lineage | High |
| `program_expense` | `finance.cost_lines` | move+promote | promoted financial truth | numeric conversion + project linkage | High |
| `normalized_cost_lines` | `finance.cost_lines` | merge source feed | imports-to-finance promotion | preserve `import_run_id` lineage | High |
| `import_runs` | `imports.import_runs` | move+compat | governed ingestion | ID-preserving backfill | Medium |
| `smart_import_runs` | `imports.smart_import_runs` | move+compat | governed ingestion | ID-preserving + project link | Medium |
| *(new)* | `imports.source_update_requests` | create | source-update governance | supports explicit request lifecycle | Medium |
| *(new)* | `imports.source_update_acknowledgements` | create | role-based completion gates | explicit ack by Construction Manager / Program Manager / Program Finance Manager | Medium |
| *(new)* | `imports.data_conflicts` | create | mismatch detection | stores source/app delta pairs | High |
| *(new)* | `imports.conflict_resolutions` | create | user choice + audit | one resolution per conflict | High |

### Mapping corrections called out from actual usage
- `projects` and `tasks` are still heavily referenced and **cannot** be treated as dead now.
- `work_items` and `operational_tasks` are both active: migration must run in compatibility mode before any read switch.
- `program_expense` / `program_inflows` are weakly typed-referenced in code imports, but business-critical in finance ingestion model; migrate and reconcile before any deprecation decision.

---

## 4) SQL / migration implementation plan

Implemented SQL artifacts:

1. **Schema + target table + backfill migration**
   - `migrations/20260314_multischema_foundation.sql`
   - Includes:
     - schema creation (all 10 approved schemas)
     - additive promoted tables
     - compatibility views (`core.v_projects_legacy_compat`, `core.v_work_items_legacy_compat`)
     - idempotent backfill for core/internal/documentation/finance/imports
     - operational-task merge into shared `core.work_items`

2. **Reconciliation SQL**
   - `migrations/20260314_multischema_reconciliation.sql`
   - Includes checks for:
     - project master count parity + missing rows
     - work-item/comment/attachment/activity parity + orphan detection
     - finance totals mismatch by project
     - deliverable/document parity
     - import lineage parity
     - user identity parity
     - unresolved conflict counts

3. **Usage evidence artifact**
   - `docs/db/table_usage_matrix.csv`
   - Full table reference matrix generated from current repository usage.

4. **PR 86 hardening migration (additive)**
   - `migrations/20260315_multischema_hardening.sql`
   - Adds:
     - lineage hardening for `core.projects.legacy_projects_id` using canonical and unique-name fallback mapping
     - blind-spot backfill for `public.work_item_comments`, `public.work_item_attachments`, and `public.work_item_status_history`
     - soft-typed validation views (`core.v_work_items_soft_type_issues`, `finance.v_revenue_lines_soft_type_issues`, `finance.v_cost_lines_soft_type_issues`)
     - additive indexes for reconciliation/traceability hot paths (`project_id`, legacy lineage columns, `source_table`, `linked_work_item_id`, `document_id`, `import_run_id`, `project_name_snapshot`, `source_update_request_id`, `conflict_id`)

5. **PR 86 reconciliation expansion**
   - `migrations/20260315_multischema_reconciliation_hardening.sql`
   - Adds diagnostics for:
     - duplicate finance facts by practical business key and source lineage
     - operational-task parent/child merge integrity
     - watcher migration parity + missing watcher rows
     - work-item/comment/attachment/activity/watcher orphan references
     - legacy `work_item_*` blind-spot backfill parity
     - document/version ambiguity and per-document count deltas
     - project linkage gaps caused by project-name joins
     - user-reference integrity for promoted entities
     - soft-typed/cast-risk visibility in source finance text fields

---

## 5) Risk register

### Highest-risk migrations
1. `operational_tasks` -> `core.work_items` merge
   - Risk: ID collisions, parent-child integrity, activity link drift.
   - Control: reserved ID offset, `legacy_operational_task_id`, orphan checks in reconciliation.

2. Deliverables split into `documentation.*`
   - Risk: version/file/event semantics can diverge.
   - Control: preserve all legacy IDs and source markers; reconcile counts for each family.

3. Finance promotion
   - Risk: string-to-numeric casts, duplicated lines from normalized + program tables.
   - Control: lineage fields + per-source reconciliation totals before read cutover.

4. Source update governance and conflicts
   - Risk: incomplete role acknowledgements or unresolved conflict backlog.
   - Control: explicit ack and conflict tables with status-driven monitoring.

### Rollback / containment approach
- This phase is additive: if validation fails, keep legacy reads/writes unchanged.
- Disable promoted read paths; rerun backfill after fixes (idempotent `ON CONFLICT`).
- Reconciliation scripts provide failure localization per domain.

### Remaining risks after PR 86 hardening
- Finance promotion still intentionally retains parallel source ingestion (`program_*` + `normalized_*`): duplicate risk is now measurable, but not auto-resolved.
- Soft-typed date fields are intentionally preserved for compatibility; validation views surface invalid values, but no destructive type migration is done in this phase.
- Project-name join gaps can still occur when source names drift; checks now explicitly surface unresolved linkage rows.
- Legacy read/write code paths are still active across `project_info`, `operational_tasks`, `work_items`, and deliverable-family routes; this PR improves observability without broad cutover.

---

## 6) Recommended phased cutover order

1. **Phase 0 (now):** Run new migration + reconciliation; keep legacy paths primary.
2. **Phase 1 reads:** non-destructive read adoption of `core.projects`, `core.clients`, `core.portfolios` via compatibility views.
3. **Phase 2 reads:** enable feature-flagged reads for `core.work_items` in selected routes (dashboard/reporting first, write paths unchanged).
4. **Phase 3 docs:** move deliverable history read APIs to `documentation.*` with side-by-side comparison responses.
5. **Phase 4 finance:** switch analytics/reporting reads to `finance.revenue_lines` and `finance.cost_lines`; keep legacy finance writes until monthly reconciliation passes.
6. **Phase 5 imports governance:** enforce source update request + required acknowledgements before smart import commit.
7. **Phase 6 writes:** dual-write limited services to promoted tables; compare with reconciliation.
8. **Phase 7 deprecation planning (future approval):**
   - set legacy tables to read-only,
   - then compatibility-only,
   - then archive,
   - only then drop in separate approved phase.

---

## Notes for implementation teams
- No legacy table is dropped in this phase.
- Preserve actor/source/legacy lineage fields on every promoted fact table.
- Reconciliation script should be run before and after each scoped cutover.
