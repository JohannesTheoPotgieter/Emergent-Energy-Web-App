# Projects (`/projects`)

> **Draft (agent-generated):** this file was produced by an automated exploration agent and has NOT yet been verified against server handlers or schema. Table names and API paths may be approximate. A follow-up pass will trace each endpoint to its handler (file + line) and reconcile table names with `shared/schema/`.
**Source file(s):** `client/src/pages/projects.tsx`

**Route:** `/projects`

**Permission entity:** projects

**Role landing:** Project List view (PROJECT_MANAGEMENT nav group)

## Purpose
Displays comprehensive project summary directory with filtering, sorting, column configuration, and inline editing of task completion percentages. Integrates financial close document management, PM assignment, escalation tracking, and priority filtering.

## How the view is populated

- **Projects Summary**:
  - Hook: `useQuery` with queryKey `["/api/projects-summary"]`
  - API: `GET /api/projects-summary`
  - Handler file: `server/projects-routes.ts`
  - Reads tables: `project_info`, `project_execution_state`, `project_plan`, `financial_close_documents`, `priorities`, `escalations`
  - Populates: Main projects table with all columns (name, phase, kwp, PM, PD, completion %, financial data, dates, etc.)

- **PM Assignable Users**:
  - Hook: `useQuery` with queryKey `["/api/pm-assignable-users"]`
  - API: `GET /api/pm-assignable-users`
  - Reads tables: `users`, `user_roles`
  - Populates: PM dropdown in project rows

- **Priorities**:
  - Hook: `useQuery` with queryKey `["/api/priorities"]`
  - API: `GET /api/priorities`
  - Reads tables: `priorities`, `priority_linked_projects`
  - Populates: Priority filter dropdown

- **Priority Detail** (when priority filter selected):
  - Hook: `useQuery` with queryKey `["/api/priorities/{priorityFilter}/detail"]`
  - API: `GET /api/priorities/{id}`
  - Reads tables: `priority_linked_projects`
  - Populates: Filtered project list for priority

- **Project Plan (Task Completion)**:
  - Hook: `useQuery` with queryKey `["/api/project-plan", projectName]`
  - API: `GET /api/project-plan/{projectName}`
  - Reads tables: `project_plan`, `project_plan_overrides`
  - Populates: Task popover for each project (task name, actual %, expected %, duration)

## Buttons / Actions (exhaustive)

- **Save Task Edits** (in task completion popover) — saves task completion overrides
  - Mutation: `saveMutation`
  - API: `POST /api/project-plan/overrides`
  - Handler file: `server/projects-routes.ts`
  - Writes tables: `project_plan_overrides`
  - Invalidates: `/api/projects-summary`, `/api/project-plan/{projectName}`, dashboard queries
  - Side effects: Closes popover, displays toast "Edits saved"

- **Export Projects** — downloads CSV/Excel of visible projects
  - Action: `window.location.href = "/api/export/projects-summary"`
  - API: `GET /api/export/projects-summary`
  - Handler file: `server/export-routes.ts`
  - Reads tables: `project_info` and summarized data

- **Retry Projects** (error state) — refetches project list
  - Action: `refetch()`
  - API: `GET /api/projects-summary`

- **Assign PM** (inline dropdown in project row) — assign project manager
  - Mutation: `pmAssignMutation`
  - Mutation signature: `mutate({ projectInfoId, pm, pmUserId })`
  - API: `PATCH /api/project-info/{projectInfoId}/assign-pm`
  - Handler file: `server/project-info-routes.ts`
  - Writes tables: `project_info`
  - Invalidates: `/api/projects-summary`, dashboard queries
  - Side effects: Toast notification

- **Edit Financial Close Document** (Cost Proposal, Funding, EPC Contract) — open dialog to manage document
  - Dialog trigger: `openDialog()` in `FinancialCloseCell`
  - Actions within dialog:
    - **Upload File** — uploads document
      - API: `POST /api/financial-close/upload`
      - Handler file: `server/financial-close-routes.ts`
      - Writes tables: `financial_close_documents`
      - Mutation also POSTs to `/api/projects-summary/{projectName}/edit`
    - **Set Link** — manually enter document URL
      - Mutation: `mutation.mutate(payload)`
      - API: `POST /api/projects-summary/{projectName}/edit`
      - Writes tables: `financial_close_documents`
    - **Mark N/A** — set document as not applicable with reason
      - Mutation: `mutation.mutate(payload)`
      - API: `POST /api/projects-summary/{projectName}/edit`
    - **Clear** — remove document entry
      - Mutation: `mutation.mutate(payload)`
      - API: `POST /api/projects-summary/{projectName}/edit`

- **Latest Update Editor** (in project row) — edit/add latest update note
  - Component: `LatestUpdateEditor`
  - Mutation: Direct `fetch` to `/api/projects-summary/{projectName}/latest-update`
  - API: `POST /api/projects-summary/{projectName}/latest-update`
  - Writes tables: `project_info` (latest_update, latest_update_at, latest_update_by)
  - Side effects: Invalidates projects-summary

