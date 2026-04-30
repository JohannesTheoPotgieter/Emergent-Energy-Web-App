# Workstream B — Implementation Plan

> **Status:** DRAFT — pending user approval before any code lands.
> **Parent design doc:** `docs/excel-vs-app-diff-plan.md` § Workstream B.
> **Goal:** Make `live column = Excel` invariant real. Cell-edit
> mutations on the operational tabs write to `manual_overrides`
> JSONB only; live columns hold Excel-truth and are touched only
> by Smart Import. Plus the `import_snapshot` backfill so legacy
> rows have a baseline.
> **PR shape:** ONE PR (per resolved decision §6.1), with clearly
> sequenced commits.

---

## 0. Why a separate plan

The design doc (`excel-vs-app-diff-plan.md`) specifies the **what**.
This doc specifies the **how**: file-by-file diffs, commit ordering,
test gates between commits, and the rollback story per commit. The
intent is that on approval the code lands in the order described,
each commit individually green.

---

## 1. Touch list (full file inventory)

**New files (5)**

| Path | Purpose | LOC est |
|------|---------|--------|
| `shared/excel-vs-app/contract.ts` | Single-source contract — tracked-field lists, `manualOverrideEntrySchema`, `DRIFT_RESOLVER_ROLES`. | ~120 |
| `server/lib/manual-overrides.ts` | The `applyManualOverride` / `clearManualOverride` helper. | ~150 |
| `scripts/backfill-import-snapshot.ts` | One-shot backfill from latest `summaryJson` per project. | ~250 |
| `qa/tests/unit/excel-vs-app-contract.test.ts` | Snapshot test on field lists + JSONB shape round-trip. | ~80 |
| `qa/tests/unit/manual-overrides-helper.test.ts` | Helper write/read/clear/repeat-edit tests. | ~150 |
| `qa/tests/unit/cell-edit-invariant.test.ts` | End-to-end: cell edit → live column unchanged + override populated. | ~200 |
| `qa/tests/unit/backfill-import-snapshot.test.ts` | Backfill idempotency + match tests. | ~150 |

**Modified files (8)**

| Path | What changes |
|------|--------------|
| `server/lib/import/commit-executor.ts` | The three `*_MERGE_FIELDS` constants become re-exports from the contract. No behaviour change. |
| `server/lib/import/merge-engine.ts` | `updateManualOverrides` returns objects validated against `manualOverrideEntrySchema` (zod parse on write). |
| `server/departments/finance-routes.ts` | Two override-sync blocks (cost: line 1460 region; revenue: line 5920 region) stop writing to canonical value columns. They call `applyManualOverride` instead. |
| `server/routes/planning-tasks-routes.ts` | Six `db.update(workItems).set(wiMirror)` blocks (lines 946, 960, 980, 992, 1100, 1111, 1163 regions) re-routed through `applyManualOverride` for tracked fields. Non-tracked fields (e.g. `parentId`, `sortOrder`, structural metadata) keep direct writes — they're not in the merge-field list and not drift sources. |
| `server/repositories/tracker-replica-repository.ts` | Read paths gain a `displayValue = manualOverrides[field]?.value ?? row[field]` overlay for the operational-tab consumers. The replica endpoints themselves still return the raw live column unchanged. |
| `client/src/components/tabs/ExpenditureEditableTab.tsx` | Read overlay applied to displayed values. `saveMutation` URL unchanged (server endpoint same; behaviour different). New "Reset to Excel" affordance per cell. |
| `client/src/components/tabs/RevenueTrackingEditableTab.tsx` | Same. |
| `client/src/components/tabs/UnifiedPlanTab.tsx` | Same. |

That's 5 new + 8 modified = **13 files**, plus the four new test files = **17 files total in the PR**.

---

## 2. Commit sequencing

The PR is one logical change but lands as 7 sequenced commits. Each
commit is individually green (TS check + targeted tests) so a bisect
can isolate any later regression. The order is risk-driven: contract
first, then the helper, then re-routes one domain at a time, then
backfill, then UI.

