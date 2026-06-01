# RECON_FINDINGS.md — Why monthly Planned/Realised COS·REV·GP don't match the trackers

**Mode:** read-only diagnosis. No application code changed.
**Companion:** `IMPORTER_AUDIT.md` (importer/colour/classification audit) and the harness
`qa/audit/importer-canonical-recon.ts`.
**Environment limit:** fresh ephemeral clone — no `node_modules`, no DB, no data snapshot.
The exact per-month numbers can only be tied on the live snapshot, so this report
**locates the mechanisms with file:line** and ranks them by likely impact; precise
dollar attribution per cause is marked **UNKNOWN (run the harness on the snapshot)**.

The reported view is the **GP-company page** (`client/src/pages/finance-gp-company.tsx`,
"Budget → Planned → Realised" tab) which calls **`/api/cos-tracker`** and
**`/api/revenue-tracker`** (`server/departments/finance-routes.ts`). All findings below are
on that live path.

---

## TL;DR

* **Symptom (a) — "Planned == Realised for closed months" is real and explained.** The
  "Planned" grid value is **not an independent budget/forecast**; it is the *all-states
  actual* total `cosPlanned = realisedCOS + committedCOS + plannedCOS`
  (`finance-routes.ts:2710`). Because the **past-month auto-realise** rule (Finding C1 in
  IMPORTER_AUDIT) drives `committedCOS → 0` for every closed month, `cosPlanned` collapses
  to `realisedCOS` whenever a closed month also has no no-invoice lines — which is exactly
  Sep 2025–Mar 2026. It only diverges Apr/May where current-month red (committed) and
  no-invoice (planned) lines survive. So "Planned" is cosmetic for closed months. (Plus an
  explicit budget→actual snap in the FYE dashboard — see §2.)
* **Symptom (b) — month drift is timing + state, not an amount-grain gap.** The tracker
  aggregates COS at the **actuals-line grain** with the child's `Actual Total`
  (`mergeLineLevelCostLines`, `finance-expense-engine-repository.ts:659`), so the COS
  *amount* matches truth. The drift comes from **(1) which month a line lands in** — the
  stored `invoiceDate` is `raw col T ?? EOMONTH(FINANCE PAYMENT DATE)`
  (`normalizer.ts:1534`), so for blank-col-T lines the recognition month is driven by the
  payment date — and **(2) the past-month auto-realise state rule** inflating "Realised" in
  some months (Sep) vs the black-only truth. A **revenue-recognition grain bug** (parent
  col U inherited per child; child col U dropped — §1.4) is the leading cause of the
  **YTD REV** shortfall.
* The agent-style hypothesis that the **UTC `cosCurrentMonthKey`** (`finance-routes.ts:2583`)
  causes the Sep/Feb drift is **incorrect** for *closed* months (month keys are string-sliced
  and timezone-safe); it only affects the *open*-month boundary and COS-vs-REV endpoint
  consistency. Reported as a minor issue, not the drift cause.

---

## 1. Root cause(s) of the month drift (Symptom b)

### 1.1 The reported path and its grain (verified)
`/api/cos-tracker` reads `financeExpenseRepository.listAllActiveCostLines()`
(`finance-routes.ts:2532`). That method merges parents with their `normalized_cost_line_actuals`
children via `mergeLineLevelCostLines` (`finance-expense-engine-repository.ts:346-371, 637-668`):
one output row **per actuals child**, where

```
finance-expense-engine-repository.ts:659  amountExVat: child.actualTotal != null ? String(child.actualTotal) : p.amountExVat,
finance-expense-engine-repository.ts:662  invoiceDate: child.invoiceDate ?? p.invoiceDate ?? null,
```

So COS amount = **child `Actual Total`** and the bucket date = **child `invoiceDate`** — the
same grain and amount as the independent "truth". **The COS *amount* is therefore not the
source of the gap.** (This corrects an intuitive "parent vs child amount" hypothesis — the
merge is line-level.)

### 1.2 ROOT CAUSE A — recognition month is driven by `EOMONTH(FINANCE PAYMENT DATE)` when col T is blank
The bucket date is the stored `invoiceDate`, sliced to a month (`finance-routes.ts:2617-2621`,
no fallback to payment date at read time — `getCosEffectiveDateAndSource` is invoice-date-only,
`expense-row-selector.ts:137-138`). **But the stored `invoiceDate` itself is payment-derived
when col T is empty**, at import:

