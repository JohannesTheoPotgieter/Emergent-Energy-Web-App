# Route Smoke Report

Generated: 2026-03-13T18:33:15.902Z

## Coverage Summary
- Routes checked: 13
- Passed: 13
- Warnings: 0
- Failed: 0

## Route Results
| Route | Status | Missing UI markers | Permission-blocked expected | Route-to-API dependencies |
|---|---|---|---|---|
| /dashboard | PASS | - | yes | /api/program-dashboard |
| /projects | PASS | - | yes | /api/export/projects-summary<br>/api/financial-close/files/<br>/api/financial-close/upload<br>/api/pm-assignable-users<br>/api/project-info/<br>/api/project-plan<br>/api/project-plan/<br>/api/project-plan/overrides<br>/api/projects-summary<br>/api/projects-summary/ |
| /project/:projectName | PASS | - | no | /api/cashflow<br>/api/eng/tasks<br>/api/eng/tasks/<br>/api/normalized-cost-lines<br>/api/normalized-plan-tasks<br>/api/normalized-revenue-lines<br>/api/pd-assignable-users<br>/api/pd/tickets<br>/api/planning-tasks/<br>/api/pm-assignable-users<br>/api/program-expenses/<br>/api/program-inflows<br>/api/projects-summary<br>/api/projects/<br>/api/quality/project/<br>/api/roles/<br>/api/users |
| /engineering | PASS | - | yes | /api/eng/dashboard/standup<br>/api/eng/tasks<br>/api/eng/tasks/<br>/api/eng/team-members<br>/api/mytool/company-priorities |
| /engineering/tasks | PASS | - | yes | /api/eng/dashboard/projects<br>/api/eng/deliverables/<br>/api/eng/local-synced-save/config<br>/api/eng/tasks<br>/api/eng/tasks/<br>/api/eng/team-members<br>/api/my-work/all-tasks<br>/api/projects-summary |
| /quality | PASS | - | yes | /api/projects-summary<br>/api/quality/all-items<br>/api/quality/checklists<br>/api/quality/project/<br>/api/quality/warning/<br>/api/quality/warnings |
| /pd | PASS | - | yes | /api/pd/dashboard<br>/api/pd/tickets |
| /collaboration | PASS | - | yes | /api/admin/sp-settings<br>/api/ms-objects/<br>/api/ms-objects/mine<br>/api/ms-sync/trigger<br>/api/ms-teams/chats<br>/api/ms-teams/joined<br>/api/notifications<br>/api/notifications/<br>/api/notifications/mark-all-read<br>/api/notifications/mark-read<br>/api/notifications/unread-count<br>/api/outlook/events<br>/api/outlook/folders<br>/api/outlook/messages<br>/api/outlook/messages/<br>/api/outlook/status<br>/api/projects<br>/api/settings<br>/api/sharepoint/discover-sites<br>/api/sharepoint/site-drives/<br>/api/sp-config<br>/api/sp-project-browse<br>/api/teams/groups |
| /my-work | PASS | - | yes | /api/ms-objects/mine<br>/api/ms-sync/trigger<br>/api/ms-teams/chats<br>/api/my-work/all-tasks<br>/api/mytool/escalated-priorities<br>/api/notifications<br>/api/outlook/events<br>/api/outlook/status |
| /pm-dashboard | PASS | - | yes | /api/pm/calendar-events<br>/api/pm/dashboard<br>/api/pm/priority-items<br>/api/pm/users |
| /subcontractor-dashboard | PASS | - | yes | /api/invoice-patterns<br>/api/procurement-analysis/pattern-stats<br>/api/subcontractor-dashboard/counterparty/<br>/api/subcontractor-dashboard/detail<br>/api/subcontractor-dashboard/detail/<br>/api/subcontractor-dashboard/link-counterparty<br>/api/subcontractor-dashboard/merge<br>/api/subcontractor-dashboard/overdue<br>/api/subcontractor-dashboard/rename<br>/api/subcontractor-dashboard/summary<br>/api/subcontractor-dashboard/supplier-details/ |
| /admin/control-center | PASS | - | yes | /api/admin/control-center/active-sessions<br>/api/admin/control-center/dangerous/clear-audit-log<br>/api/admin/control-center/dangerous/clear-sessions<br>/api/admin/control-center/enums<br>/api/admin/control-center/feature-flags<br>/api/admin/control-center/feature-flags/<br>/api/admin/control-center/health<br>/api/admin/control-center/integration-health<br>/api/admin/control-center/integrations<br>/api/admin/control-center/operational-exceptions<br>/api/admin/control-center/permission-enforcement<br>/api/admin/control-center/recent-import-failures<br>/api/admin/control-center/recent-issues<br>/api/admin/control-center/rollout-foundation<br>/api/admin/control-center/sessions/ |
| /handover-control | PASS | - | yes | /api/pd-pm-handover/control |

## Suspected dead/incomplete views
- None

## TODO: deeper interaction coverage
- [ ] /dashboard (Home / Dashboard): Add workflow assertion for role-aware landing redirects and KPI card drilldowns.
- [ ] /projects (Projects): Add tests for filters, pagination, and project-open interactions.
- [ ] /project/:projectName (Project Detail): Add route-param + tab navigation workflow tests and save flows.
- [ ] /engineering (Engineering): Add tests for engineering triage and status transitions.
- [ ] /engineering/tasks (Engineering Tasks): Add task lifecycle interaction tests for assignment and completion.
- [ ] /quality (Quality): Add quality workflow checks for scorecards and defect drilldown.
- [ ] /pd (PD Dashboard): Add ticket creation and board state workflow coverage.
- [ ] /collaboration (Collaboration): Add provider-specific interaction tests (email/chat compose).
- [ ] /my-work (My Work): Add personal task update and approval action workflow tests.
- [ ] /pm-dashboard (PM Dashboard): Add PM-specific prioritisation and escalation workflow tests.
- [ ] /subcontractor-dashboard (Procurement): Add procurement action tests for PO and supplier operations.
- [ ] /admin/control-center (Admin Control Center): Add admin-only governance action workflow tests.
- [ ] /handover-control (Handover Control): Add end-to-end handover gate progression tests.
