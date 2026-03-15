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


---

## 7) PR 87 staged promoted-read preparation (bridge to next-phase adoption)

### What PR 87 enables (additive, reversible)
- Added **compatibility read surfaces** for promoted core master data:
  - `core.v_clients_legacy_compat`
  - `core.v_portfolios_legacy_compat`
  - `core.v_project_portfolio_assignments_legacy_compat`
- Added **side-by-side promoted-vs-legacy comparison views**:
  - `core.v_projects_promoted_vs_legacy`
  - `core.v_clients_promoted_vs_legacy`
  - `core.v_portfolios_promoted_vs_legacy`
  - `core.v_project_portfolio_assignments_promoted_vs_legacy`
  - `core.v_work_item_counts_promoted_vs_legacy`
- Added **cutover blocker visibility** view:
  - `core.v_promoted_read_cutover_blockers`
- Added a narrow server compatibility service (`server/services/promoted-read-compat.ts`) to expose:
  - consistent comparison summaries
  - mismatch categories and sample IDs
  - readiness status (`ready` / `partial` / `blocked`)
- Added admin readiness API:
  - `GET /api/readiness/core-master-data`
- Added low-risk **feature-flagged promoted read path** for clients only:
  - `GET /api/clients` reads from `core.clients` **only when** `promoted_core_clients_read = true`
  - optional `?compare=true` emits comparison headers without changing behavior

### Readiness matrix after PR 87

| Candidate read area | Legacy source | Promoted source | Current readiness state | Blockers / notes | Next action |
|---|---|---|---|---|---|
| Projects master list/detail fields | `public.project_info` | `core.projects` | Partial/Blocked (depends on reconciliation output) | Any missing promoted rows blocks cutover; field mismatches must be explicit | Keep legacy primary, run comparison API + SQL views until blocker count reaches zero |
| Clients list (read-only) | `public.clients` | `core.clients` | Candidate for controlled rollout | Must pass parity checks continuously; flag default is off | Enable `promoted_core_clients_read` for admin/internal cohort only |
| Portfolios summary fields | `public.portfolios` | `core.portfolios` | Partial | Ownership/project composition still served via legacy-linked route logic | Keep legacy primary; adopt via wrapper in a focused follow-up PR |
| Project-portfolio assignments | `public.project_portfolio_assignments` | `core.project_portfolio_assignments` | Partial | Pairwise link diffs must be zero for safe rollout | Keep comparison-first; do not switch mutation routes yet |
| Work-item counts by project (reporting only) | `public.work_items` | `core.work_items` | Partial (report-only candidate) | Operational writes and mixed lineage are still active | Limit to read-only dashboard/reporting diagnostics |

### Exact recommended next PR order after PR 87
1. **PR 88: Expand promoted reads for core master data only**
   - Keep writes legacy.
   - Add feature-flagged promoted read for project list/detail summary endpoints.
   - Keep side-by-side comparison headers + logs.
2. **PR 89: Portfolio read-path hardening**
   - Isolate portfolio read endpoints into compatibility wrappers.
   - Adopt promoted read for summary/list only when assignment parity is stable.
3. **PR 90: First department schema rollout (recommended: `project_management`)**
   - One bounded rollout with explicit dual-read/compare and no broad write switch.

### Explicitly deferred by PR 87
- Broad PM/engineering/quality/procurement/finance read or write cutover.
- Legacy table deprecation/drop planning actions.
- Auto-resolution of duplicate finance rows or project-name linkage gaps.
- Any hidden business semantic change under promoted reads.

---

## 8) PR 88 expanded promoted reads for core master data (controlled + reversible)

### What changed in PR 88
- Expanded promoted-read rollout flags (default off):
  - `promoted_core_projects_read`
  - `promoted_core_portfolios_read`
  - `promoted_core_portfolio_assignments_read`
- Extended safe promoted read usage:
  - `GET /api/project-info` can read from `core.projects` when `promoted_core_projects_read=true`
  - `GET /api/portfolios` can independently source portfolios/assignments/projects from promoted core tables when corresponding flags are enabled
- Preserved legacy fallback behavior as default across all user-facing routes.
- Kept writes unchanged (legacy-primary, no dual-write in this PR).
- Extended readiness endpoint payload:
  - `GET /api/readiness/core-master-data` now includes `rolloutFlags` for projects/clients/portfolios/assignments promoted-read toggles.
- Preserved side-by-side comparison and mismatch visibility:
  - compare mode (`?compare=true`) and promoted-read execution paths both emit comparison headers
  - comparison mismatches are still logged; no silent conflict suppression.

### PR 88 readiness and known blockers (do not hide)

| Domain | PR 88 read posture | Current blocker posture | Evidence path | Go-forward note |
|---|---|---|---|---|
| Projects master read (`project_info` compatibility) | Feature-flagged promoted read added | **Blocked/Partial** until zero missing promoted rows and stable field parity | `/api/readiness/core-master-data`, `core.v_projects_promoted_vs_legacy` | Keep fallback default OFF outside controlled cohorts |
| Portfolios list summary | Feature-flagged promoted read added | **Partial** because legacy portfolio metadata (owner/status/clientName semantics) remains richer than promoted baseline | `/api/readiness/core-master-data`, `core.v_portfolios_promoted_vs_legacy` | Safe for controlled read cohorts only; keep legacy default |
| Project-portfolio assignment linkage | Feature-flagged promoted read added | **Partial/Blocked** whenever pairwise link parity is non-zero | `/api/readiness/core-master-data`, `core.v_project_portfolio_assignments_promoted_vs_legacy` | Must hit zero missing assignment links before wider adoption |

### What remains blocked before broader project-detail adoption
- Project detail reads still rely on legacy-only fields not fully represented in `core.projects` (`size_kwp`, PM/PD ownership, signed-document metadata, execution-enabled settings, and related operational enrichments).
- Portfolio ownership and workflow metadata are still primarily anchored in legacy tables and joins.
- Project-name linkage risks remain in non-master flows and must be addressed before broad project-detail promoted reads.

### Exact next PR recommendation
1. Proceed to **PR 89** for bounded project-detail master read adoption (identity/client/phase/rag + portfolio membership summaries only).
2. Add read-only work-summary diagnostics as reporting/admin evidence only.
3. Keep all project execution writes and operational task behavior unchanged until later convergence phases.
