# Engineering Dashboard (`/engineering`)

> **Draft (agent-generated):** this file was produced by an automated exploration agent and has NOT yet been verified against server handlers or schema. Table names and API paths may be approximate. A follow-up pass will trace each endpoint to its handler (file + line) and reconcile table names with `shared/schema/`.
**Source file(s):** `client/src/pages/engineering-dashboard.tsx` (main) + sub-components

**Route:** `/engineering` (id: `engineering`)

**Permission entity:** `engineering` (view)

## Purpose
High-level standup and team operations dashboard showing task blockers, overdue items, upcoming deadlines, team workload, project health, and recent activity. Managers see all tasks; engineers see their own tasks.

## How the view is populated

### Data Block 1: Dashboard Overview
- **Hook:** `useQuery(['eng-overview', assigneeParam])`
- **API:** `GET /api/eng/dashboard/overview` (with optional `?assignee=` param)
- **Handler file:** `server/engineering-routes.ts` (line 2222)
- **Reads tables:** `work_items`, `project_info`, `project_execution_state`, `users`
- **Populates:** Summary (totalProjects, activeTasks, overdueTasks, etc.), task lists (recentlyCompleted, blockers, upcomingThisWeek, needsApproval, inProgressHighlights, otherActive), workload, projectHealth, statusPipeline

### Data Block 2: Company Priorities
- **Hook:** `useQuery(['/api/mytool/company-priorities'])`
- **API:** `GET /api/mytool/company-priorities`
- **Handler file:** NOT FOUND (external service)
- **Populates:** CompanyPrioritiesSection component

### Data Block 3: Activity Feed
- **Hook:** `useQuery(['eng-activity-feed'])`
- **API:** `GET /api/eng/audit-log?limit=15`
- **Handler file:** `server/engineering-routes.ts` (line 2679)
- **Reads tables:** `task_activity_log`, `users`, `work_items`, `project_info`
- **Populates:** ActivityFeed component with recent changes

## Buttons / Actions (exhaustive)

### Top Navigation
- **"Audit Log"** (admin only) → Navigate to `/engineering/audit`
- **"More" menu toggle** → Show/hide popover
  - **"My Tasks" / "All Tasks"** → Toggle `showAllTasks`, refetch with/without assignee filter
- **"Go to Task Execution Board"** → Navigate to `/engineering/tasks`

### KPI Strip (7 clickable cards)
1. **Projects** → Scroll to project-health-grid
2. **Active** → Navigate to `/engineering/tasks?status=IN+PROGRESS`
3. **Overdue** (pulses if > 0) → Navigate to `/engineering/tasks?dueDate=overdue`
4. **On Hold** → Navigate to `/engineering/tasks?status=HOLD`
5. **Approvals** → Navigate to `/engineering/tasks?status=NEEDS+APPROVAL`
6. **Due This Week** → Navigate to `/engineering/tasks?dueDate=this_week`
7. **Done (24h)** → Navigate to `/engineering/tasks?status=COMPLETE`

### Collapsible Sections (toggleable)
- **Blockers & Escalations** (default open)
- **Needs Approval / Feedback** (default open if ≤5)
- **Due This Week** (default open)
- **In Progress** (default closed)
- **Other Active Tasks** (default open)
- **Recently Completed (24h)** (default closed)

Each contains TaskRow items that navigate to `/engineering/tasks?taskId={id}` on click.

### Project Health Grid
- **Click project card** → Navigate to `/project/{trackerName}`

### Workload Table
- **Click person row** → Navigate to `/engineering/tasks?assignee={personName}`

## Forms / Inputs
None. All interactions through buttons, toggles, and card clicks.

## Tabs / Sub-views / Filters / Sorts

### Primary Filter: Task Assignment
- **State:** `showAllTasks` (boolean)
- **Toggle:** "More" popover menu
- **Effect:** Changes query param `?assignee={firstName}` in dashboard overview API call
- **Scope:** All task lists affected

### Project Health Sorting
- **By RAG status:** RED > AMBER > GREEN
- **Within RAG:** By overdue count (descending)

### Workload Sorting
- **By:** overdue count (desc), then active count (desc)

### Company Priorities Sorting
- **By severity:** critical > important > normal
- **Within severity:** critical health > at_risk > healthy

### Status Pipeline (in Status Pipeline card)
- **Predefined order:** TO DO, IN PROGRESS, NEEDS APPROVAL, QC APPROVED, PROVIDE FEEDBACK, PROJECTS ASSISTANCE, HOLD, COMPLETE

## Numbers / Counters / KPIs shown

**KPI Strip:**
- Total Projects
- Active Tasks (count)
- Overdue Tasks (count, pulses if > 0)
- On Hold (count)
- Approvals (count)
- Due This Week (count)
- Done in 24h (count)

**Project Health Cards:**
- Completion percentage (bar)
- Active task count
- Overdue count (highlighted red)
- Hold count (highlighted amber)
- Due this week count
- RAG status (RED/AMBER/GREEN)

**Workload Table:**
- Active task count per person (bar)
- Due This Week count
- Overdue count (badge)
- On Hold count (badge)

**Status Pipeline Card:**
- Status name
- Task count per status
- Percentage bar

**Activity Feed:**
- Actor name + initials
- Action type (status change, comment, created)
- Task title
- Timestamp (HH:MM)

## Dialogs / Modals opened
None.

## Navigation out of this page

1. `/engineering/audit` — Audit Log button (admin)
2. `/engineering/tasks` — Task Execution Board link, task row clicks, KPI clicks
3. `/engineering/tasks?status=...` — KPI cards (PROGRESS, HOLD, APPROVAL, COMPLETE)
4. `/engineering/tasks?dueDate=...` — KPI cards (overdue, this_week)
5. `/engineering/tasks?assignee={name}` — Workload table rows
6. `/project/{trackerName}` — Project health cards
