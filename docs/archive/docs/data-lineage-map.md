# Data Lineage Map

Complete data flow from import sources through foundation tables, derived/normalized tables, API endpoints, and UI pages.

---

## 1. Data Sources (Ingestion)

### 1.1 Excel Tracker Upload (Legacy Path)
- **Entry Point**: `/api/upload` (POST, multer disk storage)
- **Parser**: `server/excelParser.ts` → `parseTrackerFile()`
- **Sheets Parsed**: Project Plan, Expenditure Breakdown, Revenue Tracking, Cashflow, Finance - Revenue, Finance - COS
- **Destination Tables** (Foundation/Legacy):
  - `project_info` — fixed-cell project metadata (name, size, PM, PD, dates, phase)
  - `program_expense` — expenditure line items (budget + actual sides)
  - `program_inflows` — revenue milestone rows
  - `project_plan` — task/milestone rows from Project Plan sheet
  - `project_revenue_summary` — top summary block values
  - `cashflow_points` — weekly time-series from Cashflow sheet
  - `finance_revenue_monthly` — monthly pivot from Finance - Revenue sheet
  - `finance_cos_monthly` — monthly pivot from Finance - COS sheet

### 1.2 Smart Import Pipeline (Normalized Path)
- **Entry Point**: `/api/smart-import/upload` (POST)
- **Pipeline**: `server/lib/import/index.ts` → `runSmartImportPreview()`
  1. **Detector** (`server/lib/import/detector.ts`): identifies sheet sections (PLAN, REVENUE, EXPENDITURE, CASHFLOW, GENERAL)
  2. **Mapper** (`server/lib/import/mapper.ts`): maps Excel columns → canonical field names using synonym matching + `mapping_rules` + `template_profiles`
  3. **Normalizer** (`server/lib/import/normalizer.ts`): validates, coerces types, generates issues
- **Staging Table**: `smart_import_runs` (stores preview JSON, status lifecycle: PREVIEW → AWAITING_REVIEW → COMMITTED / ROLLED_BACK / FAILED / SUPERSEDED)
- **Issue Tracking**: `import_issues` (per-run issues with severity BLOCKER/WARNING/INFO)
- **Commit** (`/api/smart-import/:runId/commit`): writes to normalized tables:
  - `normalized_plan_tasks` — canonical task rows (linked to `project_info.id` via `project_id`)
  - `normalized_revenue_lines` — canonical revenue rows (status enum: PLANNED/INVOICED/PAID/IN_BANK/REALISED)
  - `normalized_cost_lines` — canonical cost rows (status enum: PLANNED/INVOICED/APPROVED/PAID)
  - `normalized_execution_phases` — phase date milestones (source: EXCEL_IMPORT or MANUAL)
  - `counterparties` — supplier/installer entities with aliases
- **Learning Tables**:
  - `mapping_rules` — learned column mappings per template profile
  - `template_profiles` — named mapping profiles per tracker template
  - `issue_resolution_rules` — remembered issue resolutions (auto-apply on future imports)

### 1.3 SharePoint Integration
- **Entry Point**: `/api/sp/sync-files` (POST)
- **Config**: `sp_settings` table (site ID, drive ID, folder ID)
- **File Index**: `sp_files` table (metadata, checksums)
- **Import Runs**: `import_runs`, `change_ledger` tables (audit trail)
- **Snapshots**: `snapshots`, `snapshot_metrics` tables

### 1.4 Manual Entry / Overrides
- Multiple override tables allow user edits atop imported baselines:
  - `cashflow_planning_overrides` — planned cashflow series adjustments
  - `project_plan_overrides` — task field edits, virtual milestones, soft deletes
  - `revenue_tracking_overrides` — revenue milestone field edits
  - `expenditure_overrides` — expense field edits
  - `finance_revenue_overrides` — monthly revenue pivot edits
  - `finance_cos_overrides` — monthly COS pivot edits
  - `revenue_milestone_manual` — legacy manual milestone entries
  - `cos_status_overrides` — COS status manual overrides
  - `date_overrides` — scenario-based date overrides
  - `working_plan_task_override` — CPM scenario task overrides
  - `working_plan_dependency_override` — CPM dependency overrides

---

## 2. Foundation Tables (Primary Data Store)

