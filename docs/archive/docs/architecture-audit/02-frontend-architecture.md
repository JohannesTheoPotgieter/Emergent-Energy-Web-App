# Section 2: Frontend Architecture Map

> 99 pages | 147 components | 11 hooks | React 19 + Vite + Wouter + TanStack Query

## 2.1 Pages/Routes by Module

### Dashboard & Home
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/` | `homepage.tsx` | Role-based redirect, `authApi.me()` |
| `/dashboard` | `dashboard.tsx` | `dashboardApi.getData()` → project_info, program_expense, program_inflows |
| `/execution-board` | `execution-board.tsx` | `overviewApi.getData()`, `overviewApi.getProjectsSummary()` |
| `/execution-board/program` | (subview) | Same as execution-board |
| `/execution-board/construction` | (subview) | Same + construction filters |
| `/execution-board/finance` | (subview) | Same + finance aggregations |

### Project Management
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/projects` | `projects.tsx` | `projectsApi.getAll()` → project_info list |
| `/project/:projectName` | `project-detail.tsx` | `projectsApi.getById()` + 10+ tab-level fetches |
| `/project/:projectName/financial-linking` | `financial-linking.tsx` | project expenses/revenues + linking rules |
| `/project-lifecycle` | `project-lifecycle.tsx` | `overviewApi.getData()` |
| `/project-lifecycle/stage-gates` | (subview) | stage_gate_definitions, project_gate_evaluations |
| `/project-lifecycle/latest-updates` | (subview) | project_editable_fields |
| `/project-lifecycle/client-overview` | (subview) | clients, project_client_history |

### Finance Module
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/cashflow` | `cashflow.tsx` | cashflow_points, cashflow_planning_overrides, cashflow_weekly_manual |
| `/cos` | `cos.tsx` | program_expense (aggregated via cosAggregator), cos_status_overrides |
| `/revenue-tracker` | `revenue-tracker.tsx` | tracker_monthly_manual (type=revenue) |
| `/gp-tracker` | `gp-tracker.tsx` | tracker_monthly_manual (type=gp) |
| `/fye-revenue-tracking` | `fye-revenue-tracking.tsx` | fye_budgets, fye_kpi_counters, fye_report_snapshots |
| `/invoice-patterns` | `invoice-patterns.tsx` | invoice_pattern_rules, invoice_pattern_matches |
| `/counterparties` | `counterparties.tsx` | counterparties, counterparty_contacts |

### Work & Task Management
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/my-work` | `my-work-home.tsx` | mytool_tasks, operational_tasks (assigned), work_items |
| `/my-work/tasks` | `my-work-tasks.tsx` | mytool_tasks (user-filtered) |
| `/my-work/calendar` | `my-work-calendar.tsx` | mytool_timeblocks, mytool_tasks, meetings |
| `/my-work/meetings` | `my-tool-meetings.tsx` | meeting_summaries, meeting_action_items |
| `/my-work/email` | `collab-email.tsx` | Outlook API (via ms_accounts) |
| `/tasks` | `task-management.tsx` | operational_tasks, work_items (unified) |

### Engineering Module
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/engineering` | `engineering-dashboard.tsx` | engineering_tasks, project_eng_stages |
| `/engineering/tasks` | `engineering-tasks.tsx` | engineering_tasks (filtered), eng attachments |
| `/engineering/audit` | `engineering-audit.tsx` | audit_events (eng-filtered) |

### Quality Module
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/quality` | `qm-dashboard.tsx` | qc_checklist, qc_item_instance, qc_warning |

