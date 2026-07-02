# IMPORTER_AUDIT.md — Tracker Importer & COS / REV / GP / Cashflow Audit

**Scope:** read-only audit of how the app ingests the project trackers and computes
COS, Revenue, GP and cashflow, reconciled against the canonical model in the task brief.
**Mode:** read-only. No application code was changed. This document and the
reconciliation harness at `qa/audit/importer-canonical-recon.ts` are the only added files.
**Auditor run date:** 2026-06-01 (the “as-at” date matters — see Finding C1).
**Environment limitation:** this is a fresh ephemeral clone with **no `node_modules`,
no `.env`, and no database**, and no live data snapshot. The app pipeline therefore
could not be executed end-to-end here. Per the brief’s fallback (“if data has moved,
reconcile methodology + a fixed sample instead”), Part 4 reconciles by **methodology +
a worked sample**, and ships a runnable harness for an environment that has the snapshot.

> **One-line verdict:** The *plumbing* is largely correct and trustworthy — fonts are
> read (it uses **exceljs**, not the colourless SheetJS build), columns are resolved by
> **header text**, COS=`Actual Total`, REV=`Revenue Recognition Amount` (col U), recognition
> buckets on `INVOICE RAISED DATE`, cashflow keys off payment dates, snapshot guards are in
> place, and the in-sheet pivots are never read. **But one deliberate rule —
> “past-month auto-realise” — silently overrides the red/black signal for every closed
> month, which (as-at 1 Jun 2026) is 11 of the 12 FY months.** That single rule
> reclassifies *Committed* COS/REV as *Realised* and is the dominant source of divergence
> from the canonical model. See **C1**.

---

## Part 1 — Data-flow map (source sheet/column → parse → transform → DB field → metric)

### 1.1 Ingestion (discovery / fetch)

| Stage | Where | Notes |
|---|---|---|
| Manual upload | `server/smart-import-routes.ts:282-295` (`multer` memory storage, `fileFilter`) | Accepts `.xlsx` / `.xlsm` only (mimetype or extension). |
| Scheduled folder ingest | `server/services/scheduled-import-v2.ts:290-439` | Lists a configured SharePoint folder, processes each file, inserts as `awaiting_review`. Interval from `sp_settings.intervalMinutes` (default 30). |
| Auto-fetch / hydration | `server/sharepoint.ts:643-653` `downloadFileContent()` → `.../items/{id}/content` → full `arrayBuffer` → `Buffer` | **Full download before parse** (no streaming/partial). Hash computed on the full buffer (`scheduled-import-v2.ts:114`). |
| File-name / type match | `server/sharepoint.ts:550-552` `isTrackerWorkbookName` = `/\.(xlsx\|xlsm\|xls)$/i`; project name parsed in `server/lib/import/project-match.ts:17-29` (strips everything after “tracker”, version suffixes) | **No `~$` lock-file or “conflicted copy” exclusion; no HSE/Safety content filter.** (Finding M2) |
| Dedupe | `server/lib/import/project-match.ts:176-193` `checkRerunProtection` (by **file SHA-256 hash**); pruning `smart-import-routes.ts:235-264` (keep current + 2 committed runs/project) | Dedupe is **hash-identity only**, not “one latest-modified tracker per project / ignore older revisions”. (Finding M2) |
| Scope selection | configured folder path only (`spSettings`); `sharepoint.ts:573-601` lists `file ne null` | **No Active / Past Clients / Compliance-Handover status filtering in code** — operator must point the folder at the right scope. (Finding M2) |

### 1.2 Parse (library, sheets, columns, colour)

* **Library:** `exceljs ^4.4.0` (`package.json`). This is the community feature that
  **does** expose `cell.font.color` — the chief reason the colour trust-check can pass.
* **Sheet detection:** `server/lib/import/detector.ts:82-233`. Header row is found by
  *scoring* each row against section anchor + synonym phrases (`scoreRowAsHeader:82-109`),
  not by a fixed row index. Sections: `PLAN`, `REVENUE` (`Revenue Tracking`),
  `EXPENDITURE` (`Expenditure Breakdown`) — `server/lib/import/synonyms.ts:92-108`.
  The in-sheet `Finance - COS` / `Finance - Revenue` pivots are **not** in the anchor
  set and are never parsed; PO sheets are explicitly skipped (`normalizer.ts:1797`).