- **Escalation Level** (dropdown menu) — set escalation status
  - Mutation: `escalationMutation`
  - Mutation signature: `mutate({ projectInfoId, escalationLevel })`
  - API: `PATCH /api/projects-summary/{projectInfoId}/escalation`
  - Handler file: `server/projects-summary-routes.ts`
  - Writes tables: `project_escalations` or `project_info`
  - Invalidates: `/api/projects-summary`, dashboard queries

- **Quick Filter Tabs** (buttons) — filter by status/assignment
  - Options: "Behind Plan", "Needs Attention", "My Projects"
  - Action: `setQuickFilter()`
  - Client-side filtering: No API call, filters `sorted` array

- **PM Filter** (dropdown) — filter by project manager
  - Action: `setPmFilter()`
  - Client-side filtering: Filters `sorted` array

- **RAG Status Filter** (dropdown) — filter by Red/Amber/Green status
  - Action: `setRagFilter()`
  - Options: Red, Amber, Green, All
  - Client-side filtering: Filters `sorted` array

- **Phase Exclusion** (checkboxes) — exclude phases from view
  - Action: `togglePhaseExclusion()`
  - Client-side filtering: Filters `sorted` array

- **Column Visibility** (header menu) — show/hide columns
  - Action: `toggleColumn()`, `selectAllColumns()`
  - Client-side only: Updates `visibleColumns` Set

- **Column Resize** (drag on column border) — resize table columns
  - Action: Drag handler with `onResizeStart()`, mouse listeners
  - Client-side only: Updates `colWidths` map

- **Sort Column** (click column header) — sort by column
  - Action: `handleSort(key)`
  - Logic: Toggles sort direction or changes sort key
  - Client-side: Updates `sortKey`, `sortDir`

- **Save View** (button in view menu) — save current column/filter configuration
  - Action: `saveView()`
  - Client-side: Persists to localStorage via `persistSavedViews()`

- **Project Link** (project name) — navigate to project detail
  - Component: `<Link>`
  - Navigation: To `/project/{projectName}`

## Tabs / Sub-views / Filters / Sorts

- **View Tabs**: Active (has_tracker_import=true) vs Archived (is_active=false)
  - Action: `setViewTab()`
  - Filters `projects` into `activeProjects` or `archivedProjects`

- **Quick Filter Tabs**: "Behind Plan", "Needs Attention", "My Projects"
  - Delta vs expected < -10% → Behind Plan
  - RAG Red/Amber OR escalation level set → Needs Attention
  - pm === currentUserName → My Projects

- **Stage Filter** (URL-driven): pd-pipeline, execution, closeout, post-handover
  - From page-registry secondary nav
  - Maps to phase lists via `STAGE_FILTER_PHASES`

- **Sortable Columns**: project_name, phase, size_kwp, pd, pm, project_pct_complete, delta_vs_expected, total_contract_revenue, gp_percent, construction_start_date, commissioning_date, om_handover_date

- **Default Columns**: project_name, phase, size_kwp, pd, pm, project_pct_complete, expected_pct_complete, delta_vs_expected, financial_close_achieved, total_contract_revenue, gp_percent, commissioning_date, om_handover_date

## Numbers / Counters / KPIs shown

- **Total Projects** — count of sorted projects
- **Total kWp** — sum of size_kwp for filtered projects
- **Avg Completion %** — mean of project_pct_complete (only projects with non-null value)
- **Behind Schedule Count** — count where delta_vs_expected < -5%
- **Financial Close Count** — count where financial_close_achieved = true
- **Project Completion %** (per project) — calculated from task-weighted percentages or project_pct_complete
- **Expected Completion %** (per project) — from expected_pct_complete
- **Delta vs Expected** (per project) — actual - expected, colored by range
- **GP %** — gross profit percent, from gp_percent
- **COS Realized %** — cost of sales realized percentage
- **Task Completion Bar** (popover) — weighted average of task completion %

## Dialogs / Modals opened from this page

- **Task Completion Popover** (`TaskCompletionPopover` component)
  - Triggered: Click progress bar in project row
  - Query: `useQuery` for `/api/project-plan/{projectName}`
  - Mutation: `POST /api/project-plan/overrides` to save edits
  - Inputs: Task name, actual %, expected %, duration days
  - Shows: Weighted completion % based on duration, created count from hydrate

- **Financial Close Dialog** (`FinancialCloseCell` component)
  - Triggered: Click pending/link/na badge or edit button
  - Modes: "link" (upload/enter URL), "na" (mark not applicable), null (pending)
  - Mutation: `POST /api/projects-summary/{projectName}/edit` or `POST /api/financial-close/upload`
  - File upload: Multipart form data to `/api/financial-close/upload`

- **Latest Update Editor Dialog** (`LatestUpdateEditor` component)
  - Triggered: Click latest update text or edit icon
  - Mutation: `POST /api/projects-summary/{projectName}/latest-update`
  - Fields: Update text, auto-timestamps with current user

## Navigation out of this page

- **Project Name Link** → `/project/{projectName}` (to project detail)
- **Sidebar Navigation** → Various other pages (portfolios, clients, sites, etc.)

