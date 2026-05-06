# Reporting & Aggregation Endpoint Audit

> **Date:** 2026-04-30
> **Scope:** Workstream A of the Excel-vs-App diff system
> (`docs/excel-vs-app-diff-plan.md` § Workstream A).
> **Goal:** Inventory every reporting / aggregation endpoint that
> consumers trust as "live state". Classify each as canonical /
> legacy / derivative / mixed, and flag any snapshot-table reads
> missing the `effectiveTo IS NULL` guard.
> **Method:** see `docs/excel-vs-app-diff-plan.md` § A.3.

---

## 0. Executive summary

**The reporting layer is in much better shape than the kickoff brief
suggested.** Across every file in the seed list and every cross-reference
chased during the audit:

- **Zero snapshot-table reads are missing the `effectiveTo IS NULL`
  guard.** Every `db.select().from(<snapshot table>)` chain checked
  also includes `isNull(<table>.effectiveTo)` and (where the table
  has it) `isNull(<table>.deletedAt)`. This is the most important
  invariant for the diff system, and it already holds.
- **Zero reporting endpoints read from the deprecated
  `programExpense` table.** The cost-side legacy table is essentially
  write-only at this point.
- **Zero reporting endpoints read from `programInflows` either** —
  but the *appearance* of legacy reads is heavy because the
  long-standing storage shim
  `storage.getProgramInflowsByProject(projectName)` (used in
  ~13 call sites across finance / financial-integration / route
  files) is **misleadingly named**: it reads from
  `normalizedRevenueLines` with the proper guards and adapts the
  row shape via `adaptRevenueToInflow` for backward-compatible
  callers. Functionally canonical; cosmetically legacy.

**Top action items**:

1. Rename the misleading `storage.getProgramInflowsByProject` (and
   peers) to make the canonical source obvious. Cosmetic but high
   signal-to-noise: it'll stop the audit alarm bells the next time
   someone runs it. Optional; track as a follow-up issue.
2. The `programExpense` and `programInflows` tables themselves are
   write-only legacy. They can be retired in a separate workstream
   once the import engine stops writing to them; out of scope here.

The diff system can proceed with the assumption that **reporting
already reads canonical**. Workstream B's invariant change does not
need to be paired with a "fix reporting first" gate.

---

## 1. Findings table — services

| File | Reads | Guards present | Class. | Drift exposure | Notes |
|------|-------|----------------|--------|----------------|-------|
| `server/services/dashboard-metrics.ts` | normalizedRevenueLines, normalizedCostLines | ✅ effectiveTo + deletedAt | canonical | n/a — service is the gold standard | Reference implementation. |
| `server/services/canonical-dashboard-kpi-service.ts` | normalizedRevenueLines, normalizedCostLines | ✅ effectiveTo + deletedAt | canonical | n/a | Lines 67–133. |
| `server/services/project-header-kpi-service.ts` | normalizedRevenueLines, normalizedCostLines, projectRevenueSummary | ✅ effectiveTo on all three | mixed (canonical + derivative) | low — projectRevenueSummary is upstream-canonical | Lines 238–243. The derivative read is also guarded. |
| `server/services/financial-review-service.ts` | normalizedCostLines, projectRevenueSummary | ✅ effectiveTo on both | mixed (canonical + derivative) | low | Line 51 reads `projectRevenueSummary` with `isNull(effectiveTo)`. |
| `server/services/pm-monthly-report-service.ts` | normalizedRevenueLines, cashflowPoints, financeRevenueMonthly | ✅ all three | mixed (canonical + derivative) | low | Lines 132, 142, 143. |
| `server/services/company-overview-service.ts` | normalizedRevenueLines, normalizedCostLines | ✅ both | canonical | n/a | Lines 97–98. |
| `server/services/quickbooks-cascade-service.ts` | normalizedRevenueLines, normalizedCostLines | ✅ effectiveTo + deletedAt | canonical | low — read as part of QB cascade write path | Lines 198–211, 305–316. |
| `server/services/quickbooks-reconciliation-service.ts` | normalizedCostLines, normalizedRevenueLines | ✅ all reads | canonical | low | Multiple read sites all correctly guarded. |
| `server/services/report-drilldown-service.ts` | normalizedRevenueLines | ✅ | canonical | low | Line 76. |
| `server/services/project-cost-line-read-service.ts` | normalizedCostLines | ✅ effectiveTo + deletedAt | canonical | n/a | Lines 134, 145, 199–200. |
| `server/services/gate-auto-evaluator-service.ts` | normalizedRevenueLines, normalizedCostLines, projectRevenueSummary | ✅ all three | mixed (canonical + derivative) | medium — drives gate state | Lines 188, 228. The derivative read is also guarded. |
| `server/services/recognition-mode-service.ts` | categoryRevenueAllocations | ✅ effectiveTo | derivative | low — used only for revenue-mode classification | Line 113. Not in seed list; surfaced via cross-reference. |