### 2.1 Legacy Foundation Tables (from Excel Upload)
| Table | Key Columns | Source |
|-------|-------------|--------|
| `project_info` | projectName, sizeKwp, contractValue, phase, PM, PD, key dates, RAG status | Excel fixed cells, manual edits |
| `program_expense` | projectName, expenseCategory, budgetTotal, expenseActualTotal, invoicing fields | Excel Expenditure Breakdown sheet |
| `program_inflows` | projectName, milestoneName, milestoneAmount, payment date fields | Excel Revenue Tracking sheet |
| `project_plan` | projectName, taskNo, highLevelProgramme, actualStart/End, pctComplete | Excel Project Plan sheet |
| `project_revenue_summary` | projectName, plannedRevenue/Expenditure/Profit/Margin, actualRevenue/Expenditure | Excel summary block |
| `cashflow_points` | projectName, seriesName, pointDate, value | Excel Cashflow sheet (weekly) |
| `finance_revenue_monthly` | projectName, category, monthEndDate, value | Excel Finance - Revenue |
| `finance_cos_monthly` | projectName, category, monthEndDate, value | Excel Finance - COS |

### 2.2 Normalized Foundation Tables (from Smart Import)
| Table | Key Columns | Source |
|-------|-------------|--------|
| `normalized_plan_tasks` | projectId, projectName, taskName, startDate, endDate, pctComplete, importRunId | Smart Import pipeline |
| `normalized_revenue_lines` | projectId, projectName, amountExVat, invoiceNumber, invoiceDate, paidDate, status | Smart Import pipeline |
| `normalized_cost_lines` | projectId, projectName, amountExVat, counterpartyName, invoiceNumber, cosRealised, status | Smart Import pipeline |
| `normalized_execution_phases` | projectId, projectName, phaseName, phaseDate, source | Smart Import pipeline |
| `counterparties` | nameCanonical, nameAliases, typeDefault | Smart Import + manual |

### 2.3 Operational / Engineering Tables
| Table | Key Columns | Source |
|-------|-------------|--------|
| `operational_tasks` | projectName, title, status, priority, assignees, dueDate, phase, workstream | Manual + PD ticket spawning |
| `task_comments` | taskId, userId, text | Manual |
| `task_activity_log` | taskId, actorId, actionType, fieldName, oldValue, newValue | Automated on task changes |
| `task_deliverables` | taskId, filename, sentByUserId, recipientUserId | Manual |
| `deliverables` | projectName, title, status | Manual |
| `project_team_members` | projectName, userId, roleOnProject | Manual |

### 2.4 Quality Management Tables
| Table | Key Columns | Source |
|-------|-------------|--------|
| `qc_template` / `qc_template_phase` / `qc_template_group` / `qc_template_item` | Template hierarchy | Seeded + admin |
| `qc_checklist` | projectName, templateId, status | Auto-created per project |
| `qc_item_instance` | checklistId, templateItemId, qmStatus, approved | QM manual |
| `qc_warning` / `qc_warning_event` | projectName, severity, message | Automated from checklist state |
| `qc_postmortem` / `qc_postmortem_metric_value` | projectName, metrics | Manual |

### 2.5 Governance / Lifecycle Tables
| Table | Key Columns | Source |
|-------|-------------|--------|
| `project_phase_history` | projectId, fromPhase, toPhase, changedByUserId, reason | Automated on phase change |
| `project_eng_approvals` | projectId, approvalType, status | Manual approval workflow |
| `project_eng_stages` | projectId, stageTemplateId, status | Engineering stage tracking |
| `eng_stage_templates` | name, phase, tasks | Admin configuration |
| `phase_template` / `phase_template_application` | Template lifecycle | Admin |

### 2.6 Linking / Task-Milestone Association Tables
| Table | Purpose |
|-------|---------|
| `milestone_task_links` | Links revenue milestones → operational tasks (or plan tasks via negative IDs) |
| `expense_task_links` | Links expense rows → operational tasks for date resolution |
| `key_date_mappings` | Maps project key dates to plan/task references |
| `project_plan_dependency` | Task dependency graph for CPM engine |

### 2.7 User / Auth Tables
| Table | Key Columns | Source |
|-------|-------------|--------|
| `users` | username, email, role (user_role enum), microsoft_id | Registration, admin |
| `role_permissions` | role, resource, actions | Admin configuration |
| `dashboard_widget_config` | userId, widgetOrder, hiddenWidgets | User preferences |

### 2.8 PD (Project Development) Tables
| Table | Key Columns | Source |
|-------|-------------|--------|
| `clients` | clientId, name | PD manual |
| `pd_tickets` | clientId, projectSiteName, requestType, status, dueDate | PD manual |