```
normalizer.ts:1534   const invoiceDate = rawInvoiceDate ?? lastDayOfMonthFromDate(paidDate);   // parent
normalizer.ts:1393   const orphanInvoiceDateResolved = orphanInvoiceDate ?? lastDayOfMonthFromDate(orphanPaidDate); // 1:N child
```

`INVOICE RAISED DATE` (col T) in the template is the formula `IF(FINANCE_PAYMENT_DATE>1,
EOMONTH(FINANCE_PAYMENT_DATE,0),"")` (comment `normalizer.ts:1528-1533`). When the workbook is
saved **without cached formula results**, col T reads blank and the app substitutes
`EOMONTH(finance payment date)`. **Consequence:** for every such line the *recognition month
follows the finance payment date, not a true invoice-raised date.* If the independent "truth"
reads a different invoice-raised date (e.g. a cached col T value, or a manually typed date that
differs from EOMONTH(payment)), the line lands in a different month → the **Sep-high / Feb-low**
signature. This is Hypothesis #1 from the brief, realised at **import time** rather than in the
read path. **Impact: timing (moves COS/REV between months); can also push a line across the
May→Jun FY edge, reducing YTD.** Exact magnitude **UNKNOWN** without the snapshot — the harness
isolates it (it buckets the same realised lines by invoice-date vs payment-date).

### 1.3 ROOT CAUSE B — past-month auto-realise inflates "Realised" in some months
`/api/cos-tracker` confirms a closed-month invoiced line **regardless of colour**:

```
finance-routes.ts:2628-2635
  const isPastMonth = monthKey < cosCurrentMonthKey;
  const invoiceDateConfirmed = !!row.invoiceDate &&
    (row.invoiceDateFontColor === 'black' || row.invoiceDateConfirmed === true || (isPastMonth && hasInvoice));
```

The revenue tracker does the same via `isEffectivelyRealisedLocal` →
`isPastMonthAutoRealised` (`recognition-bucketing.ts:69`, `cos-realisation.ts:194-206`). The
**truth** here is "invoice present **AND black**", so the app's Realised set is a *superset*
of truth in closed months (it adds the **red** lines). This pushes app-Realised **up** in
months with red invoiced lines (e.g. Sep `+R1.0m`) and partially offsets the Root-Cause-A/C
understatement elsewhere — explaining why the net is a modest, mixed-sign drift rather than a
clean over- or under-count. **Impact: state (moves amounts between Realised and Committed).**

### 1.4 ROOT CAUSE C — revenue recognition uses the PARENT col U for every child (1:N bug)
The line-level merge overrides amount/dates with child values but **not**
`revenueRecognitionAmount` — and `ChildActualRow` doesn't even fetch it:

```
finance-expense-engine-repository.ts:628-635   interface ChildActualRow { costLineId; actualTotal; poNumber; invoiceNumber; invoiceDate; financePaymentDate }   // no revenueRecognitionAmount
finance-expense-engine-repository.ts:657-664   out.push({ ...parent, amountExVat: child.actualTotal, ... });   // revenueRecognitionAmount stays = parent's
```

The revenue tracker then sums `recognitionAmountFor(exp)` = `exp.revenueRecognitionAmount`
(parent's col U) **once per child** (`finance-routes.ts:5946-5955`, `revenue-recognition.ts:67-71`).
For a BOQ line settled across N invoices (N actuals children) this **repeats the parent's
col U N times and drops each child's own col U** (the child's `revenue_recognition_amount`
captured at `normalizer.ts:1395` is never read here). Net revenue for that line = `parentColU × N`
instead of `Σ child colU`. The sign of the error is data-dependent, but dropping the orphan
children's own recognition is the **leading explanation for the YTD REV shortfall (≈ −R3.0m)**.
Note this is **inconsistent with the dashboard path**, which reads the child's own col U
(`finance-line-level-repository.ts:251`) — so the two surfaces disagree for multi-invoice lines.
**Impact: revenue magnitude (YTD and monthly).** Magnitude **UNKNOWN** without the snapshot.

### 1.5 Things that are NOT the cause (ruled out by code)
* **COS-without-revenue lines are NOT dropped.** `bucketCostLinesForRecognition` skips only
  zero-*amount* and no-month rows (`recognition-bucketing.ts:92,96`); a line with
  `revenueRecognitionAmount = 0 / noRevenueLinked` keeps its COS and contributes `revenue 0`
  (`revenue-recognition.ts:69`). So the ~R13.4m COS-without-revenue stays in COS. (Hypothesis #4
  is not a COS-drop.)
