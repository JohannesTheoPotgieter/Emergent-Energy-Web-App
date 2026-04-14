# Home (`/`)

**Source file:** `client/src/pages/home.tsx` (974 lines)
**Route:** `/` — registered eagerly in `client/src/App.tsx:58,387` (loaded
non-lazy because it is the authenticated landing page).
**Permission entity:** `home` (`PAGE_REGISTRY` id `myWork` uses
`/my-work` but `/` is a hard-coded route inside `ProtectedPages`, not
driven by the registry — effectively permission-ungated for any
authenticated user).
**Role landing:** catch-all. Users whose role has a specific
`ROLE_LANDING_PAGE` entry are redirected elsewhere by `HomeRedirect`
(`App.tsx:300`); everyone else lands here.

**Sub-pages embedded as tabs** (via React `lazy`):
- `client/src/pages/my-work-tasks.tsx` (not actually mounted by any
  tab — imported but unused)
- `client/src/pages/my-work-calendar.tsx` → Calendar tab
- `client/src/pages/my-work-meetings.tsx` → Meetings tab
- `client/src/pages/inbox.tsx` → Inbox tab
- `client/src/components/approvals/unified-approvals-queue.tsx` → Approvals tab

> Each of those sub-pages has its own document in `pages/` (once that
> batch is complete). This file only covers what the *Home* page adds on
> top of the embedded views.

## Purpose
Role-aware landing page. Three responsibilities:
1. **Greet** the user and show their current "lens" (role label).
2. **Surface company-level signal**: Company Priorities, Attention
   Needed badges, and a compact KPI grid whose composition is
   determined by the user's effective role.
3. **Act as a tab container** so most My-Work views (Calendar,
   Meetings, Inbox, Approvals) render in place without a full page
   navigation.

## How the view is populated

All four main data fetches run unconditionally on mount via
`useQuery({...})` hooks at the top of `HomePage` (`home.tsx:207–239`).
Each call goes through the shared `apiRequest` helper from
`client/src/lib/queryClient.ts`, which attaches `Authorization: Bearer`
from `localStorage` and the CSRF token.

### 1. Program/portfolio rollup (`dashData`) — `home.tsx:207`
- Hook: `useQuery<any>({ queryKey: ["/api/lifecycle-board/execution-dashboard"], queryFn: ... })`
- API: `GET /api/lifecycle-board/execution-dashboard`
- Handler: `server/lifecycle-routes.ts:821`
  (`app.get("/api/lifecycle-board/execution-dashboard", requireAuth, ...)`)
- Reads tables (direct Drizzle queries inside the handler):
  - **`project_info`** (SELECT + `.leftJoin(projectExecutionState, ...)`)
  - **`project_execution_state`** (left-joined)
  - **`work_items`** (via `getAllPMWorkItemsAsProjectPlan()` in
    `server/work-items-adapter.ts:382` — filters by
    `workstream='PM' AND source='SMART_IMPORT' AND deleted_at IS NULL`
    and joins back to `project_info` for the project name)
  - **`approvals`** (`.from(approvals)` — counts pending)
  - **`normalized_cost_lines`** (for FY expenditure calculations)
  - **`normalized_revenue_lines`** (for FY inflow calculations)
  - **`qc_warning`** (for `openQualityWarnings` KPI)
  - **`users`** (for owner name resolution)
  - **`smart_import_runs`** (read to correlate work-item source runs)
- Populates:
  - `stats` object (`home.tsx:258`) — totalProjects, activeProjects,
    greenProjects, amberProjects, redProjects (counted client-side from
    `dashData.projects[]`)
  - `kpis` object — all the values shown in KPI cards (see each layout
    variant below). Keys include `receivedInflowFy`, `grossMarginPctFy`,
    `plannedRevenueFy`, `plannedExpenditureFy`, `paidExpenditureFy`,
    `openExpenditureFy`, `overdueOutflowFy`, `overdueInflowFy`,
    `grossProfitFy`, `projectsBehindPlan`, `openEngineeringBlockers`,
    `openQualityWarnings`, `pendingApprovals`,
    `averageActualProgressPct`.
  - `dashData.actionCenter.rows[]` — fuels the expanded attention-row
    tables (see Attention Needed section below).