* **Column resolution — by HEADER TEXT** (`server/lib/import/mapper.ts:28-236`):
  `findBestMatch` tries **exact** synonym (conf 1.0) → **substring** synonym (0.9) →
  **fuzzy** Levenshtein/Dice ≥ 0.5 (≤0.85) → learned mappings from `mapping_rules`.
  `getColIndex(mapping, canonicalField)` (`normalizer.ts:509-512`) returns the resolved
  index. **No fixed-letter assumption** — shifted templates resolve correctly.
* **Font-colour read** (`server/lib/import/normalizer.ts:534-596`):
  `getCellFontColor` → `extractFontColorHex` (ARGB / RGB / theme) → `classifyColorHex`
  (`isBlack = r<40&g<40&b<40`; `isRedish = r>150&g<80&b<80`). **Missing font, no
  `font.color`, theme 0/1, unresolvable, or extraction error all default to BLACK /
  confirmed** (`:581-595`). Colour is read from the *invoice-date* cell and the
  *paid-date* cell specifically (`:1599-1608` cost, `:1147-1156` revenue).

### 1.3 Field extraction → DB

**Expenditure Breakdown (cost + recognised revenue):** `normalizer.ts:1232-1716`

| Canonical field | Header synonym(s) | Parsed at | Stored on |
|---|---|---|---|
| COS = `Actual Total` | `actual total / actual amount / actual cost / actual` (`synonyms.ts:65`) | `:1259, :1389/1428` | `normalized_cost_line_actuals.actual_total` (child) / `normalized_cost_lines.amount_ex_vat` (parent) |
| REV = `Revenue Recognition Amount` (col U) | `revenue recognition amount …` (`synonyms.ts:75`) | `:1620 parseNumber(row[revenueRecogCol])` | `…actuals.revenue_recognition_amount` / `…cost_lines.revenue_recognition_amount` |
| `invoice_no` | `invoice number / invoice no …` (`synonyms.ts:68`) | `:1524` | `…invoice_number` |
| `invoice_date` (col T, drives recognition month) | `invoice raised date / invoice date …` (`synonyms.ts:69`) | `:1525, :1534` (blank → `EOMONTH(finance payment date)` replica) | `…invoice_date` |
| `finance_payment_date` (drives cash-OUT) | `payment date / paid date / finance payment date` (`synonyms.ts:71`) | `:1527` | `normalized_cost_lines.paid_date` / `…actuals.finance_payment_date` |
| invoice-date colour | — | `:1600-1602` (`getCellFontColor`) | `normalized_cost_lines.invoice_date_font_color` + `invoice_date_confirmed` (**parent only**) |
| category revenue allocation (col J) | `total revenue / revenue allocation …` (`synonyms.ts:78`) | `:1469-1506` (positional fallback `HEADER_ERROR_POSITIONAL`) | `category_revenue_allocations.revenue_allocation` |

**Revenue Tracking (client billing / receipts → cash-IN):** `normalizer.ts:1000-1165`

| Canonical field | Header synonym(s) | Parsed at | Stored on |
|---|---|---|---|
| `value` = `VALUE` | `value / amount / value (excl. vat)` (`synonyms.ts:36`) | `:1073` | `normalized_revenue_lines.amount_ex_vat` |
| `planned_date` = `PLANNED PAYMENT DATE` | `planned payment date / planned date …` (`synonyms.ts:40`) | `:1079` | `…expected_payment_date` |
| `received_date` = `PAYMENT RECEIVED DATE` | `payment received date / received date / paid date` (`synonyms.ts:41`) | `:1080` | `…paid_date` |
| received-date colour | — | `:1152-1156` | `…paid_date_font_color` + `paid_date_confirmed` |

**1:N actuals (a BOQ line settled across several invoices):** `normalizer.ts:1379-1438`
emits extra `normalized_cost_line_actuals` rows (right-pane-only rows attached to the
last costed parent). These children store amount/date/col-U but **no font-colour column**
(`shared/schema/finance.ts:779-823`) — colour lives on the parent only. (Finding M1)

### 1.4 Classification (Realised / Committed / Planned / Unrealised)

The canonical predicate is `isCanonicalCosRealised()`
(`server/lib/finance/cos-realisation.ts:76-124`) — and it is **correct**: invoice present
+ (`invoice_date_font_color==='black'` OR `invoice_date_confirmed===true`) ⇒ realised; red ⇒
not realised (`:104-113`). Its own docstring even restates the rule “‘Committed from prior
month’ does NOT silently become realised unless it has an invoice + black-font date”
(`:60-62`).