* **UTC `cosCurrentMonthKey`** (`finance-routes.ts:2583`) does not move closed-month buckets
  (month keys are `String(date).match(/^\d{4}-\d{2}/)` slices, `:2619`; `extractMonthKey`
  `financeUtils.ts:66-71` — pure string, no tz). It only shifts the *current-month* boundary and
  differs from the revenue tracker's SAST key (`:5940`) — a **cross-endpoint inconsistency**
  (minor), not the Sep/Feb drift.

### 1.6 Scope (Hypothesis #3) — confirm, likely a superset not a subset
The trackers aggregate **all live cost lines that have a project name**
(`finance-routes.ts:2625-2626`); there is **no project-status filter** —
`filterActiveProjectIds` / `DEFAULT_FINANCE_PROJECT_STATUSES` (`project-filters.ts:22`) exist but
are **not applied** here. So the set is "every project with live cost lines", which is more
likely a **superset** (could include internal/closed/tbc) than the canonical
Active + 02-Past Clients + 1.Compliance Handover. A superset would *overstate*, so scope is
unlikely to explain the net *understatement* — but the set is undefined and should be pinned.
**UNKNOWN** whether it equals the ~67-project canonical set without enumerating projects on the snapshot.

---

## 2. The Planned write-path finding (Symptom a)

**"Planned" is not an independent plan — it is the all-states actual total, and it degenerates
to Realised for closed months because of past-month auto-realise.**

* **COS "Planned"** (`finance-routes.ts:2697-2715`):
  ```
  const plannedCOS = plannedBucket?.total ?? 0;              // no-invoice lines (actual amounts)
  const cosPlanned = realisedCOS + committedCOS + plannedCOS; // "COS Planned" grid row = all states
  ```
  With Root Cause B, closed-month `committedCOS → 0` (every invoiced line auto-realises), so
  `cosPlanned = realisedCOS + plannedCOS`. For Sep–Mar the no-invoice `plannedCOS` is evidently
  ~0, so **`cosPlanned == realisedCOS`** → Planned == Realised. Apr/May retain red current-month
  (committed) and/or no-invoice (planned) lines, so Planned > Realised (May ≈ +R3.0m, Apr ≈ +R0.9k).
* **Revenue "Planned"** = `revByMonth.total` (all-states col-U revenue), with `realisedByMonth`
  the realised subset (`finance-routes.ts:5946-5963`). Same degeneration under Root Cause B.
* **It is NOT literally copied from Realised at month-close** in the GP grid — the equality is a
  *structural consequence* of "Planned = all states" + auto-realise. The effect is identical:
  **Planned cannot show plan-vs-actual variance for closed months, and the view looks reconciled.**
* **An explicit "use actual as planned for past months" DOES exist** in the FYE dashboard:
  ```
  fye-revenue-tracking-routes.ts:765-769
    const adjustedBudgetRev = isPastOrCurrent ? capturedRev : budgetRev;
    const adjustedBudgetCos = isPastOrCurrent ? capturedCos : budgetCos;
  ```
  i.e. closed/current months snap "Adjusted Budget" to captured actuals.
* **The real "Budget" column is a static hardcoded map** `STATIC_COS_BUDGET_FY26`
  (`finance-routes.ts:2665, 2721`), and variance is `cosPlanned − budget` (`:2731`) — so neither
  "Budget" nor "Planned" is derived from the trackers' costed side (col G budget / col J revenue
  allocation).
* **An independent per-line plan baseline already exists but is unused here**:
  `finance-line-level-repository.ts` computes `plannedRevenue` / `plannedGp` from `budgetTotal`
  (col G) and `category.revenueAllocation` (col J) — the GP grid does not consume it for the
  "Planned" row.
* **"Reconciles ✓"** (`client/src/components/finance/DrillReconciliationFooter.tsx:46-47`)
  compares a hero **YTD** value vs the **sum of monthly drilldown** values (internal
  consistency), **not Planned vs Realised**. So a green badge does not attest plan-vs-actual.

> **Design-bug flag:** the "Planned" row should be the independent budget/forecast baseline
> (the col-G/col-J plan already computed in `finance-line-level-repository`), not the all-states
> actual total. As built, "Planned" is structurally unable to surface variance for closed months.