### 2. Company priorities (`companyPrioritiesRaw`) — `home.tsx:215`
- Hook: `useQuery<any[]>({ queryKey: ["/api/priorities"], ... })`
- API: `GET /api/priorities`
- Handler: `server/departments/priority-strategic-routes.ts:220`
  (`router.get("/api/priorities", requireAuth, ...)`)
- Reads tables:
  - **`mytool_company_priorities`** (primary SELECT at
    `priority-strategic-routes.ts:232`; raw-SQL fallback at L236 reads
    the same table by name)
  - **`mytool_company_priorities`** again — a second SELECT at L318 for
    parent titles (for hierarchical display)
  - **`mytool_company_priorities`** — a third raw aggregate at L303 for
    child counts per parent
  - **Database view `priority_derived_metrics`** (not a Drizzle table —
    raw `SELECT * FROM priority_derived_metrics` in
    `getAllPriorityDerivedMetrics()` at L119). This view is defined
    outside Drizzle in SQL migrations.
  - **`users`** (via `getUsersByIds()` at L133 — owner name lookup)
  - **`priority_projects`** (indirectly — `enrichPriority()` at L139
    uses it through `getLinkedProjectsForPriority()`)
- Populates:
  - `companyPrioritiesRaw[]` filtered client-side
    (`home.tsx:222`) to drop items whose `status` is `"complete"` or
    `"completed"` → `companyPriorities[]`.
  - `visiblePriorities = companyPriorities.slice(0, 3)` (always
    visible).
  - `hiddenPriorities = companyPriorities.slice(3)` (behind "Show N
    more" collapsible).
  - Each item renders as a `<PriorityCard>` at `home.tsx:937`.

### 3. My Work aggregate (`myWorkData`) — `home.tsx:224`
- Hook: `useQuery<any>({ queryKey: ["/api/my-work/all-tasks"], ... })`
- API: `GET /api/my-work/all-tasks`
- Handler: `server/ms-sync-routes.ts:519`
  (`app.get("/api/my-work/all-tasks", jwtAuth, requireAuth, ...)`)
- The handler runs 8 parallel queries (`Promise.all` at L535) and
  unions the results into `{ items: [...] }`. Tables touched:
  - **`work_items`** + **`work_item_assignments`** (raw SQL at L536 —
    items where the caller is owner OR appears in
    `work_item_assignments.user_id`, joined to `project_info`)
  - **`project_info`** (left-joined above for `project_name`)
  - **`tr_items`** (`.from(trItems)` at L547 — items where user is in
    `owners[]` or `owner_user_ids[]`)
  - **`project_eng_approvals`** (innerJoin chain at L552)
  - **`project_eng_stages`** (joined)
  - **`eng_stage_templates`** (joined)
  - **`project_info`** (joined again for project name)
  - **`qc_item_instance`** + **`qc_template_item`** +
    **`qc_checklist`** (for QC items assigned to the user)
  - **`approvals`** (`.from(approvals)` — generic approvals queue)
  - **`deliverables`** (`.from(deliverables)` — deliverables owned by
    user)
  - **`ms_objects`** (`.from(msObjects)` — Microsoft-origin tasks
    tagged to user)
- Populates:
  - `myOpenTasks` (`home.tsx:297`) — count of items whose status isn't
    `complete`, `done`, `closed`, or `cancelled`.
  - `myPendingActions` (`home.tsx:284`) — subset that is both
    overdue *and* open.
  - Indirectly drives the `"My Overdue Actions"` row in
    `attentionActionRows` (`home.tsx:352`).

### 4. Overdue finance drill-down (`overdueData`) — `home.tsx:232`
- Hook: `useQuery<any>({ queryKey: ["/api/lifecycle-board/overdue-payments"], enabled: overdueDrill !== null })`
- API: `GET /api/lifecycle-board/overdue-payments`
- Handler: `server/lifecycle-routes.ts:1272`
- Reads tables:
  - **`project_info`** + **`project_execution_state`** (left-join for
    active projects, L1278)
  - **`normalized_revenue_lines`** (L1286 — all rows where
    `effective_to IS NULL`, for AR overdue)
  - **`normalized_cost_lines`** (L1303 — same, for AP overdue)
- The lazy trigger is `setOverdueDrill("ap" | "ar")` — the query stays
  disabled until one of the overdue KPI cards is clicked.
- Populates:
  - `currentOverdue` (`home.tsx:270`) — either
    `overdueData.outflow` or `overdueData.inflow` based on which KPI
    was clicked.
  - `overdueRows[]` → the rows in the drill-down dialog's HTML table.

## Tabs

Five tabs declared in `HOME_TABS` (`home.tsx:103`). The active tab is
kept in `activeTab` state, defaulting to `"actions"` unless the URL has
`?tab=<key>`.

| Key | Label | Icon | Content source |
|-----|-------|------|----------------|
| `actions` | Actions | `ListChecks` | inline role-specific layout (see below) |
| `approvals` | Approvals | `ClipboardCheck` | lazy `UnifiedApprovalsQueue` from `client/src/components/approvals/unified-approvals-queue.tsx` |
| `calendar` | Calendar | `Calendar` | lazy `MyWorkCalendarPage` (see `pages/my-work-calendar.md`) |
| `meetings` | Meetings | `MessageSquare` | lazy `MyWorkMeetingsPage` (see `pages/my-work-meetings.md`) |
| `inbox` | Inbox | `Inbox` | lazy `InboxPage` (see `pages/inbox.md`) |

Each tab swap is a pure client-side `setActiveTab(key)` — no API call.
The embedded Approvals/Calendar/Meetings/Inbox components run *their
own* queries when they mount. Their data blocks are documented in the
linked per-page files above.

## Role layouts (`layoutGroup`)

`layoutGroup` is derived from `lens.activeLens` at `home.tsx:247`:

| Group | Triggering lens roles |
|-------|-----------------------|
| `leadership` | `CEO`, `COO_SUPER_ADMIN` |
| `portfolio-manager` | `PROGRAM_MANAGER` |
| `delivery` | `PROJECT_MANAGER`, `CONSTRUCTION_MANAGER` |
| `specialist` | `ENGINEER`, `QUALITY_MANAGER` |
| `finance` | `CFO`, `PROGRAM_FINANCE_MANAGER` |
| `default` | anything else |

### leadership layout (`home.tsx:616`)
Section "Portfolio Health" — 3 `kpiCard`s:
- **Active Projects** = `stats.activeProjects` (from
  `dashData.projects.length`)
- **Red RAG** = `stats.redProjects` (count of
  `projects.filter(p => p.rag === "Red")`)
- **Behind Plan** = `kpis.projectsBehindPlan`

Section "Financial Snapshot" — 3 `kpiCardDual`s (planned / actual):
- **Inflows (FY)** — `kpis.plannedRevenueFy` / `kpis.receivedInflowFy`
- **Gross Profit (FY)** — `kpis.grossProfitFy` /
  `(kpis.receivedInflowFy − kpis.paidExpenditureFy)` (computed inline)
- **COS (FY)** — `kpis.plannedExpenditureFy` / `kpis.paidExpenditureFy`

Below, 2 clickable `kpiCard`s:
- **AP Overdue (Outflows)** = `money(kpis.overdueOutflowFy)` — onClick
  sets `overdueDrill="ap"` → triggers the overdue dialog (and the
  `/api/lifecycle-board/overdue-payments` query).
- **AR Overdue (Inflows)** = `money(kpis.overdueInflowFy)` — same with
  `"ar"`.

Both have long `helpText` tooltips explaining their filter logic
(readable verbatim at `home.tsx:640` and `home.tsx:648`).

Right column: "Your Workspace" — a `workspaceCard` with two buttons:
- **View My Tasks** → `/my-work/tasks`
- **Approvals (N)** → `/pm/approvals` (only if `kpis.pendingApprovals > 0`)

### portfolio-manager layout (`home.tsx:669`)
Section "Portfolio Overview" — same 3 KPI cards as leadership
(Active / Red RAG / Behind Plan) but with `scopeLabel: "Portfolio"`.

Section "Delivery Health" — 3 cards:
- **Avg Progress** = `kpis.averageActualProgressPct` (formatted as
  integer %)
- **Eng. Blockers** = `kpis.openEngineeringBlockers`
- **Quality Warnings** = `kpis.openQualityWarnings`

Right column: same "Your Workspace" card.

### delivery layout (`home.tsx:702`)
Workspace card moved to the LEFT (2/5 width).

Section "Delivery Status" — 4 cards (2×2 grid):
- **Active Projects** = `stats.activeProjects`
- **Red RAG** = `stats.redProjects`
- **Behind Plan** = `kpis.projectsBehindPlan`
- **Avg Progress** = `kpis.averageActualProgressPct`

### specialist layout (`home.tsx:728`)
Workspace card on the LEFT with two buttons:
- **View My Tasks** → `/my-work/tasks`
- `config.cockpitLabel` → `config.cockpitPath` (from
  `getLensDashboardConfig(effectiveRole)`)

Right column varies:
- If `lens.activeLens === 'ENGINEER'` — section "Engineering Health":
  Eng. Blockers / Quality Warnings / Avg Progress / Behind Plan
- Else — section "Quality & Delivery": Quality Warnings / Pending
  Approvals / Avg Progress / Behind Plan

### finance layout (`home.tsx:765`)
Two sections of 3 cards each:
1. **Financial Overview** — Inflow (FY) / Gross Margin / Gross Profit
2. (unlabelled) — Open Expenditure / Paid Expenditure / Overdue Inflow

Right column: same "Your Workspace" card.

### default layout (`home.tsx:797`)
Workspace card on the LEFT. Right column "Key Metrics" is driven by
`getKpiCards(config, kpis, stats, isLoading)` at `home.tsx:117`. That
helper maps the user role's `config.kpis` keys (from
`client/src/config/role-dashboard-config.ts`) onto a hard-coded
`kpiKeyMap` (`home.tsx:123`) that covers 40+ named KPIs, all computed
from the same `dashData.kpis` / `stats` objects populated by the
`execution-dashboard` query. The first 4 unique-by-label matches are
rendered.