### 2.9 My Tool Tables
| Table | Purpose |
|-------|---------|
| `mytool_tasks` | Personal task management |
| `mytool_timeblocks` | Time blocking |
| `mytool_daily_reviews` | Daily review notes |
| `mytool_company_priorities` | Company-wide priority items |
| `mytool_user_preferences` | Per-user UI settings |

---

## 3. Derived / Computed Tables

### 3.1 Materialized Derived Tables
Built by `server/lib/derived-tables.ts` → `rebuildDerivedTables()`:

| Table | Source | Purpose |
|-------|--------|---------|
| `derived_project_kpis` | `project_info` + `normalized_cost_lines` + `normalized_revenue_lines` | Per-project KPIs: revenue, cost, margin, RAG |
| `derived_portfolio_kpis` | Aggregation of `derived_project_kpis` | Portfolio-level totals |
| `derived_rag_summary` | `derived_project_kpis` cost RAG | RAG distribution counts |

### 3.2 Data Merge Layer
`server/lib/data-merge.ts` merges legacy + normalized data at query time:
- `mergeExpensesOnly()`: legacy `program_expense` + `normalized_cost_lines` (normalized data fills gaps where legacy has no data for a project)
- `mergeInflowsOnly()`: legacy `program_inflows` + `normalized_revenue_lines`
- `mergePlansOnly()`: legacy `project_plan` + `normalized_plan_tasks`
- Name resolution: `createNameResolver()` matches project names across naming conventions

### 3.3 Server-Side Calculation Modules
Located in `server/lib/calculations/`:
| Module | Input | Output |
|--------|-------|--------|
| `stateClassifier.ts` | Expense rows | Computed state (Planned/Committed/Invoiced/Paid) |
| `confidence.ts` | Expense/inflow rows | Confidence scores + assumption drivers |
| `cosAggregator.ts` | Expense rows | COS aggregation by project + program |
| `cashflow.ts` | Expense + inflow rows | Weekly cashflow computation |
| `dataQuality.ts` | All data | Data quality check results |
| `scenarioResolver.ts` | Override maps + baseline | Scenario-resolved values |
| `forecaster.ts` | Historical data | Forecast projections |
| `hashing.ts` | Row data | Line hashes for change detection |
| `supplierExtractor.ts` | Expense rows | Supplier name extraction |

### 3.4 CPM Engine
`server/cpmEngine.ts`:
- Input: `project_plan` tasks + `project_plan_dependency` + `working_plan_task_override` + `working_plan_dependency_override`
- Output: Critical path, slack, early/late start/finish dates

---

## 4. API Endpoints → Data Source Mapping

### 4.1 Portfolio / Dashboard APIs
| Endpoint | Tables Read | Overrides Applied | Used By |
|----------|------------|-------------------|---------|
| `GET /api/overview` | project_info, program_expense, program_inflows, project_plan, milestone_task_links, operational_tasks | effective date resolution | Dashboard page |
| `GET /api/home/summary` | project_info, program_expense, program_inflows, project_plan, project_revenue_summary, milestone_task_links, operational_tasks | effective date resolution | Home page |
| `GET /api/projects-summary` | project_info, program_expense, program_inflows, project_plan, project_revenue_summary, milestone_task_links, operational_tasks | schedule delta calculations | Projects summary, Home widgets |

### 4.2 Project Detail APIs
| Endpoint | Tables Read | Overrides Applied |
|----------|------------|-------------------|
| `GET /api/project/:name/plan` | project_plan, project_plan_overrides | `applyProjectPlanOverrides()` |
| `GET /api/project/:name/expenses` | program_expense, expenditure_overrides | `applyExpenditureOverrides()` |
| `GET /api/project/:name/inflows` | program_inflows, revenue_tracking_overrides, milestone_task_links, operational_tasks | `applyRevenueTrackingOverrides()` + effective date resolution |
| `GET /api/project/:name/cashflow` | cashflow_points, cashflow_planning_overrides, program_expense, program_inflows | `applyPlanningOverrides()` + revenue recognition calc |
| `GET /api/project/:name/finance-revenue` | finance_revenue_monthly, finance_revenue_overrides | `applyFinanceRevenueOverrides()` |
| `GET /api/project/:name/finance-cos` | finance_cos_monthly, finance_cos_overrides | `applyFinanceCosOverrides()` |
| `GET /api/project/:name/info` | project_info | Direct read |