**However, the reporting surfaces do not classify periods with that predicate.** They call
the wrapper `isEffectivelyRealised()` (`cos-realisation.ts:224-232`):

```
isEffectivelyRealised = isPastMonthAutoRealised(exp, monthKey, currentMonthKey)
                        OR (isCanonicalCosRealised(exp) AND monthKey <= currentMonthKey)
```

and `isPastMonthAutoRealised` (`:194-206`) returns **true for any invoice-bearing,
non-placeholder, non-overridden line whose recognition month is strictly before the current
month — regardless of font colour.** The GP / portfolio path reimplements the same idea in
`finance-line-level-repository.ts:159-178` (`classifyBucket`, `confirmed = black || confirmed
|| isPastMonth`). This is **Finding C1** (below).

There is **no canonical “Unrealised” bucket**: `classifyBucket` returns only
`planned | committed | realised` and folds no-invoice lines into `planned`
(`finance-line-level-repository.ts:27, :166-167`); a separate, *differently-defined*
“unrealised = planned + committed” exists in `finance-routes.ts:2711-2945`. (Finding H1)

### 1.5 Aggregation (period / state, cashflow)

* **Per-line REV / GP** (single source of truth per §3.3.2):
  `finance-line-level-repository.ts:579-708`. `perLineRevenue` = **persisted col U if > 0**
  (`:604-609`), else the POC formula `(actualTotal/categoryTotalActualTotal)*revenueAllocation`
  (`:636`); `perLineGp = perLineRevenue − actualTotal` (`:639`). Category total `X` is summed
  **per project** (`:556-563`, never pooled). Snapshot guards on all three reads
  (`:257, :292, :312`).
* **Recognition month** = `INVOICE RAISED DATE` only (`:582-587, :700-702`); lines outside
  `[fyStart,fyEnd]` (filtered on that date) are dropped (`:127-133, :587`).
* **Monthly COS/REV/GP** for the COS/Revenue trackers: `bucketCostLinesForRecognition`
  (`recognition-bucketing.ts:80-105`) using `getCosEffectiveDateAndSource` (invoice-date-first,
  `expense-row-selector.ts:137-138`) and `recognitionAmountFor` (reads col U,
  `revenue-recognition.ts:67-71`). Consumed in `finance-routes.ts:5362-6230`,
  `fye-revenue-tracking-routes.ts:597`, etc.
* **Cashflow OUT:** cost line, effective date = payment-first
  (`expense-row-selector.ts:118-123`: actual payment → forecast payment → invoice date);
  confirmed iff paid-date present AND (`paymentDateConfirmed` OR `paymentDateFontColor==='black'`)
  (`:171-178`). Read via `finance-expense-engine-repository.ts:89-124` (snapshot-guarded).
* **Cashflow IN:** revenue line, effective date = `paymentReceivedDate` else …else
  `plannedPaymentDate` (`cashflow-helpers.ts:42-118`, esp. `:53, :87, :116`); confirmed/forecast
  by `isDateConfirmedCheck` (red→forecast, black→confirmed) (`:9-17`).
* **FY window:** `server/lib/finance-year-scope.ts:25-33` — `month>=9 ⇒ next FY`, start
  `${y-1}-09-01`, end `${fy}-08-31`, inclusive both ends (`monthKeyInFinanceScope:108`).
  A second, hardcoded UTC window lives in `register-cashflow-2026-routes.ts:58-59`
  (`Date.UTC(2025,8,1)…Date.UTC(2026,7,31)`). (Finding M3)
* **Snapshot tables (effective_to):** `cashflow_points, category_revenue_allocations,
  finance_cos_monthly, finance_revenue_monthly, normalized_cost_line_actuals,
  normalized_cost_lines, normalized_revenue_lines, project_revenue_summary,
  tracker_project_metadata, tracker_revenue_summary` — every reported read path filters
  `isNull(effectiveTo)` (verified on the line-level repo).

---

## Part 2 — Conformance table (canonical rule → implemented? → evidence → impact)