Examples of mapped KPIs:
`revenue_vs_target`, `gp_margin`, `projects_off_track`, `open_vos`,
`projects_on_track`, `milestones_due`, `overdue_tasks`, `my_projects_rag`,
`my_overdue_tasks`, `my_approvals_pending`, `my_deliverables_due`,
`my_eng_tasks`, `design_queue`, `review_queue`,
`my_overdue_deliverables`, `my_opportunities`, `handover_readiness`,
`pd_tickets_open`, `proposals_pending`, `revenue_this_month`,
`cos_this_month`, `cash_position`, `margin_drift`, `open_ncrs`,
`snags_due`, `inspections_pending`, `corrective_actions_open`,
`active_sites`, `site_readiness`, `open_snags`, `inspections_due`,
`incidents_open`, `corrective_actions_due`, `safety_file_compliance`,
`inspections_overdue`, `applications_pending`, `queries_outstanding`,
`approvals_due`, `rejections_open`, `my_tasks`, `my_approvals`,
`my_projects`, `upcoming_events`.

## "Attention Needed" badges (`home.tsx:528`)

`attentionItems` is built at `home.tsx:307` with conditional entries.
Each row is a clickable button; `onClick` toggles
`expandedAttention` which reveals an inline action-row table (max 8
rows, plus a "view all" link to `href`).