## 2. Findings table — repositories

| File | Reads | Guards present | Class. | Notes |
|------|-------|----------------|--------|-------|
| `server/repositories/finance-temporal-repository.ts` | cashflowPoints, financeRevenueMonthly, financeCosMonthly, projectRevenueSummary | ✅ effectiveTo on every read | derivative | Lines 26–123. Pure derivative-read repo; trustworthy because the upstream refresh job is canonical (verified separately — `server/services/dashboard-metrics.ts` and the import engine are the only writers). |
| `server/repositories/finance-analysis-repository.ts` | normalizedRevenueLines, projectRevenueSummary, cashflowPoints | ✅ all reads | mixed (canonical + derivative) | Lines 88–417. |
| `server/repositories/finance-expense-engine-repository.ts` | normalizedCostLines (writes only — no reporting reads) | n/a | write-only | Pure write surface; no reporting paths. |
| `server/repositories/finance-inflows-repository.ts` | normalizedRevenueLines | ✅ | canonical | Critical: `getProgramInflowsByProject` (line 113) and `getAllProgramInflows` (line 89) are **canonical-by-proxy**. Their misleading names suggest legacy reads but they read `normalizedRevenueLines` and adapt the row shape via `adaptRevenueToInflow`. |
| `server/repositories/tracker-replica-repository.ts` | normalizedRevenueLines, normalizedCostLines, normalizedCostLineActuals, workItems, tracker_project_metadata, tracker_revenue_summary | ✅ all reads | canonical | Reference implementation for the diff system. |
| `server/api/v2/repositories/project-v2-repository.ts` | projectRevenueSummary | ✅ | derivative | Line 218. |

## 3. Findings table — routes