| # | Canonical rule | Implemented correctly? | Evidence (file:line) | Impact on the numbers |
|---|---|---|---|---|
| 1 | Source = workbook sheets, never the in-sheet pivots | **Y** | `synonyms.ts:92-108` (only PLAN/REVENUE/EXPENDITURE anchored); pivots/PO never parsed (`normalizer.ts:1797`) | Safe — totals never sourced from stale pivots |
| 2 | Resolve columns by **header text** | **Y** | `mapper.ts:28-236`; `getColIndex` `normalizer.ts:509-512` | Shifted templates read correctly; small fuzzy-match risk (L3) |
| 3 | COS = `Actual Total` | **Y** | `synonyms.ts:65`; `normalizer.ts:1259,1620`; `finance-line-level-repository.ts:589` | Correct |
| 4 | REV = `Revenue Recognition Amount` (col U) | **Y** (with neg-value bug) | `synonyms.ts:75`; `normalizer.ts:1620`; `finance-line-level-repository.ts:604-609` | Correct for ≥0; **negative col U dropped** (H2) |
| 5 | `invoice_date` (col T) drives recognition period | **Y** | `finance-line-level-repository.ts:582-587,700-702`; `getCosEffectiveDateAndSource` `expense-row-selector.ts:137-138` | Correct; blank col T → `EOMONTH(payment date)` replica (`normalizer.ts:1534`) — faithful but can shift month (M3) |
| 6 | `finance_payment_date` drives cash-OUT | **Y** | `synonyms.ts:71`; `expense-row-selector.ts:118-123` | Correct |
| 7 | GP = REV − COS per line | **Y** | `finance-line-level-repository.ts:639` | Correct; GP% guards REV=0 → **null** not 0 (L2) |
| 8 | Cash-IN = received-date else planned-date | **Y** | `cashflow-helpers.ts:53,87,116` | Correct (extra forecast fallbacks for the forecast leg) |
| 9 | **Red = pending/forecast, Black/default = confirmed** is the realisation signal | **Partial → effectively N for closed months** | Read correctly `normalizer.ts:560-596`; **overridden** `cos-realisation.ts:194-206,224-232`; `finance-line-level-repository.ts:171-177` | **C1 — overstates Realised, understates Committed** |
| 10 | States: Realised / Committed / Planned / **Unrealised** | **Partial** | `finance-line-level-repository.ts:27,155-167`; overloaded `finance-routes.ts:2711-2945` | Cannot reproduce the canonical Planned vs Unrealised split (H1) |
| 11 | Forecast = Committed + Planned×conv% (default 100%) | **Partial / UNKNOWN** | Committed/Planned exist but conversion-% knob not located | Forecast = Committed+Planned at 100% effectively; no conversion lever found |
| 12 | One latest tracker per project; ignore older/“conflicted copy” | **Partial (N for naming)** | hash dedupe `project-match.ts:176-193`; no conflicted-copy/lock filter | Duplicate/older revisions in the folder could double-count (M2) |
| 13 | Snapshot reads guarded (`effective_to IS NULL`) | **Y** | `finance-line-level-repository.ts:257,292,312`; partial indexes `finance.ts` | No historical double-count on guarded paths |
| 14 | Keep negatives (credit notes) with sign | **Partial** | COS keeps sign; **REV neg col U dropped** `finance-line-level-repository.ts:608` | Credit-note REV/GP wrong (H2) |
| 15 | Flag same `invoice_no`+amount across >1 period | **N** | only intra-sheet dup flag `normalizer.ts:1100,1552` | Cross-period duplicates not surfaced (M4) |
| 16 | Old template (no col T / col U) flagged & excluded, not guessed | **Partial** | `missingRequired` `mapper.ts:214-221`; recognition silently 0/POC when col U absent | A template missing col U yields POC-derived REV rather than an exclusion flag |
| 17 | FY window 1 Sep–31 Aug inclusive | **Y** | `finance-year-scope.ts:25-33,108` | Correct (UTC vs SAST anchoring inconsistency = M3) |
| 18 | VAT basis consistent (ex-VAT) | **Y** | recognition ex-VAT; cash-in uses `amount_ex_vat` (`normalizer.ts:1073`) | Internally consistent; real bank receipts are gross (L4 caveat) |

---

## Part 3 — Findings (ranked by severity)

### 🔴 CRITICAL

#### C1 — “Past-month auto-realise” silently overrides the red/black signal for every closed month
**What’s wrong.** Every period-classifying surface uses `isEffectivelyRealised`
(`server/lib/finance/cos-realisation.ts:224-232`) / `classifyBucket`
(`server/repositories/finance-line-level-repository.ts:159-178`), both of which promote a
line to **Realised** whenever it has a (non-placeholder) invoice number **and** its
recognition month is *before the current month* — **without checking the invoice-date
colour**:

```
cos-realisation.ts:199   if (!monthKey || monthKey >= currentMonthKey) return false;
cos-realisation.ts:202-205  ...has invoice & not placeholder & not override-not-realised ⇒ true
finance-line-level-repository.ts:171-175
   const isPastMonth = recognitionMonth != null && recognitionMonth < currentMonthKey;
   const confirmed = invoiceDateFontColor?.toLowerCase()==="black" || invoiceDateConfirmed===true || isPastMonth;
```

**Where it bites the numbers.** As-at **1 Jun 2026** the current month is `2026-06`, so
**Sep 2025 → May 2026 (11 of the 12 FY months) are all “past”.** Every invoice-bearing line
in those months is counted **Realised even when its invoice date is RED**. The canonical
model (and the repo’s own §3.2 rule 7 / §5A hard rule) say **invoice + RED ⇒ Committed, not
Realised**. So the implementation’s “Realised” absorbs most of what should be “Committed”.

**Why it’s untrustworthy.** This is exactly the failure the brief calls out: *committed
items silently count as realised and overstate COS/GP.* It is pervasive — the rule feeds the
exec dashboard (`canonical-dashboard-kpi-service.ts:231`), the COS & Revenue trackers
(`finance-routes.ts:2857,5362-6230`), the GP/portfolio page
(`finance-line-level-repository.ts`), and per-project KPIs
(`project-routes.ts:544`, `home/overview/project-info` routes). The red/black signal is read
faithfully at import and then **discarded for 11/12 of the year** at read time.

**Note on intent.** The code documents a deliberate rationale: font colour is treated as a
“current-month vetting heuristic” and past-month invoiced rows are auto-promoted so the COS
tracker “doesn’t drift from QuickBooks” (`cos-realisation.ts:189-193`). That may be a valid
*business* policy — but it is **not in the canonical model and directly contradicts the
stated hard rule §3.2 / §5A**. Either the canonical/guardrails or the implementation must
change; today the *numbers do not mean what the canonical model says they mean*.

**Recommended fix (do not apply without owner sign-off).** Make period-realisation use
`isCanonicalCosRealised()` (colour-gated) for *all* months, and represent the
“reconcile-to-QuickBooks” behaviour as an explicit, separately-labelled QB-evidence
promotion (the predicate already supports `lineAssignedQbExVat` at `:85-89`) rather than a
blanket date-based override. If past-month promotion is genuinely desired, encode it in the
canonical model and §3.2 first, and surface it as a distinct “auto-realised (closed month)”
state so it is visible, not silent.

---

### 🟠 HIGH

#### H2 — Negative `Revenue Recognition Amount` (credit notes) is dropped, breaking GP sign
`finance-line-level-repository.ts:604-609`:
```
const persistedRevenue = toNum(a.revenueRecognitionAmount);
if (persistedRevenue > 0) { perLineRevenue = persistedRevenue; }   // negatives fall through
```
A negative col-U value (a credit note / reversal) fails the `> 0` test and is replaced by the
POC formula (or 0 + a warning). The canonical rule is *keep negatives with sign*. **Impact:**
credit-note lines get the wrong revenue (and therefore wrong GP, wrong sign) — a plausible-
looking but incorrect figure. **Fix:** use `if (a.revenueRecognitionAmount != null)` (accept
any finite value, including negative); reserve the POC fallback for *missing* col U only.

#### H1 — No canonical “Unrealised” bucket; Planned/Unrealised conflated; no-date lines dropped
`classifyBucket` yields only `planned | committed | realised` and maps every no-invoice line
to `planned` (`finance-line-level-repository.ts:27,166-167`). A second, *different*
“unrealised = planned + committed” is computed in `finance-routes.ts:2711-2945`. The brief’s
four states (Realised / Committed / **Planned** / **Unrealised**) cannot be reproduced: the
reference split (Planned ≈ R69.0m vs Unrealised ≈ R3.6m) collapses to a single bucket, and
lines with no `INVOICE RAISED DATE` are dropped from FY-windowed rollups
(`finance-line-level-repository.ts:587`). **Impact:** the Planned/Unrealised columns of any
report cannot be trusted to match canonical; totals are roughly preserved but the *state
attribution* is wrong. **Fix:** implement the canonical 4-state predicate (no-invoice +
red + future ⇒ Planned; no-invoice otherwise ⇒ Unrealised) and use it consistently.