| Label | Shown when | Value | Badge color | "View all" `href` | Action rows source |
|-------|-----------|-------|-------------|-------------------|---------------------|
| Red RAG Projects | `stats.redProjects > 0` | `stats.redProjects` | red | `/dashboard?rag=Red` | `dashData.projects.filter(p=>p.rag==="Red")` |
| Behind Plan | `kpis.projectsBehindPlan > 0` | `kpis.projectsBehindPlan` | amber | `/dashboard?behindPlanOnly=true` | `dashData.actionCenter.rows.filter(r=>r.queue==="Projects Behind Plan")` |
| Pending Approvals | `kpis.pendingApprovals > 0` | `kpis.pendingApprovals` | blue | `/pm/approvals` | `dashData.actionCenter.rows.filter(r=>r.queue==="Pending Approvals / Decisions")` |
| Eng. Blockers | `kpis.openEngineeringBlockers > 0` | `kpis.openEngineeringBlockers` | violet | `/dashboard?engineeringBlockersOnly=true` | `dashData.actionCenter.rows.filter(r=>r.queue==="Engineering Bottlenecks")` |
| Quality Warnings | `kpis.openQualityWarnings > 0` | `kpis.openQualityWarnings` | orange | `/dashboard?qualityIssuesOnly=true` | `dashData.actionCenter.rows.filter(r=>r.queue==="Quality Issues")` |
| My Overdue Actions | `myPendingActions > 0` | `myPendingActions` | rose | `/my-work/tasks?overdue=1` | `myWorkData.items.filter(overdue && open)` |