### 4.3 COS & Cashflow APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/program/cos` | program_expense (+ merged normalized_cost_lines), expenditure_overrides | COS aggregation via `cosAggregator.ts` |
| `GET /api/cashflow-2026` | program_expense, program_inflows, cashflow_weekly_manual, opex_budget_monthly, opex_weekly_manual, available_payment_overrides | Weekly cashflow computation |
| `GET /api/cashflow-2026/detail` | Same as above, line-item detail |

### 4.4 Engineering APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/eng/tasks` | operational_tasks |
| `GET /api/eng/tasks/:id` | operational_tasks |
| `GET /api/eng/tasks/:id/comments` | task_comments, users |
| `GET /api/eng/tasks/:id/activity` | task_activity_log, users |
| `GET /api/eng/tasks/:id/subtasks` | operational_tasks (parent_task_id) |
| `GET /api/deliverables` | deliverables, deliverable_versions |
| `GET /api/notifications` | notifications |

### 4.5 Quality APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/quality/project/:name/checklist` | qc_checklist, qc_template_*, qc_item_instance, qc_risk_answer, qc_item_evidence |
| `GET /api/quality/warnings/:name` | qc_warning, qc_warning_event |
| `GET /api/quality/postmortem/:name` | qc_postmortem, qc_postmortem_metric_value |

### 4.6 PM Dashboard APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/pm/dashboard` | project_info (filtered by pmUserId), program_expense (aggregated), operational_tasks (aggregated) |
| `GET /api/pm/priority-items` | operational_tasks (overdue/hold/approval), program_expense (flagged COS, budget overruns) |
| `GET /api/pm/calendar-events` | project_info (milestone dates), operational_tasks (due dates) |

### 4.7 PD (Project Development) APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/pd/tickets` | pd_tickets, clients, project_info, operational_tasks |
| `GET /api/pd/dashboard` | pd_tickets (aggregated stats) |

### 4.8 Smart Import APIs
| Endpoint | Tables Read/Written |
|----------|---------------------|
| `POST /api/smart-import/upload` | → smart_import_runs, import_issues |
| `POST /api/smart-import/:runId/commit` | → normalized_plan_tasks, normalized_revenue_lines, normalized_cost_lines, normalized_execution_phases, counterparties, project_info |
| `GET /api/smart-import/pending-runs` | smart_import_runs, import_issues |

### 4.9 Lifecycle / Governance APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/lifecycle-board/projects` | project_info, project_eng_approvals, project_eng_stages, operational_tasks, qc_checklist, qc_item_instance |

### 4.10 Subcontractor / Procurement APIs
| Endpoint | Tables Read |
|----------|------------|
| `GET /api/subcontractor-dashboard/summary` | counterparties, normalized_cost_lines (aggregated by supplier) |
| `GET /api/subcontractor-dashboard/detail/:name` | normalized_cost_lines (filtered by counterparty) |

---

## 5. UI Pages → API Endpoint Mapping