| File | Reads | Guards present | Class. | Notes |
|------|-------|----------------|--------|-------|
| `server/portfolio-routes.ts` | normalizedRevenueLines, normalizedCostLines | ✅ both | canonical | Lines 406, 407, 659, 660. |
| `server/report-routes.ts` | normalizedCostLines | ✅ | canonical | Lines 321, 632. |
| `server/routes/dashboard-routes.ts` | cashflowPoints, financeRevenueMonthly, financeCosMonthly | ✅ effectiveTo on all | derivative | Lines 105–107. |
| `server/routes/home-extracted-routes.ts` | normalizedRevenueLines, normalizedCostLines | ✅ | canonical | Lines 461–567. |
| `server/routes/finance-legacy-extracted-routes.ts` | normalizedCostLines, normalizedRevenueLines | ✅ | canonical | Lines 247–248 (and via storage shim elsewhere). The "legacy" in the filename is about the route URL pattern, not the data source. |
| `server/routes/overview-extracted-routes.ts` | normalizedCostLines, normalizedRevenueLines | ✅ | canonical | Lines 40–41. |
| `server/routes/project-info-extracted-routes.ts` | (via `storage.getProgramInflowsByProject`) | ✅ canonical-by-proxy | canonical | Line 90. Same canonical-by-proxy pattern. |
| `server/routes/imports-admin-extracted-routes.ts` | normalizedRevenueLines, normalizedCostLines, workItems (mostly write side) | ✅ on the read side | canonical | Lines 325, 364, 389, 1008, 1272. Imports admin path; not a reporting endpoint per se. |
| `server/lifecycle-routes.ts` | normalizedRevenueLines, normalizedCostLines | ✅ all reads | canonical | Lines 579–1415 (multiple read sites). |
| `server/subcontractor-routes.ts` | normalizedCostLines | ✅ all reads | canonical | Lines 34–861. |
| `server/invoice-pattern-routes.ts` | normalizedCostLines | ✅ effectiveTo + deletedAt | canonical | Lines 50–744. |
| `server/deliverable-capture-routes.ts` | normalizedCostLines, normalizedRevenueLines | ✅ both | canonical | Lines 60–95. |
| `server/storage.ts` | normalizedCostLines, normalizedRevenueLines | ✅ both | canonical | Lines 548–606. The `storage` object delegates to the repositories above. |
| `server/departments/finance-routes.ts` | normalizedCostLines, normalizedRevenueLines, plus `storage.getProgramInflowsByProject` shim (~6 sites) | ✅ on direct reads; shim is canonical-by-proxy | canonical (cosmetically mixed) | The largest reporting file in the codebase. ~25 reporting handlers. Every direct snapshot read has the proper guard. The shim usage is canonical-by-proxy. |
| `server/departments/financial-integration-routes.ts` | (via `storage.getProgramInflowsByProject`) | ✅ canonical-by-proxy | canonical | Lines 428, 586, 746. |
| `server/departments/fye-revenue-tracking-routes.ts` | projectRevenueSummary | ✅ | derivative | Line 656. |

---

## 4. Cross-cutting findings

### 4.1 No bugs found

This is the headline. Workstream B does not need to be paired with
a "fix reporting first" effort. Reporting reads canonical data with
the right guards.

### 4.2 The misleadingly-named storage shim

`storage.getProgramInflowsByProject(projectName)` — used in 13 call
sites — reads from `normalizedRevenueLines` (canonical), filters with
`isNull(effectiveTo)` and `isNull(deletedAt)`, and adapts the row
shape via `adaptRevenueToInflow` for callers that still expect the
PE/PI row interface. This is functionally canonical but reads like
legacy. Sister methods follow the same pattern.

**Risk:** The next person to do an audit (or a static-analysis tool,
or an LLM) will flag these as "reads legacy table". Cosmetic but
high signal-to-noise.

**Recommendation:** rename in a separate PR. Suggestions:
- `getProgramInflowsByProject` → `getRevenueInflowsByProject`
- `getAllProgramInflows` → `getAllRevenueInflows`

The `adaptRevenueToInflow` shape adapter stays — there are still
callers that expect the legacy row shape. That's fine; the shape is
just a presentation concern.

### 4.3 The legacy `programExpense` / `programInflows` tables

These tables exist and are still written to by:
- `server/lib/import/commit-executor.ts` (the import engine writes
  PE/PI rows in addition to canonical rows for backward
  compatibility).
- A few admin-recovery and one-off paths.

**No reporting endpoints read from these tables directly** (modulo
the canonical-by-proxy shim above, which doesn't actually touch
them).

**Recommendation:** retire in a separate workstream after a final
audit confirming no readers. Out of scope for the diff system.

### 4.4 Derivative-table refresh provenance

The derivative tables (`financeRevenueMonthly`, `financeCosMonthly`,
`projectRevenueSummary`, `categoryRevenueAllocations`,
`cashflowPoints`) are read in 5 reporting paths. Their refresh job
is the import engine itself (Smart Import v2 commit path) and the
post-commit metric refresh (`refreshProjectMetricsAsync`). Both are
canonical. Therefore reads from these derivative tables are
trustworthy.