All six "view all" links are plain `<Link>` navigations — no mutation
calls.

## Company Priorities section (`home.tsx:477`)

Renders above the attention badges when `companyPriorities.length > 0`.
A `<Collapsible>` wraps:
- Card header with:
  - Label "Company Priorities"
  - Badge `${companyPriorities.length} active`
  - **"View all"** link → `/priorities` (see `pages/priorities.md`)
- `visiblePriorities` (first 3) rendered as `<PriorityCard>` grid.
- `hiddenPriorities` (rest) inside `CollapsibleContent`.
- `CollapsibleTrigger` button:
  - Text: `"Show N more"` / `"Show less"` with a rotating chevron.

### `<PriorityCard>` sub-component (`home.tsx:937`)
A priority rendered as a card with:
- Border-left color by `priority.effectiveHealth`:
  `critical` → red, `at_risk` → amber, else emerald.
- Dot + title linking to **`/priorities/${priority.id}`**
  (`home.tsx:949`) — i.e. `PriorityDetailPage`.
- Severity badge (`Critical` / `High` / `Normal`).
- Owner name (`priority.owner.name` or `assignedTo` fallback).
- Days-to-due (red ≤ 7, amber ≤ 14).
- Blocker count.
- Progress bar driven by `priority.effectiveProgress`.
- Footer: `"${progress}%"` (plus `(manual)` if no linked projects) and
  `"${projectCount} projects"` / `"Standalone"`.

