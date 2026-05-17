# UI/UX Audit — Priority Surfaces

**Date:** 2026-05-16
**Scope:** Project Delivery, Finance, Engineering, Quality, Admin (the screens nominated as priorities).
**Design theme being audited against:** *integrity, trust, clear, simple* — brand palette white + emerald `#16A34A`.
**Method:** Source-level review of every nominated page component (read-only). High-impact claims were spot-verified against the actual code and server logic; one agent over-claim was caught and corrected (see "Verification notes").

---

## 1. Executive summary

The priority surfaces are functionally rich but **do not yet express the stated theme consistently**. The same five problems recur on almost every screen. None of these are cosmetic — three of them (fail-to-clean error handling, fragmented money formatting, under-confirmed privilege/bulk actions) directly attack the *integrity* and *trust* pillars on the screens where those pillars matter most (finance, quality, audit, permissions).

**Theme scorecard (qualitative):**

| Pillar | State | Biggest detractor |
|---|---|---|
| Integrity | ⚠️ At risk | Failed data loads silently render as empty / `R 0` / "no events" on finance, quality, payments and audit screens. |
| Trust | ⚠️ At risk | Privilege and bulk actions apply with no confirmation/justification/diff; audit timestamps have no timezone; raw JSON shown to non-technical users. |
| Clear | ⚠️ Mixed | Buried hierarchy (stacked banners), terminology drift, dead/lying UI ("Items view" that doesn't exist, "Save & Close" that doesn't save). |
| Simple | ⚠️ Mixed | 6–8 accent colours + raw hex per screen instead of white + emerald; duplicated components and divergent taxonomies. |