The one caveat: refresh is async. After a Smart Import commit, a
brief window exists where derivative tables are stale. This is
documented in `docs/smart-import-v2-known-limitations.md` § 1
("Derivative table refresh lag — by design"). Not a concern for the
diff system because the diff page reads canonical, not derivative.

### 4.5 Drift exposure ranking (top 5 endpoints)

Even without bugs, some endpoints have higher drift exposure simply
because their values feed into business decisions. Listed for
information only:

1. `server/services/canonical-dashboard-kpi-service.ts` — drives
   the program dashboard.
2. `server/services/project-header-kpi-service.ts` — drives the
   project header KPIs every operator sees.
3. `server/portfolio-routes.ts` `/api/portfolio/*` — drives the
   portfolio summary screens.
4. `server/services/gate-auto-evaluator-service.ts` — drives gate
   state machine.
5. `server/departments/finance-routes.ts` `/api/cashflow-2026/*` —
   drives the cashflow reporting.

All five are canonical. None need migration. The diff system's
drift detection runs alongside them.

---

## 5. Recommended follow-up issues

1. **Rename `storage.getProgramInflowsByProject` and peers** to
   reflect canonical source. Pure rename + call-site update; no
   behaviour change. Estimated 1 hour. Priority: low (cosmetic).
   Title: `chore(finance): rename ProgramInflows shim to RevenueInflows`.

2. **Audit `programExpense` / `programInflows` write paths** as a
   precursor to retiring the tables. Confirm the import engine and
   any admin paths are the only writers; produce a retirement plan.
   Estimated 4 hours. Priority: low (no operational impact).
   Title: `tech-debt: PE/PI table retirement plan`.

3. **Pin the canonical-vs-legacy assertion in CI**. A unit test (or
   an extension to `ee-snapshot-auditor`) that runs the same grep
   audit this doc did and fails CI on new snapshot-table reads
   missing the guard. Prevents regression. Estimated 2 hours.
   Priority: medium.
   Title: `qa: pin reporting-read invariants in CI`.

These three follow-ups are NOT critical-path for the Excel-vs-App
diff system. They're recorded so the audit isn't lost.

---

## 6. Method notes (reproducing this audit)

```bash
# 1. List every snapshot-table read.
for tbl in normalizedCostLines normalizedRevenueLines \
          normalizedCostLineActuals cashflowPoints \
          financeRevenueMonthly financeCosMonthly \
          categoryRevenueAllocations projectRevenueSummary; do
  grep -rEn "from\(${tbl}\)|\.from\(${tbl}\)" server/ \
    | grep -v -E "^server/(lib/import/|imports/|migrations/|test|.*\.bak)"
done

# 2. Check every legacy PE/PI read.
grep -rEn "from\(programExpense\)|from\(programInflows\)" server/

# 3. Trace every storage shim that returns ProgramInflows /
#    ProgramExpense to confirm the underlying table.
grep -nE "getProgramInflowsByProject|getProgramExpenseByProject" \
  server/storage.ts server/repositories/

# 4. For every read site found in (1) and (3), open the file and
#    verify the where clause includes isNull(effectiveTo) and
#    (where the table has the column) isNull(deletedAt).
```

The grep approach catches every Drizzle ORM read. Raw SQL reads
(e.g. `db.execute(sql\`SELECT … FROM normalized_cost_lines\`)`) are
rare; spot-checked by also running:

```bash
grep -rEn "FROM normalized_cost_lines|FROM normalized_revenue_lines" server/
```

No raw SQL reporting reads bypass the ORM.

---

## 7. Conclusion

The reporting layer is canonical. The Excel-vs-App diff system can
proceed without a "fix reporting first" prerequisite. The three
follow-up issues in §5 are low-priority cleanup that improves
maintainability but doesn't gate any feature work.