All of these fields come from the enriched `GET /api/priorities`
response (see data block #2 above) — no extra query per card.

## "Navigate To" grid (`home.tsx:822`)

Shown under every layout. Maps over `config.quickActions` (from
`getLensDashboardConfig(effectiveRole)` in
`client/src/config/role-dashboard-config.ts`).

Each item is a `<Link href={action.path}>` wrapping a `<Card>` with:
- Icon from `resolveIcon(action.iconKey)` (`home.tsx:99`) — mapped via
  `ICON_MAP` to a Lucide icon.
- Label text.
- Trailing chevron.

No API calls; pure navigation shortcuts. Destinations vary by role and
can be any path in the registry.

## Overdue drill-down dialog (`home.tsx:865`)

Opens when any overdue KPI card is clicked (sets `overdueDrill`). Title
is `"AP Overdue (Outflows) details"` or `"AR Overdue (Inflows)
details"`.

Content:
- Header line: `"Total outstanding: <money> · <count> item(s)"` and
  `"As of <overdueData.asOfDate>"` (overdueData.asOfDate comes from the
  handler's `today` at `lifecycle-routes.ts:1275`).
- Warning badge: `"N item(s) were excluded because due date is
  missing..."` when `currentOverdue.missingDueDateCount > 0`.
- Table (10 columns): Project, Supplier/Client, Invoice #, Invoice Date,
  Due Date, Outstanding, Days Overdue, Owner/PM, Status, Link.
  Each row's `recordLink` is rendered as an `<Link>` "Open" if present.
- Empty state copy varies based on whether missing-due-date items
  exist (`home.tsx:885`).

Closing the dialog (`onOpenChange(false)`) resets `overdueDrill = null`
but the `useQuery` keeps the cached data.

## Forms / Inputs

None — this page is entirely read-only. There is no form, no textarea,
no editable field.

## Tabs / Sub-views / Filters / Sorts
See **Tabs** section above. No client-side filters or sorts beyond the
`expandedAttention` toggle.

## Numbers / Counters / KPIs shown
Every KPI on every layout variant is covered in the **Role layouts**
section above. All numeric values trace back to either:
- `stats` (computed from `dashData.projects[]`), or
- `kpis` (the `dashData.kpis` object returned by the
  `execution-dashboard` handler), or
- `myOpenTasks` / `myPendingActions` (computed from
  `myWorkData.items[]`).

## Dialogs / Modals opened from this page
1. **Overdue drill-down dialog** — described above.

No other dialogs are declared in this file.

## Navigation out of this page

From the body:
- `/priorities` — "View all" link above priorities section.
- `/priorities/:id` — each `<PriorityCard>` title click.
- `/my-work/tasks` — workspace card "View My Tasks" button.
- `/pm/approvals` — workspace card "Approvals (N)" button (conditional).
- `<config.cockpitPath>` — specialist / default layouts' second
  workspace button. Resolves per role.
- **Attention Needed** "view all" links:
  - `/dashboard?rag=Red`
  - `/dashboard?behindPlanOnly=true`
  - `/dashboard?engineeringBlockersOnly=true`
  - `/dashboard?qualityIssuesOnly=true`
  - `/pm/approvals`
  - `/my-work/tasks?overdue=1`
- **Attention expanded action rows** — each row's `link` (from
  `dashData.actionCenter.rows[].link`) is project-specific, e.g.
  `/project/<projectName>` or `/pm/approvals/<id>`.
- **Navigate To** grid — each `action.path` from `config.quickActions`.
- **Overdue dialog rows** — `row.recordLink` per row.

From the tab content (embedded):
- Approvals / Calendar / Meetings / Inbox tabs embed other pages and
  may issue their own navigations — see their respective docs.

## Database tables touched (direct + transitive)

From the handlers backing this page's four queries:

| Table (SQL) | Via which handler |
|-------------|-------------------|
| `project_info` | `/api/lifecycle-board/execution-dashboard`, `/api/lifecycle-board/overdue-payments`, `/api/my-work/all-tasks` |
| `project_execution_state` | execution-dashboard (leftJoin), overdue-payments (leftJoin) |
| `work_items` | execution-dashboard (via `getAllPMWorkItemsAsProjectPlan`), all-tasks (raw SQL) |
| `work_item_assignments` | all-tasks (raw SQL join) |
| `approvals` | execution-dashboard, all-tasks |
| `normalized_cost_lines` | execution-dashboard, overdue-payments |
| `normalized_revenue_lines` | execution-dashboard, overdue-payments |
| `qc_warning` | execution-dashboard |
| `qc_item_instance` | all-tasks |
| `qc_template_item` | all-tasks |
| `qc_checklist` | all-tasks |
| `project_eng_approvals` | all-tasks |
| `project_eng_stages` | all-tasks |
| `eng_stage_templates` | all-tasks |
| `deliverables` | all-tasks |
| `ms_objects` | all-tasks |
| `tr_items` | all-tasks |
| `smart_import_runs` | execution-dashboard |
| `users` | execution-dashboard (name lookups), priorities (owner lookups), all-tasks (user map) |
| `mytool_company_priorities` | `/api/priorities` (three separate SELECTs) |
| `priority_projects` | `/api/priorities` (via `enrichPriority` linked-projects lookup) |
| `priority_derived_metrics` | `/api/priorities` (raw SELECT from a SQL-defined view, not a Drizzle table) |

> No writes. This page is a pure read surface — every button on it
> either navigates, toggles client state, or opens the (read-only)
> overdue dialog.

