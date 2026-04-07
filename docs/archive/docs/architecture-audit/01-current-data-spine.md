# Section 1: Current Data Spine (Backend)

> Audit date: 2026-03-20 | Schema file: `shared/schema.ts` (5,936 lines)

## 1.1 Statistics

| Metric | Count |
|--------|-------|
| Database tables (pgTable) | 200+ |
| Enums (pgEnum) | 85 |
| API route files | 43 |
| API endpoints | 288+ |
| Services | 15 |
| Repositories | 3 |
| SQL migrations | 33 |

## 1.2 Current Architecture Diagram (Text-Based)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React SPA)                           │
│  99 pages │ 147 components │ React Query + Context │ Wouter routing    │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │ fetch() / React Query
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API LAYER (Express)                            │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Legacy Routes │  │ Domain Routes    │  │ V2 Canonical API         │  │
│  │ routes.ts     │  │ pm-routes.ts     │  │ /api/v2/projects/:id/*   │  │
│  │ /api/*        │  │ engineering-*.ts  │  │ /api/v2/imports/:domain  │  │
│  │               │  │ quality-*.ts     │  │ /api/v2/lookups/:type    │  │
│  │               │  │ pd-routes.ts     │  │                          │  │
│  │               │  │ + 38 more        │  │                          │  │
│  └──────┬───────┘  └───────┬──────────┘  └────────────┬─────────────┘  │
│         │                  │                           │                │
│  ┌──────┴──────────────────┴───────────────────────────┴─────────────┐  │
│  │                    MIDDLEWARE                                      │  │
│  │  requireAuth │ requirePermission │ attachProjectScope │ audit     │  │
│  └──────────────────────────┬────────────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────────┐
│                    SERVICE LAYER                                        │
│  ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐  │
│  │ assignment-svc   │ │ kpi-service      │ │ lifecycle-stage-gate    │  │
│  │ evidence-eval    │ │ project-event    │ │ project-access          │  │
│  │ project-dev-ws   │ │ project-lifecycle│ │ platform-summary        │  │
│  │ imports-gov      │ │ work-item-conv   │ │ source-of-truth-policy  │  │
│  └─────────────────┘ └──────────────────┘ └─────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────────┐
│                    DATA LAYER (Drizzle ORM + PostgreSQL)                │
│                                                                         │
│  ┌─ FOUNDATION (Layer 0) ──────────────────────────────────────────┐   │
│  │  users │ clients │ qc_template │ eng_stage_templates │           │   │
│  │  app_settings │ calendar_holiday │ role_credentials              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─ CORE ENTITIES (Layer 1) ──────────────────────────────────────┐   │
│  │  project_info │ portfolios │ pd_tickets │ counterparties        │   │
│  │  company_projects │ scenarios │ engineering_templates            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─ DOMAIN DATA (Layer 2) ────────────────────────────────────────┐   │
│  │  program_expense │ program_inflows │ project_plan │ work_items  │   │
│  │  operational_tasks │ engineering_tasks │ deliverables            │   │
│  │  qc_checklist │ normalized_cost_lines │ normalized_revenue_lines│   │
│  │  cashflow_points │ finance_revenue_monthly │ finance_cos_monthly│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─ OVERRIDES & EDITS (Layer 3) ──────────────────────────────────┐   │
│  │  expenditure_overrides │ revenue_tracking_overrides              │   │
│  │  cashflow_planning_overrides │ cos_status_overrides              │   │
│  │  project_plan_overrides │ working_plan_task_override             │   │
│  │  line_item_overrides │ planning_overrides │ manual_edit_flags    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─ AUDIT & EVENTS (Layer 4) ─────────────────────────────────────┐   │
│  │  audit_events │ project_phase_history │ task_activity_log        │   │
│  │  import_diff_events │ permission_audit_log │ writeback_audit_log │   │
│  │  deliverable_events │ qc_warning_event │ error_logs              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1.3 All Entity Groups & Relationships

### Group A: Identity & Access (Layer 0)

| Table | Purpose | Dependencies | Dependents |
|-------|---------|-------------|------------|
| `users` | User accounts | None | Nearly everything |
| `role_credentials` | Role-based auth passwords | None | Auth system |
| `role_permissions` | Role permission matrices | None | Permission middleware |
| `user_permission_overrides` | Per-user permission overrides | `users` | Permission middleware |
| `permission_audit_log` | Permission change audit | `users` | None (terminal) |
| `outlook_accounts` | Outlook OAuth tokens | `users` | MS integration |
| `ms_accounts` | Microsoft SSO accounts | `users` | MS integration |
| `app_settings` | Global app configuration | None | Various features |

### Group B: Project Core (Layer 1)

| Table | Purpose | Dependencies | Dependents |
|-------|---------|-------------|------------|
| `project_info` | **Central project entity** | `users`, `clients` | 50+ tables |
| `clients` | Client organizations | `users` | `project_info`, `pd_tickets`, `project_client_history` |
| `portfolios` | Portfolio groupings | `users` | `project_portfolio_assignments` |
| `company_projects` | Company-lifecycle project view | None | Lifecycle features |
| `projects` | **LEGACY** project table | None | `expenses`, `revenues`, `tasks`, `budgets` |
| `project_editable_fields` | Manual project metadata | None (by projectName) | Project detail UI |
| `project_team_members` | Project team roster | `users`, (by projectName) | PM views |

**Key relationship**: `project_info` is the **root entity** for the canonical model. `projects` is the **legacy root** still referenced by `expenses`, `revenues`, `tasks`, `budgets`.

### Group C: Finance — Imported Data (Layer 2)

| Table | Purpose | FK to project | Linked by |
|-------|---------|---------------|-----------|
| `program_expense` | Expenditure line items | `project_info.id` + `projectName` | `import_run_id` |
| `program_inflows` | Revenue milestones | `project_info.id` + `projectName` | `import_run_id` |
| `cashflow_points` | Weekly cashflow time-series | `project_info.id` + `projectName` | — |
| `finance_revenue_monthly` | Monthly revenue pivot | `projectName` only | — |
| `finance_cos_monthly` | Monthly COS pivot | `projectName` only | — |
| `project_revenue_summary` | Revenue summary block | `project_info.id` + `projectName` | — |
| `project_plan` | Gantt/plan tasks | `projectName` only | — |
| `normalized_cost_lines` | Canonical cost data | `project_info.id` | — |
| `normalized_revenue_lines` | Canonical revenue data | `project_info.id` | — |
| `normalized_execution_phases` | Canonical phases | `project_info.id` | — |

### Group D: Finance — Overrides (Layer 3)

| Table | Purpose | Links to |
|-------|---------|----------|
| `expenditure_overrides` | User edits on expenses | `projectName` + `rowNumber` |
| `revenue_tracking_overrides` | User edits on revenue | `projectName` + `rowNumber` |
| `revenue_milestone_manual` | Manual milestone data | `projectName` + `importedMilestoneId` |
| `cashflow_planning_overrides` | Cashflow forecast edits | `projectName` + `weekStartDate` |
| `cos_status_overrides` | COS status corrections | `expenseId` + `projectName` |
| `finance_revenue_overrides` | Monthly revenue edits | `projectName` + `category` |
| `finance_cos_overrides` | Monthly COS edits | `projectName` + `category` |
| `project_plan_overrides` | Plan task edits | `projectName` + `rowNumber` |
| `working_plan_task_override` | Scenario plan edits | `scenarioId` (FK) |
| `manual_edit_flags` | Conflict detection flags | `entityType` + `entityId` |
| `line_item_overrides` | Generic line overrides | `lineType` + `lineId` |
| `planning_overrides` | Generic planning overrides | `entityType` + `entityId` |
| `date_overrides` | Scenario date overrides | `scenarioId` (FK) |

### Group E: Task & Work Management (Layer 2)

| Table | Purpose | FK to project |
|-------|---------|---------------|
| `operational_tasks` | PM/execution tasks | `project_info.id` |
| `work_items` | **Canonical** work items | `project_info.id` |
| `mytool_tasks` | Personal task planner | `users.id` (owner) |
| `engineering_tasks` | Engineering-specific tasks | `project_info.id` |
| `tasks` | **LEGACY** task table | `projects.id` |
| `task_comments` | Task discussion | `taskId` (polymorphic) |
| `task_checklists` / `task_checklist_items` | Subtask checklists | `taskId` |
| `task_attachments` | File attachments | `taskId` |
| `task_deliverables` | Deliverable handoffs | `taskId` |
| `task_activity_log` | Change history | `taskId` |
| `task_watchers` | Notification subscribers | `taskId`, `users.id` |
| `work_item_assignments` | Work item assignees | `work_items.id`, `users.id` |
| `work_item_dependencies` | Work item DAG | `work_items.id` |
| `entity_assignments` | Universal assignment | `project_info.id` |

### Group F: Engineering (Layer 2-3)

| Table | Purpose | FK |
|-------|---------|---|
| `eng_stage_templates` | Stage definitions | None (Layer 0) |
| `eng_task_templates` | Task definitions per stage | `eng_stage_templates.id` |
| `eng_deliverable_templates` | Deliverable definitions | `eng_stage_templates.id` |
| `project_eng_stages` | Stage instances per project | `project_info.id`, `eng_stage_templates.id` |
| `project_eng_tasks` | Task instances per stage | `project_eng_stages.id`, `eng_task_templates.id` |
| `project_eng_deliverables` | File deliverables | `project_eng_stages.id` |
| `project_eng_approvals` | Stage approvals | `project_eng_stages.id` |
| `engineering_task_attachments` | Eng task files | `engineering_tasks.id` |

### Group G: Quality Management (Layer 2-3)

| Table | Purpose | FK |
|-------|---------|---|
| `qc_template` | QC template master | None (Layer 0) |
| `qc_template_phase` | Template phases | `qc_template.id` |
| `qc_template_group` | Groups within phases | `qc_template_phase.id` |
| `qc_template_item` | Checklist items | `qc_template_group.id` |
| `qc_template_risk_question` | Risk questions | `qc_template_phase.id` |
| `qc_checklist` | Project checklist instance | `project_info.id`, `qc_template.id` |
| `qc_item_instance` | Item status per project | `qc_checklist.id`, `qc_template_item.id` |
| `qc_item_evidence` | Evidence uploads | `qc_item_instance.id`, `project_info.id` |
| `qc_risk_answer` | Risk answers | `qc_checklist.id` |
| `qc_warning` | Quality warnings | `projectName` |
| `qc_warning_event` | Warning events | `qc_warning.id` |
| `qc_postmortem` | Project postmortem | `projectName` |

### Group H: Import & Sync Pipeline (Layer 2)

| Table | Purpose |
|-------|---------|
| `smart_import_runs` | Import session tracking |
| `import_runs` | SP import runs |
| `import_issues` | Import validation issues |
| `import_logs` | Import event logs |
| `import_field_mappings` | Field mapping config |
| `import_diff_events` | Diff tracking |
| `sp_settings` | SharePoint config |
| `sp_files` | Tracked SP files |
| `snapshots` | File snapshots |
| `snapshot_metrics` | Snapshot statistics |
| `change_ledger` | Change detection log |
| `invoice_pattern_rules` / `invoice_pattern_matches` | Invoice classification |

### Group I: MyTool Personal Workspace (Layer 2)

| Table | Purpose |
|-------|---------|
| `mytool_tasks` | Personal tasks |
| `mytool_task_dependencies` | Task DAG |
| `mytool_recurrence_templates` | Recurring task templates |
| `mytool_recurrence_instances` | Recurrence instances |
| `mytool_timeblocks` | Calendar timeblocks |
| `mytool_daily_reviews` | Daily review journals |
| `mytool_company_priorities` | Company priority items |
| `mytool_user_preferences` | User settings |
| `mytool_email_links` | Email-to-task links |
| `mytool_dod_templates` | Definition-of-done templates |
| `priority_links` | Priority cross-links |

### Group J: Collaboration & Notifications (Layer 3)

| Table | Purpose |
|-------|---------|
| `notifications` | User notifications |
| `notification_throttle` | Dedup notifications |
| `meeting_summaries` | Meeting records |
| `meeting_action_items` | Action items from meetings |
| `teams_chat_groups/members/messages` | Teams chat |
| `approvals` | Approval workflow |
| `support_tickets` | User feedback |
| `feedback_tickets` | Feature feedback |

### Group K: Legacy Tables (Deprecated)

| Table | Purpose | Replacement |
|-------|---------|------------|
| `projects` | Old project entity | `project_info` |
| `expenses` | Old expenses | `program_expense` + `normalized_cost_lines` |
| `revenues` | Old revenues | `program_inflows` + `normalized_revenue_lines` |
| `tasks` | Old tasks | `operational_tasks` + `work_items` |
| `budgets` | Old budgets | `fye_budgets` + tracker tables |

## 1.4 API Route Map

### Core Routes (`routes.ts` — monolith, ~4000+ lines)

| Method | Endpoint | Models Touched |
|--------|----------|---------------|
| POST | `/api/auth/login` | `users`, `role_credentials` |
| POST | `/api/auth/logout` | Session |
| GET | `/api/auth/me` | `users`, `role_permissions` |
| GET | `/api/auth/permissions` | `role_permissions`, `user_permission_overrides` |
| GET | `/api/dashboard` | `project_info`, `program_expense`, `program_inflows`, aggregations |
| GET | `/api/overview` | `project_info`, `project_revenue_summary` |
| GET | `/api/projects` | `project_info` |
| GET | `/api/projects/:id` | `project_info`, `project_editable_fields`, `project_notes` |
| PATCH | `/api/projects/:id/phase` | `project_info`, `project_phase_history` |
| GET | `/api/program-expenses` | `program_expense` |
| GET | `/api/program-inflows` | `program_inflows` |
| GET | `/api/project-plans` | `project_plan`, `project_plan_overrides` |
| GET | `/api/project-info` | `project_info` |
| POST | `/api/upload` | `upload_metadata`, Excel parser → multiple tables |
| POST | `/api/refresh` | Triggers recalculation |
| GET | `/api/expenses` | `expenses` (LEGACY) |
| GET | `/api/revenues` | `revenues` (LEGACY) |
| GET | `/api/tasks` | `tasks` (LEGACY) |
| POST | `/api/budgets` | `budgets` (LEGACY) |
| GET | `/api/search` | Cross-table search |
| GET | `/api/export/*` | Various tables → CSV/JSON |

### Domain Route Files (43 files)

| File | Prefix | Key Endpoints |
|------|--------|---------------|
| `pm-routes.ts` | `/api/pm/*` | Dashboard, priority items, calendar |
| `pm-on-the-go-routes.ts` | `/api/pm/on-the-go/*` | Mobile PM views |
| `engineering-routes.ts` | `/api/eng/*` | Eng tasks CRUD, deliverables, approvals |
| `eng-stage-routes.ts` | `/api/eng/stages/*` | Stage lifecycle |
| `quality-routes.ts` | `/api/quality/*` | QC checklists, items, evidence, warnings |
| `pd-routes.ts` | `/api/pd/*` | PD tickets, handover |
| `portfolio-routes.ts` | `/api/portfolios/*` | Portfolio CRUD |
| `lifecycle-routes.ts` | `/api/lifecycle/*` | Phase transitions, stage gates |
| `task-management-routes.ts` | `/api/task-management/*` | Unified task CRUD |
| `weekly-review-routes.ts` | `/api/weekly-reviews/*` | Weekly review wizard |
| `standup-routes.ts` | `/api/standups/*` | Standup schedules & entries |
| `smart-import-routes.ts` | `/api/smart-import/*` | Import preview & commit |
| `approvals-routes.ts` | `/api/approvals/*` | Approval workflow |
| `audit-routes.ts` | `/api/audit/*` | Audit log queries |
| `report-routes.ts` | `/api/reports/*` | Programme reports |
| `meeting-routes.ts` | `/api/meetings/*` | Meeting summaries |
| `gamification-routes.ts` | `/api/gamification/*` | Leaderboard, badges |
| `invoice-capture-routes.ts` | `/api/invoice-capture/*` | Invoice processing |
| `invoice-pattern-routes.ts` | `/api/invoice-patterns/*` | Pattern library |
| `subcontractor-routes.ts` | `/api/subcontractors/*` | Subcontractor mgmt |
| `procurement-routes.ts` | `/api/procurement/*` | PO management |
| `commissioning-routes.ts` | `/api/commissioning/*` | Commissioning items |
| `dependency-routes.ts` | `/api/dependencies/*` | Task dependencies |
| `change-control-routes.ts` | `/api/change-control/*` | Change requests |
| `raid-routes.ts` | `/api/raid/*` | RAID register |
| `po-routes.ts` | `/api/po/*` | Purchase orders |
| `deliverable-capture-routes.ts` | `/api/deliverable-capture/*` | Deliverable uploads |
| `project-events-routes.ts` | `/api/project-events/*` | Event timeline |
| `ee-info-routes.ts` | `/api/ee-info/*` | Knowledge graph |
| `role-auth-routes.ts` | `/api/role-auth/*` | Role challenge |
| `platform-routes.ts` | `/api/platform/*` | Platform diagnostics |
| `admin-control-routes.ts` | `/api/admin/*` | Admin operations |
| `admin-recovery-routes.ts` | `/api/admin/recovery/*` | Data recovery |
| `kpi-traceability-routes.ts` | `/api/kpi-traceability/*` | KPI drill-down |
| `ms-sync-routes.ts` | `/api/ms-sync/*` | Microsoft sync |
| `sync-routes.ts` | `/api/sync/*` | Data sync |
| `template-routes.ts` | `/api/templates/*` | Phase templates |
| `tr-register-routes.ts` | `/api/tr-register/*` | TR items |

### V2 API (`api/v2/routes/v2-routes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v2/projects` | Canonical project list |
| GET | `/api/v2/projects/:id` | Full project detail |
| GET | `/api/v2/projects/:id/overview` | Project overview |
| GET | `/api/v2/projects/:id/lifecycle` | Lifecycle data |
| GET | `/api/v2/projects/:id/health` | Health metrics |
| GET | `/api/v2/projects/:id/engineering` | Engineering data |
| GET | `/api/v2/projects/:id/quality` | Quality data |
| GET | `/api/v2/projects/:id/finance/*` | Finance sub-routes |
| GET | `/api/v2/projects/:id/work-items` | Work items |
| GET | `/api/v2/projects/:id/procurement` | Procurement |
| POST | `/api/v2/imports/:domain` | Domain import |
| GET | `/api/v2/lookups/:type` | Reference data |
| GET | `/api/v2/audit/activity` | Audit trail |

## 1.5 Data Flow Direction Summary

```
Excel Files (SharePoint)
    │
    ▼ (smart-import / upload)
┌──────────────────────────────┐
│  Import Pipeline             │
│  smart_import_runs           │
│  import_runs / sp_files      │
│  snapshots / change_ledger   │
└──────────┬───────────────────┘
           │ parsed rows
           ▼
┌──────────────────────────────┐     ┌──────────────────────────┐
│  Imported Data Tables        │     │  Manual Entry / UI       │
│  program_expense             │     │  operational_tasks       │
│  program_inflows             │     │  mytool_tasks            │
│  project_plan                │     │  engineering_tasks       │
│  cashflow_points             │     │  deliverables            │
│  finance_*_monthly           │     │  work_items              │
└──────────┬───────────────────┘     └──────────┬───────────────┘
           │                                    │
           ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│  Override Layer (user edits on imported + manual data)        │
│  expenditure_overrides, revenue_tracking_overrides,           │
│  cashflow_planning_overrides, project_plan_overrides, etc.    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Computation Layer (server-side)                              │
│  cosAggregator, cashflow computer, forecaster,                │
│  stateClassifier, confidence scorer, CPM engine               │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Derived / Normalized Tables                                  │
│  normalized_cost_lines, normalized_revenue_lines,             │
│  normalized_execution_phases, derived_project_kpis            │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
                    API → Frontend
```
