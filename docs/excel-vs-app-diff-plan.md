# Excel-vs-App Diff System — Implementation Plan

> **Status:** APPROVED 2026-04-30 — all 6 locked decisions reconfirmed,
> all 5 open decisions resolved per the plan's recommendations.
> Implementation may proceed under the per-workstream plans below.
> **Created:** 2026-04-30
> **Branch:** `claude/replica-diff-and-reporting-p3OWG`
> **Author:** Claude (AI-assisted), reviewed by user.
> **Scope:** Three coordinated workstreams that make the imported Tracker
> workbook the unambiguous source of truth across reporting, dashboards,
> and KPI surfaces — and give operators a single screen (per-project +
> program-level) to see and resolve every place live state has drifted
> from Excel.

---

## 0. Mission summary

Build the "Excel-vs-App" diff system that makes the imported tracker
workbook the unambiguous source of truth across the company tool — for
reporting, dashboards, and any KPI surface — and gives operators a single
screen (per project + program-level) to see and resolve every place the
live state has drifted from Excel.

Three coordinated workstreams, sequenced as A‖B → C:

| ID | Workstream | Owner of risk | PR shape |
|----|-----------|---------------|----------|
| A  | Reporting audit (read-only inventory + follow-up issues) | Data trust | Doc PR + N follow-ups |
| B  | Live-column-equals-Excel invariant + import_snapshot backfill | Operational tabs | Single PR (recommended) |
| C  | Diff page UI + bulk actions + RBAC | UX + workflow | Single PR (depends on B) |

---

## 1. Architectural decisions ALREADY LOCKED

These were locked in the kickoff brief. They are surfaced here so any
re-debate is explicit during plan review, not at implementation time.

1. **Replica = source of truth.** All reporting (dashboards, finance,
   KPIs, programme reports) reads from the canonical `normalized_*`
   tables that the tracker-replica routes already use. No reads from
   deprecated PE/PI shapes (`programExpense`/`programInflows`) or stale
   derivatives.
2. **"Live column = Excel" invariant.** Cell-edit mutations on the
   operational tabs MUST stop writing to the value column on
   `normalized_cost_lines` / `normalized_revenue_lines` / `work_items`.
   They write to `manual_overrides` JSONB only. Operational tabs apply
   `manual_overrides` on top of the live column for display; reporting
   and replica read the live column unmodified.
3. **No auto-creation.** For "unverified drift" rows (live ≠
   `import_snapshot` AND no `manual_overrides` entry AND no side-table
   override that explains it), the diff page raises an alert and
   requires the appropriate-role user to either Accept Excel or Keep
   app + reason. Never silently backfill `manual_overrides`.
4. **Diff pages at BOTH program-level and per-project.** Program-level:
   one row per project, drift counters, filters. Per-project: three
   sections matching the replica, side-by-side field rendering, cell
   colours from the workbook, bulk select.
5. **Comparison logic uses `valuesEqual()`** from
   `server/lib/import/merge-engine.ts:75` — loose equality across
   `"1500" / 1500 / "1,500.00"` and ISO-vs-Excel-date strings is
   identical to the import engine's existing semantics. The merge-field
   lists `PLAN_MERGE_FIELDS` / `REVENUE_MERGE_FIELDS` /
   `EXPENDITURE_MERGE_FIELDS` in
   `server/lib/import/commit-executor.ts:135–167` are the canonical
   "fields that participate in the diff".