#### H3 — Multiple parallel reimplementations of the realisation predicate (single-read-path violation)
§3.3.2 mandates one read path. In practice the realisation/bucket logic is reimplemented in:
`finance-line-level-repository.ts:159-178` (`classifyBucket`), `recognition-bucketing.ts:68-72`
(`isEffectivelyRealisedLocal`), `finance-routes.ts:514` (local `isEffectivelyRealised`),
`cos-control-routes.ts:41`, and `finance-helpers.ts:22`. They are *not* byte-identical:
`classifyBucket` omits the **placeholder** (`TBC/N/A/…`) and **admin-override** gates that
`isPastMonthAutoRealised` enforces (`cos-realisation.ts:200-204`). **Impact:** a past-month
“TBC”-invoice line is **Realised** on the GP/portfolio page but **not** on the COS tracker —
the same project can show different realised COS on two screens. **Fix:** funnel all surfaces
through the canonical predicate; delete the local copies.

---

### 🟡 MEDIUM

#### M1 — Realisation colour is stored per-parent only; 1:N invoice splits share one colour
`normalized_cost_line_actuals` (the per-invoice child) has **no font-colour column**
(`shared/schema/finance.ts:779-823`), yet the recognition read keys the *date* off the child
(`a.invoiceDate`) and the *colour* off the parent
(`finance-line-level-repository.ts:695 parent?.invoiceDateFontColor`). A BOQ line settled by
two invoices — one BLACK (realised), one RED (committed) — collapses to the single parent
colour. **Impact:** mixed-state multi-invoice lines are misclassified wholesale. **Fix:** add
`invoice_date_font_color` / `invoice_date_confirmed` to the actuals child (the parser already
captures it in `cellFormat`, `normalizer.ts:1406-1418`) and classify per child row.

#### M2 — Dedupe is file-hash identity only; no “latest per project” / conflicted-copy handling
`checkRerunProtection` keys on the file **SHA-256** (`project-match.ts:176-193`); pruning
keeps current + 2 committed runs (`smart-import-routes.ts:235-264`). There is **no** filter
for `~$`-lock files, `… (conflicted copy …)`, or older revisions of the same project, and no
“keep only the latest-modified workbook per project” rule. **Impact:** if the watched folder
contains two revisions or a conflicted copy of one project, both can import and double-count.
**Fix:** group candidate files by resolved project, keep max `lastModified`, and exclude
`~$*` / `*conflicted copy*` by name.

#### M3 — Mixed month / FY anchoring (SAST vs UTC) across surfaces
Recognition uses a SAST-anchored current month (`finance-line-level-repository.ts:186-190`;
`timezone-helpers.ts`), but `register-cashflow-2026-routes.ts:58-59` hardcodes a **UTC** FY
window, and the blank-col-T `EOMONTH(payment date)` replica (`normalizer.ts:1534`) can place
a line in a different month than a human reading the sheet would. **Impact:** month-boundary
lines (and the open/closed-month boundary that drives C1) can differ by up to a day/2 hours
between the cashflow and recognition surfaces. **Fix:** centralise FY/month math on one
SAST-anchored helper.

#### M4 — Cross-period duplicate-invoice detection missing
Duplicate-invoice warnings fire only **within a single sheet/import**
(`normalizer.ts:1100,1552`). The canonical hygiene rule wants the same `invoice_no`+amount
appearing in **>1 period** flagged as a possible duplicate. **Impact:** a genuine
double-capture across months is not surfaced. **Fix:** add a post-import portfolio check
across live actuals.

#### M5 — Cash-OUT amount source not confirmed to be `Actual Total` (UNKNOWN)
Cash-OUT reads the **parent** `normalized_cost_lines` via
`finance-expense-engine-repository.ts:89-124` / `adaptCostToExpense`, whose amount is
`amount_ex_vat` (= `amount_ex_vat` column, falling back to `actual_total`,
`normalizer.ts:1333,1649`). Recognition (correctly) uses the **child** `actual_total`. If a
workbook populates a distinct `amount_ex_vat` separate from `actual_total`, cash-OUT and COS
recognition use different amounts. **Status: UNKNOWN** — needs a data check. **Fix/verify:**
confirm cash-OUT sums child `actual_total`, or that parent `amount_ex_vat ≡ Σ child actual_total`.

---

### 🟢 LOW

* **L1 — Grey/tinted invoice dates handled inconsistently.** Theme-tinted greys →
  black/confirmed (`normalizer.ts:551-556`), but an *explicit ARGB* mid-grey →
  `{color:hex,isBlack:false}` (`:566-572`) ⇒ not confirmed. Edge case; rare in practice.
* **L2 — GP% guard returns `null` on REV=0**, canonical says 0
  (`finance-line-level-repository.ts:640`). Display-only.