| # | Commit | Files | Gate before next commit |
|---|--------|-------|-------------------------|
| 1 | **Contract module** — `shared/excel-vs-app/contract.ts` + the contract test. Make `commit-executor.ts`'s `*_MERGE_FIELDS` re-export from the contract. Make `merge-engine.ts`'s JSONB writes parse through the schema. | `shared/excel-vs-app/contract.ts`, `server/lib/import/commit-executor.ts`, `server/lib/import/merge-engine.ts`, `qa/tests/unit/excel-vs-app-contract.test.ts` | `npm run check` + the contract suite. Existing `qa/tests/unit/engine-consolidation-phase1.test.ts` and `qa/tests/unit/tracker-replica-integration.test.ts` must stay green (the import engine's behaviour is unchanged; only the import location of constants changes). |
| 2 | **Override helper** — `server/lib/manual-overrides.ts` + helper tests. Pure addition; nothing imports from it yet. | `server/lib/manual-overrides.ts`, `qa/tests/unit/manual-overrides-helper.test.ts` | Helper tests green. |
| 3 | **Repository read overlay** — extend `trackerReplicaRepository` (and the operational-tab read paths it serves) with a `displayValue` overlay. The replica endpoints still return raw live column. | `server/repositories/tracker-replica-repository.ts` | Existing `qa/tests/unit/tracker-replica-integration.test.ts` must stay green; new shape is additive. |
| 4 | **Re-route Expenditure** — `server/departments/finance-routes.ts` override-sync block + `client/src/components/tabs/ExpenditureEditableTab.tsx`. | 2 files + targeted `cell-edit-invariant.test.ts` cost-side tests | Cell-edit invariant cost tests green. |
| 5 | **Re-route Revenue** — same shape, revenue side. | 2 files + revenue-side tests | Revenue invariant tests green. |
| 6 | **Re-route Plan** — `planning-tasks-routes.ts` six blocks + `UnifiedPlanTab.tsx`. | 2 files + plan-side tests | Plan invariant tests green. |
| 7 | **Backfill script** — pure addition; idempotent; no production data touched in CI. | `scripts/backfill-import-snapshot.ts` + tests | Backfill tests green. Manual smoke on a postgres dev DB before merge. |

Why this order:
- Contract first so subsequent commits build on stable shared types.
- Helper before re-routes so re-routes have something to call.
- Read overlay before write changes so the operational tabs render
  correctly the moment the writes shift to JSONB. Otherwise commit 4
  produces a visible regression: edit a cell, value reads back as
  Excel-truth, operator panic.
- Domains in cost / revenue / plan order because cost has the most
  override traffic — getting it right first de-risks the rest.
- Backfill last because it depends on the JSONB shape being settled.

---

## 3. Per-commit detail

### Commit 1 — Contract module

**New: `shared/excel-vs-app/contract.ts`**

Move (not copy) the merge-field lists from
`server/lib/import/commit-executor.ts:135–167`. Add the JSONB schema
(currently the `ManualOverrideEntry` interface in
`server/lib/import/merge-engine.ts:262–271`) as a zod schema. Add the
`DRIFT_RESOLVER_ROLES` mapping — sourced from the existing per-field
edit middleware (`server/middleware/requireRole.ts` callers in
finance routes — to be confirmed against the actual role lists when
implementing).

Skeleton (full file):

```ts
import { z } from "zod";
import type { CompanyRole } from "@shared/schema/users";

export type DiffSection = "PLAN" | "REVENUE" | "EXPENDITURE";

export const PLAN_TRACKED_FIELDS = [
  "startDate", "endDate", "duration",
  "actualStart", "actualEnd", "actualDuration",
  "ownerName", "status", "percentComplete", "expectedPctComplete",
  "description", "isMilestone", "outlineNumber",
  "lead", "resource1", "resource2", "trackerComments", "workDays",
] as const;

export const REVENUE_TRACKED_FIELDS = [
  "amountExVat", "vat", "milestonePercent", "invoiceNumber",
  "invoiceDate", "expectedPaymentDate", "paidDate", "inBankDate",
  "status", "invoiceDateConfirmed", "paidDateConfirmed",
  "milestoneNotes",
] as const;

export const EXPENDITURE_TRACKED_FIELDS = [
  "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
  "invoiceNumber", "invoiceDate", "approvedDate", "paidDate",
  "forecastPaymentDate", "poNumber", "costCategory", "status",
  "counterpartyName", "revenueRecognitionAmount",
  "invoiceDateConfirmed", "paidDateConfirmed", "cosRealised",
  "cashflowConfirmed", "noRevenueLinked",
  "actualQty", "actualRate", "comments", "checkFlag",
  "savingOverrun", "usdExchangeRate", "pricePerWatt",
] as const;

export const TRACKED_FIELDS_BY_SECTION: Record<DiffSection, readonly string[]> = {
  PLAN: PLAN_TRACKED_FIELDS,
  REVENUE: REVENUE_TRACKED_FIELDS,
  EXPENDITURE: EXPENDITURE_TRACKED_FIELDS,
};

export const DRIFT_RESOLVER_ROLES: Record<DiffSection, readonly CompanyRole[]> = {
  PLAN: ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
  REVENUE: ["PROGRAM_FINANCE_MANAGER", "CCO", "CFO", "COO_ADMIN", "CEO_ADMIN"],
  EXPENDITURE: ["PROGRAM_FINANCE_MANAGER", "CFO", "COO_ADMIN", "CEO_ADMIN"],
};

const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const manualOverrideEntrySchema = z.object({
  value: fieldValueSchema,
  editedBy: z.number().int().nullable(),
  editedAt: z.string(),
  fromValue: fieldValueSchema,
  note: z.string().optional(),
});

export const manualOverridesMapSchema = z.record(manualOverrideEntrySchema);

export type ManualOverrideEntry = z.infer<typeof manualOverrideEntrySchema>;
export type ManualOverridesMap = z.infer<typeof manualOverridesMapSchema>;
```

**Edits to `server/lib/import/commit-executor.ts`**

```ts
// before
const PLAN_MERGE_FIELDS = [/* …list… */] as const;
const REVENUE_MERGE_FIELDS = [/* …list… */] as const;
const EXPENDITURE_MERGE_FIELDS = [/* …list… */] as const;

// after
import {
  PLAN_TRACKED_FIELDS,
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";

const PLAN_MERGE_FIELDS = PLAN_TRACKED_FIELDS;
const REVENUE_MERGE_FIELDS = REVENUE_TRACKED_FIELDS;
const EXPENDITURE_MERGE_FIELDS = EXPENDITURE_TRACKED_FIELDS;
```

(Local `*_MERGE_FIELDS` aliases stay so existing callers don't change.
Pure rename-via-import; trivial diff.)

**Edits to `server/lib/import/merge-engine.ts`**

`updateManualOverrides` already builds objects of the right shape.
We add a `manualOverrideEntrySchema.parse()` on each constructed entry
in dev (gated on `NODE_ENV !== "production"` to avoid prod overhead).
Catches drift between import-engine writes and the shared schema.

**Test: `qa/tests/unit/excel-vs-app-contract.test.ts`**

- Snapshot tests pinning each of the three field lists.
- Round-trip: a sample manualOverrides map (built from a fixture)
  parses cleanly under `manualOverridesMapSchema`.
- Reference equality: `import { PLAN_MERGE_FIELDS } from
  ".../commit-executor"` and the contract's `PLAN_TRACKED_FIELDS` are
  the same array reference (catches accidental shadowing during a
  later refactor).

**Rollback for commit 1**: trivial revert — the constants move back,
the schema disappears. No data touched.

### Commit 2 — Override helper

**New: `server/lib/manual-overrides.ts`**

Skeleton:

```ts
import { eq, isNull, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
} from "@shared/schema/finance";
import { workItems } from "@shared/schema/tasks";
import {
  manualOverrideEntrySchema,
  type ManualOverridesMap,
  type ManualOverrideEntry,
} from "@shared/excel-vs-app/contract";

type CanonicalTable =
  | typeof normalizedCostLines
  | typeof normalizedRevenueLines
  | typeof workItems;

function tableFor(name: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items"): CanonicalTable {
  switch (name) {
    case "normalized_cost_lines":   return normalizedCostLines;
    case "normalized_revenue_lines": return normalizedRevenueLines;
    case "work_items":               return workItems;
  }
}

export interface ApplyOverrideInput {
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items";
  rowId: number;
  fieldName: string;             // canonical camelCase
  value: ManualOverrideEntry["value"];
  editedBy: number | null;
  note?: string;
}

export async function applyManualOverride(
  tx: typeof db,
  input: ApplyOverrideInput,
): Promise<void> {
  const t = tableFor(input.table);

  // Read existing row to get current live value (= fromValue) and
  // current manual_overrides JSONB.
  const [row] = await tx
    .select()
    .from(t as any)
    .where(eq((t as any).id, input.rowId))
    .limit(1);
  if (!row) throw new Error(`row ${input.rowId} not found in ${input.table}`);

  const current: ManualOverridesMap =
    (row as any).manualOverrides && typeof (row as any).manualOverrides === "object"
      ? (row as any).manualOverrides
      : {};

  // Preserve the EARLIEST fromValue: if there's already an entry,
  // keep its fromValue (the original Excel-truth at time of first
  // override). Don't shift to "the previous override's value".
  const existingFromValue = current[input.fieldName]?.fromValue;
  const fromValue =
    existingFromValue !== undefined
      ? existingFromValue
      : (row as any)[input.fieldName] ?? null;

  const entry: ManualOverrideEntry = manualOverrideEntrySchema.parse({
    value: input.value,
    editedBy: input.editedBy,
    editedAt: new Date().toISOString(),
    fromValue,
    note: input.note,
  });

  const next: ManualOverridesMap = { ...current, [input.fieldName]: entry };

  await tx
    .update(t as any)
    .set({ manualOverrides: next })
    .where(eq((t as any).id, input.rowId));
}

export async function clearManualOverride(
  tx: typeof db,
  table: ApplyOverrideInput["table"],
  rowId: number,
  fieldName: string,
): Promise<void> {
  const t = tableFor(table);
  const [row] = await tx
    .select()
    .from(t as any)
    .where(eq((t as any).id, rowId))
    .limit(1);
  if (!row) return;
  const current: ManualOverridesMap =
    (row as any).manualOverrides && typeof (row as any).manualOverrides === "object"
      ? (row as any).manualOverrides
      : {};
  if (!(fieldName in current)) return;
  const next = { ...current };
  delete next[fieldName];
  await tx
    .update(t as any)
    .set({ manualOverrides: next })
    .where(eq((t as any).id, rowId));
}
```

(`as any` casts on the Drizzle table union are the tax for unifying
three tables that don't share an interface; alternative is three
separate functions. Optimise later if it bites.)

**Test: `qa/tests/unit/manual-overrides-helper.test.ts`**

- New entry: assert `manual_overrides[field]` populated, `row[field]`
  unchanged, `fromValue` = original live value.
- Repeat edit: second `applyManualOverride` on same field updates
  `value` and `editedAt`; `fromValue` stays the **original** Excel
  value (this is the subtle bit — doc-test it).
- Clear: removes the entry; row's live column unchanged.
- Schema parse failure: pass an invalid value, assert zod throws
  before any DB write.

**Rollback for commit 2**: revert; no callers yet, so no side effects.

### Commit 3 — Repository read overlay

The replica endpoints stay unchanged (they return Excel-truth — that's
their contract). The operational-tab read paths get a thin overlay
helper. The simplest place is a single utility:

```ts
// server/repositories/tracker-replica-repository.ts (extension)

export function withOverridesOverlay<T extends { manualOverrides: unknown }>(
  row: T,
  fields: readonly string[],
): T {
  const overrides = row.manualOverrides;
  if (!overrides || typeof overrides !== "object") return row;
  const out: any = { ...row };
  for (const f of fields) {
    const entry = (overrides as any)[f];
    if (entry && "value" in entry) out[f] = entry.value;
  }
  return out as T;
}
```

Operational-tab read paths (the `cos.tsx` data, the
`/api/finance/cost-lines` lists, etc.) call `withOverridesOverlay(row,
EXPENDITURE_TRACKED_FIELDS)` before returning. Replica routes do not.

**Tests**: extend `qa/tests/unit/tracker-replica-integration.test.ts`
with a fixture row that has both a live value and a manual override;
assert the replica endpoint returns the live value, the operational
endpoint returns the override.

**Rollback for commit 3**: revert; the new helper is unreferenced.

### Commit 4 — Re-route Expenditure

**Server: `server/departments/finance-routes.ts`**

The `POST /api/expenditure/overrides` handler at line 6746 today
inserts into `expenditure_tracking_overrides` (or raises a
`financial_edit_requests` row when the actor lacks direct edit
permission), then runs a sync block that writes the same value to
`normalizedCostLines`. Drop the sync block; replace with
`applyManualOverride` calls.

Pseudo-diff:

```ts
// before — finance-routes.ts:~6800 (inside the override save handler)
for (const o of saved) {
  await db.update(normalizedCostLines)
    .set({ [camelCaseField(o.fieldName)]: o.overrideValue })
    .where(/* … */);
}

// after
for (const o of saved) {
  // Find the canonical row id for this projectName + sourceRow.
  const [canonical] = await db.select({ id: normalizedCostLines.id })
    .from(normalizedCostLines)
    .where(and(
      eq(normalizedCostLines.projectName, o.projectName),
      eq(normalizedCostLines.sourceRow, o.rowNumber),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    ))
    .limit(1);
  if (!canonical) continue;
  await applyManualOverride(db, {
    table: "normalized_cost_lines",
    rowId: canonical.id,
    fieldName: camelCaseField(o.fieldName),
    value: normalizeOverrideValue(o.overrideValue),
    editedBy: userId,
    note: overrideComment,
  });
}
```

The legacy `expenditure_tracking_overrides` table insert stays — it
remains the operator-facing audit trail and the surface that
`financial_edit_requests` reviewers see. Only the canonical-row
sync changes.

**Client: `client/src/components/tabs/ExpenditureEditableTab.tsx`**

- `EditableCell` value resolution becomes `manualOverrides[field]?.value
  ?? row[field]`. Visual indicator (small pencil dot) when an override
  is active.
- New "Reset to Excel" affordance: right-click on a cell with an
  override produces a context menu with a single action that calls
  `DELETE /api/manual-overrides/normalized_cost_lines/:rowId/:field`
  (a thin route that wraps `clearManualOverride`).

**Test: `qa/tests/unit/cell-edit-invariant.test.ts` (cost section)**

- Submit an override via `POST /api/expenditure/overrides`. Assert
  `normalizedCostLines.amountExVat` (or whichever field) is
  unchanged in DB; `manualOverrides.amountExVat.value` equals the
  posted value.
- Repeat edit: second submission updates the same JSONB entry,
  `editedAt` advances, `fromValue` preserves the original Excel
  amount.
- Clear: `DELETE` removes the entry; subsequent reads return the
  live (Excel) value.
- Re-import: simulate a Smart Import that brings a new value for
  the same field; assert the merge engine surfaces a conflict via
  the existing `v2_conflicts_detected` envelope (no regression).

**Rollback for commit 4**: revert. The legacy
`expenditure_tracking_overrides` rows that landed in the meantime
remain valid; the canonical row's `manualOverrides` JSONB entries
that were written during the experiment are harmless (the import
engine treats them as protected, so re-imports just skip them or
flag conflicts — same as today).

### Commit 5 — Re-route Revenue

Symmetric to Commit 4. Server change at
`server/departments/finance-routes.ts:5920` (the inBank/paidDate
sync block at the bottom of `POST /api/revenue-tracking/overrides`).
Drop the `db.update(normalizedRevenueLines).set({…})` write;
substitute `applyManualOverride` per field.

Client change:
`client/src/components/tabs/RevenueTrackingEditableTab.tsx`. Same
overlay + reset affordance shape as cost.

Test: revenue-side cases of `cell-edit-invariant.test.ts`.

**Rollback**: same shape as commit 4.

### Commit 6 — Re-route Plan

**Server: `server/routes/planning-tasks-routes.ts`**

Six `db.update(workItems).set(wiMirror)` blocks at lines 946, 960,
980, 992, 1100, 1163. For each block, separate the payload into
**tracked fields** (route through `applyManualOverride` per field,
table = `"work_items"`) and **non-tracked fields** (keep direct
write — these are structural metadata: `parentId`, `sortOrder`,
`indentLevel`, `workstream`, etc., not in `PLAN_TRACKED_FIELDS`).

Pseudo-helper to keep the diff readable:

```ts
async function applyWorkItemEdit(
  workItemId: number,
  edits: Partial<typeof workItems.$inferInsert>,
  userId: number | null,
) {
  const tracked = pick(edits, PLAN_TRACKED_FIELDS as readonly string[]);
  const untracked = omit(edits, PLAN_TRACKED_FIELDS as readonly string[]);

  if (Object.keys(untracked).length > 0) {
    await db.update(workItems).set(untracked).where(eq(workItems.id, workItemId));
  }
  for (const [field, value] of Object.entries(tracked)) {
    await applyManualOverride(db, {
      table: "work_items",
      rowId: workItemId,
      fieldName: field,
      value: value as any,
      editedBy: userId,
    });
  }
}
```

Each of the six call sites then becomes a single `applyWorkItemEdit`
call with the same payload it built before.

**Client: `client/src/components/tabs/UnifiedPlanTab.tsx`**

- Overlay + reset affordance, same shape as cost/revenue.
- The TaskDetailDrawer (`client/src/components/TaskDetailDrawer.tsx`)
  also hits `/api/planning-tasks/:id` — its writes go through the
  same server change automatically. No client edit needed there
  unless the drawer's read path has its own resolution that bypasses
  the overlay (audit during implementation).

Test: plan-side cases of `cell-edit-invariant.test.ts`.

**Rollback**: revert. work_items has no `effectiveTo`, so any
`manualOverrides` entries written during the experiment are
harmless (the next merge engine run on a re-import handles them as
protected fields).

### Commit 7 — Backfill script

**New: `scripts/backfill-import-snapshot.ts`**

Skeleton:

```ts
import { db } from "../server/db";
import { smartImportRuns } from "@shared/schema/imports";
import {
  normalizedCostLines,
  normalizedRevenueLines,
} from "@shared/schema/finance";
import { workItems } from "@shared/schema/tasks";
import { matchRows } from "../server/lib/import/row-matcher";
import {
  PLAN_TRACKED_FIELDS,
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";
import { eq, and, isNull, desc } from "drizzle-orm";

interface RunOpts {
  projectId?: number;
  dryRun: boolean;
  verbose: boolean;
}

async function backfillForProject(projectId: number, opts: RunOpts) {
  // 1. Latest committed run
  const [run] = await db.select()
    .from(smartImportRuns)
    .where(and(
      eq(smartImportRuns.projectId, projectId),
      eq(smartImportRuns.status, "COMMITTED"),
    ))
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);
  if (!run) return { skipped: "no committed runs" };

  const summary = run.summaryJson as any;
  const norm = summary?.normalization;
  if (!norm) return { skipped: "no normalization in summaryJson" };

  // 2. For each section, read active rows missing snapshot and
  //    match against summaryJson rows via row-matcher.
  let written = 0, unmatched = 0;
  for (const section of ["EXPENDITURE", "REVENUE", "PLAN"] as const) {
    const { table, fields } = sectionFor(section);
    const rows = await db.select().from(table)
      .where(and(
        eq((table as any).projectId, projectId),
        isNull((table as any).effectiveTo),
        isNull((table as any).deletedAt),
        // sqlite-friendly null check on JSONB
        sql`${(table as any).importSnapshot} IS NULL`,
      ));
    const fileRows = norm[section.toLowerCase()] ?? [];
    const matches = matchRows(section, fileRows, rows);
    for (const m of matches) {
      if (!m.fileRow) { unmatched++; continue; }
      const snap: Record<string, unknown> = {};
      for (const f of fields) snap[f] = m.fileRow[f] ?? null;
      if (!opts.dryRun) {
        await db.update(table)
          .set({ importSnapshot: snap })
          .where(and(
            eq((table as any).id, m.dbRow.id),
            isNull((table as any).importSnapshot),
          ));
      }
      written++;
    }
  }
  return { written, unmatched };
}
```

(Schema-table union casts `as any` again — same trade-off as the
helper module. Could be cleaner with three explicit functions; the
backfill runs once so readability wins.)

**Test: `qa/tests/unit/backfill-import-snapshot.test.ts`**

- Project with no committed run → script no-ops, returns "skipped".
- Project with one run + active rows: snapshot populated for matches;
  unmatched rows logged, not modified.
- Idempotency: second run leaves the table identical (the `IS NULL`
  guard catches anything already populated by a real import).
- `--dry-run`: writes nothing, reports same counts as a real run.

**Operational note**: not run from CI. Operator runs manually on a
postgres dev DB first, spot-checks counts, then runs on staging,
then prod. Audit-logs to `audit_log` once per invocation.

**Rollback**: a one-off `scripts/clear-backfilled-snapshots.ts` that
nulls `import_snapshot` where it equals what the backfill would
write. Drafted alongside the backfill but only used if needed.

---

## 4. Cross-cutting concerns

### 4.1 Feature flag

The whole invariant change is gated by `USE_MANUAL_OVERRIDES=true`
(default ON in dev + prod after deploy). When `false`:
- `applyManualOverride` short-circuits to the legacy
  `db.update(table).set({field: value})` write.
- Read overlay short-circuits to `row[field]` directly.

Lets us flip back instantly if a regression surfaces post-deploy.
Removed in a follow-up PR after one stable release.

### 4.2 Backwards compatibility on existing data

- Rows that already have `manual_overrides` JSONB entries (written by
  the import engine on conflict resolution) keep working unchanged —
  the cell-edit path just adds entries the same way.
- Rows whose live column was directly edited before this PR landed
  show as **unverified drift** on the diff page (workstream C). The
  diff page's "Accept Excel" / "Keep app + reason" affordance is
  exactly the resolution path for those.
- The 50-row bulk-action cap (decision §6.3) limits the rate at
  which an operator can resolve historical drift. Acceptable —
  reconciliation is a deliberate process.

### 4.3 Observability

A structured log line on every override write:

```
[manual-overrides] { table, rowId, field, editedBy, fromValue, toValue, source: "import" | "cell-edit" }
```

Enables a quick "how often is the cell-edit path firing vs the
import path" Splunk-style query post-deploy.

---

## 5. Combined test plan

| Suite | Where | Run |
|-------|-------|-----|
| Contract pinning | `qa/tests/unit/excel-vs-app-contract.test.ts` | `npx vitest run -c qa/vitest.config.ts qa/tests/unit/excel-vs-app-contract.test.ts` |
| Helper write/read | `qa/tests/unit/manual-overrides-helper.test.ts` | same pattern |
| Cell-edit invariant | `qa/tests/unit/cell-edit-invariant.test.ts` | same pattern |
| Backfill | `qa/tests/unit/backfill-import-snapshot.test.ts` | same pattern |
| Existing import-engine suite | `qa/tests/unit/engine-consolidation-phase1.test.ts` | must stay green throughout |
| Existing replica suite | `qa/tests/unit/tracker-replica-integration.test.ts` | must stay green throughout |

`npm run check` is the global gate and runs cleanly after each commit.

`npm run qa:full-proof` is reserved for pre-release; not run during
this PR's iteration.

---

## 6. Acceptance (rolls up §B.11–B.12 of the design doc)

- B.AC-1 through B.AC-7 from the design doc.
- Plus per-commit gate: each commit individually green on
  `npm run check` and the targeted test suite for that commit.
- Plus: the structured override log line is emitted on every
  cell-edit and every import-engine override write.

---

## 7. What needs your sign-off before I start coding

1. **Commit ordering**. The 7-commit sequence in §2 — does it match
   how you want to land it? I picked cost / revenue / plan order
   based on override traffic; you may have a different preference.
2. **Feature flag default**. Default ON or default OFF on first
   deploy? My recommendation is default ON (we've already designed
   for graceful degradation), but a default-OFF deploy gives more
   time to spot a regression before users see it.
3. **Cell-edit reset affordance UX**. Right-click context menu, or
   an inline icon in the cell? I default to context menu (less
   visual clutter), but inline is more discoverable.
4. **Plan-tab call sites**. Do you want to confirm the six
   `db.update(workItems).set(wiMirror)` blocks I marked in
   `planning-tasks-routes.ts` are the complete in-scope set, or
   should I do a deeper grep before coding?

Answer those four and I'll start with commit 1 (the contract module).





