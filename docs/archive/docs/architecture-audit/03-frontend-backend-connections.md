# Section 3: Frontend ↔ Backend Connections & Entity-to-Page Mapping

## 3.1 Entity-to-Page Mapping Table

| Entity (DB Table) | Pages That Read It | Pages That Write It |
|-------------------|--------------------|---------------------|
| `users` | All (via AuthProvider) | `/admin/roles`, `/auth/login` |
| `project_info` | `/projects`, `/project/:name`, `/dashboard`, `/execution-board`, `/lifecycle-board`, `/pm-dashboard`, `/pd/handover`, `/portfolios/:id` | `/project/:name` (phase, RAG, fields), `/pd/handover` |
| `clients` | `/clients`, `/pd/dashboard`, `/pd/tickets/create` | `/clients`, `/pd/tickets/create` |
| `program_expense` | `/project/:name` (Expenditure tab), `/cos`, `/cashflow`, `/execution-board/finance` | Smart import only; overrides via `/project/:name` |
| `program_inflows` | `/project/:name` (Revenue tab), `/cashflow`, `/revenue-tracker` | Smart import only; overrides via `/project/:name` |
| `cashflow_points` | `/cashflow`, `/project/:name` (Cashflow tab) | Smart import |
| `operational_tasks` | `/tasks`, `/project/:name` (Plan tab), `/my-work/tasks`, `/pm-dashboard` | `/tasks`, `/project/:name`, `/my-work/tasks` |
| `work_items` | `/tasks`, `/project/:name` (Plan tab), `/pm/on-the-go/project/:id` | `/tasks`, `/project/:name` |
| `mytool_tasks` | `/my-work/*` pages | `/my-work/*` pages |
| `engineering_tasks` | `/engineering/*`, `/project/:name` (Engineering tab) | `/engineering/tasks` |
| `deliverables` | `/pm/deliverables`, `/project/:name` (Deliverables tab) | `/project/:name`, engineering routes |
| `qc_checklist` / `qc_item_instance` | `/quality`, `/project/:name` (Quality tab) | `/quality` |
| `pd_tickets` | `/pd/tickets`, `/pd/tickets/:id`, `/pd/dashboard` | `/pd/tickets/create`, `/pd/tickets/:id` |
| `approvals` | `/pm/approvals` | `/pm/approvals` |
| `portfolios` | `/portfolios`, `/portfolios/:id` | `/portfolios` |
| `smart_import_runs` | `/admin/smart-import` | `/admin/smart-import` |
| `weekly_reviews` | `/weekly-reviews` | `/weekly-reviews` |
| `meeting_summaries` | `/my-work/meetings` | MS integration (webhook) |
| `audit_events` | `/admin/activity-log`, `/engineering/audit` | Server-side only (automatic) |
| `notifications` | AppLayout (bell icon) | Mark-read via API |
| `phase_template` | `/phase-templates` | `/phase-templates` |
| `standup_schedules` / `standup_entries` | `/standups` | `/standups` |
| `fye_budgets` | `/fye-revenue-tracking` | `/fye-revenue-tracking` |
| `counterparties` | `/counterparties` | `/counterparties` |

### Legacy Tables Still Consumed

| Legacy Table | Pages | API Endpoint | Canonical Replacement |
|-------------|-------|-------------|----------------------|
| `projects` | `/dashboard` (fallback) | GET `/api/projects` (legacy) | `project_info` |
| `expenses` | Export features | GET `/api/expenses` | `program_expense` / `normalized_cost_lines` |
| `revenues` | Export features | GET `/api/revenues` | `program_inflows` / `normalized_revenue_lines` |
| `tasks` | Export features | GET `/api/tasks` | `operational_tasks` / `work_items` |
| `budgets` | Budget forms | POST/GET/DELETE `/api/budgets` | `fye_budgets` + trackers |

## 3.2 Per-Page Connection Detail

### `/project/:projectName` (Most Complex Page)

This page is the **hub** — it uses 10+ tabbed sub-views, each fetching different data:

| Tab | API Calls | Models Read | Models Written |
|-----|-----------|-------------|----------------|
| Overview | GET `/api/projects/:id` | project_info, project_editable_fields, project_notes, project_revenue_summary | project_info (phase, RAG) |
| Plan | GET `/api/project-plans?project=X`, GET `/api/tasks/operational?project=X` | project_plan, operational_tasks, work_items, project_plan_overrides | project_plan_overrides, operational_tasks |
| Revenue | GET `/api/program-inflows?project=X` | program_inflows, revenue_tracking_overrides, revenue_milestone_manual | revenue_tracking_overrides |
| Expenditure | GET `/api/program-expenses?project=X` | program_expense, expenditure_overrides | expenditure_overrides |
| Cashflow | GET `/api/cashflow?project=X` | cashflow_points, cashflow_planning_overrides | cashflow_planning_overrides |
| COS | GET `/api/cos-tracker?project=X` | program_expense (COS view), cos_status_overrides | cos_status_overrides |
| Quality | GET `/api/quality/checklists?project=X` | qc_checklist, qc_item_instance, qc_item_evidence | qc_item_instance |
| Engineering | GET `/api/eng/tasks?project=X` | engineering_tasks, project_eng_stages | engineering_tasks |
| History | GET `/api/project-events?project=X` | project_phase_history, audit_events | — |
| Chat | GET `/api/project-chat?project=X` | teams_chat_messages | teams_chat_messages |