### Project Development
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/pd/dashboard` | `pd-dashboard.tsx` | pd_tickets (aggregated), clients |
| `/pd/tickets` | `pd-tickets.tsx` | pd_tickets list |
| `/pd/tickets/create` | `pd-ticket-create.tsx` | clients, users (for assignment) |
| `/pd/tickets/:id` | `pd-ticket-detail.tsx` | pd_tickets + operational_tasks (linked) |
| `/pd/handover/:projectId` | `pd-pm-handover.tsx` | project_info, operational_tasks, deliverables |
| `/clients` | `clients.tsx` | clients, project_client_history |

### PM Module
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/pm-dashboard` | `pm-dashboard.tsx` | project_info, operational_tasks (cross-project) |
| `/pm/on-the-go` | `pm-on-the-go-home.tsx` | project_info (assigned to PM) |
| `/pm/on-the-go/project/:projectId` | `pm-on-the-go-project.tsx` | work_items, deliverables, qc items per project |
| `/pm/deliverables` | `pm-deliverables.tsx` | deliverables (cross-project) |
| `/pm/approvals` | `admin-approvals.tsx` | approvals |
| `/pm/handover-review` | `pm-handover-review.tsx` | project_info (handover-phase) |

### Admin Module
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/admin` | `admin-control-center.tsx` | app_settings, feature flags |
| `/admin/roles` | `admin-roles.tsx` | users, role_permissions, user_permission_overrides |
| `/admin/activity-log` | `system-activity-log.tsx` | audit_events |
| `/admin/recovery` | `admin-recovery.tsx` | migration_backups, deleted records |
| `/admin/smart-import` | `smart-import.tsx` | smart_import_runs, import_issues |
| `/admin/sharepoint-intake` | `SharePointIntakePage.tsx` | sp_settings, sp_files, import_runs |
| `/admin/database-migration` | `database-migration.tsx` | migration status |
| `/admin/kpi-traceability` | `kpi-traceability.tsx` | derived KPIs, source tracing |

### Lifecycle & Governance
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/lifecycle-board` | `lifecycle-board.tsx` | company_projects, project_info |
| `/handover-control` | `handover-control.tsx` | project_info (handover phase) |
| `/weekly-reviews` | `weekly-reviews.tsx` | weekly_reviews |
| `/phase-templates` | `phase-templates.tsx` | phase_template, phase_template_item |

### Other
| Route | Page File | Data Consumed |
|-------|-----------|---------------|
| `/portfolios` | `portfolios.tsx` | portfolios |
| `/portfolios/:id` | `portfolio-detail.tsx` | portfolios + project_portfolio_assignments |
| `/leaderboard` | `leaderboard.tsx` | user_points, user_badges |
| `/feedback` | `feedback.tsx` | support_tickets, feedback_tickets |
| `/standups` | `standups.tsx` | standup_schedules, standup_entries |
| `/exceptions` | `exceptions.tsx` | Exception dashboard service |
| `/reports/programme` | `programme-reports.tsx` | Cross-table aggregation |
| `/auth/login` | `login.tsx` | `authApi.login()` |

## 2.2 Component Hierarchy & Data Dependencies

### Layout Shell
```
<App>
  <QueryClientProvider>          ← React Query cache
    <AuthProvider>               ← user, login(), logout()
      <ProgramProvider>          ← dashboardData, refreshData()
        <RoleGuard>              ← permission checks
          <AppLayout>            ← sidebar, header, nav, search
            <PageShell>          ← breadcrumbs, title
              {page content}
            </PageShell>
          </AppLayout>
        </RoleGuard>
      </ProgramProvider>
    </AuthProvider>
  </QueryClientProvider>
</App>
```

### Key Data-Fetching Components
| Component | Data Source | Pattern |
|-----------|------------|---------|
| `AppLayout` | `useAuth()`, `useProgramData()` | Context |
| `EditableDataGrid` | Props (data passed from page) | Props |
| `TaskDetailDrawer` | `useQuery` (fetches task by ID) | Server state |
| `WeeklyReviewWizard` | `useQuery` (project data + review) | Server state |
| `PermissionGate` | `usePermission(entity, action)` | Hook |
| `UserAssignmentPicker` | `useQuery` for users list | Server state |
| `GlobalCommandPalette` | `/api/search` | Direct fetch |
| Tab components (25) | Individual `useQuery` per tab | Server state |