| Route | Page Component | Primary API Endpoints | Data Tables (Transitive) |
|-------|---------------|----------------------|--------------------------|
| `/` | `Home` | `/api/home/summary`, `/api/projects-summary` | project_info, program_expense, program_inflows, project_plan, project_revenue_summary |
| `/dashboard` | `Dashboard` | `/api/overview`, `/api/projects-summary` | project_info, program_expense, program_inflows, project_plan |
| `/projects` | `ProjectsSummary` | `/api/projects-summary` | project_info, program_expense, program_inflows, project_plan |
| `/project/:name` | `ProjectDetailPage` | `/api/project/:name/*` (plan, expenses, inflows, cashflow, finance-revenue, finance-cos, info) | All foundation tables for project + all override tables |
| `/cashflow` | `CashflowPage` | `/api/cashflow-2026` | program_expense, program_inflows, cashflow_weekly_manual, opex tables |
| `/cos` | `CostTracker` | `/api/program/cos` | program_expense, normalized_cost_lines, expenditure_overrides |
| `/cos-control` | `CosControlPage` | `/api/program/cos`, expenditure override endpoints | program_expense, expenditure_overrides, cos_status_overrides |
| `/cashflow-forecast` | `CashflowForecastPage` | `/api/cashflow-2026` | Same as cashflow |
| `/revenue` | `RevenueTracker` | `/api/project/:name/inflows` (per project) | program_inflows, revenue_tracking_overrides |
| `/engineering` | `EngineeringDashboardPage` | `/api/eng/tasks`, `/api/deliverables` | operational_tasks, deliverables |
| `/engineering/tasks` | `EngineeringTasksPage` | `/api/eng/tasks` | operational_tasks |
| `/engineering/inbox` | `EngineeringInboxPage` | `/api/eng/tasks` (filtered) | operational_tasks |
| `/quality` | `QmDashboardPage` | `/api/quality/*` | qc_checklist, qc_item_instance, qc_warning |
| `/smart-import` | `SmartImportPage` | `/api/smart-import/*` | smart_import_runs, import_issues, normalized_* tables |
| `/lifecycle-board` | `LifecycleBoardPage` | `/api/lifecycle-board/projects` | project_info, project_eng_stages, project_eng_approvals |
| `/execution-board` | `ExecutionBoardPage` | `/api/lifecycle-board/projects` (filtered) | project_info, operational_tasks |
| `/pm-dashboard` | `PMDashboard` | `/api/pm/dashboard`, `/api/pm/priority-items`, `/api/pm/calendar-events` | project_info, program_expense, operational_tasks |
| `/pd` | `PdDashboardPage` | `/api/pd/dashboard` | pd_tickets |
| `/pd/tickets` | `PdTicketsPage` | `/api/pd/tickets` | pd_tickets, clients, operational_tasks |
| `/pd/tickets/:id` | `PdTicketDetailPage` | `/api/pd/tickets/:id` | pd_tickets, operational_tasks, task_activity_log |
| `/subcontractor-dashboard` | `SubcontractorDashboardPage` | `/api/subcontractor-dashboard/*` | counterparties, normalized_cost_lines |
| `/invoice-patterns` | `InvoicePatternsPage` | `/api/invoice-patterns`, `/api/invoice-pattern-matches` | invoice_pattern_rules, invoice_pattern_matches, normalized_cost_lines |
| `/admin` | `AdminPage` | `/api/admin/*`, upload endpoints | upload_metadata, users |
| `/admin/roles` | `AdminRolesPage` | `/api/roles`, `/api/admin/users` | role_permissions, users |
| `/notifications` | `NotificationCenterPage` | `/api/notifications` | notifications |
| `/portfolios` | `PortfoliosPage` | `/api/portfolios` | portfolios, project_info |
| `/weekly-reviews` | `WeeklyReviewsPage` | `/api/weekly-reviews` | weekly_review_* tables |
| `/my-tool` | `MyToolTodayPage` | `/api/mytool/*` | mytool_tasks, mytool_timeblocks |
| `/leaderboard` | `LeaderboardPage` | `/api/gamification/*` | gamification_* tables |
| `/feedback` | `FeedbackPage` | `/api/feedback/*` | feedback_tickets |
| `/ee-info` | `EeInfoPage` | `/api/ee-info/*` | ee_info tables |
| `/tr-register` | `TrRegisterPage` | `/api/tr-register/*` | tr_register tables |
| `/collaboration` | `CollaborationPage` | `/api/collaboration/*` | Collaboration tables |
| `/settings/integrations` | `MsIntegrationSettingsPage` | Microsoft auth APIs | sp_settings |

---

## 6. Identified Issues

### 6.1 Duplicate Data Stores
| Issue | Detail |
|-------|--------|
| **Legacy vs Normalized expense data** | `program_expense` (legacy upload) and `normalized_cost_lines` (smart import) store overlapping data. The merge layer (`data-merge.ts`) deduplicates at query time by project name, but both tables persist independently. |
| **Legacy vs Normalized revenue data** | `program_inflows` and `normalized_revenue_lines` — same pattern as expenses. |
| **Legacy vs Normalized plan data** | `project_plan` and `normalized_plan_tasks` — same pattern. |
| **Legacy projects table** | `projects`, `expenses`, `revenues`, `tasks` tables are kept for backward compatibility but rarely used by current UI. |
| **Counterparty routes registered twice** | `/api/counterparties` routes exist in both `smart-import-routes.ts` and `invoice-pattern-routes.ts`. |

### 6.2 Manual Overrides / UI-Side Calculations
| Item | Detail |
|------|--------|
| **Schedule delta** | Calculated server-side in `/api/home/summary` and `/api/projects-summary` using weighted actual vs expected % complete. Not stored; recomputed on every request. |
| **COS state classification** | Computed server-side via `stateClassifier.ts` on each request. Also duplicated in `data-merge.ts` `adaptCostToExpense()`. |
| **Revenue recognition** | Calculated in `routes.ts` `calculateRevenueRecognition()` on each cashflow request — not persisted. |
| **Effective date resolution** | `resolveInflowEffectiveDates()` is duplicated in `routes.ts` and `departments/project-routes.ts` with identical logic. |
| **Override application functions** | `applyProjectPlanOverrides()`, `applyExpenditureOverrides()`, etc. are duplicated between `routes.ts` and `departments/project-routes.ts`. |
| **Working days calculation** | SA public holiday logic + business days computed in `departments/project-routes.ts` — not centralized. |

