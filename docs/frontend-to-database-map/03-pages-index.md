# Pages Index

Master list of every screen in the Emergent Energy web app. Sourced from
`client/src/pages/` + `client/src/config/page-registry.ts` +
`client/src/App.tsx`.

Status column:
- `[x]` — detailed page file exists in `pages/` under this directory
- `[ ]` — still to be produced
- `alias` — the entry is an alias/redirect and will be covered in the
  target page's file

## Per-page mapping status

| Status | Screen / label | Route | Source file | Per-page doc |
|--------|----------------|-------|-------------|--------------|
| `[x]` | 404 – Off the grid | `*` | `not-found.tsx` | [`pages/not-found.md`](pages/not-found.md) |
| `[x]` | Login | `/auth/login` | `login.tsx` | [`pages/login.md`](pages/login.md) |
| `[x]` | Microsoft OAuth callback | `/auth/ms-callback` | `ms-callback.tsx` | [`pages/ms-callback.md`](pages/ms-callback.md) |
| `[x]` | Feedback & Support | `/feedback` | `feedback.tsx` | [`pages/feedback.md`](pages/feedback.md) |
| `[ ]` | Home | `/` | `home.tsx` | `pages/home.md` |
| `[ ]` | Company Overview | `/company-overview` | `company-overview/index.tsx` | `pages/company-overview.md` |
| `[ ]` | Dashboard (legacy redirect → Gates) | `/dashboard` → `/gates` | `dashboard.tsx` | `pages/dashboard.md` |
| `[ ]` | Execution Board | `/execution-board` | `execution-board.tsx` (re-exports `execution-dashboard/`) | `pages/execution-board.md` |
| `[ ]` | Execution Dashboard | `/execution-dashboard` | `execution-dashboard/` | `pages/execution-dashboard.md` |
| `[ ]` | Action Launchpad | `/actions/launchpad` | `action-launchpad.tsx` | `pages/action-launchpad.md` |
| `[ ]` | Projects (list) | `/projects` | `projects.tsx` | `pages/projects.md` |
| `[ ]` | Project Detail | `/project/:projectName` | `project-detail.tsx` | `pages/project-detail.md` |
| `[ ]` | Project Create | `/project-create` | `project-create.tsx` | `pages/project-create.md` |
| `[ ]` | Project Lifecycle | `/project-lifecycle` | `project-lifecycle.tsx` | `pages/project-lifecycle.md` |
| `[ ]` | Project Stage Gate | `/project/:projectName/gate/:stageCode` | `project-stage-gate.tsx` | `pages/project-stage-gate.md` |
| `[ ]` | Portfolios | `/portfolios` | `portfolios.tsx` | `pages/portfolios.md` |
| `[ ]` | Portfolio Detail | `/portfolios/:id` | `portfolio-detail.tsx` | `pages/portfolio-detail.md` |
| `[ ]` | Clients | `/clients` | `clients.tsx` | `pages/clients.md` |
| `[ ]` | Client Detail | `/clients/:clientId` | `client-detail.tsx` | `pages/client-detail.md` |
| `[ ]` | Client Project Departments | `/clients/:clientId/project/:projectId` | `client-project-departments.tsx` | `pages/client-project-departments.md` |
| `[ ]` | Sites | `/sites` | `sites.tsx` | `pages/sites.md` |
| `[ ]` | Counterparties | `/counterparties` | `counterparties.tsx` | `pages/counterparties.md` |
| `[ ]` | Opportunities | `/opportunities` | `opportunities.tsx` | `pages/opportunities.md` |
| `[ ]` | Engineering Dashboard | `/engineering` | `engineering-dashboard.tsx` | `pages/engineering-dashboard.md` |
| `[ ]` | Engineering Tasks | `/engineering/tasks` | `engineering-tasks.tsx` / `EngineeringTasksPage.tsx` | `pages/engineering-tasks.md` |
| `[ ]` | Engineering Standup | `/engineering/standup` | `engineering/standup.tsx` | `pages/engineering-standup.md` |
| `[ ]` | Engineering Audit | `/engineering/audit` | `engineering-audit.tsx` | `pages/engineering-audit.md` |
| `[ ]` | Engineering Templates (admin) | `/admin/eng-templates` | `eng-template-admin.tsx` | `pages/eng-template-admin.md` |
| `[ ]` | Engineering Monthly Report | `/reports/engineering/monthly` | `engineering-monthly-report.tsx` | `pages/engineering-monthly-report.md` |
| `[ ]` | Engineering Monthly Report History | `/reports/engineering/monthly/history` | `engineering-monthly-report-history.tsx` | `pages/engineering-monthly-report-history.md` |
| `[ ]` | Engineering Monthly Report Compare | `/reports/engineering/monthly/compare` | `engineering-monthly-report-compare.tsx` | `pages/engineering-monthly-report-compare.md` |
| `[ ]` | Engineering Monthly Report Project | `/reports/engineering/monthly/:month/project/:projectId` | `engineering-monthly-report-project.tsx` | `pages/engineering-monthly-report-project.md` |
| `[ ]` | PM Dashboard | `/pm-dashboard` | `pm-dashboard.tsx` | `pages/pm-dashboard.md` |
| `[ ]` | PM On-The-Go Home | `/pm/on-the-go` | `pm-on-the-go-home.tsx` | `pages/pm-on-the-go-home.md` |
| `[ ]` | PM On-The-Go Project | `/pm/on-the-go/project/:projectId` | `pm-on-the-go-project.tsx` | `pages/pm-on-the-go-project.md` |
| `[ ]` | PM Handover Review | `/pm/handover-review` | `pm-handover-review.tsx` | `pages/pm-handover-review.md` |
| `[ ]` | PM Monthly Report | `/reports/pm/monthly` | `pm-monthly-report.tsx` | `pages/pm-monthly-report.md` |
| `[ ]` | PM Monthly Report History | `/reports/pm/monthly/history` | `pm-monthly-report-history.tsx` | `pages/pm-monthly-report-history.md` |
| `[ ]` | PM Monthly Report Compare | `/reports/pm/monthly/compare` | `pm-monthly-report-compare.tsx` | `pages/pm-monthly-report-compare.md` |
| `[ ]` | PM Monthly Report Project | `/reports/pm/monthly/:month/project/:projectId` | `pm-monthly-report-project.tsx` | `pages/pm-monthly-report-project.md` |
| `[ ]` | PD Dashboard | `/pd` | `pd-dashboard.tsx` | `pages/pd-dashboard.md` |
| `[ ]` | PD Tickets | `/pd/tickets` | `pd-tickets.tsx` | `pages/pd-tickets.md` |
| `[ ]` | PD Ticket Create | `/pd/tickets/create` | `pd-ticket-create.tsx` | `pages/pd-ticket-create.md` |
| `[ ]` | PD Ticket Detail | `/pd/tickets/:id` | `pd-ticket-detail.tsx` | `pages/pd-ticket-detail.md` |
| `[ ]` | PD Reports | `/pd/reports` | `pd-reports.tsx` | `pages/pd-reports.md` |
| `[ ]` | PD-PM Handover v2 | `/pd/handover/:projectId` | `pd-pm-handover-v2.tsx` | `pages/pd-pm-handover-v2.md` |
| `[ ]` | Cashflow | `/cashflow` | `cashflow.tsx` | `pages/cashflow.md` |
| `[ ]` | Revenue Tracker | `/revenue-tracker` | `revenue-tracker.tsx` | `pages/revenue-tracker.md` |
| `[ ]` | COS | `/cos` | `cos.tsx` | `pages/cos.md` |
| `[ ]` | GP Tracker | `/gp-tracker` | `gp-tracker.tsx` | `pages/gp-tracker.md` |
| `[ ]` | FYE Revenue Tracking | `/fye-revenue-tracking` | `fye-revenue-tracking.tsx` | `pages/fye-revenue-tracking.md` |
| `[ ]` | Financial Linking | `/project/:projectName/financial-linking` | `financial-linking.tsx` | `pages/financial-linking.md` |
| `[ ]` | Financial Review Queue | `/governance/financial-reviews` | `financial-review-queue.tsx` | `pages/financial-review-queue.md` |
| `[ ]` | Invoice Patterns | `/invoice-patterns` | `invoice-patterns.tsx` | `pages/invoice-patterns.md` |
| `[ ]` | PO Approval Board | `/po-approval-board` | `po-approval-board.tsx` | `pages/po-approval-board.md` |
| `[ ]` | Payment Request Board | `/payment-request-board` | `payment-request-board.tsx` | `pages/payment-request-board.md` |
| `[ ]` | Payment Batch Manager | `/payment-batch-manager` | `payment-batch-manager.tsx` | `pages/payment-batch-manager.md` |
| `[ ]` | Subcontractor Dashboard | `/subcontractor-dashboard` | `subcontractor-dashboard.tsx` | `pages/subcontractor-dashboard.md` |
| `[ ]` | Procurement Dashboard | `/procurement` | `procurement-dashboard.tsx` | `pages/procurement-dashboard.md` |
| `[ ]` | QM Dashboard (Quality) | `/quality` | `qm-dashboard.tsx` + `quality/` | `pages/qm-dashboard.md` + `pages/quality-*.md` |
| `[ ]` | HSE Dashboard | `/hse` | `hse-dashboard.tsx` | `pages/hse-dashboard.md` |
| `[ ]` | Commissioning Dashboard | `/commissioning-dashboard` | `commissioning-dashboard.tsx` | `pages/commissioning-dashboard.md` |
| `[ ]` | Handover Dashboard | `/handover` | `handover-dashboard.tsx` | `pages/handover-dashboard.md` |
| `[ ]` | Handover Control | `/handover-control` | `handover-control.tsx` | `pages/handover-control.md` |
| `[ ]` | Admin Approvals | `/admin/approvals` (via `ApprovalsPage`) | `admin-approvals.tsx` | `pages/admin-approvals.md` |
| `[ ]` | Admin Backfill | `/admin/data-migration-status` | `admin-backfill.tsx` | `pages/admin-backfill.md` |
| `[ ]` | Admin Control Center | `/admin/control-center` | `admin-control-center.tsx` | `pages/admin-control-center.md` |
| `[ ]` | Admin Pipedrive | `/admin/pipedrive` | `admin-pipedrive.tsx` | `pages/admin-pipedrive.md` |
| `[ ]` | Admin Recovery | `/admin/recovery` | `admin-recovery.tsx` | `pages/admin-recovery.md` |
| `[ ]` | Admin Roles | `/admin/roles` | `admin-roles.tsx` | `pages/admin-roles.md` |
| `[ ]` | Admin Settings (system) | `/admin/settings` | `role-settings.tsx` + `admin-settings/` | `pages/admin-settings.md` |
| `[ ]` | Admin Workflow Config | `/admin/workflow-config` | `admin-workflow-config.tsx` | `pages/admin-workflow-config.md` |
| `[ ]` | Role Settings | `/admin/settings` | `role-settings.tsx` | `pages/role-settings.md` |
| `[ ]` | Stage Admin | `/admin/stage-lifecycle` | `components/stage-lifecycle/StageAdminPanel.tsx` | `pages/stage-admin.md` |
| `[ ]` | Phase Templates | `/admin/phase-templates` | `phase-templates.tsx` | `pages/phase-templates.md` |
| `[ ]` | System Activity Log | `/admin/activity-log` | `system-activity-log.tsx` | `pages/system-activity-log.md` |
| `[ ]` | Database Migration | `/admin/database-migration` | `database-migration.tsx` | `pages/database-migration.md` |
| `[ ]` | Import Control Tower | `/admin/import-control-tower` | `import-control-tower.tsx` | `pages/import-control-tower.md` |
| `[ ]` | KPI Traceability | `/admin/kpi-traceability` | `kpi-traceability.tsx` | `pages/kpi-traceability.md` |
| `[ ]` | SharePoint Intake | `/admin/sharepoint-intake` | `SharePointIntakePage.tsx` | `pages/sharepoint-intake.md` |
| `[ ]` | My Work Home | `/my-work` | `my-work-home.tsx` | `pages/my-work-home.md` |
| `[ ]` | My Work Calendar | `/my-work/calendar` | `my-work-calendar.tsx` | `pages/my-work-calendar.md` |
| `[ ]` | My Work Tasks | `/my-work/tasks` | `my-work-tasks.tsx` + `my-work-tasks-logic.ts` | `pages/my-work-tasks.md` |
| `[ ]` | My Work Meetings | `/my-work/meetings` | `my-work-meetings.tsx` | `pages/my-work-meetings.md` |
| `[ ]` | My Work Settings | `/my-work/settings` | `my-work-settings.tsx` | `pages/my-work-settings.md` |
| `[ ]` | My Work Admin Settings | `/admin/my-tool-settings` | `my-work-admin-settings.tsx` | `pages/my-work-admin-settings.md` |
| `[ ]` | My Work Priorities (legacy) | `/my-work/priorities` | `my-work-priorities.tsx` | `pages/my-work-priorities.md` |
| `[ ]` | Inbox | `/inbox` | `inbox.tsx` | `pages/inbox.md` |
| `[ ]` | Priorities | `/priorities` | `priorities.tsx` | `pages/priorities.md` |
| `[ ]` | Priority Detail | `/priorities/:id` | `priority-detail.tsx` | `pages/priority-detail.md` |
| `[ ]` | Smart Import | `/admin/smart-import` | `smart-import.tsx` + `smart-import/` | `pages/smart-import.md` |
| `[ ]` | Collaboration (legacy alias → My Work) | `/collaboration` | `collaboration.tsx` | `pages/collaboration.md` |
| `[ ]` | Collab Email (legacy) | `/collaboration/email` | `collab-email.tsx` | `pages/collab-email.md` |
| `[ ]` | Collab Teams (legacy) | `/collaboration/teams` | `collab-teams.tsx` | `pages/collab-teams.md` |
| `[ ]` | Teams Chats | `/my-work/teams` | `teams-chats.tsx` | `pages/teams-chats.md` |
| `[ ]` | Lifecycle Board | `/lifecycle-board` | `lifecycle-board.tsx` | `pages/lifecycle-board.md` |
| `[ ]` | Gates Pipeline | `/gates` | `gates/gates-pipeline.tsx` | `pages/gates-pipeline.md` |
| `[ ]` | Gates Blocked | `/gates/blocked` | `gates/gates-blocked.tsx` | `pages/gates-blocked.md` |
| `[ ]` | Gates Ready | `/gates/ready` | `gates/gates-ready.tsx` | `pages/gates-ready.md` |
| `[ ]` | Gates Exceptions | `/gates/exceptions` | `gates/gates-exceptions.tsx` | `pages/gates-exceptions.md` |
| `[ ]` | Gates Client Updates | `/gates/client-updates` | `gates/gates-client-updates.tsx` | `pages/gates-client-updates.md` |
| `[ ]` | Gates Handovers | `/gates/handovers` | `gates/gates-handovers.tsx` | `pages/gates-handovers.md` |
| `[ ]` | Gates Queries | `/gates/queries` | `gates/gates-queries.tsx` | `pages/gates-queries.md` |
| `[ ]` | Gates Commitments | `/gates/commitments` | `gates/gates-commitments.tsx` | `pages/gates-commitments.md` |
| `[ ]` | Milestone Tracker | `/milestone-tracker` | `milestone-tracker.tsx` | `pages/milestone-tracker.md` |
| `[ ]` | Exceptions (legacy redirect → /gates/exceptions) | `/exceptions` | `exceptions.tsx` | `pages/exceptions.md` |
| `[ ]` | Weekly Reviews | `/weekly-reviews` | `weekly-reviews.tsx` | `pages/weekly-reviews.md` |
| `[ ]` | Standups (alias → /engineering/standup) | `/standups` | `standups.tsx` | `pages/standups.md` |
| `[ ]` | Report Center | `/reports/center` | `reports/report-center.tsx` | `pages/report-center.md` |
| `[ ]` | Performance (Reports) | `/reports/performance` | `reports/performance.tsx` | `pages/performance.md` |
| `[ ]` | Programme Reports | `/reports/programme` | `programme-reports.tsx` | `pages/programme-reports.md` |
| `[ ]` | Leaderboard | `/leaderboard` | `leaderboard.tsx` | `pages/leaderboard.md` |
| `[ ]` | Department Scores (alias → /leaderboard?tab=departments) | `/department-scores` | `department-scores.tsx` | `pages/department-scores.md` |
| `[ ]` | Lessons Learnt | `/admin/lessons` | `lessons-learnt.tsx` | `pages/lessons-learnt.md` |
| `[ ]` | Training | `/training` | `training.tsx` | `pages/training.md` |
| `[ ]` | Processes & SOPs (EE Info) | `/ee-info` | `ee-info.tsx` | `pages/ee-info.md` |

## Summary counts

- **Total pages listed above:** 112 (matches `client/src/pages/` plus the
  re-exported `components/stage-lifecycle/StageAdminPanel.tsx`)
- **Completed so far:** 4 — `not-found`, `login`, `ms-callback`, `feedback`
- **Remaining:** 108

Follow-up commits will fill the `[ ]` rows in order, grouped by domain
(Home/Dashboard → Projects → Engineering → PM/PD → Finance → Quality/HSE →
Admin → My Work → Smart Import/Collab → Gates/Lifecycle → Reports).
