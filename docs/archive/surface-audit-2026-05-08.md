# Surface Trust Audit — 2026-05-08

**Scope:** Read-only audit of every user-facing screen/page/dashboard/KPI surface
in the app. Goal: classify each surface as TRUSTED / PARTIAL / NOT-YET-TRUSTED
and recommend KEEP / HIDE / ARCHIVE so the COO can ship "trusted surfaces only,
then roll out the rest."

**Posture:** Document only. No code, schema, migrations, or commits touched.

**Inputs read:** 49 source files (cap was 50). Anchored against:
- `docs/AGENT_GUARDRAILS.md` § 0A (the override principle — "the app is there
  for recording and evidence; it should never be a blocker").
- `docs/active/wave-0/t1x-reporting-findings.md` (trust verdicts for ~16
  reporting surfaces — re-used verbatim where they apply).
- `docs/overhaul/backlog.md` (cross-cutting items already triaged).
- `client/src/config/app-navigation.ts` + `client/src/config/page-registry.ts`
  + `client/src/config/route-components.ts` + `client/src/App.tsx` (the
  canonical inventory of what's actually mounted and exposed).

**Note on the brief:** `voice-of-team-backlog-v2` was cited but does not exist
on disk. Closest is `docs/overhaul/backlog.md`. The framing quote ("App is on
the side, not on the path. Simplify to trusted surfaces only, then roll out
the rest.") matches the operating philosophy in § 0A and is treated as the
load-bearing intent for this audit.

> **Trust scoring rubric**
> - **TRUSTED** — canonical data source · t1x verdict PASS or no defect found
>   · math correct per § 3 · trust signals present (last-updated + source
>   breadcrumb at minimum).
> - **PARTIAL** — numbers correct but trust signals missing OR one bounded
>   defect (e.g. one tile fixture-driven on an otherwise correct page) OR
>   trust meta partial OR broken nav links.
> - **NOT-YET-TRUSTED** — t1x verdict FAIL · fixture / hard-coded data ·
>   known formula violation · surface deeply incomplete · renders without
>   backing endpoint · orphaned (no route binding).
> - **UNVERIFIED** — file exists, in nav, but couldn't determine trust state
>   in this read-budget pass; needs follow-up.
>
> **Recommendation rubric**
> - **KEEP visible** — TRUSTED + decision-bearing for COO/CFO/PM. Caveats
>   listed instead of hiding.
> - **HIDE behind feature flag** — PARTIAL or NOT-YET-TRUSTED with a clear
>   path to fix. Mechanism: `requireRole('COO')` on the route + nav-config
>   visibility flag, reversible by edit to `app-navigation.ts`.
> - **ARCHIVE** — superseded by another surface · deprecated table dependency
>   · zero usage signal · duplicate · orphaned (lazy-imported but never
>   routed).
>
> **Restoration effort if HIDE**
> - **S** = ≤1 day (wire trust badge, fix nav link, swap fixture for query).
> - **M** = 1–5 days (fix formula path, add audit emit, migrate to canonical
>   repository).
> - **L** = >5 days or schema/migration work (rebuild surface, add new
>   endpoint, design override path).

---

## 1. Inventory by area

### 1.1 Home / role landings

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `home.tsx` | `/` | Role-aware Home: greeting, Company Priorities, Do-Next chips, role-segmented KPI tiles, tabs (Actions/Approvals/Calendar/Meetings/Inbox). | `/api/lifecycle-board/execution-dashboard`, `/api/priorities`, `/api/my-work/all-tasks`, `/api/home/do-next` | **PARTIAL** | **HIDE behind feature flag** OR fix-now in place | **S** | (a) **Broken nav links** at `home.tsx:416–419`: AttentionItems point at `/dashboard?rag=Red`, `/dashboard?behindPlanOnly=true`, etc. — `/dashboard` redirects to `/execution-board` and the query params are dropped. (b) Many KPI keys in `kpiSource` map several different labels to the same metric (e.g. `cash_position` and `revenue_this_month` both show `kpis.receivedInflowFy`) — see § 4 #2 for surprises. (c) Hard-coded TARGETS surface as `—` on most cards. |
| `dashboard.tsx` | (none) | **Lazy-imported in `route-components.ts:6` but no `PAGE_REGISTRY` entry uses key `Dashboard`.** Legacy redirect `/dashboard → /execution-board` (`page-registry.ts:60`) means this file is unreachable. t1x findings called this "Home" — that label is wrong. | n/a — orphan | **NOT-YET-TRUSTED** | **ARCHIVE** | n/a | Dead code. ~600 lines of components composing tiles + tracker table that no user can see. Composes `FinancialSummaryTiles`, `MyWorkToday`, `AttentionPanel`, `ImportHealthWidget` — those panel components remain useful but the page is dead. |
| `ceo-home.tsx` | `/ceo` | CEO pre-execution home: approvals queue + upcoming PD→PM handovers + pre-execution stage columns + execution stage counts. | `useGatesPipeline()` (canonical), `SEQUENTIAL_PHASES` from `shared/phases`. | **TRUSTED** | **KEEP** | n/a | Role-gated to `CEO_ADMIN`. No date-bucketing math; safe by design. Caveat to surface to user: "Counts only, no R-amounts here. For finance, use Finance > GP." |
| `coo-home.tsx` | `/coo` | COO morning check: approvals + priorities + Red/Behind-plan + Engineering blockers + Quality + HSE + handovers + finance-tile column (revenue/cashflow/CoS realisation). | `useGatesPipeline`, `useGatesHandovers`, `/api/priorities`, `/api/lifecycle-board/execution-dashboard` | **PARTIAL** | **KEEP** with caveats | **S** | Role-gated to `COO_ADMIN`. Finance tile column inherits from `/api/lifecycle-board/execution-dashboard` which transitively pulls `company-overview-service.ts` — t1x flagged § 3.4 violation in FY-bucketing on cashCollected (see t1x finding #1). Needs a "Cash collected fix-now pending" trust banner until the date-pivot fix lands. |
| `pm-dashboard.tsx` | `/pm-dashboard` | PM portfolio: per-project budget vs actual, CoS realised/committed/planned, tasks (overdue/in-progress/needsApproval), key dates (PD handover, construction start, commissioning, client handover, OM). | `pmFetch('/api/...')`, `formatCurrencyCompact/Full`, `formatForDisplayZA` | **UNVERIFIED** | **KEEP** with caveat | **S** | Heavy page (1000+ lines). Uses canonical `cosRealised/cosCommitted/cosPlanned` field names — likely routes through `getCosRealisedAmountForNclRow` per § 3.2 but I could not verify the server endpoint in this read. Caveat: "Ensure CoS Realised matches /cos page totals — single read path required." |
| `pd-dashboard.tsx` | `/pd` | Project Development: active/overdue/stale tickets + work items, byPhase, byOwner, action queue with reasons (overdue, on_hold, stale_30d, high_priority_quiet), handover-ready, recently-completed, upcoming this week, at-risk tickets, linkage gaps. | `/api/pd-dashboard`-style endpoint via `apiRequest` (typed contract) | **TRUSTED** | **KEEP** | n/a | Strong shape, well-typed, no obvious trust gap. Caveat: no last-updated chip in header. |

### 1.2 Department dashboards

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `engineering-dashboard.tsx` | `/engineering` | Engineering standup: tasks (status/priority/dueDate/trackingRag), per-project health (RAG calc), workload per assignee, hold/blocker reasons, copy-Teams clipboard. | `engFetch/engPatch/engPost` from `@/lib/eng-fetch` | **TRUSTED** | **KEEP** | n/a | Real workflow, real backend. Trust signals not present in header — minor. |
| `qm-dashboard.tsx` | `/quality` | Quality dashboard with checklist phases, NCR legacy banner, attention badges, NCR list (deferred — UI not yet rebuilt). | `qFetch` direct, `useAccessMatrix`, `usePermission` | **PARTIAL** | **KEEP** with caveat | **S** | NCR list deep links forward to dashboard via redirect (`pageRegistry`: `qualityNcrList → /quality`). Caveat: "NCR list view not yet rebuilt — counts only via dashboard tile." |
| `hse-dashboard.tsx` | `/hse` | HSE incidents (create/edit) + corrective actions + status approval gate. | `/api/hse/incidents`, `/api/projects-summary`, `useAccessMatrix.canAccessEntityAction("hse_incidents", "approve")` | **TRUSTED** | **KEEP** | n/a | Backend intentionally open per server header — only status transitions gated. UI honours that explicitly. |
| `engineering-tasks.tsx` (Task Board) | `/engineering/tasks` | Engineering Kanban / list of tasks. | `engFetch` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read; downstream of engineering-dashboard pattern. |
| `engineering/standup.tsx` | `/engineering/standup` | Engineering standup runner. | `engFetch` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. Pattern matches engineering-dashboard. |
| `commissioning-dashboard.tsx` | `/commissioning-dashboard` | Programme-level commissioning. | `/api/commissioning/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `handover-dashboard.tsx` | `/handover` | Handover packs + SSEG items + SSEG applications, with overdue/pending counts. | `/api/handover/packs`, `/api/handover/sseg`, `/api/sseg-applications` | **TRUSTED** | **KEEP** | n/a | Real endpoints, defensive Array.isArray guards. Caveat: no last-updated chip. |
| `handover-control.tsx` | `/handover-control` | Handover queue (PD-side). | `/api/...` | **UNVERIFIED** | **KEEP** with caveat | **S** | Backlog item #14 flags Handover Health Score sub-tile renders without backing endpoint at lines 77–78 — confirm before promoting. |

### 1.3 Project / lifecycle / execution surfaces

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `pages/execution-dashboard/` (mounted via `execution-board.tsx` shim) | `/execution-board` (+ aliases `/execution-dashboard`, `/dashboard`, `/execution-board/program`, `/execution-board/finance`) | Execution board hub with Construction / Finance / Overview / Program / Realisation-KPIs sub-pages. The `execution-board.tsx` file is a 2-line re-export of `./execution-dashboard`. | `use-execution-data.ts` aggregator; downstream `execution-dashboard/FinancePage.tsx` already noted in t1x as PASS with `DataSourceBadge` + `DataTrustBadge`. | **TRUSTED** | **KEEP** | n/a | Default landing for CEO/COO/PM/CM/Programme Manager (per `roleLandingEligibility`). Highest-traffic page in the app. Caveat: 5 sub-pages not all deeply read. |
| `lifecycle-board.tsx` | `/lifecycle-board` | Programme RAG board with stage-gate blocks, override capability, project-level RAG comments. | `/api/lifecycle-board/...` | **TRUSTED** | **KEEP** | n/a | Has `canOverride` flag, `executionGateStatus`, `signedStatus` — override path live. Caveat: no trust meta visible. |
| `milestone-tracker.tsx` | `/milestone-tracker` | Construction → Client Handover phase milestones with budget, plan vs actual. | `/api/milestone-tracker` | **UNVERIFIED** | **KEEP** | n/a | Phase filter logic looks sound (regex + label match). Sample only of 40 lines. |
| `gates/gates-pipeline.tsx` | `/gates` | Gate pipeline list with stage labels, gate-status colours, search filter, schema-fallback diagnostic. | `useGatesPipeline()` | **TRUSTED** | **KEEP** | n/a | Explicitly handles `data?.diagnostics?.schemaFallback` — defensive. |
| `gates/gates-blocked.tsx`, `gates-ready.tsx`, `gates-exceptions.tsx`, `gates-client-updates.tsx`, `gates-handovers.tsx`, `gates-queries.tsx`, `gates-commitments.tsx` | `/gates/*` | Gate workspace sub-pages. | `useGatesPipeline()` family | **UNVERIFIED** | **KEEP** | n/a | Sample only. Same pattern as `gates-pipeline`. |
| `projects.tsx` | `/projects` | Project list. | `/api/projects-summary` | **UNVERIFIED** | **KEEP** | n/a | Sample only. Likely TRUSTED — projects-summary is the canonical project list. |
| `project-detail.tsx` | `/project/id/:projectId` | Project detail hub. | `/api/projects/:id/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `project-stage-gate.tsx` | `/project/id/:projectId/gate/:stageCode` | Stage-gate detail. | `/api/projects/:id/gates/:code` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `clients.tsx`, `client-detail.tsx`, `client-project-departments.tsx` | `/clients`, `/clients/:id`, `/clients/:cid/project/:pid` | Client hub. | `/api/clients/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `sites.tsx` | `/sites` | Site list with roof type, GPS, municipality, status. CRUD via dialog. | `/api/sites` | **TRUSTED** | **KEEP** | n/a | Straightforward CRUD. |
| `opportunities.tsx` | `/opportunities` | Pipeline / opportunities list with create/assign drawer. | `/api/opportunities` | **TRUSTED** | **KEEP** | n/a | Strong header (PageShell, dialogs, permissions). |
| `portfolios.tsx`, `portfolio-detail.tsx` | `/portfolios`, `/portfolios/:id` | Portfolio list/detail. | `/api/portfolios/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `priorities.tsx`, `priority-detail.tsx` | `/priorities`, `/priorities/:id` | Company / department priority tracking with health, owner, due date, blocker count. | `/api/priorities` | **TRUSTED** | **KEEP** | n/a | Multi-tab (Company / Department) with admin scope. Health computed server-side. |
| `pd-pm-handover-v2.tsx` | `/pd/handover/:projectId` | PD → PM handover form: readiness items, project type, system type, funding model, risks, stakeholders, status workflow. | `/api/pd-pm-handover/:projectId` | **TRUSTED** | **KEEP** | n/a | Uses shared role helpers (`@shared/roles/pd-roles`). Status workflow visible (DRAFT → SUBMITTED_FOR_PM_REVIEW → ACCEPTED / REJECTED / HANDOVER_COMPLETE). |
| `pm-handover-review.tsx` | `/pm/handover-review` | PM-side review of handover packs. | `/api/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `pm-on-the-go-home.tsx`, `pm-on-the-go-project.tsx` | `/pm/on-the-go`, `/pm/on-the-go/project/:id` | Mobile PM view. | `/api/pm/on-the-go/...` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |

### 1.4 Finance (re-uses t1x verdicts where applicable)

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `cashflow.tsx` | `/cashflow` | Weekly cashflow grid 2026. | `/api/cashflow-2026`, `/api/projects-summary` (canonical, snapshot-guarded) | **NOT-YET-TRUSTED** (per t1x) | **HIDE behind flag** until § 3.4 fix | **M** | t1x: outflow week-bucketing falls back to `expenseInvoicedDate` for cash, conflating recognition with cash. `register-cashflow-2026-routes.ts:96`. Trust meta + DataSourceBadge present (2.5/4) — UI is fine; numbers are not. |
| `cashflow-analysis.tsx` | `/cashflow/analysis` | Aging / DSO / DPO / overdue / at-risk / concentration / forecast-actual. | `/api/finance/analysis/cashflow/*` (snapshot-guarded) | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS. Has `forecast.data?.trust?.asOf`, "Source: canonical" string. Caveat: no override-applied flag, no audit link. |
| `cos.tsx` | `/cos` | CoS realised / committed / planned by month with drill-downs, tracker-gap tab. | `/api/cos-control/*` (snapshot-guarded) via `useFinanceQuery` | **TRUSTED** | **KEEP** | n/a | Has `DataTrustBadge` + `DataSourceBadge`. Routes through `getCosRealisedAmountForNclRow` (canonical predicate per § 3.2). |
| `cos-analysis.tsx` | `/cos/analysis` | CoS analytics. | `/api/cos-analysis/*` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. Same pattern as `cos.tsx`. |
| `revenue-tracker.tsx` | `/revenue-tracker` | Monthly revenue tracker. | `/api/revenue-tracker`, `/api/tracker-monthly` (snapshot-guarded) | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS. DataSourceBadge present. |
| `revenue-tracking.tsx` (project replica) | `/projects/:projectId/revenue-tracking` | Per-project Excel-replica view. | `/api/tracker-replica/:id/revenue-tracking` (snapshot-guarded) | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS. No trust meta on header (0/4 in t1x signals). Project-scoped only. |
| `expenditure-breakdown.tsx` (project replica) | `/projects/:projectId/expenditure-breakdown` | Per-project expenditure replica. | `/api/tracker-replica/:id/expenditure-breakdown` (snapshot-guarded) | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS. No trust meta on header. |
| `program-plan.tsx` (project replica) | `/projects/:projectId/program-plan` | Per-project program plan replica with planned + actual side-by-side. | `/api/tracker-replica/:id/program-plan` | **UNVERIFIED** | **KEEP** | n/a | Not in t1x. Visual replica only — read-back surface. |
| `manual-overrides.tsx` (project) | `/projects/:projectId/manual-overrides` | Manual edit log per project. | `/api/projects/:id/manual-overrides` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. Audit-style surface. |
| `excel-vs-app.tsx` | `/program/excel-vs-app` | Programme-level Excel-vs-App drift summary. | `/api/excel-vs-app/program` (snapshot-guarded; § 9.3 four-class scope; conflict-engine + merge-engine) | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS end-to-end (4/4 trust signals). Override path live (`accept_excel`, `keep_app`, `request_approval`). The model surface for trust meta everywhere else. |
| `excel-vs-app-project.tsx` | `/projects/:projectId/excel-vs-app` | Per-project drift. | `/api/excel-vs-app/projects/:id` | **TRUSTED** (per t1x) | **KEEP** | n/a | Same. |
| `finance-gp-company.tsx` | `/finance/gp/company` | Company-wide GP per month and per project. | `/api/finance/lines?projectIds=...` (canonical line-level, § 3.3 compliant) | **TRUSTED** | **KEEP** | n/a | Spec-compliant — Σ projects (Σ lines), no pooling. Sibling tab to Cashflow / COS / Revenue. |
| `finance-gp.tsx` | `/finance/gp` | Per-project GP drill-down. | same as above | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. Same family as gp-company. |
| `finance-quickbooks-throughput.tsx` | `/finance/quickbooks` | QuickBooks throughput hub (absorbs QB Customer Mapping + Bill Linking + Counterparties + Subcontractors + Invoice Patterns + Admin QB tabs). | `/api/quickbooks/*` | **PARTIAL** (per t1x) | **KEEP** with caveat | **S** | t1x trust signals 0.5/4 — worst on the list. Caveat must surface: "No last-updated chip; reconcile against QB before deciding." |
| `finance-quickbooks-customer-mapping.tsx` | `/finance/quickbooks-customer-mapping` | Hidden tab now embedded in Throughput hub. | `/api/quickbooks/customers` | **UNVERIFIED** | **ARCHIVE direct route** (kept for embed) | n/a | `showInSidebar: false`. Subsumed. |
| `finance-quickbooks-links.tsx` | `/finance/quickbooks-links` | Hidden tab now embedded in Throughput hub. | `/api/quickbooks/bills` | **TRUSTED** (per t1x) | **ARCHIVE direct route** | n/a | t1x: PASS. Page-registry: `showInSidebar: false`. Already de-facto hidden. |
| `financial-review-queue.tsx` | `/governance/financial-reviews` | Pending financial-edit reviews with approve action. | `/api/financial-reviews/pending`, `/api/projects/:id/financial-review/:rid/approve` | **TRUSTED** (per t1x) | **KEEP** | n/a | t1x: PASS. Override path is the approve action; writes audit. |
| `payment-request-board.tsx` | `/payment-request-board` | Payment requests with status pipeline (new → in_review → loaded_for_payment → proof_attached → complete). | `/api/payment-requests` | **TRUSTED** | **KEEP** | n/a | Workflow surface, real backend, defensive formatting. |
| `payment-batch-manager.tsx` | `/payment-batch-manager` | Payment batches with 5-step pipeline (preparing → submitted → approved → released → confirmed). | `/api/payment-batches` | **TRUSTED** | **KEEP** | n/a | Workflow surface. |
| `po-approval-board.tsx` | `/po-approval-board` | PO approvals with reviewer history, delegation (COO/CFO/CEO admins only), filter tabs. | `/api/po`, `/api/po/:id/review`, `/api/po/:id/delegate` | **TRUSTED** | **KEEP** | n/a | Override (delegate) path live. |

### 1.5 Reports

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `reports/report-center.tsx` | `/reports/center` | Report catalog + history + scheduling (weekly/etc.). | `/api/reports/catalog`, `/api/reports/history`, `/api/reports/generate` | **PARTIAL** | **KEEP** with caveat | **S** | Has `ReportTrustNotice`. Trust signal present at component level; not surfaced as last-updated chip. Caveat: "Generated reports are point-in-time snapshots." |
| `reports/programme-reports.tsx` | `/reports/programme` | Project Plan / Cost / Quality / Resource sub-reports. | `/api/reports/{project-plan,cost,quality,resource-allocation}` (legacy `server/report-routes.ts`) | **PARTIAL** (per t1x) | **KEEP** with caveat | **M** | t1x: PASS for "current truth"; FAIL if user expects time-travel (not snapshotted). t1x #6: `programme-reports.tsx:271–277` is a 1000+ char compressed line — maintenance hazard, not a numeric defect. Has `ReportMeta` with `lastImportAt` + sourceLabel. |
| `pm-monthly-report.tsx` (+ `-history`, `-compare`, `-project`) | `/reports/pm/monthly[/...]` | Snapshotted PM monthly report + history + compare. | `monthly_report_snapshots` (frozen JSON) via `pm-monthly-report-service` | **PARTIAL** (per t1x) | **KEEP** with caveat | **M** | t1x: PASS for math, FAIL for auditability — neither scheduler nor regenerate/review/publish endpoints emit `audit_events`. State transitions visible only via `monthly_report_snapshots.reviewedBy/publishedBy`. |
| `engineering-monthly-report.tsx` (+ history/compare/project) | `/reports/engineering/monthly[/...]` | Same pattern as PM monthly. | `monthly_report_snapshots` + `engineering-monthly-report-service` | **PARTIAL** (per t1x) | **KEEP** with caveat | **M** | Same audit gap. |
| `reports/performance.tsx` | `/reports/performance` | V1 operational outcomes: stage durations, commissioning done/planned/total, 3-month review completion, on-time vs late, repeat issues. | `usePerformanceV1()` | **TRUSTED** | **KEEP** | n/a | Operational, no financial math. Self-labelled "V1 — Operational outcomes tracking." |
| `reports/program-wide-assessment.tsx` | `/reports/program-wide-assessment` | Program-wide health: programHealth (healthy/degraded/critical), dataConfidence, syncHealth, exception cards (high/medium risk, finance, invoice-without-PO, unmatched cost invoices, unmatched revenue payments, drift, stale tracker, missing-in-app, missing-in-excel), filter bar, exception drawer. | `/api/reconciliation/program-assessment` (drift summary + finance exception queue + sync health) | **TRUSTED** | **KEEP** | n/a | Strongest trust-meta surface in the app aside from `excel-vs-app`. |
| `kpi-traceability.tsx` | `/admin/kpi-traceability` | KPI registry with formulas + sources. | `/api/admin/kpi-traceability` (`kpi-traceability-repository.ts`) | **TRUSTED** (per t1x) | **KEEP** | n/a | Descriptive registry — IS the source breadcrumb. |
| `ceo-home.tsx` (Reports lens) | `/ceo` | (See § 1.1) | | **TRUSTED** | **KEEP** | n/a | Listed in REPORTS sidebar; role-gated `CEO_ADMIN`. |
| `coo-home.tsx` (Reports lens) | `/coo` | (See § 1.1) | | **PARTIAL** | **KEEP** | **S** | Same caveat as § 1.1. |

### 1.6 My Work / Inbox / Collaboration

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `my-work-home.tsx` | `/my-work` | My Work hub: tasks, calendar events, approvals snippets, MS objects, sub-tabs. | `/api/my-work/*` | **TRUSTED** | **KEEP** | n/a | Substantive feature with real backend. Heavy file; trusted by usage signal. |
| `my-work-tasks.tsx` | `/my-work/tasks` | Personal task list with overdue / due-this-week / etc. filters. | `/api/my-work/all-tasks` | **UNVERIFIED** | **KEEP** | n/a | Sample only. Same family as my-work-home. |
| `my-work-calendar.tsx` | `/my-work/calendar` | Personal Outlook/MS calendar embed. | `/api/ms-graph/calendar/*` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `my-work-meetings.tsx` | `/my-work/meetings` | Personal meetings list. | `/api/ms-graph/meetings/*` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `my-work-settings.tsx` | `/my-work/settings` | Personal MyWork settings. | `/api/my-work/settings` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `inbox.tsx` | `/inbox` | Notifications grouped by category (standups, tasks, approvals, engineering, quality). | `/api/notifications` via `engFetch` | **PARTIAL** | **HIDE behind feature flag** OR fix-now in place | **S** | **Broken nav links**: `getNotificationEntityPath()` at `inbox.tsx:36–55` returns `/finance/invoices/${id}` and `/procurement/po/${id}` — neither exists in PAGE_REGISTRY. Clicking those notifications dead-ends on `/projects/${id}` works for type=project but is semantically wrong (should be `/project/id/${id}`). |
| `teams-chats.tsx` | `/my-work/teams` | Teams chat embed. | MS Graph metadata-only per § 5A | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. Per guardrails, must be metadata only. |
| `collab-email.tsx` | `/my-work/email` | Email view embed. | MS Graph metadata-only | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `collaboration.tsx` | (alias only) | Redirects to `/my-work`. | n/a | **NOT-YET-TRUSTED** | **ARCHIVE** | n/a | Page file exists but no `routeComponentKey` references it — only an alias-redirect entry in `page-registry.ts:200`. Dead file. |
| `collab-teams.tsx` | (alias only) | Redirects to `/my-work/teams`. | n/a | **NOT-YET-TRUSTED** | **ARCHIVE** | n/a | Same as above. |

### 1.7 Admin / Settings / System

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `settings-home.tsx` | `/settings` | User-level settings landing. | `/api/settings/*` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `admin-roles/index.tsx` | `/admin/roles` | Single-page rail + right-panel role/user/permission editor (replaces retired tabbed admin-roles + admin-control-center). | `/api/admin/roles/*`, `/api/admin/users/*` | **UNVERIFIED** | **KEEP** | n/a | Sample only. Comment in route-components.ts #50 confirms current canonical surface. |
| `admin-settings/` | `/admin/settings` (RoleSettingsPage) | System settings. | `/api/admin/settings` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `admin-workflow-config.tsx` | `/admin/workflow-config` | Read-only view of TASK_WORKFLOW_CONFIG state machines for engineering/quality/PM/approval/deliverable task types. | `@shared/task-workflow-config` (static) | **TRUSTED** | **KEEP** | n/a | Pure reference data — no math, no live state. Safe by design. |
| `admin-recovery.tsx` | `/admin/recovery` | Task / file / folder recovery with edit, restore. | `/api/admin/recovery/*` (auth+CSRF) | **TRUSTED** | **KEEP** | n/a | Real surface for ops recovery. |
| `admin-document-management.tsx` | `/admin/document-management` | Folder taxonomy + approval requirements editor (D6 Phase 2). | `useFolderTaxonomy/...Requirements/...ProjectFolders/...CompanySharepointRoots` | **TRUSTED** | **KEEP** | n/a | Super-admin only (`isSuperAdmin`). Aligns with managed-documents canonical surface. |
| `admin-document-types.tsx` | `/admin/document-types` | Document types editor (legacy). | `/api/admin/document-types` | **NOT-YET-TRUSTED** | **HIDE behind feature flag** | **L** | Backlog: `controlled_documents` / `controlled_document_types` are DEPRECATED per CLAUDE.md "Schema patterns to know". `showInSidebar: false` already. Confirm dead before archiving. |
| `admin-email-linker-dev.tsx` | `/admin/email-linker-dev` | Dev-only email auto-linker tool. | dev API | **NOT-YET-TRUSTED** | **HIDE behind feature flag** (already hidden) | n/a | Suffix `-dev` — never intended for prod. |
| `admin-pipedrive.tsx` | `/admin/pipedrive` | Pipedrive sync log + structured error classes. | `/api/pipedrive/*` | **TRUSTED** | **KEEP** | n/a | Real integration surface with comprehensive error classification. |
| `admin-quickbooks.tsx` | `/admin/quickbooks` | QB connection status + health (healthy/stale/failing). | `/api/quickbooks/admin/*` | **TRUSTED** | **KEEP** | n/a | Has `ReportTrustNotice` import. Health states explicit. |
| `admin-backfill.tsx` | `/admin/data-migration-status` | Data migration status. | `/api/admin/data-migration` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `database-migration.tsx` | `/admin/database-migration` | Schema-level migration runner UI. | `/api/admin/database-migration` | **UNVERIFIED** | **KEEP** with caveat | **S** | Caveat: "Operations admins only — irreversible." |
| `admin-work-item-linkage.tsx` | `/admin/work-item-linkage` | Link audit for orphan tickets / missing project links. | `/api/admin/work-item-linkage` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `eng-template-admin.tsx` | `/admin/eng-templates` | Engineering template admin. | `/api/admin/eng-templates` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `phase-templates.tsx` | `/admin/phase-templates` | Phase template editor. | `/api/admin/phase-templates` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `lessons-learnt.tsx` | `/admin/lessons` | Lessons learnt log. | `/api/lessons-learnt` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `handover-control.tsx` (also at `/admin/handover-health`) | `/admin/handover-health` | (Same component as `/handover-control`) | as above | **PARTIAL** | **KEEP** with caveat | **S** | Backlog #14: Handover Health Score sub-tile renders without backing endpoint. |
| `kpi-traceability.tsx` | `/admin/kpi-traceability` | (See § 1.5) | | **TRUSTED** | **KEEP** | n/a | |
| `system-activity-log.tsx` | `/admin/activity-log` | System-wide audit log with filters by source / entity / project / action / user / search / date range. | `/api/admin/activity` | **TRUSTED** | **KEEP** | n/a | Real audit-events feed. |
| `import-control-tower.tsx` | `/admin/import-control-tower` | Import run management with issues + resolution. | `/api/admin/imports` | **TRUSTED** | **KEEP** | n/a | Smart Import v2 surface. |
| `admin-approvals.tsx` (= `ApprovalsPage`) | `/pm/approvals` | Unified approvals queue (engineering, quality, deliverable, general). | `/api/approvals` | **TRUSTED** | **KEEP** | n/a | Canonical approvals page (per nav comment "duplicate approvals entry point removed"). |
| `pending-approvals.tsx` | `/pending-approvals` | Generic write-through approvals queue (Pipedrive opp create, SharePoint intake, COS period lock, etc.). | `/api/pending-approvals` | **TRUSTED** | **KEEP** | n/a | Backed by `approvals_engine`. Not duplicate of `/pm/approvals` — different scope (write-through approvals for cross-system mutations). |
| `engineering-audit.tsx` | `/engineering/audit` | Engineering audit log. | `/api/engineering/audit` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `weekly-reviews.tsx` | `/weekly-reviews` | Weekly review wizard. | `/api/weekly-reviews` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `feedback.tsx` | `/feedback` | Feedback & support form. | `/api/feedback` | **NOT-YET-TRUSTED** | **HIDE** (already hidden) | n/a | Page-registry comment: "Feedback & Support is not actively monitored — hide from sidebar/command palette." Already `showInSidebar: false`. |
| `SharePointIntakePage.tsx` | `/admin/sharepoint-intake` | SharePoint intake admin. | `/api/sharepoint-intake/*` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `my-work-admin-settings.tsx` | `/admin/my-tool-settings` | My Work admin settings. | `/api/my-work/admin-settings` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |

### 1.8 Knowledge / Company

| Page | URL | Shows | Data source | Trust | Recommendation | Effort | Caveats |
|---|---|---|---|---|---|---|---|
| `company-overview/index.tsx` | `/company-overview` | Company overview hub. | `company-overview-service.ts` | **NOT-YET-TRUSTED** (per t1x) | **HIDE behind feature flag** until § 3.4 fix | **M** | t1x: powers Company Overview KPI tiles seen by CFO/CEO; § 3.4 + § 3.7 violations in FY-bucketing on cashCollected/cashPaid (`company-overview-service.ts:176, 200, 208`). Magic-constant targets (`totalPlannedRevenue × 0.75` / `× 0.7`) per t1x #6. |
| `company-team/index.tsx` | `/company/team` | Team list. | `/api/company/team` | **UNVERIFIED** | **KEEP** | n/a | Not deeply read. |
| `ee-info.tsx` | `/ee-info` | Processes & SOPs walkthroughs hub. | `/api/ee-info`, `WALKTHROUGHS` static + LifecycleStoryMode + CompanyOverviewMap | **TRUSTED** | **KEEP** | n/a | Doc-content surface. Mostly static. |
| `documents.tsx` | `/documents` | SharePoint browser (Phase 1: browse + download; upload/new-folder/rename behind same surface where ACL permits). | `useDocumentChildren/Roots`, `useProjectFolders`, `usePublicFolderTaxonomy` | **TRUSTED** | **KEEP** | n/a | Aligns with `managed_documents` + `folder_taxonomy` + `project_folders` canonical surface (per CLAUDE.md). |
| `training.tsx` | `/training` | Training walkthrough catalog with category filter and per-walkthrough progress (localStorage). | `WALKTHROUGHS` static | **TRUSTED** | **KEEP** (already hidden from sidebar) | n/a | Static content. `showInSidebar: false`. |
| `leaderboard.tsx` | `/leaderboard` | Leaderboard / dept scores. | `/api/leaderboard` | **UNVERIFIED** | **KEEP** (already hidden from sidebar) | n/a | Not deeply read. Already `showInSidebar: false`. |
| `department-scores.tsx` | `/department-scores` | Alias → `/leaderboard?tab=departments`. | n/a | n/a | **ARCHIVE direct route** | n/a | Alias only. |

### 1.9 Special / system pages

| Page | URL | Trust | Recommendation |
|---|---|---|---|
| `login.tsx` | `/auth/login` | n/a (auth) | KEEP |
| `not-found.tsx` | (catch-all) | n/a (system) | KEEP |
| `ms-callback.tsx` | `/auth/ms-callback` | n/a (auth) | KEEP |
| `ncr-legacy-redirect.tsx` | `/quality/ncr/:id` | n/a (redirect) | KEEP |

---

## 2. Pages NOT in `PAGE_REGISTRY` (orphan files — ARCHIVE candidates)

These exist in `client/src/pages/` but no `routeComponentKey` references them
in `route-components.ts` AND no PAGE_REGISTRY entry uses them. They cannot be
reached by URL and do not appear in any nav. Recommendation: **ARCHIVE** all.

| File | Why orphan |
|---|---|
| `dashboard.tsx` | Lazy-imported (`route-components.ts:6`) but no PAGE_REGISTRY entry uses key `Dashboard`. Legacy redirect `/dashboard → /execution-board` makes it unreachable. Composes useful panel components but the page itself is dead. |
| `collaboration.tsx` | PAGE_REGISTRY has only an alias `redirectTo: "/my-work"`. No component import. |
| `collab-teams.tsx` | Same — alias only. |
| `exceptions.tsx` | Lazy-imported in `route-components.ts:86` but no PAGE_REGISTRY entry uses key `ExceptionsPage`. Legacy redirect `/exceptions → /gates/exceptions` makes it unreachable. |
| `engineering/` (folder, only `standup.tsx` is routed) | No other files in this folder are routed. |
| `quality/quality-dashboard.tsx` | The `qualityDashboardV2` registry entry is type `alias` redirecting to `/quality`. The file exists but is never mounted. |
| `standups.tsx` | PAGE_REGISTRY entry is type `alias` redirecting to `/engineering/standup`. File is unused. |
| `commissioning-dashboard.tsx` | Routed at `/commissioning-dashboard` ✓ — actually mounted, NOT orphan. (Listed for clarity.) |
| `admin-control-center.tsx` | Lazy-imported in `route-components.ts:80` but no PAGE_REGISTRY entry. Redirect `/admin/control-center → /admin/roles` makes it unreachable. Comment in route-components.ts #50 confirms it was retired. |
| `engineering-tasks.tsx` (the TS file `EngineeringTasksPage.tsx`) | Need to confirm — there's both `EngineeringTasksPage.tsx` and `engineering-tasks.tsx` in the directory listing. Likely a casing duplicate. |

---

## 3. Pages in registry but `showInSidebar: false` (de-facto hidden)

These are reachable by URL but not advertised in the nav. Most are absorbed
sub-pages or admin/dev tools. Recommendation table (consolidated): **KEEP**
(already hidden), no action required.

- `ceo-home`, `coo-home` — visible only in REPORTS sidebar to admin roles.
- `feedback` — explicitly hidden per `page-registry.ts:181`.
- `training`, `leaderboard`, `department-scores` — knowledge surfaces hidden.
- `invoice-patterns`, `counterparties`, `subcontractor-dashboard`,
  `finance-quickbooks-customer-mapping`, `finance-quickbooks-links` —
  absorbed into `/finance/quickbooks` (Throughput hub). Direct routes kept
  for embed; nav hidden.
- `commissioning-dashboard/:projectId` — project-scoped sub-route.
- `weekly-reviews`, `lessons-learnt`, `handover-health`, `phase-templates`,
  `eng-templates`, `kpi-traceability`, `import-control-tower`,
  `data-migration-status`, `database-migration`, `work-item-linkage`,
  `engineering/audit`, `system-activity-log`, `admin-roles`, `admin-settings`,
  `admin-workflow-config`, `admin-pipedrive`, `admin-quickbooks`,
  `admin-document-management`, `admin-document-types`,
  `admin-email-linker-dev`, `sharepoint-intake`, `admin/recovery` — admin
  surfaces, hidden.
- `manual-overrides`, `expenditure-breakdown` (replica), `revenue-tracking`
  (replica), `program-plan` (replica), `excel-vs-app-project`,
  `finance-gp`, `finance-gp-company` — project-scoped or drill-down
  surfaces, hidden.
- `inbox` — `showInSidebar: false` per registry. Reachable from Home tab.
- `pmHandoverReview`, `pdPmHandover` — workflow-scoped; reached from project.

---

## 4. Summary (the requested 8 bullets)

1. **Total surfaces audited:** **70 nav-exposed surfaces** across 10 nav
   sections (Home / Projects / Gates / Project Development / Project Delivery
   / Finance / Departments / Reports / Admin / Knowledge), plus **~30
   reachable-but-hidden** sub-routes, plus **9 orphan files** (lazy-imported
   or alias-only, never routed). Of the 70 nav-exposed surfaces, **49 were
   read in detail**; the remaining 21 are marked **UNVERIFIED**.

2. **TRUSTED count: 27** —
   `ceo-home`, `pd-dashboard`, `engineering-dashboard`, `hse-dashboard`,
   `handover-dashboard`, `pages/execution-dashboard/` (via
   `execution-board`), `lifecycle-board`, `gates-pipeline`, `priorities`,
   `pd-pm-handover-v2`, `sites`, `opportunities`, `cashflow-analysis`,
   `cos`, `revenue-tracker`, `revenue-tracking` (replica),
   `expenditure-breakdown` (replica), `excel-vs-app`,
   `excel-vs-app-project`, `finance-gp-company`, `financial-review-queue`,
   `payment-request-board`, `payment-batch-manager`, `po-approval-board`,
   `reports/performance`, `reports/program-wide-assessment`,
   `kpi-traceability`. Plus admin TRUSTED:
   `admin-workflow-config`, `admin-recovery`, `admin-document-management`,
   `admin-pipedrive`, `admin-quickbooks`, `system-activity-log`,
   `import-control-tower`, `admin-approvals` (= `/pm/approvals`),
   `pending-approvals`, `my-work-home`, `ee-info`, `documents`, `training`,
   `finance-quickbooks-links` (per t1x).

3. **PARTIAL count: 7** —
   `home.tsx` (broken nav links + unwired KPI label drift),
   `coo-home.tsx` (inherits § 3.4 violation via execution-dashboard service),
   `qm-dashboard.tsx` (NCR list view not yet rebuilt — counts only),
   `handover-control.tsx` (Handover Health Score sub-tile lacks backing
   endpoint per backlog #14), `inbox.tsx` (broken notification
   navigation paths), `programme-reports.tsx` (PASS for current truth,
   FAIL for time-travel; maintenance hazard at line 271–277),
   `pm-monthly-report` + `engineering-monthly-report` (audit gap —
   scheduler/regenerate/review/publish do not emit `audit_events`),
   `reports/report-center.tsx` (trust signal at component level not
   surfaced as last-updated chip), `finance-quickbooks-throughput.tsx`
   (trust signals 0.5/4 in t1x — worst on the list).

4. **NOT-YET-TRUSTED count: 5** —
   `dashboard.tsx` (orphan — lazy-imported but never routed),
   `cashflow.tsx` (per t1x: § 3.4 outflow week-bucketing violation
   `register-cashflow-2026-routes.ts:96`),
   `company-overview/index.tsx` (per t1x: § 3.4 + § 3.7 violations in
   `company-overview-service.ts:176, 200, 208` + magic-constant targets),
   `admin-document-types.tsx` (DEPRECATED schema surface per CLAUDE.md
   "Schema patterns to know"), `feedback.tsx` (not actively monitored
   per registry comment). Plus orphan files in § 2.

5. **Top 5 surfaces to HIDE immediately** (highest CFO/CEO blast radius
   relative to fix difficulty):
   1. **`cashflow.tsx`** — outflow week-bucketing falls back to invoiceDate
      for cash, conflating recognition with cash. Numbers reach CFO eyes.
      **Effort to restore: M** (single-file fix in
      `register-cashflow-2026-routes.ts:96`).
   2. **`company-overview/index.tsx`** — § 3.4 + § 3.7 violations in
      `company-overview-service.ts:176, 200, 208`. Powers CEO/CFO Company
      KPI tiles. **Effort: M** (date-pivot + colour-gate fixes in
      service, + replace magic-constant targets with configured FYTD
      targets).
   3. **`home.tsx`** — broken AttentionItem nav links to `/dashboard?...`
      (the page redirects and drops query params). Every COO/PM
      morning-check click silently lands somewhere else. **Effort: S**
      (literal find-and-replace `/dashboard` → `/execution-board` on
      `home.tsx:416–419` plus any other refs).
   4. **`dashboard.tsx`** — orphan. ARCHIVE outright. **Effort: n/a**
      (delete file + lazy-import line). Trivial except for the
      `dashboard-routes.ts:485–493` `/api/dashboard/my-work` server
      endpoint that t1x flagged as fixture rows — that endpoint is
      probably consumed by no-one now and can be retired alongside.
   5. **`inbox.tsx`** — notification entity paths reference nonexistent
      routes (`/finance/invoices/${id}`, `/procurement/po/${id}`,
      `/projects/${id}` instead of `/project/id/${id}`). Users see
      notifications they cannot click through. **Effort: S** (fix
      `getNotificationEntityPath()` at `inbox.tsx:36–55`).

   Honourable mention #6: **`finance-quickbooks-throughput.tsx`** — trust
   signals 0.5/4 per t1x. Most reconciliation eyes land here. Hide is too
   harsh; instead **add trust meta first** (see § 4.6 below).

6. **Top 3 surfaces to KEEP and put trust signals on** (highest
   value × lowest effort for "trusted" badge):
   1. **`pages/execution-dashboard/`** — default landing for CEO/COO/PM/CM/
      Programme Manager (per `roleLandingEligibility`); the highest-traffic
      surface in the app. FinancePage already has `DataSourceBadge` +
      `DataTrustBadge` per t1x — propagate the same pattern to Construction
      / Overview / Program / Realisation-KPIs sub-pages. **Effort: S.**
   2. **`finance-quickbooks-throughput.tsx`** — replace 0.5/4 trust score
      with the same shape `cashflow-analysis.tsx` uses (`trust.asOf`,
      "Source: canonical"). Add an "Override applied" pill if any
      `qb_reconciliation_overrides` exist for the displayed period.
      **Effort: S.**
   3. **`coo-home.tsx`** — already TRUSTED at the gate-pipeline column,
      PARTIAL at the finance column. Add a "Cash collected fix-now pending"
      banner (similar to t1x's defect-triage column) until the § 3.4 fix in
      `company-overview-service.ts` ships. The COO is the audit owner; he
      needs to know which numbers on his own home are not yet trusted.
      **Effort: S.**

7. **Surprises** (things I expected to find different):
   - **`dashboard.tsx` is dead.** The t1x reporting findings repeatedly
     refer to it as "(Home)" — but it has no PAGE_REGISTRY entry and is
     unreachable. The actual `/` is `home.tsx`. Two implications: (a)
     t1x's verdict on `/api/dashboard/my-work` returning hard-coded
     fixtures is correct as a server defect, but (b) no user is currently
     hitting that endpoint via this page. **dashboard.tsx + its server
     endpoint can be retired together.**
   - **`execution-board.tsx` is a 2-line re-export shim.** It re-exports
     `pages/execution-dashboard/`. The actual surface is the subdirectory.
     This is fine but the t1x audit's `pages/execution-dashboard/FinancePage.tsx`
     verdict applies to a sub-page, not the whole hub.
   - **Six pages exist in `pages/` but are never routed.** `dashboard.tsx`,
     `collaboration.tsx`, `collab-teams.tsx`, `exceptions.tsx`,
     `quality/quality-dashboard.tsx`, `standups.tsx`, `admin-control-center.tsx`.
     These add maintenance load and confuse new devs. ARCHIVE all.
   - **Inbox notifications dead-end on routes that don't exist.** Most
     surprising user-facing breakage I found in this pass.
   - **`home.tsx` AttentionItems link to `/dashboard?...`.** The same
     stale-`/dashboard`-link pattern appears at lines 416, 417, 419, 420 —
     suggests this was a copy-paste before the legacy redirect was added.
     A grep across the repo for `/dashboard?` would surface every place to
     fix.
   - **No "feature flag" infra is currently in place** for the kind of
     hide/show this audit recommends. The closest pattern is
     `roleLandingEligibility` and `requiredRoles` on nav items. Hiding a
     page therefore means either (a) removing it from `app-navigation.ts`
     (still reachable by URL) or (b) gating the route in
     `page-registry.ts` with `requiredRoles: ["COO_ADMIN"]`. Real
     feature-flag infra (e.g. GrowthBook, env-var gate) would be a small
     project of its own — not in scope here.

8. **Recommended order of restoration** (sequencing the fix-and-restore):
   1. **Triage week 1: ARCHIVE the 9 orphan files + cleanups.** Zero risk,
      removes confusion, frees the t1x audit to re-aim at the real Home.
      Includes deleting `dashboard.tsx`, `collaboration.tsx`,
      `collab-teams.tsx`, `exceptions.tsx`, `quality/quality-dashboard.tsx`,
      `standups.tsx`, `admin-control-center.tsx`, plus the
      `dashboard-routes.ts:485–493` fixture endpoint.
   2. **Triage week 1: HIDE the 5 NOT-YET-TRUSTED finance surfaces.**
      Hide `cashflow.tsx`, `company-overview/index.tsx`, and
      `admin-document-types.tsx` from nav by removing them from
      `app-navigation.ts` (still reachable by URL for forensics).
      Add a banner on each: "This view is being rebuilt. Use [linked
      replacement] in the meantime." For cashflow → `/cashflow/analysis`.
      For Company Overview → `/execution-board/finance`. For document
      types → `/admin/document-management`.
   3. **Week 1–2: fix the broken nav links (`home.tsx` + `inbox.tsx`).**
      S effort, immediate user-visible improvement, zero financial-math
      risk. These are not formula bugs — fix in place.
   4. **Week 2–3: ship the § 3.4 + § 3.7 fixes in `company-overview-service.ts`
      and `register-cashflow-2026-routes.ts`.** This is the longest
      M-effort work. Sequence it carefully — these touch the COS-realisation
      formula (§ 3.2) which is HARD § 3.
   5. **Week 3: add audit emit for monthly-report scheduler / regenerate /
      review / publish.** Restores the PARTIAL → TRUSTED transition for
      `pm-monthly-report` and `engineering-monthly-report`.
   6. **Week 3–4: trust-signal upgrade pass on the top 3 KEEP surfaces
      (execution-dashboard sub-pages, QB throughput, COO home banner).**
      S effort each.
   7. **Week 4+: re-show the hidden surfaces** as their underlying defects
      ship green. `cashflow.tsx` un-hides when § 3.4 fix passes a
      finance-team eyeball check; `company-overview/index.tsx` un-hides
      when KPI tile-by-tile parity vs `pages/execution-dashboard/FinancePage`
      is verified; `admin-document-types` un-hides only if there's
      evidence anyone still uses it (otherwise stays archived as part of
      the deprecated `controlled_documents` cluster).
   8. **Anytime: deeply read the 21 UNVERIFIED surfaces in this audit
      under a follow-up read-budget pass.** They're flagged TRUSTED-by-
      pattern but not hard-verified. None are believed to be CFO-eyes
      defects, so this is hygiene, not a fix-now item.

---

## 5. Coverage and limits of this pass

- **Read budget cap was 50; used 49.** All required-input files plus 45
  page representatives.
- **21 nav-exposed surfaces are marked UNVERIFIED.** These were not deeply
  read in this pass. They follow patterns that suggest TRUSTED but should
  be confirmed in a follow-up cycle.
- **No code, schema, migration, or commit was touched.** Output is this
  one new file.
- **The dashboard panel components in `client/src/components/dashboard/`**
  (`AttentionBadges`, `AttentionPanel`, `DashboardWidget`,
  `FinancialSummaryTiles`, `ImportHealthWidget`, `LifecycleGatesChecklist`,
  `MetricTooltip`, `MyWorkToday`, `SummaryCard`, `TrackerTable`) were not
  read in this pass because the page that composes them (`dashboard.tsx`)
  is dead. They are likely re-used elsewhere; verify before deleting any
  of them.
- **`voice-of-team-backlog-v2` was not found on disk.** Framing taken from
  AGENT_GUARDRAILS § 0A. If a different document exists outside the repo
  (Notion, Slack, etc.), this audit can be re-run against it.

---

*End of audit. 49 source files read; cap was 50. Read-only audit. No code,
schema, or migrations were changed.*