### State Management Summary
| Layer | Mechanism | Data |
|-------|-----------|------|
| **Server state** | TanStack React Query | All API data (30s stale, 5min GC) |
| **Auth state** | React Context (`AuthProvider`) | user, isAuthenticated, role |
| **Program state** | React Context (`ProgramProvider`) | Dashboard overview, upload results |
| **UI state** | React local state | Modals, filters, selections |
| **Persistent UI** | localStorage | Theme, auth_token, guidance state, scroll positions |
| **URL state** | Wouter + query params | Current route, filter params |

## 2.3 Forms & Write Operations

| Form | Page/Component | Submits To | Models Written |
|------|---------------|------------|----------------|
| Login | `login.tsx` | POST `/api/auth/login` | Session |
| Phase change | `project-detail.tsx` | PATCH `/api/projects/:id/phase` | project_info, project_phase_history |
| RAG update | `project-detail.tsx` | PATCH `/api/projects/:id/rag` | project_info, project_rag_audit |
| Budget entry | Budget forms | POST `/api/budgets` | budgets (LEGACY) |
| File upload | `AppLayout.tsx` | POST `/api/upload` | upload_metadata → parsed tables |
| Task create | `task-management.tsx` | POST `/api/tasks/operational` | operational_tasks |
| Task update | `TaskDetailDrawer` | PATCH `/api/tasks/:id` | operational_tasks |
| MyTool task | My Work pages | POST/PATCH `/api/mytool/tasks` | mytool_tasks |
| Eng task | Engineering pages | POST/PATCH `/api/eng/tasks` | engineering_tasks |
| QC item update | Quality pages | PATCH `/api/quality/items/:id` | qc_item_instance |
| PD ticket | PD pages | POST/PATCH `/api/pd/tickets` | pd_tickets |
| Deliverable upload | Eng/PM pages | POST with file | deliverables, deliverable_files |
| Override edits | Finance tabs | PATCH `/api/overrides/*` | Various override tables |
| Approval decision | Approvals page | PATCH `/api/approvals/:id` | approvals |
| Weekly review | Weekly review wizard | POST `/api/weekly-reviews` | weekly_reviews |
| Standup entry | Standups page | POST `/api/standups/entries` | standup_entries |
| Smart import | Admin import | POST `/api/smart-import/commit` | smart_import_runs → domain tables |

## 2.4 Client-Side Derived/Computed State

| Computed Value | Source of Truth | Where Computed | Concern |
|---------------|----------------|----------------|---------|
| Project status badges | `project_info.phase` + `ragStatus` | Frontend (`status-colors.ts`) | ✅ OK — display logic |
| Task metrics (counts by status) | `operational_tasks` | Frontend (`useEngineeringTaskFilters`) | ⚠️ Should be server-side |
| Permission checks | `role_permissions` + overrides | Frontend (`use-permissions.ts`, `use-access-matrix.ts`) | ⚠️ Duplicated — server also checks |
| Phase label mapping | `PHASE_TEXT_TO_ENUM` | Shared (`schema.ts`) | ✅ OK — shared constant |
| Financial totals | `program_expense`, `program_inflows` | Both (server computes, FE re-aggregates) | ⚠️ Potential mismatch |
| Navigation visibility | Role + permissions | Frontend (`role-aware-ux.ts`) | ✅ OK — UX concern |
| COS line status | `computedState` field | Server (`stateClassifier`) | ✅ OK — server-authoritative |

## 2.5 Business Logic in Frontend (Flagged)

| Location | Logic | Should Be |
|----------|-------|-----------|
| `client/src/hooks/useEngineeringTaskFilters.ts` | Complex filter logic + metric derivation for eng tasks | Server-side aggregation endpoint |
| `client/src/lib/project-lifecycle-workspace.ts` | Lifecycle phase validation and transitions | Server-side (already exists in lifecycle service) |
| `client/src/lib/access-control.ts` | Full permission matrix evaluation | Server authoritative; FE should only cache result |
| Various tab components | Financial re-aggregation (summing rows client-side) | Server should return pre-aggregated summaries |
| `client/src/config/role-aware-ux.ts` | Role-to-nav mapping with hardcoded rules | Acceptable for UX, but should match server permissions |