6. **Phase 2 of the engine-consolidation assessment is pulled forward**
   to be a prerequisite of the diff page, so legacy NULL-snapshot rows
   have a baseline to compare against
   (`docs/smart-import-v2-engine-consolidation-assessment.md` § "Phase
   2", currently `Pending`).

---

## 2. Glossary (to keep the rest of the doc precise)

| Term | Meaning |
|------|---------|
| **Live column** | The actual column on the canonical row (e.g. `normalized_cost_lines.amount_ex_vat`). After this work it is the most recent Excel value, untouched by operator edits. |
| **`import_snapshot`** | JSONB column on `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_cost_line_actuals`, and `work_items`. Stores the per-row compare-field values exactly as written by the most recent import. The "common ancestor" in 3-way merge. **NOTE:** distinct from the legacy `import_snapshot` column on `program_expense`/`program_inflows` written by `server/lib/inline-edit-helper.ts` — that one is a revert-buffer on the deprecated tables and MUST NOT be confused with the v2 merge column. |
| **`manual_overrides`** | JSONB column on the same four tables. Per-field map: `{ fieldName: { value, editedBy, editedAt, fromValue } }`. Maintained by `server/lib/import/merge-engine.ts:289` (`updateManualOverrides`) and — after this work — by the operational tab cell-edit handlers as well. |
| **Tracked field** | A field listed in `PLAN_MERGE_FIELDS` / `REVENUE_MERGE_FIELDS` / `EXPENDITURE_MERGE_FIELDS` (`server/lib/import/commit-executor.ts:135–167`). The same set the import engine uses for conflict detection. |
| **Drift** | For a tracked field on a matched row: `valuesEqual(displayValue, importSnapshot[field]) === false`. `displayValue = manualOverrides[field]?.value ?? row[field]`. |
| **Verified drift** | Drift where `manual_overrides[field]` is present and `editedBy != null` (an operator deliberately overrode the file). |
| **Unverified drift** | Drift where `manual_overrides[field]` is absent — the live column was changed by some path that bypassed the override pipeline. Requires Accept Excel / Keep app + reason resolution. |

---

## 3. Table of contents

- [Workstream A — Reporting audit](#workstream-a--reporting-audit)
- [Workstream B — Live-column-equals-Excel invariant + backfill](#workstream-b--live-column-equals-excel-invariant--backfill)
- [Workstream C — Diff page UI + bulk actions + RBAC](#workstream-c--diff-page-ui--bulk-actions--rbac)
- [Sequencing & dependencies](#sequencing--dependencies)
- [Risks & rollback per workstream](#risks--rollback-per-workstream)
- [Open decisions for this plan review](#open-decisions-for-this-plan-review)

---

## Workstream A — Reporting audit

### A.1 Goal

Produce an authoritative, file:line-accurate inventory of every
reporting/aggregation endpoint and classify each one against the
replica-as-source-of-truth contract:

- **canonical** — reads `normalized_cost_lines` / `normalized_revenue_lines`
  / `normalized_cost_line_actuals` / `work_items` with the
  `effectiveTo IS NULL` (and `deletedAt IS NULL` where present) guards.
- **legacy** — reads `programExpense` / `programInflows` /
  `cashflow_points` / pre-temporal aggregate views.
- **derivative** — reads materialised summary tables that are themselves
  refreshed from canonical (e.g. `financeRevenueMonthly`,
  `financeCosMonthly`, `projectRevenueSummary`,
  `categoryRevenueAllocations`). These are temporal and must filter
  `effectiveTo IS NULL`; the question is whether the upstream refresh
  job is itself canonical.
- **mixed** — file reads both canonical and legacy/derivative for the
  same metric. These are the riskiest: a single endpoint that can return
  two different numbers depending on the path it takes.

This workstream produces no production code in week 1. It produces:

1. `docs/reporting-audit-2026-04.md` — punch list, file:line pointers,
   classification, recommended action.
2. One follow-up issue per non-canonical reader (or per cluster of
   readers in the same file), with reproduction steps and the
   replacement query shape.

### A.2 In-scope files (initial seed list, not exhaustive)

Pulled from `grep -rln "from.*normalizedCostLines|from.*normalizedRevenueLines|from.*programExpense|from.*programInflows|from.*cashflowPoints|from.*financeRevenueMonthly|from.*financeCosMonthly"` over `server/`. Each is classified
preliminarily; the audit will confirm.

| File | Preliminary class | Notes |
|------|-------------------|-------|
| `server/services/dashboard-metrics.ts:55–72` | canonical | Already filters `effectiveTo IS NULL` + `deletedAt IS NULL` on both tables. Spot-check confirmed. |
| `server/services/canonical-dashboard-kpi-service.ts:67–133` | canonical | Filters present on every aggregate. |
| `server/services/project-header-kpi-service.ts:238–243` | canonical | Filters present; reads `projectRevenueSummary` (derivative) with `effectiveTo IS NULL` too. |
| `server/services/financial-review-service.ts` | unknown | Audit. |
| `server/services/pm-monthly-report-service.ts` | unknown | Audit. |
| `server/services/company-overview-service.ts` | unknown | Audit. |
| `server/services/quickbooks-cascade-service.ts` | unknown | Audit. |
| `server/services/quickbooks-reconciliation-service.ts` | unknown | Audit. |
| `server/services/report-drilldown-service.ts` | unknown | Audit. |
| `server/services/project-cost-line-read-service.ts` | unknown | Audit. |
| `server/services/gate-auto-evaluator-service.ts` | unknown | Audit. |
| `server/repositories/finance-temporal-repository.ts` | unknown | Audit; this is the natural place for canonical reads. |
| `server/repositories/finance-analysis-repository.ts` | unknown | Audit. |
| `server/repositories/finance-expense-engine-repository.ts` | unknown | Audit. |
| `server/repositories/finance-inflows-repository.ts` | unknown | Audit. |
| `server/repositories/tracker-replica-repository.ts` | canonical | Already the "good" pattern; baseline for everything else. |
| `server/portfolio-routes.ts` | unknown | Audit. |
| `server/report-routes.ts` | unknown | Audit. |
| `server/routes/dashboard-routes.ts` | unknown | Audit (separate from dashboard-metrics service). |
| `server/routes/home-extracted-routes.ts` | unknown | Audit. |
| `server/routes/finance-legacy-extracted-routes.ts` | likely legacy | Name hints at PE/PI; confirm. |
| `server/routes/overview-extracted-routes.ts` | unknown | Audit. |
| `server/lifecycle-routes.ts` | unknown | Audit. |
| `server/subcontractor-routes.ts` | unknown | Audit. |
| `server/departments/finance-routes.ts` | mixed (likely) | Large file; reads both PE/PI and canonical in different handlers. |
| `server/departments/fye-revenue-tracking-routes.ts` | unknown | Audit. |

### A.3 Audit method

Per file, the audit will record:

1. **Endpoint(s)** — every Express handler in the file.
2. **Tables read** — each `db.select().from(...)` / `sql` block.
3. **Guards** — does it filter `effectiveTo IS NULL` and `deletedAt IS NULL`
   on every snapshot table read?
4. **Classification** — canonical / legacy / derivative / mixed.
5. **Drift exposure** — does the endpoint return aggregates that consumers
   trust as "live state"? (high / medium / low).
6. **Recommended action** — leave / migrate / replace with repository
   call / mark deprecated.

Tooling to assist:
- The existing `ee-snapshot-auditor` agent (per `.claude/agents/`) greps
  for snapshot-table reads missing the `effectiveTo IS NULL` guard. Run
  it as a first-pass screen.
- The existing `finance-snapshot-queries` skill encodes the exact list
  of snapshot tables — same source.

### A.4 Output shape

`docs/reporting-audit-2026-04.md` — one section per file. Within each
section: a table of endpoints with the five columns above, a "Findings"
subsection summarising mixed-source bugs, and a "Recommended issue
list" of follow-ups.

Each follow-up issue (created via GitHub MCP) gets:
- Title: `Reporting: <file>:<endpoint> reads <legacy table>`.
- Body: file:line excerpt, replacement query, blast radius, RBAC notes.
- Labels: `reporting`, `data-trust`.

### A.5 Out of scope

- Migrating any endpoint. Every migration is a follow-up PR with its
  own test plan.
- Changing the materialisation cadence of derivative tables. Refresh-job
  ownership stays where it is.
- Refactoring shape. The audit only categorises; it does not redesign.

### A.6 Acceptance

- A.AC-1: Every file in §A.2 (and any file the audit discovers) has a
  classification.
- A.AC-2: Every endpoint that reads a snapshot table without
  `effectiveTo IS NULL` filtering is captured as a `data-trust` issue.
- A.AC-3: Every endpoint classified as "mixed" lists the metrics that
  diverge between the two paths.
- A.AC-4: The audit doc cross-references the migration-target file
  (the canonical replacement) per legacy reader.

---

## Workstream B — Live-column-equals-Excel invariant + backfill

### B.1 Goal

Make the canonical row's value columns hold the most recent **Excel**
value, never the operator's edit. Operator edits flow into
`manual_overrides` JSONB on the same row. Everywhere reporting reads
the value column it gets Excel-truth; everywhere the operational tab
reads it the tab applies overrides on top for display.

Plus: backfill `import_snapshot` for every active canonical row that
predates PR2C, so the diff page in workstream C has a baseline to
compare against.

### B.2 Two-state invariant (the steady state we are building toward)

For each tracked field on each active canonical row:

| Source | Holds | Written by |
|--------|-------|-----------|
| `row[field]` (the live column) | The most recent Excel value. Refreshed only by Smart Import v2. | `server/lib/import/commit-executor.ts` (and any future import path). |
| `row.import_snapshot[field]` | The Excel value as of the last commit. The "common ancestor". | Same — `commit-executor.ts`. |
| `row.manual_overrides[field]` | `{ value, editedBy, editedAt, fromValue }` whenever the operator chose a value other than `row[field]`. | (today) `merge-engine.updateManualOverrides` on conflict resolution. (after this work) the operational-tab cell-edit handlers as well. |
| Display value on operational tabs | `manual_overrides[field]?.value ?? row[field]`. | Tab read paths (computed). |
| Reporting / replica read | `row[field]` unmodified. | Repositories. |

Diff detection (workstream C) is then trivially:
- Drift = `!valuesEqual(displayValue, importSnapshot[field])`.
- Verified drift = drift AND `manual_overrides[field]` present.
- Unverified drift = drift AND `manual_overrides[field]` absent.

### B.3 Mutation inventory — Expenditure tab path

Today's flow (cell edit on `ExpenditureEditableTab`):
- Client: `client/src/components/tabs/ExpenditureEditableTab.tsx:515` →
  `POST /api/expenditure/overrides` with `{ overrides: [{ projectName,
  rowNumber, fieldName, overrideValue }], overrideCategory,
  overrideComment }`.
- Server: `server/departments/finance-routes.ts:6746` →
  - inserts a row in the legacy `expenditure_tracking_overrides` table,
    OR raises a `financial_edit_requests` row with `status=pending` if
    the actor lacks direct edit permission;
  - **then** syncs to the canonical row via `db.update(normalizedCostLines).set({...value-fields...})`
    (the sync block is the part that violates the invariant).

Re-routing target:
1. Stop the canonical-row value-column write. The override-table row +
   `financial_edit_requests` flow stay (they remain the audit /
   approval surface).
2. On approval (or direct write when the actor has permission), upsert
   `manual_overrides[fieldName] = { value, editedBy: actorId, editedAt:
   now, fromValue: row[field] }`. Use `merge-engine.updateManualOverrides`
   shape so the import engine and the cell-edit handler write
   identically-shaped entries.
3. Operational tab read path applies `manual_overrides[fieldName]?.value
   ?? row[field]` for display. The "Reset to Excel" affordance becomes
   "delete `manual_overrides[fieldName]`".

### B.4 Mutation inventory — Revenue tab path

Symmetric to Expenditure:
- Client: `RevenueTrackingEditableTab.tsx:144` → `POST /api/revenue-tracking/overrides`.
- Server: `server/departments/finance-routes.ts:5831` →
  inserts/updates `revenue_tracking_overrides` row, then at line 5920
  syncs `paidDateConfirmed`, `paidDateFontColor`, `paidDate`,
  `inBankDate` to `normalizedRevenueLines`.

Same re-routing target: stop the sync write at line 5920, replace with
`manual_overrides` upsert on the canonical row.

### B.5 Mutation inventory — Plan tab path

Plan-tab cell edits run through `/api/planning-tasks/:id` PATCH and
hit `work_items` directly:

- Client: `UnifiedPlanTab.tsx:949` and `TaskDetailDrawer.tsx:215, 373,
  411` → `apiRequest("PATCH", "/api/planning-tasks/{id}", {...})`.
- Server: `server/routes/planning-tasks-routes.ts:946–1163` — six
  separate `db.update(workItems).set(wiMirror)` blocks that copy
  user edits onto the canonical row's value columns
  (percentComplete, status, etc.).

Re-routing target: those six blocks are the heart of the change. Each
becomes a `manual_overrides` upsert. The plan tab read path (the
parallel query in `planning-tasks-routes.ts` already documented in
limitations § 14) gets a small wrapper that overlays
`manual_overrides` for display.

`work_items` has no `effectiveTo` column (the writable-view was
retired — see migration `20260409_retire_work_items_view.sql`); active
rows are `deletedAt IS NULL`. The override pattern still applies; the
soft-close half does not.

### B.6 Mutation inventory — admin-date-override paths

Two short-circuit paths on canonical rows that bypass the override
table entirely:

- `server/departments/finance-routes.ts:1460` — cost-line
  `adminDateOverride` writes directly to `normalizedCostLines` value
  columns (`adminDateOverride`, `adminDateOverrideReason`,
  `adminDateOverrideBy`, `adminDateOverrideAt`).
- `server/departments/finance-routes.ts:1558` — symmetric for
  `normalizedRevenueLines`.

These are NOT in the merge-field lists (they are operational metadata,
not Excel-tracked fields), so they don't show up as drift. **Out of
scope for the invariant.** Documenting here so the audit doesn't
flag them as in-scope writes.

### B.7 Mutation inventory — out-of-scope writes

These write to canonical-table value columns but are not "operator cell
edits on operational tabs" and stay as-is:

| File:line | Reason out of scope |
|-----------|--------------------|
| `server/lib/import/commit-executor.ts` (the import engine itself) | Authoritative writer of the live column. |
| `server/services/finance-line-write-service.ts:96, 166` | Used by the legacy `/api/finance/cost-lines/:id` and `/api/finance/revenue-lines/:id` PATCH routes, which are admin-only manual line creation/edit. Treated as direct DB administration, not Excel-tracked operational edits. |
| `server/lib/backfill.ts:28` | One-shot backfill — runs once, audited. |
| `server/work-items-adapter.ts` (legacy, read-only by CLAUDE.md policy) | Don't extend. |
| `server/services/task-cascade-service.ts:111, 152, 197` | Cascading parent/child timeline updates derived from the user's edit on a different row — they SHOULD apply to the live column for now (cascades are a layer above per-cell edits and aren't drift). Audited separately if the diff page shows false positives. |
| `server/ms-sync-routes.ts:484` | Microsoft Graph sync of task assignment metadata; not a tracked field. |
| `server/admin-recovery-routes.ts:223–418` | Admin recovery (un-delete, etc.). Operates on rows directly; explicit-action context. |
| `server/lifecycle-routes.ts:1462`, `server/engineering-routes.ts:597, 1816`, `server/api/v2/repositories/project-v2-repository.ts:153`, `server/tr-register-routes.ts:374, 455, 644`, `server/routes/operational-tasks-routes.ts:371`, `server/routes/planning-extracted-routes.ts:681–796`, `server/routes/mytool-routes.ts:377–439`, `server/routes/working-plan-routes.ts:163–335`, `server/task-management-routes.ts:557–872`, `server/deliverable-capture-routes.ts:183, 190` | Each is its own domain (lifecycle, engineering tickets, TR register, etc.). The audit (workstream A) classifies whether they touch tracked fields; only the ones that do enter the invariant scope. **Default assumption**: most of these write fields outside the merge-field lists (status enums, audit metadata), so they're not drift sources. The audit will confirm. |

### B.8 New helper module — `server/lib/manual-overrides.ts`

A thin wrapper around the existing `merge-engine` JSONB shape so
non-import code paths can write `manual_overrides` without re-reading
the merge engine internals.

```ts
export interface ApplyOverrideInput {
  table: "normalized_cost_lines"
       | "normalized_revenue_lines"
       | "work_items";
  rowId: number;
  fieldName: string;            // canonical (camelCase or snake_case OK)
  value: FieldValue;            // operator's chosen value
  editedBy: number | null;      // session user id
  reason?: string | null;       // optional, persisted to manual_overrides
                                // entry as `note` (additive field)
}

export async function applyManualOverride(
  tx: TxOrDb,
  input: ApplyOverrideInput,
): Promise<void>;

export async function clearManualOverride(
  tx: TxOrDb,
  table: ApplyOverrideInput["table"],
  rowId: number,
  fieldName: string,
): Promise<void>;
```

Internally it:
1. Reads `manual_overrides` JSONB and `row[field]` (current live).
2. Builds the entry: `{ value, editedBy, editedAt: now, fromValue: currentLive, note }`.
3. Writes back the merged `manual_overrides` JSONB. **Does not** touch
   the live column — that's the whole point of this module.
4. Inserts a `financial_edit_requests` row with `status='approved'`
   and the edit summary, so existing audit consumers keep working.

The merge engine's `updateManualOverrides` keeps doing the same job
during import. Both call sites end up with identical JSONB shape.

### B.9 New script — `scripts/backfill-import-snapshot.ts`

Pull-forward of Phase 2 from the engine-consolidation assessment.

**Signature**

```bash
npx tsx scripts/backfill-import-snapshot.ts \
  [--project-id=<n>]   # optional, single project; default = all
  [--dry-run]          # no writes, log what would change
  [--verbose]
```

**Behaviour**

For each project:
1. Find the latest `smart_import_runs` row with `status='COMMITTED'`.
2. Read `summaryJson.normalization` — contains the parsed file rows
   per section (PLAN / REVENUE / EXPENDITURE / actuals).
3. For each canonical-table active row (`effectiveTo IS NULL` /
   `deletedAt IS NULL`) where `import_snapshot IS NULL`:
   - Match the file row by `row_hash` if present; fall back to the
     row-matcher's natural key (the same code path the import engine
     uses, imported from `server/lib/import/row-matcher.ts`).
   - Build the snapshot from the file row using the merge-field list
     for that section.
   - `UPDATE table SET import_snapshot = $1 WHERE id = $rowId AND
     import_snapshot IS NULL` (the `IS NULL` guard makes the script
     idempotent — re-runs are no-ops).
4. Log per-project counts: matched / unmatched / written.

**Idempotency**

- Read-only over `summaryJson` (never edits import runs).
- The `import_snapshot IS NULL` guard means re-running the script
  cannot revert a snapshot already written by a real import.
- If a row can't be matched to any file row, skip it (log) — do NOT
  invent a snapshot. The diff page will treat its drift as
  "needs first re-import to anchor".

**Audit-logging**

A single row in `audit_log` (or equivalent) per script invocation:
`{ action: "BACKFILL_IMPORT_SNAPSHOT", actor: <runner>, rowsTouched,
  projectsTouched }`. Per-row writes are not individually audited —
they are by-design recovery of metadata that was always intended to
be there.

### B.10 Test plan

Three Vitest suites, each isolated:

1. **`qa/tests/unit/manual-overrides-helper.test.ts`** — covers
   `server/lib/manual-overrides.ts`.
   - `applyManualOverride` adds a new entry: assert
     `manual_overrides[field]` is populated, `row[field]` is
     unchanged.
   - `applyManualOverride` updates an existing entry: timestamp +
     editor refresh; `fromValue` preserves the **earliest** override
     (does NOT shift to "from previous override").
   - `clearManualOverride` removes the entry and (since live column
     was never touched) the row reverts to Excel-truth automatically
     on the next read.

2. **`qa/tests/unit/cell-edit-invariant.test.ts`** — covers the three
   re-routed cell-edit code paths.
   - For each path (cost, revenue, plan): simulate a cell edit;
     assert `row[field]` is unchanged and `manual_overrides[field].value`
     equals the operator's value.
   - Repeat-edit: second edit on same field updates the existing
     entry; `editedAt` advances; `fromValue` is the **original**
     Excel value, not the previous override.
   - Re-import: simulate a Smart Import run that brings a different
     value for the same field. Assert merge engine produces a
     conflict (existing manual override + file change ≠ db).

3. **`qa/tests/unit/backfill-import-snapshot.test.ts`** — covers the
   backfill script.
   - Project with no committed runs → script is a no-op.
   - Project with committed run + active rows: snapshot populated
     for all matched rows; `import_snapshot IS NULL` guard prevents
     overwriting an already-set snapshot.
   - Idempotency: second run leaves the table identical.

Targeted iteration:
```bash
npx vitest run -c qa/vitest.config.ts \
  qa/tests/unit/manual-overrides-helper.test.ts \
  qa/tests/unit/cell-edit-invariant.test.ts \
  qa/tests/unit/backfill-import-snapshot.test.ts
```

Smoke test (manual, on a postgres dev DB):
1. Run backfill script with `--dry-run`. Confirm log counts.
2. Run for real on a single project.
3. Edit a cell on the operational Expenditure tab. Confirm the live
   column is unchanged in DB; `manual_overrides` is populated.
4. Re-upload the Tracker workbook unchanged. Confirm the edited cell
   surfaces as a "keep_db" outcome (no conflict, override preserved).
5. Re-upload with the cell value changed in Excel. Confirm a v2
   conflict prompt appears.

### B.11 Acceptance

- B.AC-1: For each of the three operational tabs (cost / revenue /
  plan), a cell edit no longer changes `row[field]` on the canonical
  table; the change appears only in `manual_overrides[field]`.
- B.AC-2: The operational tab read paths render the override value
  on top of the live column.
- B.AC-3: A re-import that brings a new Excel value for an
  override-bearing field surfaces a v2 conflict (existing engine
  behaviour, validated unchanged).
- B.AC-4: `manual_overrides` schema shape is identical whether the
  entry was written by the import engine or by the cell-edit path
  (verified by helper-shape unit test).
- B.AC-5: After running the backfill script over a project with prior
  imports, every active canonical row has a non-null `import_snapshot`
  matching the most recent committed file values for the row's
  merge-field set.
- B.AC-6: `npm run check` and the targeted Vitest suite are green.
  No new failures in `qa/tests/unit/permission-snapshot-no-drift.test.ts`
  beyond the 3 pre-existing fails on main.

---

## Workstream C — Diff page UI + bulk actions + RBAC

### C.1 Goal

A pair of screens — one program-level, one per-project — that surface
every drift between live state and Excel-truth, give the right operator
the right resolution affordance, and route unverified drift through
the existing approval pipeline rather than silently auto-resolving.

### C.2 Routes

New file: `server/routes/excel-vs-app.routes.ts` (dot-separator pattern,
per `CLAUDE.md` § "API Style"). Pure read; no mutations live in this
route file. Mutations re-use the existing `financial_edit_requests`
endpoints in `server/departments/financial-integration-routes.ts` and
the new `applyManualOverride` helper.

| Method | Path | Purpose | RBAC |
|--------|------|---------|------|
| GET | `/api/excel-vs-app/program` | Program-level summary: one row per project with drift counters. | `requireAuth` + `requirePermission("excel_vs_app", "view")` (NEW permission, see §C.6). |
| GET | `/api/excel-vs-app/projects/:projectId` | Per-project drift detail across PLAN / REVENUE / EXPENDITURE. | Same. |
| GET | `/api/excel-vs-app/projects/:projectId/unverified` | Unverified-drift queue for the project; feeds the project-header notification component. | Same. |

Each handler:
- Loads the canonical rows via the existing
  `trackerReplicaRepository` (extended — see C.3) which already filters
  `effectiveTo IS NULL` and `deletedAt IS NULL` correctly.
- For each tracked field on each row, computes
  `displayValue = manualOverrides[field]?.value ?? row[field]` and
  compares against `importSnapshot[field]` via `valuesEqual` from
  `merge-engine.ts:75`.
- Aggregates drift / verified-drift / unverified-drift counts.
- Returns cell-format JSONB so the client can render the workbook's
  font/fill colours via `client/src/lib/tracker-cell-format.ts`.

### C.3 Repository extension

Extend `server/repositories/tracker-replica-repository.ts` with a
single method:

```ts
async getDriftDetail(projectId: number): Promise<{
  costLines: DriftRow[];
  revenueLines: DriftRow[];
  workItems: DriftRow[];
}>;
```

Where `DriftRow` is:

```ts
interface DriftRow {
  id: number;                  // canonical row id
  rowHash: string | null;
  displayLabel: string;        // milestoneName | description | taskName
  sourceRow: number | null;
  fields: Array<{
    fieldName: string;         // canonical name
    liveValue: FieldValue;     // row[field]
    snapshotValue: FieldValue; // importSnapshot[field]
    overrideValue: FieldValue; // manualOverrides[field]?.value (else null)
    overrideEditor: number | null;
    overrideEditedAt: string | null;
    overrideReason: string | null;
    cellFormat: CellFormat | null;
    drift: "none" | "verified" | "unverified";
  }>;
}
```

The repository performs a single read per table per project, applies
`isNull(effectiveTo)` (and `isNull(deletedAt)` where present), and
walks the merge-field list once per row. No per-cell DB queries — the
JSONB columns travel with the row.

### C.4 State machine for unverified drift

```
                ┌───────────────┐
                │ Unverified    │  Drift detected, no manual_overrides
                │ drift         │  entry, no side-table override.
                └───────┬───────┘
                        │
       ┌────────────────┼─────────────────┐
       │                │                 │
       ▼                ▼                 ▼
  Accept Excel    Keep app +         Request approval
  (delete         reason             to push back to
  manual_         (creates           Excel
  overrides       manual_            (creates
  entry → row     overrides          financial_edit_
  reverts to      entry,             requests row,
  live = Excel)   editedBy =         status=pending,
                  actor)             routes to role
                                     mapping in §C.6)
       │                │                 │
       ▼                ▼                 ▼
  ┌─────────────────────────────────────────────┐
  │ Resolved — drift recorded as verified       │
  │ (or live = Excel for "Accept Excel").       │
  │ Audit row written either way.               │
  └─────────────────────────────────────────────┘
```

Crucial property: there is no path that writes to the live column.
"Accept Excel" deletes the override; the live column was already
Excel-truth (post-workstream-B). "Keep app" upserts the override; the
live column stays Excel-truth.

### C.5 Page design

Two new pages under `client/src/pages/`:

**`excel-vs-app.tsx`** (program-level)

- Route: `/program/excel-vs-app` (recommendation — see decision §6.2).
- Top: program totals — total drifted fields, unverified count, last
  import timestamp range (min/max across projects).
- Filters: project status, drift type (any / verified / unverified),
  section (PLAN / REVENUE / EXPENDITURE).
- Table: one row per project with columns
  `Project | Last Import | Drift (verified) | Drift (unverified) | Action`.
  Action column has "Open diff" link to the per-project page.
- Sort: default by unverified drift desc.

**`excel-vs-app-project.tsx`** (per-project)

- Route: `/projects/:id/excel-vs-app`.
- Layout mirrors the existing tracker-replica per-project pages so
  operators don't relearn it: header summary card, then three sections
  (Schedule / Revenue / Costs) collapsible.
- Each section renders a table with columns:
  `Row | Field | Excel value | Live value | Override | Drift status | Cell colours | Actions`.
- Cell colours = the workbook colours via
  `styleForCell(row.cellFormat, fieldName)` from
  `tracker-cell-format.ts:102`.
- Drift status badges: green "match" / amber "verified drift" / red
  "unverified drift".
- Bulk select via row checkboxes; bulk-action bar appears at top when
  any row is selected: "Accept Excel (N)", "Keep app (N) + reason",
  "Request approval (N)".

### C.6 RBAC

A new permission key `excel_vs_app` with `view` and `resolve` actions,
added to `shared/permissions.ts`. Per-action role gating mirrors the
existing per-field edit roles already enforced today on the
operational tabs:

| Action surface | Allowed roles |
|----------------|--------------|
| View diff pages | All authenticated roles. (`excel_vs_app:view`) |
| Resolve drift on cost-line tracked fields | `PROGRAM_FINANCE_MANAGER`, `CFO`, `CCO`, `COO_ADMIN`, `CEO_ADMIN` (matches today's `financials:edit`). |
| Resolve drift on revenue-line tracked fields | `PROGRAM_FINANCE_MANAGER`, `CCO`, `CFO`, `COO_ADMIN`, `CEO_ADMIN`. |
| Resolve drift on plan tracked fields | `PROGRAM_MANAGER`, work-item owner (`assignedToUserId == actor`), `COO_ADMIN`, `CEO_ADMIN`. |
| Bulk "Accept Excel" / "Keep app" | Same per-section role set as per-field edit. **No new "bulk override" privilege** — the brief is explicit about this. |
| Bulk "Request approval to push back to Excel" | All roles with read access (the request itself doesn't change canonical state — approval is on the receiving end). |

Server-side enforcement: the new `requirePermission("excel_vs_app",
"view")` for the GET endpoints; a per-section hard check inside the
resolve mutation (which reuses the existing
`/api/financial-edit-requests` endpoints — they already enforce the
right role gates).

### C.7 Drift queue / notification surface

Unverified drift goes through `financial_edit_requests` with a new
`editType = "EXCEL_VS_APP_UNVERIFIED_DRIFT"`. Routing rules:

| Section | Reviewer roles (from `requirePermission` logic) |
|---------|-----------------------------------------------|
| EXPENDITURE | `PROGRAM_FINANCE_MANAGER`, `CFO`. |
| REVENUE | `PROGRAM_FINANCE_MANAGER`, `CCO`. |
| PLAN | `PROGRAM_MANAGER`, work-item owner. |

Per-project surface:
- A small `<UnverifiedDriftBadge>` component on the project header
  (count of pending drift requests for that project). Clicks through to
  the per-project diff page filtered to "unverified".
- An entry in the existing `NotificationBell` component
  (`client/src/components/NotificationBell.tsx`).

Program surface:
- A count badge on the `/program/excel-vs-app` page itself — total
  unverified drift across the portfolio, gated on the actor's role
  (only counts projects the actor can resolve).

### C.8 Bulk action UX

Caps + confirmation:
- Per-action cap: 50 rows. The brief recommended this; we adopt it.
  Rationale: prevents runaway "accept all 800 cost lines" reconciliations
  that would erase verified drift in one click.
- Confirm dialog content: "You are about to {Accept Excel|Keep app|
  Request approval} for N fields across M rows. The most-impactful
  fields are: {top 5 fields by drift count}. {Field} on {row} will
  change from {live} to {excel}." Diff summary visible before the
  user confirms.
- After confirmation, mutations run sequentially (not bulk SQL) so
  per-row failures (e.g. permission denied on one field) don't abort
  the whole batch — surface them in a toast at the end.

### C.9 Tests

- `qa/tests/api/excel-vs-app.test.ts` — happy-path GET on a seeded
  project; aggregate counts match the seed.
- `qa/tests/unit/drift-detection.test.ts` — `valuesEqual`-based drift
  detection across all four cases (no drift / verified / unverified /
  override matches Excel — last one is "phantom drift" and must be
  classified `none`).
- `qa/tests/api/excel-vs-app-rbac.test.ts` — ENGINEER role can view
  but cannot resolve cost drift; PROGRAM_FINANCE_MANAGER can; bulk
  cap of 50 enforced; cap rejection has the correct error shape.
- `qa/tests/smoke/excel-vs-app.spec.ts` — Playwright smoke through
  both pages for COO_ADMIN.

### C.10 Acceptance

- C.AC-1: Program page loads in <2s for a 50-project portfolio.
- C.AC-2: Per-project page renders all three sections with correct
  drift classification, and cell colours match the source workbook.
- C.AC-3: Bulk "Accept Excel" deletes `manual_overrides` entries
  (live column was already Excel — no other write happens) and
  records an audit row per resolved field.
- C.AC-4: Bulk "Keep app + reason" upserts `manual_overrides` with
  `note` populated.
- C.AC-5: Unverified drift creates a `financial_edit_requests` row
  routed to the correct reviewer roles per §C.7.
- C.AC-6: 50-row cap enforced server-side; client surfaces error.
- C.AC-7: ENGINEER cannot resolve cost-side drift via the API even
  with hand-crafted requests (RBAC test).

---

## Sequencing & dependencies

```
Week 1                Week 2                Week 3
─────────────────────────────────────────────────────────
A: audit ──────► A: follow-up issues filed
B: invariant ──► B: backfill ──► B: PR merged
                                  │
                                  ▼
                         C: routes ──► C: pages ──► C: PR
```

- A and B kick off **in parallel** week 1. A is read-only and does not
  block B.
- C cannot start in earnest until B has merged — its drift detection
  depends on the steady-state model (live=Excel + manual_overrides).
  We can prototype C's read endpoints against a B-feature-flagged dev
  branch in week 1 to de-risk the schema, but UI work waits for B.
- Workstream A produces follow-up PRs that land independently. None
  of them are on the critical path for C, but each one merged makes
  C's drift detection more accurate (fewer "drift looks real but it's
  a stale derivative" false positives).

### Acceptance for the joint deliverable

The "Excel-vs-App" feature is shippable when:
- Workstream B is merged (invariant + backfill).
- Workstream C is merged (diff pages + RBAC + bulk).
- Workstream A's audit doc is merged AND every "high drift exposure"
  legacy reader has either been migrated or has a follow-up issue
  with a target release.

Workstream A's tail follow-ups are post-ship cleanup. They do not block
the diff-page launch.

---

## Risks & rollback per workstream

### Workstream A risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Audit misses a reader because the file imports the table indirectly via a repository helper. | Medium | Medium — silent stale data in one report. | Run `ee-snapshot-auditor` agent over the whole `server/` tree as a second pass after manual classification. |
| Audit categorises a derivative table reader as "canonical" when its upstream refresh job is itself legacy. | Medium | High — looks fine but isn't. | Audit explicitly lists the refresh job for every derivative-table reader and follows the chain. |

**Rollback**: doc-only. No production state changes; no rollback
needed. Follow-up migration PRs each have their own rollback plans.

### Workstream B risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Re-routing the cell-edit handlers introduces a regression on the operational tabs (operator edits a cell, the change doesn't appear). | Medium | High — visible immediately. | Targeted Vitest suite (§B.10) + manual smoke. Feature flag the new path with `USE_MANUAL_OVERRIDES=true` (default ON) so we can revert quickly. |
| The display-overlay logic on read paths gets out of sync with the write path's JSONB shape. | Low | Medium. | Single helper module (`server/lib/manual-overrides.ts`) for both write and read overlay; unit-tested. |
| The backfill writes a wrong snapshot (e.g. matches the wrong file row). | Low | High — diff page would surface false drift forever after. | `--dry-run` flag + project-by-project rollout. The `import_snapshot IS NULL` guard means we never overwrite an already-correct snapshot. |
| `inline-edit-helper.ts` writes on `program_expense`/`program_inflows` are confused with the new path. | Low | Medium. | Plan glossary + code comment on every touchpoint pinning the legacy file to its (deprecated) tables. |

**Rollback**: 
- Cell-edit handlers: revert the PR (single PR makes this trivial). No
  data corruption — the live column stays Excel-truth either way; the
  worst case is a few `manual_overrides` JSONB entries that the import
  engine harmlessly preserves on the next import.
- Backfill: write a `scripts/clear-import-snapshot.ts` that nulls
  `import_snapshot` for any row where the script wrote it (audit trail
  identifies these). Or simply leave them — the merge engine degrades
  gracefully on existing rows whose snapshot turns out to be wrong
  (next re-import overwrites it).

### Workstream C risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Drift detection has false positives because A hasn't fully migrated derivative readers. | Medium | Medium — operators chase phantom drift. | Tracked-fields-only scope (decision §6.5) + clear "verified vs unverified" classification + per-row "ignore" option. |
| Bulk "Accept Excel" wipes a verified drift the operator forgot they cared about. | Low | High — lost manual edit. | 50-row cap, diff summary in confirm dialog, per-row audit trail with `editedBy` and `fromValue` so reverts are possible. |
| RBAC misroute — a reviewer sees / acts on a drift they shouldn't. | Low | High. | Server-side `requirePermission` on every mutation endpoint, automated `qa/tests/api/excel-vs-app-rbac.test.ts` covering all 16 roles × 3 sections × {view, resolve}. |

**Rollback**: feature-flag the diff page route registration behind
`EXCEL_VS_APP_DIFF=true` (default OFF on first deploy, flip ON after
smoke-test). Disabling the flag de-registers the routes; no DB
state changes.

---

## Open decisions for this plan review

Each decision below has a recommendation and the alternative. Please
redline before any code lands.

### 6.1 Workstream B as one PR vs split per domain

**Recommendation: ONE PR.**

The mutation inventory (§B.3–B.7) shows the in-scope re-routing is
concentrated in three files:
- `server/departments/finance-routes.ts` (cost + revenue overrides
  sync blocks).
- `server/routes/planning-tasks-routes.ts` (six work_items mirror
  blocks).
- `server/lib/manual-overrides.ts` (new helper).

Plus the backfill script (`scripts/backfill-import-snapshot.ts`) and
the operational-tab read-path overlay code in three components.
Single-PR scope is meaningful but tractable, and the invariant change
needs the read-path overlay to land atomically with the write change
or the operational tabs visibly regress. Splitting per domain
(cost / revenue / plan) would mean three intermediate states where
the invariant is partially enforced — net more risk than one well-
tested PR.

**Alternative (split):** three PRs, each domain-scoped, gated behind
a per-domain feature flag (`USE_MANUAL_OVERRIDES_COST=true`, etc.).
Smaller blast radius per PR; longer total elapsed time; more
intermediate states to verify. Pick this if review bandwidth is the
binding constraint.

### 6.2 Diff page route: dedicated vs 4th tab on tracker-replica

**Recommendation: dedicated routes** — `/program/excel-vs-app` and
`/projects/:id/excel-vs-app`.

Rationale:
- The replica is read-only and styled as a Tracker mirror. The diff
  page is action-bearing (bulk select, accept/keep buttons, RBAC).
  Mixing them muddles the mental model.
- A dedicated route gets its own analytics, its own permission gate
  (`excel_vs_app:view`), and its own SEO/sidebar slot for visibility.
- Operators searching for "where is the drift?" find a top-level page,
  not a sub-tab of a per-project replica.

**Alternative (4th tab):** add an "Excel-vs-App" tab next to the three
existing replica pages. Pros: lower navigation cost from the replica
view; operators don't context-switch. Cons: program-level view has
no natural home; and the per-project tab has to host bulk actions
that the rest of the replica deliberately doesn't have.

### 6.3 Bulk-action confirm dialogs / per-session caps

**Recommendation: 50-row cap + diff summary in dialog.**

The 50-row cap is a deliberate safety on the most-destructive bulk
action ("Accept Excel" wipes manual_overrides for the selected
fields). The dialog should show:
- Counts: N fields across M rows.
- Top 5 fields by drift count (so the operator sees if a single field
  dominates).
- A short list of the 3–5 highest-impact rows (by absolute monetary
  drift on cost/revenue, by critical-path flag on plan).

Per-session cap: tracked in the user's session via existing rate
limit middleware; reset on logout. 200 rows total per session.

**Alternative (no cap):** rely solely on the confirm dialog. Faster
for power users doing legitimate bulk reconciliations after a major
re-import. Riskier — one click can destroy weeks of operator decisions.

### 6.4 Notification queue location

**Recommendation: header badge + project-level component, both on
top of `financial_edit_requests`.**

Two surfaces:
- Per-project: a small `<UnverifiedDriftBadge>` in the project header
  showing the count of unverified-drift requests for that project.
  Clicks to the project diff page filtered to "unverified".
- Program-level: a count badge on the `/program/excel-vs-app` page
  itself, plus a digest entry in the existing `NotificationBell`
  (`client/src/components/NotificationBell.tsx`).

Inline-only (the alternative) hides drift from people who don't visit
the diff page — bad for CFO/PROGRAM_FINANCE_MANAGER who run a project-
header view first.

**Alternative (inline only):** drift surfaces only on the diff page
itself; no header badge, no notification entry. Simpler; lower
visibility.

### 6.5 Drift severity: any field vs tracked-only

**Recommendation: tracked-only** — exactly the merge-field lists in
`server/lib/import/commit-executor.ts:135–167`.

Tracked fields are the "trust contract" between Excel and the app —
the import engine treats them as authoritative. Non-tracked fields
(`revenueRecognitionAmount`, `lastEditedAt`, `cellFormat` itself,
audit timestamps, etc.) are operational metadata where drift is
expected and benign.

If we tracked every field, the diff page would surface dozens of
false positives per row (timestamps drift on every read, internal
flags drift on every cascade, etc.) and operators would tune it out.

**Alternative (any field):** show drift on every column. Pros:
exhaustive — nothing slips through. Cons: high noise; defeats the
"single screen for drift" goal.

---

## Resolved decisions (2026-04-30)

User confirmed all six locked decisions remain locked, and adopted the
recommendation for each of the five open decisions:

| # | Decision | Resolution |
|---|----------|-----------|
| 6.1 | Workstream B PR shape | **One PR** (per recommendation). |
| 6.2 | Diff page route | **Dedicated** routes (per recommendation). |
| 6.3 | Bulk-action safety | **50-row cap + diff summary**, 200/session (per recommendation). |
| 6.4 | Notification surface | **Header badge + project-level component** on `financial_edit_requests` (per recommendation). |
| 6.5 | Drift severity scope | **Tracked fields only** (per recommendation). |

Mutation inventory in §B.3–B.7 accepted as scoped: three in-scope code
paths (Expenditure overrides sync, Revenue overrides sync, Plan tab
work_items mirror); cascade-service / lifecycle / engineering /
ms-sync / admin-recovery / legacy adapter writes remain out of scope.

---

## What happens after this plan is approved

1. Workstream A: drafted in `docs/reporting-audit-2026-04.md`,
   first-pass classification done. Follow-up issues filed via GitHub
   MCP.
2. Workstream B: implementation in plan-mode, starting with the
   helper module + cell-edit handler re-routes (per §6.1). Backfill
   script second. Targeted Vitest suite throughout.
3. Workstream C: starts after B merges. Routes first (server-side
   testable in isolation), then UI components, then bulk actions
   + RBAC last (RBAC test suite needs the routes to exist).

---

## Files this plan references

- `CLAUDE.md` — project rules (route conventions, snapshot-table
  guard, etc.).
- `docs/smart-import-v2-spec.md` — current import pipeline.
- `docs/smart-import-v2-known-limitations.md` § 14 — inline UI refresh
  state (parent of this plan).
- `docs/smart-import-v2-engine-consolidation-assessment.md` — Phase 2
  is pulled forward into workstream B (§B.9).
- `shared/schema/finance.ts:489–697` — canonical tables.
- `shared/schema/tasks.ts:243–259` — `work_items` snapshot/override
  columns.
- `server/lib/import/merge-engine.ts` — `valuesEqual`,
  `updateManualOverrides`.
- `server/lib/import/commit-executor.ts:135–167` — merge-field lists.
- `server/routes/tracker-replica.routes.ts` — pattern for the new
  diff routes.
- `server/repositories/tracker-replica-repository.ts` — extension
  point for the new `getDriftDetail`.
- `client/src/lib/tracker-cell-format.ts` — `styleForCell` helper.
- `server/lib/data-merge.ts` — adapter layer that already returns
  `cellFormat` + tracker fields (PR #753).










