# Route Truth Baseline (2026-04-06)

## Phase 0 Route Table

| path | route type | canonical destination | source file(s) | actual component file | sidebar visible | role landing | permission entity | current status |
|---|---|---|---|---|---|---|---|---|
| `/actions/launchpad` | page | `/actions/launchpad` | client/src/config/page-registry.ts | @/pages/action-launchpad | no | no | work_items | active |
| `/admin` | legacy redirect | `/admin/control-center` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/admin/activity-log` | page | `/admin/activity-log` | client/src/config/page-registry.ts | @/pages/system-activity-log | no | no | activity_log | active |
| `/admin/control-center` | page | `/admin/control-center` | client/src/config/page-registry.ts | @/pages/admin-control-center | no | no | admin | active |
| `/admin/data-migration-status` | page | `/admin/data-migration-status` | client/src/config/page-registry.ts | @/pages/admin-backfill | no | no | admin | active |
| `/admin/database-migration` | page | `/admin/database-migration` | client/src/config/page-registry.ts | @/pages/database-migration | no | no | database_migration | active |
| `/admin/eng-templates` | page | `/admin/eng-templates` | client/src/config/page-registry.ts | @/pages/eng-template-admin | no | no | admin | active |
| `/admin/handover-health` | page | `/admin/handover-health` | client/src/config/page-registry.ts | @/pages/handover-control | no | no | handover | active |
| `/admin/import-control-tower` | page | `/admin/import-control-tower` | client/src/config/page-registry.ts | @/pages/import-control-tower | no | no | admin | active |
| `/admin/kpi-traceability` | page | `/admin/kpi-traceability` | client/src/config/page-registry.ts | @/pages/kpi-traceability | no | no | admin | active |
| `/admin/legacy-utilities` | legacy redirect | `/admin/control-center` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/admin/lessons` | page | `/admin/lessons` | client/src/config/page-registry.ts | @/pages/lessons-learnt | no | no | handover | active |
| `/admin/migration-control` | page | `/admin/migration-control` | client/src/config/page-registry.ts | @/pages/admin-migration-control | yes | no | admin | active |
| `/admin/my-tool-settings` | page | `/admin/my-tool-settings` | client/src/config/page-registry.ts | @/pages/my-work-admin-settings | no | no | admin | active |
| `/admin/phase-templates` | page | `/admin/phase-templates` | client/src/config/page-registry.ts | @/pages/phase-templates | no | no | admin | active |
| `/admin/pipedrive` | page | `/admin/pipedrive` | client/src/config/page-registry.ts | @/pages/admin-pipedrive | no | no | admin | active |
| `/admin/recovery` | page | `/admin/recovery` | client/src/config/page-registry.ts | @/pages/admin-recovery | no | no | admin | active |
| `/admin/roles` | page | `/admin/roles` | client/src/config/page-registry.ts | @/pages/admin-roles | no | no | admin_roles | active |
| `/admin/settings` | page | `/admin/settings` | client/src/config/page-registry.ts | @/pages/role-settings | no | no | admin | active |
| `/admin/sharepoint-intake` | page | `/admin/sharepoint-intake` | client/src/config/page-registry.ts | @/pages/SharePointIntakePage | no | no | admin | active |
| `/admin/smart-import` | page | `/admin/smart-import` | client/src/config/page-registry.ts | @/pages/smart-import | no | no | smart_import | active |
| `/admin/stage-lifecycle` | page | `/admin/stage-lifecycle` | client/src/config/page-registry.ts | @/components/stage-lifecycle/StageAdminPanel | no | no | stage_admin | active |
| `/admin/workflow-config` | page | `/admin/workflow-config` | client/src/config/page-registry.ts | @/pages/admin-workflow-config | no | no | admin | active |
| `/cashflow` | page | `/cashflow` | client/src/config/page-registry.ts | @/pages/cashflow | yes | yes | cashflow | active |
| `/cashflow-forecast` | alias | `/cashflow` | client/src/config/page-registry.ts | — | no | no | cashflow | duplicate |
| `/clients` | page | `/clients` | client/src/config/page-registry.ts | @/pages/clients | yes | no | pd_clients | active |
| `/clients/:clientId` | page | `/clients/:clientId` | client/src/config/page-registry.ts | @/pages/client-detail | no | no | pd_clients | active |
| `/clients/:clientId/project/:projectId` | page | `/clients/:clientId/project/:projectId` | client/src/config/page-registry.ts | @/pages/client-project-departments | no | no | pd_clients | active |
| `/collaboration` | alias | `/my-work` | client/src/config/page-registry.ts | — | no | no | collaboration_hub | duplicate |
| `/collaboration/email` | alias | `/my-work/email` | client/src/config/page-registry.ts | — | no | no | collaboration_hub | duplicate |
| `/collaboration/teams` | alias | `/my-work/teams` | client/src/config/page-registry.ts | — | no | no | teams_chat | duplicate |
| `/command-center` | alias | `/my-work` | client/src/config/page-registry.ts | — | no | no | home | duplicate |
| `/commissioning-dashboard` | page | `/commissioning-dashboard` | client/src/config/page-registry.ts | @/pages/commissioning-dashboard | yes | no | commissioning | active |
| `/commissioning-dashboard/:projectId` | page | `/commissioning-dashboard/:projectId` | client/src/config/page-registry.ts | @/pages/commissioning-dashboard | no | no | commissioning | active |
| `/company-overview` | page | `/company-overview` | client/src/config/page-registry.ts | @/pages/company-overview | yes | yes | execution_board | active |
| `/company-priorities` | alias | `/priorities` | client/src/config/page-registry.ts | — | no | no | company_priorities | duplicate |
| `/construction` | page | `/construction` | client/src/config/page-registry.ts | @/pages/execution-board | no | no | execution_board | active |
| `/cos` | page | `/cos` | client/src/config/page-registry.ts | @/pages/cos | yes | no | cos | active |
| `/cos-control` | alias | `/cos` | client/src/config/page-registry.ts | — | no | no | cos | duplicate |
| `/counterparties` | page | `/counterparties` | client/src/config/page-registry.ts | @/pages/counterparties | yes | no | counterparties | active |
| `/dashboard` | legacy redirect | `/gates` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/department-scores` | alias | `/leaderboard?tab=departments` | client/src/config/page-registry.ts | — | no | no | leaderboard | duplicate |
| `/ee-info` | page | `/ee-info` | client/src/config/page-registry.ts | @/pages/ee-info | yes | no | ee_info | active |
| `/engineering` | page | `/engineering` | client/src/config/page-registry.ts | @/pages/engineering-dashboard | yes | yes | engineering | active |
| `/engineering/audit` | page | `/engineering/audit` | client/src/config/page-registry.ts | @/pages/engineering-audit | no | no | admin | active |
| `/engineering/deliverables-v2/:projectId` | page | `/engineering/deliverables-v2/:projectId` | client/src/config/page-registry.ts | @/pages/engineering-deliverables-v2 | no | no | deliverables | active |
| `/engineering/standup` | page | `/engineering/standup` | client/src/config/page-registry.ts | @/pages/engineering/standup | yes | no | standups | active |
| `/engineering/tasks` | page | `/engineering/tasks` | client/src/config/page-registry.ts | @/pages/engineering-tasks | yes | no | eng_tasks | active |
| `/exceptions` | legacy redirect | `/gates/exceptions` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/execution-board` | page | `/execution-board` | client/src/config/page-registry.ts | @/pages/execution-board | yes | yes | execution_board | active |
| `/execution-board/finance` | page | `/execution-board/finance` | client/src/config/page-registry.ts | @/pages/execution-board | no | no | execution_board | active |
| `/execution-board/program` | page | `/execution-board/program` | client/src/config/page-registry.ts | @/pages/execution-board | no | no | execution_board | active |
| `/execution-dashboard` | alias | `/execution-board` | client/src/config/page-registry.ts | — | no | no | execution_board | duplicate |
| `/feedback` | page | `/feedback` | client/src/config/page-registry.ts | @/pages/feedback | yes | no | feedback | active |
| `/finance/home` | legacy redirect | `/finance/records` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/finance/records` | page | `/finance/records` | client/src/config/page-registry.ts | @/pages/finance-records | yes | no | financials | active |
| `/finance/workspace/:projectId` | page | `/finance/workspace/:projectId` | client/src/config/page-registry.ts | @/pages/finance-workspace | no | no | financials | active |
| `/fye-revenue-tracking` | page | `/fye-revenue-tracking` | client/src/config/page-registry.ts | @/pages/fye-revenue-tracking | yes | no | fye_revenue_tracking | active |
| `/gates` | page | `/gates` | client/src/config/page-registry.ts | @/pages/gates/gates-pipeline | yes | no | lifecycle | active |
| `/gates/blocked` | page | `/gates/blocked` | client/src/config/page-registry.ts | @/pages/gates/gates-blocked | yes | no | lifecycle | active |
| `/gates/client-updates` | page | `/gates/client-updates` | client/src/config/page-registry.ts | @/pages/gates/gates-client-updates | yes | no | lifecycle | active |
| `/gates/commitments` | page | `/gates/commitments` | client/src/config/page-registry.ts | @/pages/gates/gates-commitments | yes | no | lifecycle | active |
| `/gates/exceptions` | page | `/gates/exceptions` | client/src/config/page-registry.ts | @/pages/gates/gates-exceptions | yes | no | lifecycle | active |
| `/gates/handovers` | page | `/gates/handovers` | client/src/config/page-registry.ts | @/pages/gates/gates-handovers | yes | no | lifecycle | active |
| `/gates/queries` | page | `/gates/queries` | client/src/config/page-registry.ts | @/pages/gates/gates-queries | yes | no | lifecycle | active |
| `/gates/ready` | page | `/gates/ready` | client/src/config/page-registry.ts | @/pages/gates/gates-ready | yes | no | lifecycle | active |
| `/governance` | legacy redirect | `/governance/processes` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/governance/approvals` | page | `/governance/approvals` | client/src/config/page-registry.ts | @/pages/approvals-board-v2 | yes | no | approvals | active |
| `/governance/financial-reviews` | page | `/governance/financial-reviews` | client/src/config/page-registry.ts | @/pages/financial-review-queue | yes | no | approvals | active |
| `/governance/processes` | page | `/governance/processes` | client/src/config/page-registry.ts | @/pages/governed-processes | yes | no | projects | active |
| `/gp-tracker` | page | `/gp-tracker` | client/src/config/page-registry.ts | @/pages/gp-tracker | yes | no | gp_tracker | active |
| `/handover` | page | `/handover` | client/src/config/page-registry.ts | @/pages/handover-dashboard | yes | no | handover | active |
| `/handover-control` | page | `/handover-control` | client/src/config/page-registry.ts | @/pages/handover-control | yes | no | handover | active |
| `/hse` | page | `/hse` | client/src/config/page-registry.ts | @/pages/hse-dashboard | yes | yes | hse | active |
| `/hse/compliance` | alias | `/hse?tab=compliance` | client/src/config/page-registry.ts | — | no | no | hse_compliance | duplicate |
| `/inbox` | page | `/inbox` | client/src/config/page-registry.ts | @/pages/inbox | yes | no | home | active |
| `/invoice-patterns` | page | `/invoice-patterns` | client/src/config/page-registry.ts | @/pages/invoice-patterns | yes | no | invoice_patterns | active |
| `/leaderboard` | page | `/leaderboard` | client/src/config/page-registry.ts | @/pages/leaderboard | no | no | leaderboard | active |
| `/lifecycle-board` | page | `/lifecycle-board` | client/src/config/page-registry.ts | @/pages/lifecycle-board | yes | no | lifecycle | active |
| `/milestone-tracker` | page | `/milestone-tracker` | client/src/config/page-registry.ts | @/pages/milestone-tracker | yes | no | execution_board | active |
| `/my-tool` | legacy redirect | `/` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-tool/backlog` | legacy redirect | `/my-work/tasks` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-tool/help` | legacy redirect | `/` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-tool/meetings` | legacy redirect | `/my-work/meetings` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-tool/settings` | legacy redirect | `/my-work/settings` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-tool/week` | legacy redirect | `/my-work/calendar` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/my-work` | page | `/my-work` | client/src/config/page-registry.ts | @/pages/my-work-home | yes | no | home | active |
| `/my-work/approvals` | alias | `/governance/approvals` | client/src/config/page-registry.ts | — | no | no | my_work | duplicate |
| `/my-work/calendar` | page | `/my-work/calendar` | client/src/config/page-registry.ts | @/pages/my-work-calendar | yes | no | my_work | active |
| `/my-work/email` | page | `/my-work/email` | client/src/config/page-registry.ts | @/pages/collab-email | yes | no | collaboration_hub | active |
| `/my-work/meetings` | page | `/my-work/meetings` | client/src/config/page-registry.ts | @/pages/my-work-meetings | yes | no | meetings | active |
| `/my-work/settings` | page | `/my-work/settings` | client/src/config/page-registry.ts | @/pages/my-work-settings | yes | no | home | active |
| `/my-work/tasks` | page | `/my-work/tasks` | client/src/config/page-registry.ts | @/pages/my-work-tasks | yes | no | my_tool | active |
| `/my-work/teams` | page | `/my-work/teams` | client/src/config/page-registry.ts | @/pages/teams-chats | yes | no | teams_chat | active |
| `/opportunities` | page | `/opportunities` | client/src/config/page-registry.ts | @/pages/opportunities | yes | no | pd_dashboard | active |
| `/parties` | page | `/parties` | client/src/config/page-registry.ts | @/pages/parties-registry | yes | no | counterparties | active |
| `/payment-batch-manager` | page | `/payment-batch-manager` | client/src/config/page-registry.ts | @/pages/payment-batch-manager | yes | no | procurement | active |
| `/payment-request-board` | page | `/payment-request-board` | client/src/config/page-registry.ts | @/pages/payment-request-board | yes | no | procurement | active |
| `/pd` | page | `/pd` | client/src/config/page-registry.ts | @/pages/pd-dashboard | yes | yes | pd_dashboard | active |
| `/pd/clients` | alias | `/clients` | client/src/config/page-registry.ts | — | no | no | pd_clients | duplicate |
| `/pd/dashboard` | alias | `/pd` | client/src/config/page-registry.ts | — | no | no | pd_dashboard | duplicate |
| `/pd/handover/:projectId` | page | `/pd/handover/:projectId` | client/src/config/page-registry.ts | @/pages/pd-pm-handover-v2 | no | no | handover | active |
| `/pd/reports` | page | `/pd/reports` | client/src/config/page-registry.ts | @/pages/pd-reports | yes | no | pd_dashboard | active |
| `/pd/tickets` | page | `/pd/tickets` | client/src/config/page-registry.ts | @/pages/pd-tickets | yes | no | pd_tickets | active |
| `/pd/tickets/:id` | page | `/pd/tickets/:id` | client/src/config/page-registry.ts | @/pages/pd-ticket-detail | no | no | pd_tickets | active |
| `/pd/tickets/create` | page | `/pd/tickets/create` | client/src/config/page-registry.ts | @/pages/pd-ticket-create | no | no | pd_tickets | active |
| `/pm-dashboard` | page | `/pm-dashboard` | client/src/config/page-registry.ts | @/pages/pm-dashboard | yes | no | pm_dashboard | active |
| `/pm/approvals` | alias | `/governance/approvals` | client/src/config/page-registry.ts | — | no | no | approvals | duplicate |
| `/pm/handover-review` | page | `/pm/handover-review` | client/src/config/page-registry.ts | @/pages/pm-handover-review | no | no | handover | active |
| `/pm/on-the-go` | page | `/pm/on-the-go` | client/src/config/page-registry.ts | @/pages/pm-on-the-go-home | yes | no | pm_on_the_go | active |
| `/pm/on-the-go/project/:projectId` | page | `/pm/on-the-go/project/:projectId` | client/src/config/page-registry.ts | @/pages/pm-on-the-go-project | no | no | pm_on_the_go | active |
| `/pm/workboard/:projectId` | page | `/pm/workboard/:projectId` | client/src/config/page-registry.ts | @/pages/pm-workboard | no | no | work_items | active |
| `/po-approval-board` | page | `/po-approval-board` | client/src/config/page-registry.ts | @/pages/po-approval-board | yes | no | procurement | active |
| `/portfolios` | page | `/portfolios` | client/src/config/page-registry.ts | @/pages/portfolios | yes | no | portfolios | active |
| `/portfolios/:id` | page | `/portfolios/:id` | client/src/config/page-registry.ts | @/pages/portfolio-detail | no | no | portfolio_detail | active |
| `/priorities` | page | `/priorities` | client/src/config/page-registry.ts | @/pages/priorities | yes | no | company_priorities | active |
| `/priorities/:id` | page | `/priorities/:id` | client/src/config/page-registry.ts | @/pages/priority-detail | no | no | company_priorities | active |
| `/procurement` | alias | `/execution-board` | client/src/config/page-registry.ts | — | no | no | execution_board | duplicate |
| `/project-create` | page | `/project-create` | client/src/config/page-registry.ts | @/pages/project-create | no | no | project_creation | active |
| `/project-lifecycle` | page | `/project-lifecycle` | client/src/config/page-registry.ts | @/pages/project-lifecycle | yes | no | lifecycle | active |
| `/project-lifecycle/client-overview` | page | `/project-lifecycle/client-overview` | client/src/config/page-registry.ts | @/pages/project-lifecycle | no | no | pd_clients | active |
| `/project-lifecycle/latest-updates` | page | `/project-lifecycle/latest-updates` | client/src/config/page-registry.ts | @/pages/project-lifecycle | no | no | projects | active |
| `/project-lifecycle/stage-gates` | page | `/project-lifecycle/stage-gates` | client/src/config/page-registry.ts | @/pages/project-lifecycle | no | no | lifecycle | active |
| `/project/:projectName` | page | `/project/:projectName` | client/src/config/page-registry.ts | @/pages/project-detail | no | no | projects | active |
| `/project/:projectName/financial-linking` | page | `/project/:projectName/financial-linking` | client/src/config/page-registry.ts | @/pages/financial-linking | no | no | financial_linking | active |
| `/project/:projectName/gate/:stageCode` | page | `/project/:projectName/gate/:stageCode` | client/src/config/page-registry.ts | @/pages/project-stage-gate | no | no | stage_lifecycle | active |
| `/projects` | page | `/projects` | client/src/config/page-registry.ts | @/pages/projects | yes | no | projects | active |
| `/quality` | page | `/quality` | client/src/config/page-registry.ts | @/pages/qm-dashboard | yes | yes | quality | active |
| `/quality/dashboard` | alias | `/quality` | client/src/config/page-registry.ts | — | no | no | quality | duplicate |
| `/quality/ncr/:id` | alias | `/quality` | client/src/config/page-registry.ts | — | no | no | quality | duplicate |
| `/quality/ncrs` | alias | `/quality` | client/src/config/page-registry.ts | — | no | no | quality | duplicate |
| `/reports/center` | page | `/reports/center` | client/src/config/page-registry.ts | @/pages/reports/report-center | yes | no | reports | active |
| `/reports/engineering/monthly` | page | `/reports/engineering/monthly` | client/src/config/page-registry.ts | @/pages/engineering-monthly-report | yes | no | reports | active |
| `/reports/engineering/monthly/:month/project/:projectId` | page | `/reports/engineering/monthly/:month/project/:projectId` | client/src/config/page-registry.ts | @/pages/engineering-monthly-report-project | no | no | reports | active |
| `/reports/engineering/monthly/compare` | page | `/reports/engineering/monthly/compare` | client/src/config/page-registry.ts | @/pages/engineering-monthly-report-compare | no | no | reports | active |
| `/reports/engineering/monthly/history` | page | `/reports/engineering/monthly/history` | client/src/config/page-registry.ts | @/pages/engineering-monthly-report-history | no | no | reports | active |
| `/reports/performance` | page | `/reports/performance` | client/src/config/page-registry.ts | @/pages/reports/performance | yes | no | performance | active |
| `/reports/pm/monthly` | page | `/reports/pm/monthly` | client/src/config/page-registry.ts | @/pages/pm-monthly-report | yes | no | reports | active |
| `/reports/pm/monthly/:month/project/:projectId` | page | `/reports/pm/monthly/:month/project/:projectId` | client/src/config/page-registry.ts | @/pages/pm-monthly-report-project | no | no | reports | active |
| `/reports/pm/monthly/compare` | page | `/reports/pm/monthly/compare` | client/src/config/page-registry.ts | @/pages/pm-monthly-report-compare | no | no | reports | active |
| `/reports/pm/monthly/history` | page | `/reports/pm/monthly/history` | client/src/config/page-registry.ts | @/pages/pm-monthly-report-history | no | no | reports | active |
| `/reports/programme` | page | `/reports/programme` | client/src/config/page-registry.ts | @/pages/programme-reports | yes | no | reports | active |
| `/revenue` | alias | `/revenue-tracker` | client/src/config/page-registry.ts | — | no | no | revenue_tracker | duplicate |
| `/revenue-tracker` | page | `/revenue-tracker` | client/src/config/page-registry.ts | @/pages/revenue-tracker | yes | no | revenue_tracker | active |
| `/sites` | page | `/sites` | client/src/config/page-registry.ts | @/pages/sites | yes | no | projects | active |
| `/sseg` | legacy redirect | `/handover?tab=sseg` | client/src/config/page-registry.ts (LEGACY_REDIRECTS) | — | no | no | — | active |
| `/standups` | alias | `/engineering/standup` | client/src/config/page-registry.ts | — | no | no | standups | duplicate |
| `/subcontractor-dashboard` | page | `/subcontractor-dashboard` | client/src/config/page-registry.ts | @/pages/subcontractor-dashboard | yes | no | subcontractors | active |
| `/teams/chats` | alias | `/my-work/teams` | client/src/config/page-registry.ts | — | no | no | teams_chat | duplicate |
| `/training` | page | `/training` | client/src/config/page-registry.ts | @/pages/training | yes | no | training | active |
| `/weekly-reviews` | page | `/weekly-reviews` | client/src/config/page-registry.ts | @/pages/weekly-reviews | yes | no | weekly_review_wizard | active |

