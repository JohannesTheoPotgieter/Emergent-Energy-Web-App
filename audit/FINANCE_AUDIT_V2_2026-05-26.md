# Finance Module — Deep Audit V2

**Date:** 2026-05-26
**Branch:** `claude/finance-deep-audit-v2`
**Builds on:** `audit/FINANCE_AUDIT_2026-05-26.md` (V1, PR #943 / #945 merged)
**Owner:** Johannes Theo Potgieter (COO)
**Auditor:** Claude (Opus 4.7) via Claude Code on the web

> **Scope of V2 (areas under-covered in V1):** numeric precision / VAT / negative values / multi-currency, transaction atomicity & concurrency, date / timezone / period boundary edges, project lifecycle (close / archive / restore), test coverage & audit-trail completeness. Findings are verified against the live code where I could spot-check; agent claims that I could not directly verify are marked **(unverified)**.

> **Convention:** findings continue from the V1 numbering. V1 used `F-` and `U-`; V2 uses `DF-` (Deep Finding) and `DU-` (Deep UX).

---

## 1. Executive summary

After the V1 audit (formulas, RBAC, snapshot guards), V2 found that the finance module's correctness depends on a number of **second-order invariants** that aren't enforced today:

- A consistent timezone anchor (SAST) across every "today" / "current month" computation — **today there are 6+ UTC-anchored sites and a handful of SAST-anchored ones, so the dashboard and per-project drilldown can disagree for ~2 hours per day at month boundaries.**
- A `project_status` filter on every aggregate read — **today's portfolio / FY / cashflow aggregates do not filter by status, so closed projects continue to inflate totals after they should drop off.**
- A visible writer for the `derived_project_kpis` cache table — **none exists in the codebase**. The priority surface and project header tiles read from a cache nothing in this repo refreshes.
- Transaction wrapping on multi-table finance writes — **QB approve + cascade detection runs in two separate steps**; a mid-flight failure leaves a link without its proposals.
- Concurrency control on edits to the same finance line — **none today**. Two simultaneous edits silently overwrite each other.
- The `total_recognised_revenue` column / view / materializer to complete F-1 Phase 2 — **none exists yet.**

Plus a long tail of medium-and-low items: VAT NULL handling treats inc-VAT as ex-VAT (flagged but value inflated), USD exchange rate column captured but never applied, future invoice dates not blocked, hardcoded FY26 budget with no runtime guard, missing audit-event tests on 8 write paths, missing 403/200 dual-assertion tests for the PR #943 RBAC migration.

**Severity counts (V2):** 10 HIGH, 17 MEDIUM, 8 LOW.

What got fixed in this V2 PR is listed under § 9. What needs owner sign-off is in § 11. What I could not verify without DB access is listed under § 10.

---

## 2. DF-1 (HIGH) — No `project_status` filter on portfolio finance aggregates

**Where:**
- `server/services/canonical-dashboard-kpi-service.ts` (PG + SQLite paths) — reads `normalized_revenue_lines` and `normalized_cost_lines` by `project_id` only.
- `server/services/dashboard-metrics.ts` — same anti-pattern.
- `server/repositories/finance-line-level-repository.ts:227–315` (`getPortfolioFinanceLines`) — joins through `category_revenue_allocations` and reads parent + actuals by project_id, no project_status check.
- `server/pm-routes.ts:35–59` (`getPmProjectNames`) — filters by PM, NOT by status. All callers downstream inherit unfiltered project sets.
- `server/routes/register-cashflow-2026-routes.ts` — cashflow weekly view reads all projects.
- `server/departments/priority-strategic-routes.ts:592–606` — priority project roll-up does not filter by `project_status`.

**Verified:** confirmed by direct grep at every cited line.

**Effect:** a project moved to `closed` (or `hold`, `internal`, `tbc`) continues to contribute to:
- FY revenue tile on COO Dashboard
- PM Dashboard portfolio totals
- Priority KPI roll-up (linked-project totals)
- Weekly cashflow forecast (planned outflows from closed projects)
- Project-level KPI tiles (will silently linger after closure)

**Severity:** HIGH. This is a silent overstatement of revenue / cost / forecast for every closed-but-not-deleted project. Particularly bad after FY-end when a year's worth of closed projects are still summing into the active book.

**Status:** **Not fixed in this PR.** Owner decision: should closed projects appear in current-FY totals, or be excluded? Recommendation: add a `projectStatuses?: string[]` option to `getCanonicalFinanceByProjectIds` defaulting to `['active', 'hold']` (excluding `closed` and `internal`), with explicit opt-in for "All projects" views.

---

## 3. DF-2 (HIGH) — `derived_project_kpis` cache has no visible writer

**Where:**
- Read in: `server/services/project-platform-summary-service.ts:569–586`, `server/services/project-header-kpi-service.ts:240`, `server/lib/priorities/progress-source.ts:86`, `migrations/0003_priority_derived_metrics_view.sql:34–37` (the view that powers the priority KPI surface).
- **Writer:** none found anywhere in `server/`, `scripts/`, `migrations/`, or `server/bridge/`. Verified by grep for `INSERT INTO derived_project_kpis`, `.insert(derivedProjectKpis`, `UPDATE derived_project_kpis`, `.update(derivedProjectKpis`, `materializeDerived*`, `refreshDerived*` — zero matches. Only `DELETE` is found, in `lifecycle-routes.ts:3493` (hard-delete cleanup).

**Effect:** every consumer of this cache is either reading stale data, NULL data, or data populated by something external to this repo (likely a backfill script or an external Replit cron — unconfirmed). For a project whose finance state has changed since the last (unknown) backfill, the priority surface and project header tiles will be wrong.

**Severity:** HIGH. The priority dashboard headline figures (revenue / cost / margin per priority) and the project header chips are likely showing stale or zero data without anyone knowing.

**Status:** **Not fixed in this PR.** Owner decision needed:
1. Identify the current writer (external pipeline?) and document it, OR
2. Add an in-app materializer (cron-style or trigger-on-finance-write) that populates the table from the canonical sources.
3. Until then, F-1 Phase 2 (priority surface POC migration) is blocked because there's no path to add a `total_recognised_revenue` column to a table nothing writes.

---

## 4. DF-3 (HIGH) — SAST vs UTC `currentMonthKey` divergence

**Where:**
- `server/repositories/finance-line-level-repository.ts:186–189` — SAST-anchored (`Date.now() + SAST_OFFSET_MS`, then `getUTCMonth`).
- `server/lifecycle-routes.ts:1326` — SAST-anchored.
- **vs:** `server/departments/finance-routes.ts:2838, 5348, 5506, 5675, 5928, 6211` — UTC-anchored (`new Date().getUTCMonth()`).
- **vs:** `server/departments/project-routes.ts:44–46` `currentMonthKeyUtc()` — UTC-anchored (explicitly labelled).
- `server/lib/finance/cos-realisation.ts:194–206` `isPastMonthAutoRealised` accepts `currentMonthKey` as a parameter — relies on caller to pass the right one.

**Verified:** confirmed by direct read. The comment at `finance-routes.ts:2836–2837` actually says "UTC anchor — must match cosCurrentMonthKey" but the line-level repository does the SAST-anchored thing and `cos-realisation.ts` consumes whatever the caller passes.

**Effect:** at 00:00–02:00 UTC (= 02:00–04:00 SAST) the first 2 hours of each SAST day, a line dated to "today SAST" classifies as:
- **Current month** when consumed via the line-level repository, lifecycle, COS tracker
- **Previous month** when consumed via `finance-routes.ts` `/api/program/cos`, `/api/gp-tracker`, `/api/revenue-tracker` (the legacy routes)

The `isPastMonthAutoRealised` auto-promote rule will flip its answer depending on which caller is asking. A line that's "Committed" in the COS tracker can read as "Realised" on the legacy program/cos endpoint, or vice versa, for 2 hours every night.

**Severity:** HIGH for correctness. Real-world blast radius: per-night reporting jobs running at 02:00 SAST would see different numbers from morning views. Month-boundary reports (Sep 1 — FY rollover) are the worst case.

**Status:** **Fix applied in this PR.** Switched the 6 UTC-anchored sites in `finance-routes.ts` to use the SAST-anchored helper. Added a shared helper `sastCurrentMonthKey()` so future routes don't fork.

---

## 5. DF-4 (HIGH — conditional) — USD exchange rate captured but never applied

**Where:**
- `shared/schema/finance.ts:704` — `usdExchangeRate: decimal(10, 4)` on `normalized_cost_lines`.
- `server/lib/import/normalizer.ts:1641, 1706` — read from the workbook column and persisted to the DB.
- `server/lib/import/commit-executor.ts:1973, 2126` — preserved on re-import.
- `server/routes/tracker-replica.routes.ts:114–130` — surfaced as project header metadata.
- **NO** reference to `usdExchangeRate` in any aggregation, SUM, or per-line revenue calculation.

**Verified:** confirmed by direct grep. The field is captured, persisted, and displayed, but never multiplied into `amountExVat` to produce a ZAR-equivalent.

**Effect — depends on tracker convention:**
- **Case A (most likely):** the Excel tracker calculates `USD × rate = ZAR` in a hidden column and the `amount_ex_vat` column already holds the ZAR equivalent. In this case `usdExchangeRate` is pure metadata (for the tracker replica view) and there's no bug. Just dead weight in the schema.
- **Case B (possible):** the Excel tracker stores raw USD in `amount_ex_vat` and expects the app to convert using `usdExchangeRate`. In this case any project with USD lines is silently undercounted by a factor of ~18.5×.

**Severity:** HIGH if Case B holds; LOW (cosmetic) if Case A holds. Needs owner clarification.

**Status:** **Not fixed in this PR.** Awaiting owner confirmation of tracker convention. If Case A: add a comment on the field documenting it as "metadata only, used for tracker replica display". If Case B: apply the rate at normalizer time (write ZAR-equivalent to `amount_ex_vat`, keep raw USD + rate as audit columns).

---

## 6. DF-5 (HIGH — mitigated) — VAT NULL tax treated as ex-VAT (with `taxUncertain` flag)

**Where:** `server/lib/finance/qb-allocation.ts:29–44` `deriveQbVatAmounts`.

```typescript
if (tax === null) {
  return { qbAmountIncVat: incVat, qbTaxAmount: null, qbAmountExVat: incVat, taxUncertain: true };
}
```

**Effect:** when a QB bill has `TotalAmt` but no `TotalTax`, the function assumes the entire amount is ex-VAT. For a standard ZA bill (15% VAT inclusive), that **inflates the ex-VAT figure by 15%**.

The `taxUncertain: true` flag DOES propagate to `computeQbDocumentStatus` (→ `TAX_UNCERTAIN` status) and to UI badges (`finance-routes.ts`). So the value is wrong but the system flags it as suspect.

**Severity:** HIGH for accuracy, MEDIUM in practice because the flag surfaces visibly.

**Status:** **Not fixed in this PR.** Owner decision: should `deriveQbVatAmounts` return `qbAmountExVat: null` (refuse to guess) when tax is missing, or keep the current behaviour and rely on the badge? Either path is a UX change. Recommend the former — null is honest; an inflated number with a small chip is misleading.

---

## 7. DF-6 (HIGH) — Negative category total reverses per-line revenue sign

**Where:** `server/repositories/finance-line-level-repository.ts:592–628`.

The § 3.3 formula is:
```
perLineRevenue = (line.actualTotal / category.totalActualTotal) × category.revenueAllocation
```

When `category.totalActualTotal < 0` (credits > costs in the category — e.g., a refund booked larger than the costs to date), the denominator inverts the sign of `perLineRevenue`. A line with positive `actualTotal` would get **negative** recognised revenue, with magnitude potentially much larger than the line cost.

Worked example from the agent report:
- Category total: 100,000 cost + (-120,000) credit = -20,000
- Revenue allocation J = 50,000
- Line A actual: 100,000
- `perLineRevenue = (100,000 / -20,000) × 50,000 = -250,000` ← clearly wrong

**Severity:** HIGH when it triggers, but it only triggers when credits exceed costs in a category — rare but plausible end-of-project after refunds.

**Status:** **Fix applied in this PR.** Added a guard at the category-total step: when `categoryTotalActualTotal <= 0`, emit a `category_total_non_positive` derivation warning and set `perLineRevenue = 0`. Test added.

---

## 8. DF-7 (HIGH) — QB approve flow: link created outside the cascade-proposal transaction

**Where:** `server/routes/quickbooks-invoice-matches.routes.ts:1062–1142` (single-link approve path).

Sequence:
1. `confirmCostLineLink` / `confirmRevenueLineLink` writes the link row (commits its own transaction).
2. `qbLinksRepository.getLinkById(createdLinkId)` reads it back.
3. `detectAndPersistProposals` runs and writes cascade proposals.

The two writes are **not wrapped in a shared transaction**. If step 3 throws (QB API timeout, DB hiccup, anything), the link survives but the cascade proposals never appear. The user sees a successful link with no follow-up paid-date / vendor-mapping suggestions — and the next QB sync will silently re-detect them, masking the original failure.

(Note: the `approve-multi` path at lines 1469–1530 IS wrapped in `db.transaction()` — the bug is only in the single-link path.)

**Severity:** HIGH. Partial success without a user-visible error.

**Status:** **Not fixed in this PR.** Architectural change — needs to either wrap both steps in one transaction (preferred) or make `detectAndPersistProposals` idempotent and run it again on link load. Owner decision on which path.

---

## 9. DF-8 (HIGH) — Smart Import concurrent runs can cross-delete each other's rows

**Where:** `server/lib/import/commit-executor.ts` end-of-pass cleanup at lines 1041–1063.

The cleanup soft-closes any active row whose `rowHash` is **not in `seenRowHashes`** (a `Set<string>` accumulated during the import). When two imports run concurrently for the same project:
1. Import A reads active rows, builds `seenRowHashesA`.
2. Import B reads same active rows, builds `seenRowHashesB`.
3. Both commit. If `seenRowHashesA != seenRowHashesB` (different file contents), Import A's cleanup will soft-close rows that Import B just added (and vice versa).

The fix is to scope cleanup by `import_run_id` (only close rows from the import run currently committing) rather than globally on the project.

**Severity:** HIGH. Silent data loss in a race condition.

**Status:** **Not fixed in this PR.** Architectural change — needs careful review of the import_snapshot lifecycle. Documenting it explicitly.

---

## 10. DF-9 (HIGH) — PR #943 RBAC migration has no snapshot regression test

**Where:** the 22 endpoints migrated by PR #943 (`finance-legacy-extracted-routes.ts`, `cos-control-routes.ts`, `register-cashflow-2026-routes.ts`, `finance-analysis.routes.ts`) carry `requirePermission(...)` decorators.

A future commit could silently remove a `requirePermission` from one of these endpoints and there's no test that would catch it. The first audit's V1 finding F-2 fixed the gaps; without a regression test, the fix can drift.

**Severity:** HIGH. RBAC drift would re-open the original confidentiality issue.

**Status:** **Fix applied in this PR.** New test `qa/tests/unit/finance-rbac-pr943-snapshot.test.ts` source-text-grep-asserts the expected gate on each of the 22 endpoints. If any gate is removed or downgraded, CI fails.

---

## 11. DF-10 (HIGH) — F-1 Phase 2 priority materializer not pinned

**Where:** the priority-detail surface still reads `total_revenue` (contract value sum) from `priority_derived_metrics.total_revenue` → `derived_project_kpis.total_planned_revenue`. F-1 Phase 1 added `recognisedRevenue` only to `canonical-dashboard-kpi-service.ts` and `project-lifecycle-workspace-service.ts`.

**Blocked by DF-2.** Without a visible writer for `derived_project_kpis`, there's no path to add a `total_recognised_revenue` column + populate it without also building / locating the writer.

**Severity:** HIGH for completeness of F-1.

**Status:** **Not fixed in this PR.** Blocked by DF-2.

---

## 12. DF-11 (MEDIUM) — Manual cost-line edits are last-write-wins

**Where:** `server/services/finance-line-write-service.ts` `updateCostLineFields`, called by the PATCH endpoints in `finance-legacy-extracted-routes.ts:1218`.

Two simultaneous PATCHes to the same cost line:
1. Both read row at T1 (same `updatedAt`).
2. A writes `paidDate`, B writes `invoiceNumber`.
3. The later write overwrites the earlier without conflict detection.
4. The audit log shows both changes; the row reflects only the latter.

No `If-Match` / ETag check, no `updatedAt`-based optimistic concurrency, no UI "another user is editing" lock-out.

**Severity:** MEDIUM. Two simultaneous editors of the same line lose one user's change silently (audit captures both intentions but the row only keeps the last).

**Status:** **Not fixed in this PR.** Adds a new schema field (revision counter) and request-header handshake — architectural. Recommend the route accepts `If-Match: <updatedAt ISO>` and returns 409 on mismatch.

---

## 13. DF-12 (MEDIUM) — Bridge sync is fire-and-forget

**Where:** `server/bridge/bridge-writer.ts` `syncCostLineFieldUpdate` called without `await` from `finance-line-write-service.ts:110`.

Effect: a cost line is updated successfully in `normalized_cost_lines`, the response returns 200, but the downstream "promoted" schema (`core.finance_*`) lags until the next reconciliation pickup. KPI surfaces that read from the promoted schema show stale numbers for an unknown window.

**Severity:** MEDIUM. Visible inconsistency that recovers on next reconciliation. Worse during periods of heavy edits.

**Status:** **Not fixed in this PR.** Architectural choice — fire-and-forget is the right call for response latency, but needs either (a) a synchronous fallback for finance-critical paths or (b) a visible "promoted schema lag" indicator.

---

## 14. DF-13 (MEDIUM) — `getFYRange()` and `getFyWindow()` use local `getMonth()`

**Where:**
- `server/lib/home-helpers.ts:49–54` `getFYRange()`
- `server/lib/fy-window.ts:39–57` `getFyWindow()`

Both call `.getMonth()` on a plain `new Date()`, which uses the **process timezone**. On a UTC server (Replit / CI), at 22:30 SAST on Aug 31 the process clock is at 20:30 UTC Aug 31 — still August. At 02:30 SAST on Sep 1 the process clock is at 00:30 UTC Sep 1 — September. So on the SAST boundary, the FY window flips an hour early.

**Severity:** MEDIUM. Only matters in the Aug 31 → Sep 1 window, and only on a UTC server. EE runs on Replit; their timezone configuration determines actual blast radius.

**Status:** **Fix applied in this PR.** Both helpers now apply `SAST_OFFSET_MS` and use `getUTCMonth()` so they return the SAST month regardless of process timezone.

---

## 15. DF-14 (MEDIUM) — `STATIC_COS_BUDGET_FY26` has no FY-rollover runtime guard

**Where:** `server/lib/calculations/financeUtils.ts:18+`. Hardcoded `Sep 2025 – Aug 2026` budget keys. When FY rolls (Sep 2026 → FY27), the constant becomes outdated and reads return undefined / zero.

**Severity:** MEDIUM. Silent zeroing of the budget tile after FY rollover until someone notices.

**Status:** **Fix applied in this PR.** Added a runtime check in the module that logs a warning when the current SAST month is outside the constant's keyed range. The fix doesn't change values; it surfaces the drift loudly so it can't sneak past FY-end.

---

## 16. DF-15 (MEDIUM) — Holiday cache TTL 1h stale window

**Where:** `server/lib/finance/period-lock.ts:163–192`. Holidays are loaded once and cached for 1h.

If a holiday is added at 12:00 SAST, the period-lock 3rd-business-day calculation will not see it until 13:00 SAST. In a month where the 3rd business day is the day the holiday is added, that's a 1h window where the lock might activate / clear on the wrong day.

**Severity:** MEDIUM (operational). The window is small and only matters if a holiday is added intra-day.

**Status:** **Not fixed in this PR.** Owner decision: keep the cache (avoid DB thrashing) but add a manual "refresh holidays" admin button, OR drop the cache TTL to e.g. 5 minutes.

---

## 17. DF-16 (MEDIUM) — `invoiceDate > paidDate` is WARNING, not blocker

**Where:** `server/lib/import/normalizer.ts:1115–1128` (revenue) and `:1567–1578` (cost).

Today: an invoice dated 2026-06-01 with paid date 2026-05-15 (invoice AFTER payment — impossible) is imported with a WARNING. Per § 3.7, both should be actuals; a negative turnaround would corrupt DSO/DPO and aging.

**Severity:** MEDIUM. Data quality, not a calculation bug.

**Status:** **Not fixed in this PR.** Owner decision: promote to BLOCKER level (refuse the import row), or leave as WARNING and add a dedicated "review queue" surface.

---

## 18. DF-17 (MEDIUM) — Partial-payment state not persisted on app-side lines

**Where:** `server/services/quickbooks-reconciliation-service.ts:1427–1431` `derivePaymentStatus`. The status (`paid` / `partial` / `unpaid`) is computed dynamically from `qbBalance` vs `qbTotal`. The app-side cost / revenue line does NOT carry a `paymentStatus` field; partial-payment information lives only in the QB recon layer.

**Effect:** the cashflow page (which reads from app lines) cannot tell that an invoice has been part-paid. It shows the full outstanding amount, not the remaining balance.

**Severity:** MEDIUM. Cashflow forecasts overstate the receivable / payable.

**Status:** **Not fixed in this PR.** Schema addition (new `payment_status` + `partial_paid_amount` columns) + writer changes. Architectural.

---

## 19. DF-18 (MEDIUM) — No multi-currency support beyond USD

**Where:** schema has `usdExchangeRate` only — no `currencyCode`, no rates for EUR / GBP / CNY (Chinese inverter suppliers are common).

**Severity:** MEDIUM. Cosmetic until a non-USD foreign cost line appears; then it's silently treated as ZAR.

**Status:** **Not fixed in this PR.** Schema decision.

---

## 20. DF-19 (MEDIUM) — VAT rate changes mid-project not tracked

**Where:** `shared/schema/finance.ts:521, 635` — `vat` decimal field, no `vat_rate` (%) or `vat_changed_at`. If SA VAT goes 15% → 16% mid-project, the historic lines carry no rate metadata.

**Severity:** MEDIUM. Affects reconciliation with QB (which records the actual rate at transaction time).

**Status:** **Not fixed in this PR.** Schema decision.

---

## 21. DF-20 (MEDIUM) — `getCosRealisationWarnings` diagnostic flags untested

**Where:** `server/lib/finance/cos-realisation.ts:135–175`. The function returns warnings (`INVOICE_WITHOUT_PO`, `INVOICE_WITHOUT_DATE`, `PLACEHOLDER_INVOICE`, `REALISED_BY_FONT_COLOR_ONLY`) — no unit test pins them. A future refactor could silently suppress warnings.

**Severity:** MEDIUM. Diagnostic, not formula.

**Status:** **Fix applied in this PR.** New test `qa/tests/unit/cos-realisation-warnings.test.ts` covers each warning code.

---

## 22. DF-21 (MEDIUM-HIGH) — Cost/revenue line CRUD audit events untested

**Where:** `POST/PATCH/DELETE /api/finance/{cost,revenue}-lines/*`, `POST/DELETE /api/cos-status-override`, `PATCH /api/expenditure/font-color-toggle`. Each calls `logAuditFromReq` (static code) but no API test verifies an `audit_events` row is actually written.

**Severity:** MEDIUM-HIGH. Compliance — if a code path stops emitting, no signal.

**Status:** **Not fixed in this PR.** API tests need a DB-backed setup; deferred to a follow-up that brings up a test DB.

---

## 23. DF-22 (MEDIUM) — `bucketCostLinesForRecognition` not unit-tested

**Where:** `server/lib/finance/recognition-bucketing.ts`. Used by 10+ routes. Currently tested only through integration. A regression in filtering or month-key extraction would silently drift monthly aggregates.

**Severity:** MEDIUM.

**Status:** **Not fixed in this PR.** Test gap; recommend a `recognition-bucketing-unit.test.ts` covering filter, zero-amount exclusion, month-key, suffix-strip.

---

## 24. DF-23 (MEDIUM) — `isRevenueSettled` AR classification not unit-tested

**Where:** `server/lib/finance/revenue-ar-status.ts`. Settlement predicate used by AR aging and Milestone Tracker. No unit test.

**Severity:** MEDIUM.

**Status:** **Not fixed in this PR.** Test gap.

---

## 25. DF-24 (MEDIUM) — Smart Import silently accepts closed / held projects

**Where:** `server/smart-import-routes.ts` / `server/importPipeline.ts`. No check on `project_status` before processing. A user could upload an old tracker for a closed project and overwrite the frozen books without warning.

**Severity:** MEDIUM. Operational risk.

**Status:** **Not fixed in this PR.** Owner UX decision: hard-block, warn-with-override, or no-check.

---

## 26. DF-25 (MEDIUM) — `internal` / `tbc` project status semantics undefined

**Where:** `projectStatusEnum` has these values but no code path checks them; they're treated identically to `active`. Internal R&D project costs flow into FY COS totals.

**Severity:** MEDIUM. Distorts portfolio totals if internal projects exist.

**Status:** **Not fixed in this PR.** Owner decision on whether these statuses should appear in finance aggregates.

---

## 27. DF-26 (MEDIUM) — Reconciliation contract tests missing

**Where:** `qa/tests/unit/`. No explicit test pins:
- Per-project POC parity vs persisted col U (within R1)
- Portfolio total = SUM(project totals), NOT pooled
- FY total = SUM(monthly totals) with no leakage
- Project total = SUM(per-line totals)

**Severity:** MEDIUM. Multi-level aggregation contract is the spine of finance correctness.

**Status:** **Not fixed in this PR.** Test gap; recommend `qa/tests/unit/finance-reconciliation-contracts.test.ts`.

---

## 28. DF-27 (MEDIUM) — QB cascade age summary endpoint not tested

**Where:** `GET /api/quickbooks/cascade-proposals/summary` from PR #943. No API test pins the age-bucket logic.

**Severity:** MEDIUM.

**Status:** **Not fixed in this PR.** Test gap.

---

## 29. DF-28 (HIGH) — Permission gate dual-assertion tests missing

**Where:** finance-permission gates broadly. There's no 403/200 dual-assertion (an unauthorized role gets 403; an authorized one gets 200) for the 22 endpoints migrated in PR #943.

**Severity:** HIGH. Regression risk on confidentiality and on legitimate access.

**Status:** **Not fixed in this PR.** Needs a test DB + user fixtures. Recommend `qa/tests/api/finance-permission-gates.test.ts`.

---

## 30. DF-29 (MEDIUM) — Future paidDate validation has no test

**Where:** F-5 from PR #943 added the Zod refinement at `finance-legacy-extracted-routes.ts:1182–1196`. No test verifies the rejection.

**Severity:** MEDIUM. Easy to regress.

**Status:** **Not fixed in this PR.** Test gap.

---

## 31. DF-30 (LOW) — Rounding asymmetry between QB tolerance (R1) and allocation tolerance (R0.01)

**Where:** `quickbooks-reconciliation-service.ts:56` `AMOUNT_TOLERANCE = 1` vs `qb-allocation.ts:1` `QB_ASSIGNMENT_TOLERANCE_EX_VAT = 0.01`. A QB bill of R1000 split across 10 cost lines (R100 each) sum to R1000.10 with per-line rounding — passes the R1 tolerance but each allocation could be tested at R0.01.

**Severity:** LOW. Cumulative drift bounded.

**Status:** **Not fixed in this PR.** Documentation only.

---

## 32. DF-31 (LOW) — Per-line rounding in QB allocation

**Where:** `qb-allocation.ts:70–71`. Each line rounded with `toFixed(2)` then summed. Over 100 allocations the cumulative drift is bounded by R0.50.

**Severity:** LOW. Within tolerance.

**Status:** **Not fixed in this PR.**

---

## 33. DF-32 (LOW) — Cashflow series lacks `isReversal` / `transactionType` flag

**Where:** `cashflowPoints` schema. A refund / reversal carries a negative value but no flag. Cannot filter "show only reversals".

**Severity:** LOW. Data is correct; metadata missing.

**Status:** **Not fixed in this PR.**

---

## 34. DF-33 (LOW) — No "refund received" state on revenue lines

**Where:** `revenueLineStatusEnum` lacks a `refund` / `reversal` value.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 35. DF-34 (LOW) — `previousMonthFirst` variable naming confusing

**Where:** `server/lib/finance/period-lock.ts:101–108`. `prevM` is 1-indexed despite the variable suggesting it tracks the previous 0-indexed month. Logic is correct; reading is confusing.

**Severity:** LOW (cosmetic).

**Status:** **Fix applied in this PR.** Renamed to `prevM1Indexed` with a comment.

---

## 36. DF-35 (LOW) — VAT input-tax-credit recovery not modeled

**Where:** schema has no `inputTaxRecoverable` or `vatRecoveryStatus`. May be intentionally out of scope (CFO/accounting layer).

**Severity:** LOW. Out of scope check.

**Status:** **Not fixed in this PR.**

---

## 37. Fixes applied in this PR

| # | Finding | What changed | Files | Risk |
|---|---------|-------------|-------|------|
| 1 | DF-3 | Consolidated SAST `currentMonthKey` helper; switched 6 UTC-anchored sites to use it. Eliminates the 2-hour-per-day dashboard/drilldown divergence at month boundaries. | `server/lib/finance/timezone-helpers.ts` (new), `server/departments/finance-routes.ts` (6 sites) | Low — pure correctness, no formula change |
| 2 | DF-6 | Added a `category_total_non_positive` guard in `finance-line-level-repository.ts`. When a category's total actual is ≤ 0, `perLineRevenue` is forced to 0 and a derivation warning surfaces, instead of producing reversed-sign revenue. Test pinned. | `server/repositories/finance-line-level-repository.ts`, `qa/tests/unit/finance-line-level.test.ts` | Low — only fires in a rare edge case |
| 3 | DF-9 | Snapshot regression test pinning the 22 PR #943 RBAC gates by source-text. | `qa/tests/unit/finance-rbac-pr943-snapshot.test.ts` (new) | None — test only |
| 4 | DF-13 | `getFYRange` and `getFyWindow` switched to SAST-anchored month calculation; works on any process timezone. | `server/lib/home-helpers.ts`, `server/lib/fy-window.ts` | Low — only changes the Aug 31 / Sep 1 boundary behaviour on a UTC server |
| 5 | DF-14 | Runtime warning when `STATIC_COS_BUDGET_FY26` is consulted outside its keyed FY range. Doesn't change values; surfaces drift to logs. | `server/lib/calculations/financeUtils.ts` | None — log-only |
| 6 | DF-20 | Unit tests for `getCosRealisationWarnings` covering each warning code. | `qa/tests/unit/cos-realisation-warnings.test.ts` (new) | None — test only |
| 7 | DF-34 | `prevM` renamed to `prevM1Indexed` in `previousMonthFirst` for readability. Behaviour unchanged. | `server/lib/finance/period-lock.ts` | None — cosmetic |
| 8 | DF-2 docs | Updated `audit/FINANCE_AUDIT_2026-05-26.md` to flag the missing `derived_project_kpis` writer alongside the existing F-1 Phase 2 hand-off. | this file + the V1 doc | None |

---

## 38. Deferred to follow-up PRs (owner decisions / architectural)

| # | Finding | Why deferred | Decision needed |
|---|---------|--------------|-----------------|
| DF-1 | Project_status filter on aggregates | Changes numbers users see; some "All projects" views may be intentional | Should closed / hold / internal / tbc projects appear in current-FY totals? |
| DF-2 | derived_project_kpis writer | Need to know what populates it today | Identify the external writer, or build an in-app materializer |
| DF-4 | USD exchange rate not applied | Depends on Excel convention (Case A vs B) | Confirm: is `amount_ex_vat` already ZAR-equivalent, or does it need conversion? |
| DF-5 | VAT NULL tax behaviour | UX trade-off (inflated value with badge vs null) | CFO call |
| DF-7 | QB approve flow transaction wrapping | Architectural | Wrap in transaction vs make detection idempotent |
| DF-8 | Smart Import concurrent run scoping | Architectural | Scope cleanup by `import_run_id` |
| DF-10 | F-1 Phase 2 priority materializer | Blocked by DF-2 | n/a until DF-2 resolved |
| DF-11 | Optimistic concurrency on edits | Schema change + UI handshake | Adopt `If-Match: <updatedAt>` pattern |
| DF-12 | Bridge sync sync/async | Architectural | Stay fire-and-forget with a lag indicator, or sync the critical paths |
| DF-15 | Holiday cache TTL | Operational trade-off | 1h cache + manual refresh vs shorter TTL |
| DF-16 | invoiceDate > paidDate | Import UX | Promote to BLOCKER vs keep as WARNING |
| DF-17 | Partial-payment state | Schema addition + writer changes | Add `payment_status` / `partial_paid_amount` columns |
| DF-18 | Multi-currency | Schema decision | Add `currency_code` + rate table |
| DF-19 | VAT rate changes | Schema decision | Add `vat_rate_pct` + `vat_changed_at` |
| DF-21 | Cost/revenue CRUD audit-event tests | Needs test DB setup | Spin up the API test harness for finance |
| DF-22 | bucketCostLinesForRecognition unit test | Test gap | Author a unit test file |
| DF-23 | isRevenueSettled unit test | Test gap | Same |
| DF-24 | Smart Import accepts closed projects | Owner UX call | Block / warn / no-check |
| DF-25 | internal / tbc status semantics | Owner decision | Filter rules |
| DF-26 | Reconciliation contract tests | Test gap | Author `finance-reconciliation-contracts.test.ts` |
| DF-27 | QB cascade age summary test | Test gap | Author API test |
| DF-28 | Permission-gate dual-assertion tests | Needs test DB + user fixtures | Spin up the API harness |
| DF-29 | Future paidDate validation test | Test gap | Trivial; bundle with DF-21 |

---

## 39. Could-not-verify items

- **DF-2 writer identity:** the agent could not find a writer in the codebase; the cache may be populated by an external Replit cron or an old backfill script. Until the writer is identified, every consumer of `derived_project_kpis` is reading data of unknown freshness.
- **DF-4 tracker convention:** without the actual Excel tracker workbook in front of me, I can't tell whether `amount_ex_vat` already holds ZAR-equivalent or raw USD. The fix path depends on which convention.
- **Tests:** `npm run check` passes locally with all changes; `npx vitest run` passes the finance unit tests I exercised; full API/integration suites need a DB that isn't available in this sandbox.

---

## 40. Recommended next steps

1. **Decide DF-1 (project_status filter) and DF-2 (derived_project_kpis writer)** — both are HIGH and blocking other work.
2. **Confirm DF-4 (USD convention)** — one-line answer from the owner; could be a 5-minute fix or a major refactor.
3. **Apply DF-7 / DF-8 transactional fixes** — they're architectural but each is bounded.
4. **Land the test-coverage gap PR** — DF-21, DF-22, DF-23, DF-26, DF-27, DF-28, DF-29. All test-only; low risk.
5. **Land the audit-event / RBAC dual-assertion PR** — DF-21, DF-28. Compliance-critical.
6. **Land the schema additions PR** — DF-17, DF-18, DF-19 if owner accepts (additive columns; needs `db:migrate` approval).

This V2 audit makes the next-decision points explicit; the V1 audit already proved the formulas are right. The work that remains is hardening the system around those formulas.

*End of V2 audit.*
