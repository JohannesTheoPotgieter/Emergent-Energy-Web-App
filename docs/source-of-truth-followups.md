# Source-of-Truth Audit — Follow-up Tasks

> Companion to `docs/data-import-and-source-of-truth.md`. Captures
> deferred items from the 2026-05-04 source-of-truth audit. Each
> section is written as a self-contained prompt for a future
> Claude Code session — copy the section into the new session and it
> should have enough context to execute without re-reading this PR's
> commit history.

---

## Follow-up 1 — Refactor `/api/program-dashboard` to use a repository (P1 #4)

### Why

`server/routes/dashboard-routes.ts:86` (`GET /api/program-dashboard`)
performs ~1400 lines of in-route finance aggregation. It calls
`db.select()` and `db.execute()` directly inside the handler against
`normalized_revenue_lines`, `normalized_cost_lines`, `cashflow_points`,
`finance_revenue_monthly`, `finance_cos_monthly`, `work_items`,
`project_info`, `project_plan`, `normalized_execution_phases`, and
`smart_import_runs`. That violates the route → repository discipline
in `CLAUDE.md`, makes the snapshot-table guards hard to audit, and
puts the highest-traffic finance endpoint in the densest part of the
codebase.

### Scope

1. Read the existing handler in full. Map every `db.*` call and every
   piece of in-memory aggregation it performs.
2. Create `server/repositories/program-dashboard-repository.ts` with
   one (or two — splitting finance from schedule is reasonable)
   exported method that returns a typed bundle the route can serialise
   directly.
3. Move every `db.*` call to the repository. Apply
   `isNull(table.effectiveTo)` filters where missing and add a
   one-line comment naming the snapshot-table guard each query
   honours.
4. Leave the route file with: param parsing, RBAC, repository call,
   trust-header set, response serialisation. Nothing else.
5. Verify response-shape parity with a snapshot test against a known
   fixture (Vitest + the `inputs` injection pattern used in
   `qa/tests/unit/dashboard-financial-summary.test.ts`).

### Out of scope

- Rewriting the aggregation logic. The goal is to move the same
  computation to the repository, not change its results.
- Changing the response shape. The dashboard component depends on the
  current keys.
- The `manualOverrides` overlay — leave it where it is unless the
  repository surface makes it cleaner to consume.

### Acceptance

- [ ] No `db.*` calls remain in `server/routes/dashboard-routes.ts`
      between lines 86 and ~1240.
- [ ] Every snapshot-table read in the new repository has an explicit
      `effectiveTo` guard.
- [ ] `npm run check` passes.
- [ ] A unit test pins the response shape against a fixture.
- [ ] Manual smoke: load `/dashboard`, confirm KPIs, financial tiles,
      project table, attention items, and import health are
      unchanged from before the refactor.

### Prompt for the new session

> Refactor the `/api/program-dashboard` endpoint
> (`server/routes/dashboard-routes.ts:86`) to use a new
> `server/repositories/program-dashboard-repository.ts`. Keep response
> shape identical. Move every `db.select()` / `db.execute()` to the
> repository, add explicit `effective_to IS NULL` guards on snapshot
> tables, and add a Vitest unit test that pins the response shape
> using the `inputs` injection pattern in
> `qa/tests/unit/dashboard-financial-summary.test.ts`. Don't change
> aggregation results, don't add features, don't move other code.
> Read `docs/data-import-and-source-of-truth.md` first.

---

## Follow-up 2 — Smart Import v2 field-coverage gaps (P3 #7–#11)

### Why

The audit found Excel-mastered tables where the importer leaves
columns null even though the UI displays them. They're either:
- (a) intentionally app-resolved (e.g. `noRevenueLinked` runs in a
  post-import recon job), or
- (b) genuinely unmapped (`ownerUserId`, `counterpartyId`,
  `categoryAllocationId`, `parentId`).

For (b), the UI shows null/blank where Excel could supply the value
via a lookup. Each field is a small, isolated change to the importer.

### Field-by-field