## Phase 0 Truth Sources

| truth domain | current canonical file | conflicts found | proposed canonical owner |
|---|---|---|---|
| routing truth | `client/src/config/page-registry.ts` | `docs/ROUTE-INVENTORY.md` drifted from runtime; `client/src/config/department-nav.ts` referenced `/construction-dashboard` (non-existent) | Frontend platform (`client/src/config/page-registry.ts`) |
| doc truth | `docs/README.md` (created in this cleanup) | root `README.md` pointed to missing docs/README.md | Repo docs owner |
| audit truth | `docs/qa/current-audit-summary.md` (created in this cleanup) | four conflicting audit verdict files claimed mutually incompatible states | QA lead / release manager |
| KPI truth | `shared/config/kpi-registry.ts` + `qa/kpi-frozen-dataset.schema.json` process | no frozen approval dataset file existed; values not pinned | KPI business owner + QA |
| release truth | `docs/qa/release-gate.md` + `qa/release-gate.ts` | gate did not require route parity / redirect checks / KPI dataset validation | Release manager |

## Contradictions Found (A–H mapping)

- **A/C/F**: `client/src/config/department-nav.ts` matched `/construction-dashboard` although no route exists in `PAGE_REGISTRY` or `App.tsx`.
- **B**: `README.md` linked `docs/README.md`, but file was missing.
- **D**: `server/stage-collaboration-routes.ts` claimed deprecated while it is actively registered; `server/collaboration-workflow-routes.ts` claimed canonical/not-registered at the same time.
- **E**: `ADVERSARIAL_AUDIT_REPORT.md`, `qa/QA-CERTIFICATION-AUDIT-REPORT.md`, `qa/CERTIFICATION-AUDIT-2026-04-05.md`, and `qa/ADVERSARIAL-AUDIT-2026-04-05.md` had conflicting certification conclusions.
- **G/H**: no machine-checkable frozen KPI approval dataset contract existed, and release gate lacked explicit route parity + redirect checks as required evidence.

## Delete Candidates Proven

- `server/collaboration-workflow-routes.ts` — unregistered (no imports/calls), superseded by `registerStageCollaborationRoutes`.
- `client/src/pages/admin-approvals.tsx` — no route registration and no imports from runtime router (or any component).
- `PAGE_REGISTRY` alias `pmDeliverables` (`/pm/deliverables`) — duplicate legacy alias to governance approvals with no dedicated component.

## Needs Business Answer

- KPI frozen approval dataset owner and exact pinned KPI values are still required for final release sign-off.