### `/dashboard` (Execution Dashboard)

| API Call | Models | Contract |
|----------|--------|----------|
| GET `/api/dashboard` | project_info, program_expense, program_inflows (aggregated) | Returns `{ projects, financeSummary, recentActivity }` |
| GET `/api/overview` | project_info, project_revenue_summary | Returns `{ overview, programMetrics }` |
| GET `/api/projects-summary` | project_info (summary view) | Returns `ProjectSummary[]` |
| GET `/api/refresh/latest` | refresh_logs | Returns `{ refreshedAt, status }` |

### `/cashflow`

| API Call | Models | Contract |
|----------|--------|----------|
| GET `/api/cashflow` | cashflow_points, cashflow_planning_overrides, cashflow_weekly_manual, opex_weekly_manual, available_payment_overrides | Complex computed response with weekly buckets |
| PATCH `/api/cashflow/opening-balance` | cashflow_weekly_manual, cashflow_balance_history | Writes opening balance + history |
| PATCH `/api/cashflow/planning-override` | cashflow_planning_overrides | Writes override value |

## 3.3 Flags: Connection Issues

### ⛔ Critical Issues

| # | Issue | Location | Detail |
|---|-------|----------|--------|
| C1 | **Legacy tables still actively used** | `routes.ts` GET `/api/expenses`, `/api/revenues`, `/api/tasks`, `/api/budgets` | These legacy endpoints serve old `projects`/`expenses`/`revenues`/`tasks` tables while canonical data lives in `project_info`/`program_expense`/`program_inflows`/`operational_tasks`. Two parallel data paths exist. |
| C2 | **projectName vs projectId inconsistency** | Across all finance tables | Some tables FK to `project_info.id` AND have `projectName` text column. Override tables link ONLY by `projectName` + `rowNumber` with no FK. If a project is renamed, these break silently. |
| C3 | **Frontend holds duplicate permission logic** | `client/src/lib/access-control.ts`, `use-permissions.ts`, `use-access-matrix.ts` | Full permission evaluation runs client-side, duplicating `server/permission-middleware.ts`. Divergence risk is high. |
| C4 | **Monolith routes.ts** | `server/routes.ts` (~4000+ lines) | Single file registers most legacy endpoints. Mixes data access, business logic, and HTTP concerns. Difficult to maintain. |

### ⚠️ Warnings

| # | Issue | Location | Detail |
|---|-------|----------|--------|
| W1 | **Over-fetching on project detail** | `/project/:projectName` | Each tab makes independent API calls. Opening project detail triggers 10+ HTTP requests. No consolidated endpoint. |
| W2 | **Type contracts are implicit** | Throughout | Frontend `api.ts` uses `fetchJSON<T>()` with manually specified generics. No generated types from schema — types can drift. |
| W3 | **Financial re-aggregation in frontend** | Tab components (`ExpenditureEditableTab`, `RevenueTrackingEditableTab`) | Frontend sums rows to compute totals that should come from server. Risk of mismatch with server-computed values. |
| W4 | **Direct fetch() alongside React Query** | 484+ raw fetch() calls | Many components use direct `fetch()` for mutations instead of `useMutation`, bypassing React Query cache invalidation. |
| W5 | **ProgramProvider fetches everything upfront** | `use-program-data.tsx` | `ProgramProvider` loads full dashboard data at app mount for all users, regardless of which page they visit. Wasteful for non-dashboard users. |
| W6 | **Orphaned frontend pages** | `/my-tool/*` legacy routes | Multiple `/my-tool/*` routes exist as aliases/redirects to `/my-work/*`. Dead code. |
| W7 | **Multiple task systems** | Frontend consumes `operational_tasks`, `work_items`, `mytool_tasks`, `engineering_tasks` | Four separate task models with overlapping fields. Frontend must juggle all four. |
| W8 | **Override tables linked by text, not FK** | All override tables | `projectName` + `rowNumber` linking means no referential integrity. Import can reassign row numbers. |
| W9 | **Shared schema file is 5,936 lines** | `shared/schema.ts` | Monolith schema file. All 200+ tables, enums, types, constants, and permission matrices in one file. |
| W10 | **V2 API partially implemented** | `api/v2/routes/v2-routes.ts` | V2 exists but frontend still overwhelmingly uses legacy routes. Migration incomplete. |