The good news: the strongest patterns already exist *somewhere* in the codebase (`projects.tsx` page shell + error/empty/skeleton; `finance-gp.tsx` precise `Intl` ZAR formatter; `cashflow.tsx` `FinanceTrustStrip`; `fye-revenue-tracking.tsx` source-of-truth banner; standup's correct emerald `primary` usage). Most remediation is **propagating existing good patterns**, not inventing new ones.

---

## 2. Cross-cutting themes (the five things to fix everywhere)

### X1 — Errors silently masquerade as empty / zero / "all clear"  *(Integrity — highest risk)*
A failed fetch is degraded into a reassuring empty state on money- and compliance-critical screens. A load failure is indistinguishable from genuinely good news.
- Finance: `cashflow-analysis.tsx` & `cos-analysis.tsx` have spinner-only, no error branch; most formatters map `null → "R 0"`.
- Project Delivery: overdue payments `FinancePage.tsx:147-149` (`catch { setOverdueData(null) }` → "No overdue payments found"); milestone per-project revenue rows; `RealisationKPIsPage`.
- Quality: `governanceSummary` has no error state → KPI cards show `0` (`qm-dashboard.tsx:265-270, 591-619`).
- Admin: `audit-section.tsx:30-35` swallows fetch failure → "No events recorded yet" (a failed audit fetch reads as a clean audit trail); roles list error renders "Role not found".
- Engineering: standup `index.tsx` has loading but no error state; dashboard sections return `null` when empty.
- **Fix:** every data query on these surfaces gets an explicit error state distinct from empty; `null`/missing must render `—`, never `R 0` or "none".

### X2 — Money & number formatting is fragmented and sometimes misleading  *(Integrity)*
- Finance: **eight** separate hand-rolled formatters (`cashflow.tsx:185`, `cos.tsx:173`, `cashflow-analysis.tsx:78`, `cos-analysis.tsx:41`, `revenue-tracker.tsx:122`, `finance-gp.tsx:122` [the correct `Intl` ZAR one], `finance-gp-company.tsx:170`, `fye-revenue-tracking.tsx:201`). The *same metric* (GP) renders precisely on one screen and abbreviated on another; `null` collapses to `R 0` in most.
- Project Delivery: `formatCurrencyCompact`, a duplicated local `formatCurrency` in `RealisationKPIsPage.tsx:62-66`, and bare `R{Number(x).toLocaleString()}` (no en-ZA, no decimals) in `project-detail.tsx:208,1662-1663,1990` and `projects.tsx`.
- Shared helpers already exist: `client/src/lib/execution-dashboard.ts` exports `formatCurrencyCompact` / `formatCurrencyFull`.
- **Fix:** one shared ZAR module — precise `Intl.NumberFormat("en-ZA", { currency: "ZAR" })` for cells/tooltips, an explicit abbreviated variant for chart axes only, `—` for null/zero distinction. Compact cells must expose the exact figure on hover.

### X3 — Brand palette is not "white + emerald"  *(Simple / brand)*
Every domain over-uses decorative colour.
- Engineering: orange/amber dominates — dashboard header gradient `engineering-dashboard.tsx:840` (`from-orange-500 to-amber-600`), "Create Task" `bg-orange-600` (`EngineeringTasksPage.tsx:4266,4367`), blue as de-facto primary, Teams `#5059C9` hardcoded.
- Project Delivery: 6–8 accent hues across Overview/Finance/Construction; raw hex in charts `RealisationKPIsPage.tsx:203-204,264-265` (`#059669` ≠ brand `#16A34A`); non-emerald `green-*` in `project-detail.tsx:203`, `milestone-tracker.tsx:584`.
- Finance: off-brand blue/violet/slate KPI accents (`cashflow.tsx:281-317`).
- Quality: severity reds inconsistent (`red-500` vs `red-700`) so high severity can look *softer* than surrounding UI.
- Admin: blue/purple/amber/rose on the most security-critical screens.
- **Fix:** token set — emerald = primary/positive, one semantic red = alert/destructive, neutral grays for everything else; colour conveys state, not decoration. (Teams brand colour is an acceptable documented exception.)

### X4 — Accessibility is systematically weak  *(Clear / inclusive)*
Recurs on every screen: clickable `<div>`/`<tr onClick>` rows that are not keyboard-operable; status/RAG/severity conveyed by colour alone; icon-only buttons with `title` but no `aria-label`; sortable `<th onClick>` with no `aria-sort`; **drag-and-drop with no keyboard path** for the core action (Engineering Kanban + Standup lanes — move buttons are hover-only `opacity-0 group-hover`); dialogs not focus-trapped (standup shortcut help, permission matrix).
- **Fix:** real `<button>`/`<Link>` semantics for interactive rows/cards, text or `aria-label` alongside every colour signal, keyboard alternative for every DnD move, `aria-sort` on sortable headers.

### X5 — Component & pattern fragmentation  *(Simple / consistency)*
- Four+ separate `KpiCard` implementations (`ConstructionPage`, `ProgramPage`, `FinancePage`, `RealisationKPIsPage`, plus a hand-rolled `KpiTile` in `OverviewPage`).
- Engineering status/priority taxonomies diverge: snake_case `TASK_STATUSES` + helpers vs standup's uppercase strings; priority maps disagree (`Med` vs `Medium` vs `Critical`) → silent badge/sort fallbacks.
- Admin: two parallel audit UIs and two integration-status layouts for the same governance data.
- Inconsistent page chrome: `projects.tsx`/`milestone-tracker.tsx` use `PageShell`+`SectionHeader`; Execution Board hand-rolls its header; `quality/documents.tsx` and `engineering/documents.tsx` have no page header at all.
- Quality Documents/Tasks: quality tasks link into `/engineering/tasks` with no cross-domain indication.
- **Fix:** shared `KpiCard`, shared status/priority constants, one audit component, one integration-status surface, one page-shell pattern.

### X6 — Destructive / privileged / bulk actions under-confirmed  *(Trust — high risk on Admin)*
- Admin: global "Grant All"/"Revoke All" flips every entity×action with one click, no confirm, no diff (`role-permissions-matrix.tsx:146-147,209-210,277-278`); direct matrix save requires no reason while the *lower-risk* Apply-template path forces a reason — inverted governance; SharePoint auto-commit toggle commits financial data with no confirm (`admin-integrations.tsx:676-680`).
- Engineering: bulk status/priority change applies instantly with no confirm or partial-failure reporting; `window.confirm` mixed with styled AlertDialogs.
- Project Delivery: inline 2-click delete vs Dialog confirm inconsistency (`project-detail.tsx:800-809`).
- **Fix:** confirm + impact preview ("X users / Y permissions affected") + required reason for privilege and bulk changes; one confirmation primitive (AlertDialog) everywhere.

---

## 3. Per-domain findings (condensed)

Full severity tables retained below; `file:line` references are verbatim from the review. **H/M/L = High/Med/Low.**

### 3.1 Project Delivery

| Screen | Sev | Finding (file:line) |
|---|---|---|
| Execution Board | H | "Access Denied" is a bare icon+text, no heading/guidance/nav (`execution-dashboard/index.tsx:51-62`). |
| Execution Board | H | Realisation KPIs only render inside FinancePage (`FinancePage.tsx:981`) — no tab/anchor though 4 tabs advertised (`route-tabs.ts`). Whole surface undiscoverable. |
| Execution Board | M | Raw `ctx.error` string shown to user (`index.tsx:42`); "Data as of" hidden on mobile (`index.tsx:90`). |
| Overview | H | 6+ accent hues on KPI tiles (`OverviewPage.tsx:63-111`); RAG colour-only with `title` (`:331`). |
| Overview | M | Compact currency, no full-value tooltip on tiles (`:72,84,96`); hand-rolled `KpiTile` not `Card` (`:467`). |
| Construction | M | Sortable `<th onClick>` no `aria-sort` (`:63-71`); expand rows `<tr onClick>` no `aria-expanded` (`:181`). Honest "data not available" notice is a good integrity signal (`:144-150`). |
| Finance | H | Mixed currency precision table vs panel (`:616` vs `:666`); overdue fetch fail swallowed → "No overdue payments found" (`:147-149`, `:1086`). |
| Finance | M | Multi-colour tinted cards (`:331-535`); clickable `<div>` tiles not focusable (`:342-382`). |
| Realisation KPIs | H | Duplicated local `formatCurrency` w/ divergent rounding (`:62-66`); raw hex chart colours (`:203-204,264-265`). |
| project-detail | H | Bare `R{...toLocaleString()}` no locale (`:208,1662,1990`); **hardcoded role arrays** `['admin','COO_ADMIN','CEO_ADMIN']` (`:1366-1368`) — violates CLAUDE.md "never hardcode roles". |
| project-detail | M | Inline 2-click delete vs Dialog inconsistency (`:800-809`); 3 local `getPhaseLabel`/phase-colour defs. Strong: distinct loading/not-found/`ErrorBoundary` (`:1323-1354`). |
| projects (All) | L | Strong reference pattern: `isError`+retry, skeleton, `EmptyState` (`:1726-1780`), `PageShell`+`SectionHeader`. Adopt elsewhere. |
| milestone-tracker | M | Per-project revenue failure → "No revenue milestones found" (`:348-352`); expand header `<div onClick>` not keyboard (`:245-247`). |

### 3.2 Finance

| Screen | Sev | Finding (file:line) |
|---|---|---|
| Cashflow | H | `formatRand` abbreviates everything, no exact figure; `null` → `R 0` ambiguity (`:185-192`). Negative only via leading `-`, same colour/weight (`:191`). Good: `FinanceTrustStrip` + stale badge (`:1695-1697,553`). |
| Cashflow Analysis | H | Spinner-only, **no error branch** for any query (`:272-457`) → empty card reads as "nothing overdue". Risk score rendered as bare number next to currency (`:426`). |
| Cost of Sales | H | Abbreviating `formatRand` again (`:173-180`); each finance file declares its own formatter — inconsistency listed in X2. |
| COS Analysis | H | Spinner-only, no error branch (`:244,367`); "Last updated: N/A" literal with no staleness context (`:194`). |
| Revenue | H | Abbreviating `formatRand` (`:122-128`). "Revenue Unrealised" deliberately equals "Revenue Committed" — two different finance terms, identical value (`:173-178`), a reading hazard. |
| Gross Profit | L | **Reference implementation:** precise `Intl` ZAR, `—` for null (`:122-132`). Promote to shared lib. Portfolio card has loading but no error (`:357-368`). |
| GP — company | H | Reverts to abbreviating `formatRand` (`:170-177`) — *same metric* less precise than per-project GP. Negatives correctly `text-destructive` (`:195-199`). |
| FYE Revenue | M | `KpiCard` renders `{value}` raw (`:233`). **Verified: these are project counts, not Rand** (`server/departments/fye-revenue-tracking-routes.ts:1421-1430`) — so this is a Low (no thousands separator on large counts), *not* the multi-million-Rand bug originally reported. Strong: `SourceOfTruthBanner` + stale detection (`:393-400`). |

### 3.3 Engineering

| Screen | Sev | Finding (file:line) |
|---|---|---|
| Dashboard | H | Orange/amber header gradient + multi-hue KPIs, emerald not the identity colour (`:840,282-288,871`). |
| Dashboard | M | Duplicate `<h2>` header under SectionHeader + ~5 stacked banners before content (`:832-846`); empty sections return `null` (`:557,635`). |
| Task Mgmt | H | Kanban DnD-only, no keyboard path; cards `<div onClick>` (`:518-524,733,662-676`). |
| Task Mgmt | H | Divergent priority maps `Critical/Urgent/High/Medium/Low` vs `Med` vs `Medium` → `bg-muted` fallback (`:160,2889,3136`); ad-hoc status colours bypass shared helper. |
| Task Mgmt | M | Bulk status/priority applies instantly, no confirm, all-or-nothing toast (`:4696,4704,3837`); `window.confirm` vs AlertDialog inconsistency (`:1143`). Good: loading/empty/error+retry (`:4590,4595,4397`). |
| Task Mgmt | — | Entire ~4,900-line module fronted by stub re-export barrels — maintainability/clarity risk. |
| Documents | M | 7-line pass-through; no engineering framing or own state UI (`engineering/documents.tsx:26-31`); no PageShell/SectionHeader. |
| Stand-up | H | Lane move actions hover-only `opacity-0 group-hover` (`TaskLanes.tsx:65`); cards `<Card onClick>` (`:39-42`). |
| Stand-up | M | No error state for schedules/participants/tasks (`index.tsx`); uppercase status strings diverge from canonical helpers; **"Save & Close" persists nothing** (`StandupSummary.tsx:281`) — label lies. |
| Stand-up | L | Most on-brand screen: correct emerald `primary` (`index.tsx:573-601`). |

### 3.4 Quality

| Screen | Sev | Finding (file:line) |
|---|---|---|
| QM Dashboard | H | **NCRs effectively invisible** — no list/count/section; only a deep-link banner that renders `null` without `?ncr=` (`qm-dashboard.tsx:580`, `NcrLegacyDeepLinkBanner.tsx:35`). A QM landing cold sees zero open non-conformances. |
| QM Dashboard | H | Severity colour contradictory: `red-500` in dialogs/rows vs `red-700` in KPIs (`:1160,1436` vs `:187,591`) — high severity can look softer than surroundings. |
| QM Dashboard | H | Whole page gated on the checklists query (`:547`) — warnings/KPIs/NCR/approvals all hidden behind one slow endpoint. |
| QM Dashboard | M | `governanceSummary` no error/empty → KPIs silently `0` (`:265-278,591-619`); single dead `Tabs` with walkthrough copy promising a non-existent "Items view" (`:538,713`); invalid Tailwind classes silently no-op (`:1046,1428`). |
| quality-dashboard.tsx | Info | **Not redundant** — a documented 19-line redirect stub (`:13-18`). No divergence; correctly retired. |
| Quality Tasks | M | Rows link into `/engineering/tasks` with no cross-domain cue (`:147`); zero-state shows filter-mismatch copy (`:140`). State coverage otherwise good. |
| Quality Documents | M | No `PageHeader`/title (`documents.tsx:18-24`); no document version/approval/owner on landing — core trust signal for NCR/ITP evidence absent. |

### 3.5 Admin

| Screen | Sev | Finding (file:line) |
|---|---|---|
| Roles & Perms | H | Global Grant/Revoke-All flips all permissions, no confirm/diff (`role-permissions-matrix.tsx:146-147,209-210,277-278`). |
| Roles & Perms | H | Direct matrix save requires no reason while lower-risk Apply-template forces one (`right-panel-role.tsx:128-140` vs `:364-377`) — inverted governance. |
| Roles & Perms | H | No post-save diff/summary of what changed (`role-detail-panel.tsx:113`). |
| Roles & Perms | M | Roles-list / user-lookup errors render "not found" / infinite "Loading person…" (`right-panel-role.tsx:214-233`, `index.tsx:219-225`); icon-only matrix headers, colour-only cell source (`role-permissions-matrix.tsx:166-175,30-35`); four-colour scheme on the most security-critical screen. |
| Integrations | H | SharePoint auto-commit toggle commits financial data, no confirm (`admin-integrations.tsx:676-680`). |
| Integrations | M | Status inferred ad-hoc ("Needs Attention" is the catch-all), no real enum/reason (`role-settings.tsx:361-509`); "last sync" no timezone, no separate "last checked" (`:387,470,543`); raw error messages surfaced (`:216`, `admin-integrations.tsx:499`); two divergent layouts. |
| Audit Log | M | Detail dumps raw `JSON.stringify` to a non-technical COO (`system-activity-log.tsx:529-531`, `audit-section.tsx:118-120`); two parallel audit UIs; timestamps no timezone (`audit-section.tsx:94`, `system-activity-log.tsx:44-49`). |
| Audit Log | M/L | `audit-section.tsx` fetch failure swallowed → "No events recorded yet" (`:30-35`) — falsely implies a clean trail; permission-change history (most security-relevant) has the weakest filters (`:51-59`); four different names for "audit" across the UI. |

---

## 4. Verification notes (audit integrity)

This report was produced with five parallel review passes; high-impact claims were re-checked against source before inclusion.

- **Corrected:** the Finance pass originally rated `fye-revenue-tracking.tsx:233` (`{value}` rendered raw) as the single highest-severity numerical-integrity defect, assuming `broughtIn/signed/total` were multi-million-Rand totals. Server logic (`server/departments/fye-revenue-tracking-routes.ts:1421-1430`) shows these are project **counts** (`.length`). Re-rated **Low** (large counts lack a thousands separator); it is *not* an unformatted-currency bug.
- **Confirmed:** `project-detail.tsx:1366-1368` hardcoded role arrays (CLAUDE.md guardrail breach); Engineering orange/blue brand deviation (`engineering-dashboard.tsx:840`, `EngineeringTasksPage.tsx:4266`); shared currency helpers exist and are unused (`client/src/lib/execution-dashboard.ts:112,122`).

---

## 5. Prioritised remediation roadmap

**P0 — Integrity/trust, ship first (small, high-leverage):**
1. X1: add explicit error states (≠ empty) to every data query on Finance analysis pages, payments/overdue, Quality governance KPIs, Admin audit log & roles list, Standup. A failed load must never read as good news.
2. X6: confirm + impact-preview + required reason for Grant/Revoke-All, direct role-matrix save, and SharePoint auto-commit toggle.
3. Fix `audit-section.tsx:30-35` swallowed fetch (audit trail must fail loudly); add timezone to all audit timestamps.
4. Replace `project-detail.tsx:1366-1368` hardcoded role arrays with permission checks.

**P1 — Integrity, medium effort:**
5. X2: one shared ZAR formatter (precise default, explicit abbreviated variant, `—` for null); migrate all eight finance formatters + Project Delivery currency renders onto it.
6. Surface open NCRs as a first-class card/list on the QM dashboard; un-gate the page from the single checklists query.
7. Fix lying UI: standup "Save & Close" (persist or rename), QM dead "Items view" tab + walkthrough copy, invalid Tailwind classes.

**P2 — Clarity/consistency, larger effort:**
8. X3: introduce the white+emerald token set; replace raw hex and decorative multi-hue palettes.
9. X4: keyboard-operable rows/cards, colour+text status everywhere, keyboard path for Kanban/standup moves, `aria-sort`/`aria-label`.
10. X5: shared `KpiCard`, shared status/priority constants, single audit + integration-status surfaces, one page-shell pattern; split the ~4,900-line Engineering task module.

---

*Read-only audit — no application code was modified. This document is the deliverable.*
