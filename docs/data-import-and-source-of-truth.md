# Data Import and Source of Truth

> **Last verified:** 2026-06-11 (aligned to the canonical finance source of truth)

> **Finance numbers have ONE computation path.** REV / COS / GP / cash are computed **solely** by
> `server/repositories/finance-line-level-repository.ts` from the normalized lines
> (`normalized_cost_lines` + `normalized_cost_line_actuals`) and `category_revenue_allocations`, per
> `docs/finance-source-of-truth-audit.md` Part I and `docs/AGENT_GUARDRAILS.md` § 3.3.2 / § 3B.
> **There are no parallel finance calculations.** Summary/snapshot tables below
> (e.g. `project_revenue_summary`, `tracker_revenue_summary`, the monthly tables) are **derived
> snapshots for display / reconciliation — they are NOT a finance source of truth** and must never be
> summed as an independent revenue/GP figure.
>
> **QuickBooks reconciliation is COMPANY-LEVEL.** Per-project QB attribution exists **only** via the
> invoice + ex-VAT-amount auto-matcher and must always show match coverage, never imply completeness
> (Part I § E). There is no per-project "QB is complete" path.

## Ownership model
Data ownership is intentionally split by domain:

- **Excel-mastered** domains: import governs canonical baseline.
- **App-mastered** domains: app is source of record.
- **Hybrid-governed** domains: app + import coexist with explicit
  governance/audit controls (per-cell `manual_overrides` JSONB,
  `adminDateOverride*` columns, `cosStatusOverride*` columns,
  `financialEditRequests` approval queue).

## Canonical data paths

These are the tables Smart Import v2 writes to during a commit. Any
read surface that displays plan, revenue, cost or schedule numbers
should ultimately resolve to one of these tables (directly or through
a documented snapshot/aggregate built on top).

| Domain | Canonical table | Notes |
|---|---|---|
| Project identity | `project_info` | Created/updated by import; soft-delete via `deleted_at IS NULL`. |
| Cost lines | `normalized_cost_lines` | Active rows have `effective_to IS NULL`. Reads must filter both `effective_to IS NULL` AND `deleted_at IS NULL`. |
| Revenue lines | `normalized_revenue_lines` | Same temporal + soft-delete invariant as cost lines. |
| Cost actuals (1:N) | `normalized_cost_line_actuals` | Child of `normalized_cost_lines`; per-row `actualNo`. |
| Schedule / plan | `work_items` (where `source = 'SMART_IMPORT'` and `workstream = 'PM'`) | Canonical-via-import. App edits flow into the same row; the merge engine keeps lineage via `import_snapshot` JSONB. |
| Top-of-sheet metadata | `tracker_project_metadata` | PM/PD names, site size, delivery model, phase tracker. |
| Tracker revenue summary | `tracker_revenue_summary` | Costed summary value, contract value. |

## Snapshot / aggregate tables (require `effective_to IS NULL` filter)

Reads against any of these must filter out historical snapshots — see
the `finance-snapshot-queries` skill in `CLAUDE.md`.

- `cashflow_points`
- `finance_revenue_monthly`
- `finance_cos_monthly`
- `category_revenue_allocations`
- `project_revenue_summary` — derived snapshot only; **not** a finance source of truth (the line-level
  repository is). Read it snapshot-guarded for display, never as an independent revenue/GP total.
- `dashboard_project_metrics`
- `dashboard_program_metrics`
- `monthly_report_snapshots` (PM and Engineering — frozen JSON blobs;
  freshness is not a temporal column but a generation-time vs.
  underlying-data-change-time comparison; see "Freshness contract"
  below).

The `normalized_*` tables themselves carry temporal columns and require
the same `effective_to IS NULL` filter on aggregate reads.

## Override layer

Smart Import v2 captures per-row state on every active row so the
3-way merge engine can reconcile imports against in-app edits without
losing either. Override surfaces the UI and reads consult:

| Surface | Kind | What it overrides | How it's read |
|---|---|---|---|
| `manual_overrides` JSONB | Column on `work_items`, `normalized_revenue_lines`, `normalized_cost_lines` | Per-field operator edits made between imports | Read overlay applied by `tracker-replica-repository` and `planning-tasks-routes`; consulted by the 3-way merge engine on the next import. |
| `adminDateOverride*` | Direct columns on `normalized_revenue_lines` and `normalized_cost_lines` | Effective-payment / effective-cost date | Read inline by cashflow / aging / forecast logic; takes precedence over `expectedPaymentDate` / `forecastPaymentDate`. |
| `cosStatusOverride*` | Direct columns on `normalized_cost_lines` | COS realisation status | Read by `isCanonicalCosRealised()` (the canonical predicate); admin overrides win over invoice/font-color gates. |
| `financialEditRequests` | Table | Approval workflow for critical revenue/cost edits | Queued; not auto-merged into reads. Surfaces on `/financial-review-queue`. |
| `manualEditFlags`, `conflictResolutionLog` | Tables | Audit log for who changed what / who resolved what conflict | Audit-only; not consulted by operational reads. |

Both the manual-overrides overlay and the 3-way merge engine are gated
by feature flags that **default ON**:

- `USE_THREE_WAY_MERGE` (`server/lib/import/feature-flags.ts`) —
  set to `false` to disable.
- `USE_MANUAL_OVERRIDES` (`server/lib/manual-overrides.ts`) — set to
  `"false"` to disable.

Legacy override tables (`normalized_cost_line_overrides`,
`normalized_revenue_line_overrides`, `work_item_overrides`) were
collapsed into the JSONB columns on 2026-03-30 and dropped on
2026-03-38. Do not reintroduce parallel override tables.

## Smart Import principles

- Preserve lineage from import rows. Every active row carries
  `import_snapshot` (JSONB) capturing the row as written, plus
  `row_hash` for stable identity across imports.
- Avoid silent destructive overrides. The merge engine never
  overwrites an in-app edit without surfacing a conflict.
- Keep conflict visibility explicit. Conflicts return HTTP 409 with
  structured baseline / current / file values for the operator.
- Maintain compatibility for legacy consumers while canonical tables
  are primary. Deprecated PE/PI shapes (`program_expense`,
  `program_inflows`) were physically dropped on 2026-04-14; do not
  reintroduce reads against them.

## Data quality rules

- Exclude placeholder/empty financial rows from normalized
  calculations.
- Preserve financial date/confirmation semantics for COS and cashflow
  logic. The canonical realisation predicate is
  `isCanonicalCosRealised()` in `server/lib/finance/cos-realisation.ts`
  — single source of truth, do not reinterpret.
- Use deterministic row identifiers (`row_hash`) where required for
  reconciliation.
- All aggregate reads against snapshot tables must filter
  `effective_to IS NULL` (Drizzle `isNull(table.effectiveTo)`).
- All writes through routes must go through `server/repositories/*` —
  no inline `db.select()` / `db.execute()` in route files.

## Freshness contract

The materialised snapshot tables (`monthly_report_snapshots`,
`dashboard_project_metrics`, `dashboard_program_metrics`) carry a
generation timestamp but no `effective_to` versioning. Read endpoints
serving these snapshots **must surface a freshness signal** to the
client when the underlying canonical data has changed since the
snapshot's `generatedAt`. The PM and Engineering monthly report
endpoints follow this contract — see
`server/services/pm-monthly-report-service.ts` and
`server/services/engineering-monthly-report-service.ts`.

## App-mastered (legitimate non-Excel) data

These are intentionally not Excel-sourced and are owned by the app:

- Engineering tasks (`work_items` where `workstream = 'ENG'`),
  engineering stages (`project_eng_stages`), commissioning state.
- Quality (`qc_item_instance`, `qc_warning`, `qc_checklist`).
- HSE (`hse_incident`, `hse_corrective_action`).
- Project Development pipeline (Pipedrive-fed).
- Priorities, RAID, action queues, gamification leaderboard.
- OpEx budget (`opex_budget_monthly`, `opex_weekly_manual`).
- Budget baselines (`budget_baselines`).
- Manual tracker entries (`tracker_monthly_manual`).
- COS tolerance bands (`financial_integration_rules`).

These domains are out of scope for the Excel source-of-truth
invariant. Endpoints serving them should set `sourceLayer:
"app-mastered"` in their finance trust headers when relevant.