* **L3 — Fuzzy header match ≥0.5 + positional `HEADER_ERROR_POSITIONAL` fallback for col J**
  (`mapper.ts:60-69`, `normalizer.ts:1306`) can silently mis-map a renamed/shifted column
  with no hard-fail. Low likelihood (exact/synonym win first) but worth a confidence floor.
* **L4 — VAT caveat (not a code defect vs canonical).** Cash-IN is modelled on ex-VAT
  `VALUE`; actual bank receipts are VAT-inclusive, so “confirmed cash in” will read ~15%
  below QuickBooks if compared gross. Matches the canonical (ex-VAT) but note when
  reconciling to the bank.

---

## Part 4 — Reconciliation (methodology + worked sample + harness)

**Why not a live tie-out:** no `node_modules`, no DB, no data snapshot in this container
(see header). The reference figures (FY Realised COS ≈ R100.3m / REV ≈ R115.6m / GP ≈ R15.3m;
Committed COS ≈ R43.6m; Planned ≈ R69.0m; Unrealised ≈ R3.6m; Cash IN ≈ R262.4m
[conf R232.0m / fcst R30.4m]; Cash OUT ≈ R221.0m; Net ≈ +R41.4m; May-26 Realised COS ≈ R15.1m
/ REV ≈ R17.8m) can only tie **exactly** on the same file snapshot. Below is the methodology
reconciliation plus a worked sample; the runnable harness reproduces it on the real workbooks.

### 4.1 Portfolio totals — predicted divergence (driven by C1)

| Bucket | Canonical (ref) | App (as-at 1 Jun 2026) | Δ direction | Cause |
|---|---|---|---|---|
| Realised COS | ≈ R100.3m | **higher** (≈ 100.3m + closed-month share of Committed) | **+** overstated | C1: red past-month invoices counted realised |
| Committed COS | ≈ R43.6m | **lower** (≈ only `2026-06`-dated reds) | **−** understated | C1 |
| Realised REV / GP | ≈ R115.6m / R15.3m | **higher** | **+** overstated | C1 (REV+GP of promoted lines move with COS) |
| Planned COS | ≈ R69.0m | ≈ R72.6m (Planned+Unrealised merged) | mixed | H1 |
| Unrealised COS | ≈ R3.6m | ≈ 0 (no bucket) | **−** | H1 |
| Total COS | ≈ R216.5m | ≈ same | ~0 | total preserved; only *attribution* moves |
| Cash IN / OUT / Net | 262.4 / 221.0 / +41.4 | not computable here | UNKNOWN | needs snapshot; methodology conforms (§1.5) |

**Upper bound for C1:** if *all* of the canonical Committed R43.6m is dated in closed months
(highly likely on 1 Jun, since only `2026-06` is “open”), the app reports **Realised COS
≈ R143.9m vs canonical R100.3m — a ≈ +43% overstatement**, with Committed collapsing toward
zero. Even a half-closed split is ≈ +R22m. This is the single largest, most material delta.

### 4.2 Month-state spot check — May 2026

Canonical *May Realised COS ≈ R15.1m* counts only **black**-dated May lines. In the app, May
(`2026-05`) is a *closed* month (< `2026-06`), so **every** invoice-bearing May line is
realised regardless of colour. Therefore **App May Realised COS = R15.1m + (May’s
red/committed COS)** ≥ canonical, with the delta equal to May’s committed COS. Same direction
for May REV (≥ R17.8m).

### 4.3 Worked line-level sample (demonstrates C1 deterministically)

Cost line, category “Inverters” (X = ΣQ = R20.0m, J = R25.0m): Actual Total **R1,000,000**,
invoice present, **invoice date 2026-05-15 in RED**.

* per-line REV = (1,000,000 / 20,000,000) × 25,000,000 = **R1,250,000**; GP = **R250,000**.
* **Canonical:** invoice + RED ⇒ **Committed**. May → Committed COS +1.0m, REV +1.25m.
* **App (1 Jun 2026):** `classifyBucket("INV", "red", false, "2026-05", "2026-06")` →
  `isPastMonth = "2026-05" < "2026-06" = true` → `confirmed = true` → **Realised**
  (`finance-line-level-repository.ts:171-177`). May → **Realised** COS +1.0m, REV +1.25m.