| Field | Table | Current state | Proposed work |
|---|---|---|---|
| `ownerUserId` | `work_items` | Only `ownerName` text written | Add email/name → user lookup against `users.email` / `users.name` during import. Cache the lookup per run. Leave null when no match (do not auto-create users). |
| `parentId` | `work_items` | Flat — hierarchy implicit in `outline_number` | Post-import pass that walks rows ordered by `outlineNumber`, sets `parentId` to the most recent row whose `outlineNumber` is a prefix. |
| `counterpartyId`, `counterpartyType` | `normalized_cost_lines` | Only `counterpartyName` text | Alias-match against `counterparties.aliases` / `counterparties.name`. Use the same matcher already used by the invoice-pattern pipeline. Leave null on no match. |
| `categoryAllocationId` | `normalized_cost_lines` | Rarely populated | Tighten category-number match in the importer. Find where the import currently looks up category and audit why it misses. |
| `noRevenueLinked` | `normalized_cost_lines` | Set by post-import recon | Verify the recon job runs after every commit. If it doesn't, either run it inline at end-of-commit or add a queue trigger from the import-finalise step. |

### Out of scope

- Backfilling existing rows. New work only — re-importing fills in
  the gaps. A separate one-off backfill script can be planned if/when
  needed.
- Editing the `data-merge` adapters. The importer writes canonical
  rows directly.

### Prompt for the new session

> Read `docs/source-of-truth-followups.md` § "Smart Import v2
> field-coverage gaps" for the full scope. Focus on one field at a
> time, smallest first: `ownerUserId` → `counterpartyId` →
> `categoryAllocationId` → `noRevenueLinked` recon trigger →
> `parentId`. For each: read the importer location
> (`server/lib/import/normalizer.ts` and the corresponding
> `commit-executor.ts` writer for the section), find or build the
> lookup helper, wire it into the row construction, add a focused
> unit test using a small fixture. Don't backfill existing rows.
> Don't change the schema. Run `npm run check` after each field.

---

## Follow-up 3 — Rename legacy-named program endpoints (P4 #12)

### Why

`/api/program-expenses/:projectName` and
`/api/program-inflows?projectName=…` *read canonical* tables
(`normalized_cost_lines` and `normalized_revenue_lines`), but the URL
names imply the deprecated PE-PI shapes. This is confusing for new
contributors and for anyone reading server logs.

### Scope

This is a **breaking change** for API consumers. The plan must include
deprecation, not just rename.

1. Add new endpoint names beside the old ones — e.g.
   `/api/projects/:projectName/cost-lines` and
   `/api/projects/:projectName/revenue-lines`. Both new and old paths
   call the same repository method and return the same payload.
2. Update every client-side caller to use the new names. Search
   `client/src/` for `/api/program-expenses` and
   `/api/program-inflows`.
3. Mark the old paths deprecated in code comments and add a
   `Deprecation` HTTP header (per RFC 8594) on responses.
4. Open a follow-up issue to remove the old paths after one release
   cycle.

### Out of scope

- Renaming the underlying repository methods (already named
  `getAllCostLinesForCashflow` etc.).
- Renaming database tables.

### Prompt for the new session

> Add new canonical-named alternatives to
> `/api/program-expenses/:projectName` and `/api/program-inflows`,
> namely `/api/projects/:projectName/cost-lines` and
> `/api/projects/:projectName/revenue-lines`. Both paths must call
> the same repository methods and return identical payloads. Update
> every client caller in `client/src/` to use the new paths. Mark the
> old paths deprecated with a code comment and a
> `Deprecation: true` response header. Leave the old paths working
> for one release cycle. Don't rename DB tables or repository
> methods. Run `npm run check` and `npm run test` after.

---

## Follow-up 4 (optional) — Materialised monthly snapshot reads

### Why

The new `getFinancialSummary()` reads canonical line tables directly
on every call. The materialised `finance_revenue_monthly` and
`finance_cos_monthly` tables exist but are not used because the
importer's coverage of them is unverified.

If the importer reliably populates these tables (verify by reading
`server/lib/import/commit-executor.ts` for any `financeRevenueMonthly`
/ `financeCosMonthly` writes), the financial-summary endpoint can
swap to snapshot reads for performance — single grouped query
instead of full-line aggregation.

### Acceptance

- [ ] Confirmation (yes/no) that the importer writes both monthly
      tables. Document in `docs/data-import-and-source-of-truth.md`.
- [ ] If yes: a feature-flagged switch in `getFinancialSummary()` to
      read from the snapshot tables, with the existing line-aggregation
      path as fallback. Default off until perf is needed.
- [ ] If no: document this in the doctrine doc and either drop the
      tables in a future cleanup or add importer coverage.

### Prompt for the new session

> Read `server/lib/import/commit-executor.ts` (and any sibling files
> in `server/lib/import/`). Determine whether Smart Import v2 writes
> to `finance_revenue_monthly` and `finance_cos_monthly`. Report the
> finding in `docs/data-import-and-source-of-truth.md`. Do not
> change `getFinancialSummary()` yet — research only.