### 6.3 Dashboards Not Fully Tied to Foundation Data
| Dashboard | Issue |
|-----------|-------|
| **Home page** (`/`) | Reads from legacy foundation tables (program_expense, program_inflows, project_plan) — does NOT incorporate `normalized_*` tables unless merge layer is invoked. The `/api/home/summary` endpoint does not call `getMergedAll()`. |
| **Dashboard page** (`/dashboard`) | Uses `/api/overview` which also reads only legacy tables. |
| **PM Dashboard** (`/pm-dashboard`) | Queries `program_expense` and `operational_tasks` directly via raw SQL — bypasses the merge layer entirely. |
| **COS Control** (`/cos-control`) | Uses `/api/program/cos` which does invoke merge layer for expenses. |
| **Cashflow** (`/cashflow`) | Uses `/api/cashflow-2026` which reads legacy tables directly — does not use normalized data. |
| **Derived tables** | `rebuildDerivedTables()` reads from normalized tables only, not legacy — so `derived_project_kpis` may miss projects that only exist in legacy tables. |

### 6.4 Data Staleness Risks
| Risk | Detail |
|------|--------|
| **No automatic re-import** | Data only refreshes when user uploads a new tracker file. No scheduled sync. |
| **Derived tables not auto-rebuilt** | `rebuildDerivedTables()` is not called automatically after imports — must be triggered manually. |
| **Override drift** | Overrides reference row numbers which can shift between re-imports, potentially applying to wrong rows. |
| **Smart import superseding** | Old PREVIEW runs are auto-marked SUPERSEDED, but COMMITTED data is never automatically updated — a re-import creates a new run. |

---

## 7. Data Flow Diagrams (Text)

### 7.1 Excel Upload Flow
```
Excel File (.xlsx/.xlsm)
  ↓ POST /api/upload
  ↓ parseTrackerFile() → excelParser.ts
  ↓
  ├─→ project_info (upsert by projectName)
  ├─→ program_expense (delete + re-insert per project)
  ├─→ program_inflows (delete + re-insert per project)
  ├─→ project_plan (delete + re-insert per project)
  ├─→ project_revenue_summary (upsert)
  ├─→ cashflow_points (delete + re-insert)
  ├─→ finance_revenue_monthly (delete + re-insert)
  ├─→ finance_cos_monthly (delete + re-insert)
  └─→ upload_metadata + refresh_logs
```

### 7.2 Smart Import Flow
```
Excel File (.xlsx/.xlsm)
  ↓ POST /api/smart-import/upload
  ↓ runSmartImportPreview()
  │  ├─ detectSections() → identifies sheet regions
  │  ├─ mapColumns() → matches headers to canonical fields
  │  └─ normalizeData() → validates + transforms rows
  ↓
  smart_import_runs (status=PREVIEW, summaryJson=preview)
  import_issues (validation issues)
  ↓
  User reviews / resolves issues in UI
  ↓ POST /api/smart-import/:runId/commit
  ↓
  ├─→ normalized_plan_tasks
  ├─→ normalized_revenue_lines
  ├─→ normalized_cost_lines
  ├─→ normalized_execution_phases
  ├─→ counterparties (upsert)
  └─→ project_info (upsert)
```

### 7.3 Query-Time Data Resolution
```
API Request (e.g., GET /api/project/:name/expenses)
  ↓
  Read baseline: program_expense WHERE projectName = :name
  Read overrides: expenditure_overrides WHERE projectName = :name
  ↓
  applyExpenditureOverrides(baseline, overrides)
  ↓
  [Optional] Merge with normalized_cost_lines via data-merge.ts
  ↓
  Compute derived fields (state classification, confidence scores)
  ↓
  JSON Response → UI
```

### 7.4 Effective Date Resolution (Revenue)
```
program_inflows row
  ↓
  Check: paymentReceivedDate present? → use as effectiveDate
  ↓ No
  Check: milestone_task_links has dateOverride? → use dateOverride
  ↓ No
  Check: linked operational_task has dueDate? → use task dueDate
  ↓ No
  Check: linked plan_task (negative ID) has actualEnd? → use actualEnd
  ↓ No
  Fallback: computedForecastReceiptDate || plannedPaymentDate
```