**Side note (latent pivot risk):** `finance_revenue_monthly` / `finance_cos_monthly` are written
by the **legacy** `server/excelParser.ts` from the workbooks' **`Finance - Revenue` / `Finance - COS`
PIVOT sheets** (the stale surfaces IMPORTER_AUDIT says must not be a data source). The live GP/FYE
view does **not** read them today (it recomputes from normalized lines), but any future reader of
those monthly tables would be sourcing from the stale pivots. Flagged, not currently firing.

---

## 3. Reconciliation script

`qa/audit/importer-canonical-recon.ts` (added with `IMPORTER_AUDIT.md`; **exceljs-only, no DB**)
recomputes **Realised COS/REV/GP per month** straight from the raw `Expenditure Breakdown` lines
using the truth rules (COS = `Actual Total`, REV = col U else `(Q/X)*J`, GP = REV−COS;
Realised = invoice present + **BLACK**; month = `INVOICE RAISED DATE`). It now also buckets the
*same* realised lines **by INVOICE RAISED DATE vs FINANCE PAYMENT DATE** and prints the per-month Δ,
which directly tests Root Cause A.

```bash
npx tsx qa/audit/importer-canonical-recon.ts --as-at 2026-06-01 --fy-start 2025-09-01 --fy-end 2026-08-31
```

Expected use:
* The **"REALISED BY MONTH … @invoice-date"** column reproduces the brief's **truth** column
  (within rounding) on the real workbooks.
* If the app's `/api/cos-tracker` monthly numbers match the **@payment-date** column instead
  (Sep higher, Feb lower), Root Cause A (EOMONTH(payment) month) is confirmed as the driver.
* To diff against the **app**, run `/api/cos-tracker` + `/api/revenue-tracker` on the same DB
  snapshot and subtract — requires a populated DB (not available in this container).

**Cannot run here** (no `node_modules`/DB). The script is provided to run where the snapshot lives;
it is the executable form of the truth column and the Root-Cause-A isolation.

---

## 4. Ranked fixes (smallest change first — do NOT apply yet)

1. **Fix Root Cause C (revenue 1:N grain) — small, high trust.** Add `revenueRecognitionAmount`
   to `ChildActualRow` + the actuals query (`finance-expense-engine-repository.ts:357-362, 628-635`)
   and have `mergeLineLevelCostLines` (`:657-664`) carry the **child's own** col U. This stops the
   per-child parent-col-U repetition and the dropped orphan revenue — the likely bulk of the
   YTD REV gap — and makes the GP page agree with the dashboard.
2. **Point the GP-company "Planned" row at the real budget baseline.** Consume
   `finance-line-level-repository` `plannedRevenue`/`plannedGp` (col G/I) for the "Planned"
   column instead of `cosPlanned = realised+committed+planned`. Restores genuine plan-vs-actual
   variance for closed months (fixes Symptom a). Medium change, no schema.
3. **Resolve Root Cause B (past-month auto-realise)** per IMPORTER_AUDIT C1: colour-gate
   realisation for all months; make any "reconcile-to-QB" promotion an explicit, visible state.
   Removes the Realised inflation *and* the Planned≡Realised degeneration in one move.
4. **Fix Root Cause A (date provenance).** Stop deriving the recognition month from
   `EOMONTH(finance payment date)` when col T is blank (`normalizer.ts:1534, 1393`); require a real
   `INVOICE RAISED DATE` (flag blank-col-T lines for exclusion per IMPORTER_AUDIT rule 16) or store
   planned/actual dates separately and bucket strictly on the actual invoice-raised date.
5. **Unify the current-month key on SAST** (`finance-routes.ts:2583` → `sastCurrentMonthKey()`,
   matching `:5940`) so COS and REV endpoints share the open-month boundary.
6. **Apply an explicit project-scope filter** (Active + 02-Past Clients + 1.Compliance Handover)
   in the tracker queries so the aggregated set is defined, not "all live lines".

---

## 5. What's UNKNOWN (needs the snapshot)

* The **dollar split** between Root Causes A (timing), B (state), and C (revenue grain) — run the
  harness + `/api/cos-tracker` diff on the live DB.
* Whether the tracker's project set equals the canonical Active + Past + Compliance (~67) — enumerate
  on the snapshot.
* How many lines have **blank col T** at import (drives Root Cause A magnitude) and how many parents
  are **multi-invoice** (drives Root Cause C magnitude).