* **Δ:** +R1.0m Realised COS, −R1.0m Committed COS, +R1.25m Realised REV — purely from C1.
* Change the date to **2026-06-15** (current month): app → `isPastMonth=false`, red ⇒
  **Committed** — i.e. the app *only* honours red in the open month. This is the exact
  fingerprint to look for when running the harness.

### 4.4 Runnable reconciliation harness — `qa/audit/importer-canonical-recon.ts`

A self-contained **exceljs-only** script (no DB, no app bootstrap) that, for each
`qa/fixtures/trackers/*` workbook (or a path you pass):

1. locates `Expenditure Breakdown` and resolves columns **by header text** (mirroring the app);
2. reads the `INVOICE RAISED DATE` **font colour** exactly as the app does (ARGB/theme,
   missing→black, red = `r>150,g<80,b<80`);
3. derives per-line COS / REV (col U, else `(Q/X)*J`) / GP;
4. classifies each line **two ways** — **canonical** (colour-only, no past-month) and
   **app-equivalent** (the `isEffectivelyRealised` past-month rule with a configurable
   `--as-at` date) — and prints **per-state COS/REV totals + the Δ**, plus duplicate-invoice
   and missing-col-T/col-U flags.

It is intentionally independent of the app’s db-coupled modules so it runs with only
`npm i exceljs`. To run in an environment that has deps:

```bash
npx tsx qa/audit/importer-canonical-recon.ts                 # scans qa/fixtures/trackers/
npx tsx qa/audit/importer-canonical-recon.ts path/to/Tracker.xlsx --as-at 2026-06-01
```

The Δ column is the dollarised C1 finding for the real snapshot. Lines flagged
`COL_T_MISSING` or `COL_U_MISSING` are the “old template — must be excluded, not guessed”
cases (rule 16 / H1).

---

## Part 5 — Trust verdict

**Can the current numbers be trusted? Partially — with one big asterisk.**

* **Trustworthy:** the *mechanics* are sound. Font colour is genuinely read (exceljs, not
  SheetJS), columns resolve by header (shifted templates OK), COS=`Actual Total`,
  REV=`Revenue Recognition Amount` (col U) with a correct POC fallback, recognition buckets on
  `INVOICE RAISED DATE`, cashflow keys off the right payment dates with a colour signal,
  snapshot guards are present, and the stale in-sheet pivots are never read. Trust checks
  **2, 3 (≥0), 4, 6, 8, 13, 17, 18 PASS.**
* **Not trustworthy as-is:** the **Realised vs Committed split** (and therefore Realised
  GP and any “% complete / % realised” KPI) is **overstated** because the past-month
  auto-realise rule (**C1**) discards the red/black signal for 11 of 12 FY months — the very
  error the brief flags as worst-case. Secondary: credit-note revenue sign (**H2**), the
  missing Unrealised state (**H1**), divergent predicates across screens (**H3**), and
  parent-only colour on split invoices (**M1**). Trust check **1/9 FAILS in effect**;
  **7, 10, 14, 15 PARTIAL/FAIL.**

**Shortest path to trustworthy numbers (in priority order):**
1. **C1:** route period-realisation through the colour-gated `isCanonicalCosRealised()` for
   *all* months; if “reconcile-to-QB” promotion is wanted, make it an explicit, visible
   QB-evidence state — not a silent date override. *(Single highest-impact change.)*
2. **H2:** accept non-null (incl. negative) col U before falling back to POC.
3. **H3:** delete the local realisation reimplementations; one predicate, one read path.
4. **H1:** implement the canonical 4-state classifier (Planned vs Unrealised).
5. **M1:** persist invoice-date colour on the actuals child and classify per child.

Until C1 (and ideally H1–H3) are resolved against the owner-approved canonical model, treat
**Realised COS/REV/GP as an upper bound and Committed as a lower bound**; total COS, header
resolution, cashflow timing, and the POC revenue math are reliable.

---

### Evidence provenance
Load-bearing files were read directly: `normalizer.ts`, `mapper.ts`, `synonyms.ts`,
`detector.ts` (header logic), `cos-realisation.ts`, `recognition-bucketing.ts`,
`revenue-recognition.ts`, `finance-line-level-repository.ts`, `cashflow-helpers.ts`,
`expense-row-selector.ts`, `finance-year-scope.ts`, `shared/schema/finance.ts`,
`qa/tests/unit/finance-line-level-excel-recon.test.ts`. Ingestion/cashflow/data-model breadth
was mapped with assisting searches and cross-checked against the files above. Anything not
verifiable in this environment is marked **UNKNOWN** (M5; live cash totals; conversion-% lever).
