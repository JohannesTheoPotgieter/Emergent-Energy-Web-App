# API Migration Matrix

> Auto-generated from backend route declarations and static usage heuristics. Validate manually before cutover.

| Old endpoint | Purpose | Frontend usage | Tables touched | Replacement endpoint | Keep/Replace/Delete |
|---|---|---|---|---|---|
| DELETE /api/admin/users/:userId | Defined in server/role-management.ts | yes | new-schema-or-unknown | DELETE /api/v2/admin/users/:userId | review |
| DELETE /api/approvals/general/:id | Defined in server/approvals-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/approvals/general/:id | review |
| DELETE /api/budgets/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/budgets/:id | replace |
| DELETE /api/cashflow-2026/available-payment | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/cashflow-2026/available-payment | replace |
| DELETE /api/cashflow-2026/opening-balance | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/cashflow-2026/opening-balance | replace |
| DELETE /api/cashflow-2026/opex-weekly | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/cashflow-2026/opex-weekly | replace |
| DELETE /api/cashflow/planning-overrides/:projectName | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/cashflow/planning-overrides/:projectName | replace |
| DELETE /api/change-requests/:id | Defined in server/change-control-routes.ts | yes | projects | DELETE /api/v2/change-requests/:id | replace |
| DELETE /api/commissioning/:id | Defined in server/commissioning-routes.ts | yes | projects | DELETE /api/v2/commissioning/:id | replace |
| DELETE /api/cos-status-override/:expenseId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/cos-status-override/:expenseId | replace |
| DELETE /api/dependencies/:depId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/dependencies/:depId | replace |
| DELETE /api/dependencies/:id | Defined in server/dependency-routes.ts | yes | projects, tasks | DELETE /api/v2/dependencies/:id | replace |
| DELETE /api/ee-info/nodes/:id | Defined in server/ee-info-routes.ts | yes | projects | DELETE /api/v2/ee-info/nodes/:id | replace |
| DELETE /api/ee-info/nodes/:nodeId/editors/:editorId | Defined in server/ee-info-routes.ts | yes | projects | DELETE /api/v2/ee-info/nodes/:nodeId/editors/:editorId | replace |
| DELETE /api/ee-info/nodes/:nodeId/metrics/:metricId | Defined in server/ee-info-routes.ts | yes | projects | DELETE /api/v2/ee-info/nodes/:nodeId/metrics/:metricId | replace |
| DELETE /api/ee-info/os/nodes/:id | Defined in server/ee-info-routes.ts | yes | projects | DELETE /api/v2/ee-info/os/nodes/:id | replace |
| DELETE /api/eng-stages/deliverables/:id | Defined in server/eng-stage-routes.ts | yes | projects, tasks | DELETE /api/v2/eng-stages/deliverables/:id | replace |
| DELETE /api/eng-stages/template-deliverables/:delId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | DELETE /api/v2/eng-stages/template-deliverables/:delId | replace |
| DELETE /api/eng-stages/template-tasks/:taskId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | DELETE /api/v2/eng-stages/template-tasks/:taskId | replace |
| DELETE /api/eng/file-pointers/:id | Defined in server/engineering-routes.ts | unknown | projects, tasks | DELETE /api/v2/eng/file-pointers/:id | replace |
| DELETE /api/eng/tasks/:id | Defined in server/engineering-routes.ts | yes | projects, tasks | DELETE /api/v2/eng/tasks/:id | replace |
| DELETE /api/eng/tasks/:taskId/watchers/:userId | Defined in server/engineering-routes.ts | yes | projects, tasks | DELETE /api/v2/eng/tasks/:taskId/watchers/:userId | replace |
| DELETE /api/expenditure/overrides/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/expenditure/overrides/:projectName | replace |
| DELETE /api/expense-task-links/:projectName/:expenseId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/expense-task-links/:projectName/:expenseId | replace |
| DELETE /api/feedback/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/feedback/:id | replace |
| DELETE /api/finance/cos/overrides/:projectName | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/finance/cos/overrides/:projectName | replace |
| DELETE /api/finance/revenue/overrides/:projectName | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/finance/revenue/overrides/:projectName | replace |
| DELETE /api/invoice-captures/:id | Defined in server/invoice-capture-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/invoice-captures/:id | review |
| DELETE /api/key-date-mappings/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/key-date-mappings/:id | replace |
| DELETE /api/lifecycle-board/projects/:id | Defined in server/lifecycle-routes.ts | yes | projects, tasks | DELETE /api/v2/lifecycle-board/projects/:id | replace |
| DELETE /api/meetings/:id | Defined in server/meeting-routes.ts | yes | tasks | DELETE /api/v2/meetings/:id | replace |
| DELETE /api/ms-objects/:id/tag-project | Defined in server/ms-sync-routes.ts | yes | tasks | DELETE /api/v2/ms-objects/:id/tag-project | replace |
| DELETE /api/ms-teams/project-chat/:projectId/unlink | Defined in server/ms-sync-routes.ts | yes | tasks | DELETE /api/v2/ms-teams/project-chat/:projectId/unlink | replace |
| DELETE /api/mytool/dod-templates/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/mytool/dod-templates/:id | replace |
| DELETE /api/mytool/email-links/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/mytool/email-links/:id | replace |
| DELETE /api/mytool/tasks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/mytool/tasks/:id | replace |
| DELETE /api/mytool/timeblocks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/mytool/timeblocks/:id | replace |
| DELETE /api/mytool/triage-rules/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/mytool/triage-rules/:id | replace |
| DELETE /api/operational-tasks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/operational-tasks/:id | replace |
| DELETE /api/outlook/events/:eventId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/outlook/events/:eventId | replace |
| DELETE /api/overrides/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/overrides/:id | replace |
| DELETE /api/phase-template-items/:itemId | Defined in server/template-routes.ts | yes | projects, tasks | DELETE /api/v2/phase-template-items/:itemId | replace |
| DELETE /api/planning-tasks/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/planning-tasks/:taskId | replace |
| DELETE /api/po/:poId | Defined in server/po-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/po/:poId | review |
| DELETE /api/portfolios/:id | Defined in server/portfolio-routes.ts | yes | projects, expenses | DELETE /api/v2/portfolios/:id | replace |
| DELETE /api/portfolios/:id/remove-project/:projectId | Defined in server/portfolio-routes.ts | yes | projects, expenses | DELETE /api/v2/portfolios/:id/remove-project/:projectId | replace |
| DELETE /api/portfolios/:portfolioId/rollout-plans/:planId | Defined in server/portfolio-routes.ts | yes | projects, expenses | DELETE /api/v2/portfolios/:portfolioId/rollout-plans/:planId | replace |
| DELETE /api/procurement/:id | Defined in server/procurement-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/procurement/:id | review |
| DELETE /api/project-plan/overrides/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/project-plan/overrides/:projectName | replace |
| DELETE /api/project-team/:id | Defined in server/engineering-routes.ts | unknown | projects, tasks | DELETE /api/v2/project-team/:id | replace |
| DELETE /api/quality/evidence/:evidenceId | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/quality/evidence/:evidenceId | review |
| DELETE /api/quality/holidays/:id | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | DELETE /api/v2/quality/holidays/:id | review |
| DELETE /api/quality/plan-link/:linkId | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/quality/plan-link/:linkId | review |
| DELETE /api/quality/project/:projectName/item/:itemInstanceId | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/quality/project/:projectName/item/:itemInstanceId | review |
| DELETE /api/raid/:id | Defined in server/raid-routes.ts | yes | projects | DELETE /api/v2/raid/:id | replace |
| DELETE /api/revenue-tab/:projectName/link-task/:milestoneRowNumber | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/revenue-tab/:projectName/link-task/:milestoneRowNumber | replace |
| DELETE /api/revenue-tracking/overrides/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/revenue-tracking/overrides/:projectName | replace |
| DELETE /api/roles/:role | Defined in server/role-management.ts | yes | new-schema-or-unknown | DELETE /api/v2/roles/:role | review |
| DELETE /api/scenarios/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/scenarios/:id | replace |
| DELETE /api/task-attachments/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/task-attachments/:id | replace |
| DELETE /api/task-checklist-items/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/task-checklist-items/:id | replace |
| DELETE /api/task-checklists/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/task-checklists/:id | replace |
| DELETE /api/task-comments/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/task-comments/:id | replace |
| DELETE /api/tr-register/:id | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/tr-register/:id | review |
| DELETE /api/tr-register/:id/link/:linkId | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | DELETE /api/v2/tr-register/:id/link/:linkId | review |
| DELETE /api/user-project-folder/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/user-project-folder/:projectName | replace |
| DELETE /api/work-items/:id/viewers/:userId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/work-items/:id/viewers/:userId | replace |
| DELETE /api/working-plan/tasks/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/working-plan/tasks/:taskId | replace |
| DELETE /api/writeback-mappings/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | DELETE /api/v2/writeback-mappings/:id | replace |
| GET /api/admin/folder-config | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/folder-config | replace |
| GET /api/admin/import/runs | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/import/runs | replace |
| GET /api/admin/import/runs/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/import/runs/:id | replace |
| GET /api/admin/kpi-traceability | Defined in server/kpi-traceability-routes.ts | yes | expenses, tasks | GET /api/v2/admin/kpi-traceability | replace |
| GET /api/admin/reconciliation/work-items/engineering | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/admin/reconciliation/work-items/engineering | replace |
| GET /api/admin/reconciliation/work-items/projects | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/admin/reconciliation/work-items/projects | replace |
| GET /api/admin/reconciliation/work-items/summary | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/admin/reconciliation/work-items/summary | replace |
| GET /api/admin/recovery/deleted | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | GET /api/v2/admin/recovery/deleted | replace |
| GET /api/admin/recovery/imports | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | GET /api/v2/admin/recovery/imports | replace |
| GET /api/admin/recovery/tasks | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | GET /api/v2/admin/recovery/tasks | replace |
| GET /api/admin/refresh-history | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/refresh-history | replace |
| GET /api/admin/reports/operational-overview | Defined in server/report-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/admin/reports/operational-overview | review |
| GET /api/admin/reports/operational-overview/pdf | Defined in server/report-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/admin/reports/operational-overview/pdf | review |
| GET /api/admin/smoke-test | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/smoke-test | replace |
| GET /api/admin/sp-browse | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/sp-browse | replace |
| GET /api/admin/sp-settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/sp-settings | replace |
| GET /api/admin/users | Defined in server/role-management.ts | yes | new-schema-or-unknown | GET /api/v2/admin/users | review |
| GET /api/admin/work-item-summary-diagnostics | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/admin/work-item-summary-diagnostics | replace |
| GET /api/approvals/general | Defined in server/approvals-routes.ts | yes | new-schema-or-unknown | GET /api/v2/approvals/general | review |
| GET /api/approvals/pending | Defined in server/approvals-routes.ts | yes | new-schema-or-unknown | GET /api/v2/approvals/pending | review |
| GET /api/audit/activity-log | Defined in server/audit-routes.ts | yes | new-schema-or-unknown | GET /api/v2/audit/activity-log | review |
| GET /api/audit/activity-log/export | Defined in server/audit-routes.ts | yes | new-schema-or-unknown | GET /api/v2/audit/activity-log/export | review |
| GET /api/audit/changeset/:id | Defined in server/audit-routes.ts | yes | new-schema-or-unknown | GET /api/v2/audit/changeset/:id | review |
| GET /api/audit/override-categories | Defined in server/audit-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/audit/override-categories | review |
| GET /api/audit/project-history-by-name/:projectName | Defined in server/audit-routes.ts | yes | new-schema-or-unknown | GET /api/v2/audit/project-history-by-name/:projectName | review |
| GET /api/audit/project-history/:projectId | Defined in server/audit-routes.ts | yes | new-schema-or-unknown | GET /api/v2/audit/project-history/:projectId | review |
| GET /api/auth/dev-login | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/auth/dev-login | review |
| GET /api/auth/me | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/auth/me | review |
| GET /api/auth/microsoft | Defined in server/routes/auth-routes.ts | yes | new-schema-or-unknown | GET /api/v2/auth/microsoft | review |
| GET /api/auth/microsoft/callback | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/auth/microsoft/callback | review |
| GET /api/auth/microsoft/config | Defined in server/routes/auth-routes.ts | yes | new-schema-or-unknown | GET /api/v2/auth/microsoft/config | review |
| GET /api/auth/permissions | Defined in server/role-management.ts | yes | new-schema-or-unknown | GET /api/v2/auth/permissions | review |
| GET /api/auth/status | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/auth/status | review |
| GET /api/budgets | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/budgets | replace |
| GET /api/calendar/my-tasks | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/calendar/my-tasks | replace |
| GET /api/cashflow | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow | replace |
| GET /api/cashflow-2026 | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-2026 | replace |
| GET /api/cashflow-2026/available-payment-history | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-2026/available-payment-history | replace |
| GET /api/cashflow-2026/balance-history | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-2026/balance-history | replace |
| GET /api/cashflow-2026/detail | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-2026/detail | replace |
| GET /api/cashflow-2026/opex-budget | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-2026/opex-budget | replace |
| GET /api/cashflow-forecast/scenario-week-detail | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-forecast/scenario-week-detail | replace |
| GET /api/cashflow-forecast/scenario-weekly | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-forecast/scenario-weekly | replace |
| GET /api/cashflow-forecast/week-detail | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-forecast/week-detail | replace |
| GET /api/cashflow-forecast/weekly | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-forecast/weekly | replace |
| GET /api/cashflow-tracker | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow-tracker | replace |
| GET /api/cashflow/planning-overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cashflow/planning-overrides | replace |
| GET /api/change-requests/:id | Defined in server/change-control-routes.ts | yes | projects | GET /api/v2/change-requests/:id | replace |
| GET /api/change-requests/cross-project/summary | Defined in server/change-control-routes.ts | unknown | projects | GET /api/v2/change-requests/cross-project/summary | replace |
| GET /api/change-requests/project/:projectId | Defined in server/change-control-routes.ts | yes | projects | GET /api/v2/change-requests/project/:projectId | replace |
| GET /api/clients | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/clients | replace |
| GET /api/commissioning/:id | Defined in server/commissioning-routes.ts | yes | projects | GET /api/v2/commissioning/:id | replace |
| GET /api/commissioning/progress/:projectId | Defined in server/commissioning-routes.ts | yes | projects | GET /api/v2/commissioning/progress/:projectId | replace |
| GET /api/commissioning/project/:projectId | Defined in server/commissioning-routes.ts | yes | projects | GET /api/v2/commissioning/project/:projectId | replace |
| GET /api/cos-control/by-project | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/by-project | replace |
| GET /api/cos-control/invoices | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/invoices | replace |
| GET /api/cos-control/lines | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/lines | replace |
| GET /api/cos-control/pos | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/pos | replace |
| GET /api/cos-control/scenario-impact | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/scenario-impact | replace |
| GET /api/cos-control/scenario-invoices | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/scenario-invoices | replace |
| GET /api/cos-control/scenario-lines | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/scenario-lines | replace |
| GET /api/cos-control/scenario-monthly | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/scenario-monthly | replace |
| GET /api/cos-control/summary | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/summary | replace |
| GET /api/cos-control/tracker | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-control/tracker | replace |
| GET /api/cos-tracker | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-tracker | replace |
| GET /api/cos-tracker/month-detail | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/cos-tracker/month-detail | replace |
| GET /api/dashboard | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/dashboard | replace |
| GET /api/dashboard/high-priority | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/dashboard/high-priority | replace |
| GET /api/dashboard/widget-config | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/dashboard/widget-config | replace |
| GET /api/data-quality/scan | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/data-quality/scan | replace |
| GET /api/deliverable-capture/download/:id | Defined in server/deliverable-capture-routes.ts | unknown | projects | GET /api/v2/deliverable-capture/download/:id | replace |
| GET /api/deliverable-capture/linkable-items/:projectId | Defined in server/deliverable-capture-routes.ts | yes | projects | GET /api/v2/deliverable-capture/linkable-items/:projectId | replace |
| GET /api/deliverable-capture/list/:projectId | Defined in server/deliverable-capture-routes.ts | unknown | projects | GET /api/v2/deliverable-capture/list/:projectId | replace |
| GET /api/deliverable-capture/projects | Defined in server/deliverable-capture-routes.ts | yes | projects | GET /api/v2/deliverable-capture/projects | replace |
| GET /api/deliverables | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/deliverables | replace |
| GET /api/deliverables/:id | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/deliverables/:id | replace |
| GET /api/dependencies/project-name/:projectName | Defined in server/dependency-routes.ts | yes | projects, tasks | GET /api/v2/dependencies/project-name/:projectName | replace |
| GET /api/dependencies/project/:projectId | Defined in server/dependency-routes.ts | yes | projects, tasks | GET /api/v2/dependencies/project/:projectId | replace |
| GET /api/ee-info/assets/:filename | Defined in server/ee-info-routes.ts | unknown | projects | GET /api/v2/ee-info/assets/:filename | replace |
| GET /api/ee-info/flow | Defined in server/ee-info-routes.ts | unknown | projects | GET /api/v2/ee-info/flow | replace |
| GET /api/ee-info/graph | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/graph | replace |
| GET /api/ee-info/nodes | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes | replace |
| GET /api/ee-info/nodes/:nodeId/details | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes/:nodeId/details | replace |
| GET /api/ee-info/nodes/:nodeId/editors | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes/:nodeId/editors | replace |
| GET /api/ee-info/nodes/:nodeId/metrics | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes/:nodeId/metrics | replace |
| GET /api/ee-info/nodes/:nodeId/metrics/live | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes/:nodeId/metrics/live | replace |
| GET /api/ee-info/nodes/:slug | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/nodes/:slug | replace |
| GET /api/ee-info/os/departments | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/os/departments | replace |
| GET /api/ee-info/os/departments/:slug | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/os/departments/:slug | replace |
| GET /api/ee-info/os/lifecycle | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/os/lifecycle | replace |
| GET /api/ee-info/os/processes/:slug | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/os/processes/:slug | replace |
| GET /api/ee-info/os/templates | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/os/templates | replace |
| GET /api/ee-info/settings | Defined in server/ee-info-routes.ts | unknown | projects | GET /api/v2/ee-info/settings | replace |
| GET /api/ee-info/story/check-seed | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/story/check-seed | replace |
| GET /api/ee-info/story/children/:parentId | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/story/children/:parentId | replace |
| GET /api/ee-info/story/demo | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/story/demo | replace |
| GET /api/ee-info/story/node/:id | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/story/node/:id | replace |
| GET /api/ee-info/story/stages | Defined in server/ee-info-routes.ts | yes | projects | GET /api/v2/ee-info/story/stages | replace |
| GET /api/eng-stages/deliverables/:id/download | Defined in server/eng-stage-routes.ts | yes | projects, tasks | GET /api/v2/eng-stages/deliverables/:id/download | replace |
| GET /api/eng-stages/templates | Defined in server/eng-stage-routes.ts | yes | projects, tasks | GET /api/v2/eng-stages/templates | replace |
| GET /api/eng-stages/templates/:id | Defined in server/eng-stage-routes.ts | yes | projects, tasks | GET /api/v2/eng-stages/templates/:id | replace |
| GET /api/eng/audit-log | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/audit-log | replace |
| GET /api/eng/audit-log/phase-history | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/audit-log/phase-history | replace |
| GET /api/eng/audit-log/stats | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/audit-log/stats | replace |
| GET /api/eng/constants | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/constants | replace |
| GET /api/eng/dashboard/deliverables-pipeline | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/dashboard/deliverables-pipeline | replace |
| GET /api/eng/dashboard/milestones-at-risk | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/dashboard/milestones-at-risk | replace |
| GET /api/eng/dashboard/orphan-tasks | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/dashboard/orphan-tasks | replace |
| GET /api/eng/dashboard/projects | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/dashboard/projects | replace |
| GET /api/eng/dashboard/standup | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/dashboard/standup | replace |
| GET /api/eng/dashboard/warning-tower | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/dashboard/warning-tower | replace |
| GET /api/eng/dashboard/workload | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/dashboard/workload | replace |
| GET /api/eng/deliverables/:id/download | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/deliverables/:id/download | replace |
| GET /api/eng/file-pointers/:entityType/:entityId | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/file-pointers/:entityType/:entityId | replace |
| GET /api/eng/local-synced-save/config | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/local-synced-save/config | replace |
| GET /api/eng/tasks | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks | replace |
| GET /api/eng/tasks/:id | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id | replace |
| GET /api/eng/tasks/:id/activity | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id/activity | replace |
| GET /api/eng/tasks/:id/comments | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id/comments | replace |
| GET /api/eng/tasks/:id/deliverables | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id/deliverables | replace |
| GET /api/eng/tasks/:id/subtasks | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id/subtasks | replace |
| GET /api/eng/tasks/:id/watchers | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/tasks/:id/watchers | replace |
| GET /api/eng/team-members | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/team-members | replace |
| GET /api/eng/unified-audit | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/unified-audit | replace |
| GET /api/eng/users | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/eng/users | replace |
| GET /api/eng/warnings | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/eng/warnings | replace |
| GET /api/engineering/access/status | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/engineering/access/status | review |
| GET /api/environment/status | Defined in server/index.ts | unknown | new-schema-or-unknown | GET /api/v2/environment/status | review |
| GET /api/excel-updates | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/excel-updates | replace |
| GET /api/exec/portfolio | Defined in server/template-routes.ts | unknown | projects, tasks | GET /api/v2/exec/portfolio | replace |
| GET /api/exec/portfolio/:projectId | Defined in server/template-routes.ts | unknown | projects, tasks | GET /api/v2/exec/portfolio/:projectId | replace |
| GET /api/expenditure-breakdown/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/expenditure-breakdown/:projectName | replace |
| GET /api/expenditure/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/expenditure/overrides | replace |
| GET /api/expense-task-links/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/expense-task-links/:projectName | replace |
| GET /api/expenses | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/expenses | replace |
| GET /api/export/expenses | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/export/expenses | replace |
| GET /api/export/projects | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/export/projects | replace |
| GET /api/export/projects-summary | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/export/projects-summary | replace |
| GET /api/export/revenues | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/export/revenues | replace |
| GET /api/export/tasks | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/export/tasks | replace |
| GET /api/feature-flags/rollout | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/feature-flags/rollout | replace |
| GET /api/feedback | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/feedback | replace |
| GET /api/finance/cos | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/finance/cos | replace |
| GET /api/finance/cos/overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/finance/cos/overrides | replace |
| GET /api/finance/revenue | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/finance/revenue | replace |
| GET /api/finance/revenue/overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/finance/revenue/overrides | replace |
| GET /api/financial-close/files/:filename | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/financial-close/files/:filename | replace |
| GET /api/financial-headline | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/financial-headline | replace |
| GET /api/gamification/leaderboard | Defined in server/gamification-routes.ts | yes | new-schema-or-unknown | GET /api/v2/gamification/leaderboard | review |
| GET /api/gamification/user/:userId | Defined in server/gamification-routes.ts | yes | new-schema-or-unknown | GET /api/v2/gamification/user/:userId | review |
| GET /api/gamification/user/:userId/details | Defined in server/gamification-routes.ts | yes | new-schema-or-unknown | GET /api/v2/gamification/user/:userId/details | review |
| GET /api/health | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/health | replace |
| GET /api/home/action-hub | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/home/action-hub | replace |
| GET /api/home/notes | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/home/notes | replace |
| GET /api/home/summary | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/home/summary | replace |
| GET /api/imports/sync-state | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/imports/sync-state | replace |
| GET /api/invoice-captures/project/:projectId | Defined in server/invoice-capture-routes.ts | yes | new-schema-or-unknown | GET /api/v2/invoice-captures/project/:projectId | review |
| GET /api/key-date-mappings/:projectName | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/key-date-mappings/:projectName | replace |
| GET /api/key-dates/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/key-dates/:projectName | replace |
| GET /api/lifecycle-board/execution-dashboard | Defined in server/lifecycle-routes.ts | yes | projects, tasks | GET /api/v2/lifecycle-board/execution-dashboard | replace |
| GET /api/lifecycle-board/projects | Defined in server/lifecycle-routes.ts | yes | projects, tasks | GET /api/v2/lifecycle-board/projects | replace |
| GET /api/lifecycle-board/projects/:id/execution-gate | Defined in server/lifecycle-routes.ts | yes | projects, tasks | GET /api/v2/lifecycle-board/projects/:id/execution-gate | replace |
| GET /api/lifecycle-board/projects/:id/rag-history | Defined in server/lifecycle-routes.ts | yes | projects, tasks | GET /api/v2/lifecycle-board/projects/:id/rag-history | replace |
| GET /api/lifecycle-board/projects/merge-preview | Defined in server/lifecycle-routes.ts | unknown | projects, tasks | GET /api/v2/lifecycle-board/projects/merge-preview | replace |
| GET /api/meetings | Defined in server/meeting-routes.ts | yes | tasks | GET /api/v2/meetings | replace |
| GET /api/meetings/:id | Defined in server/meeting-routes.ts | yes | tasks | GET /api/v2/meetings/:id | replace |
| GET /api/meetings/webhook-info | Defined in server/meeting-routes.ts | unknown | tasks | GET /api/v2/meetings/webhook-info | replace |
| GET /api/meetings/webhook-status | Defined in server/meeting-routes.ts | yes | tasks | GET /api/v2/meetings/webhook-status | replace |
| GET /api/ms-integration/status | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/ms-integration/status | replace |
| GET /api/ms-objects/mine | Defined in server/ms-sync-routes.ts | yes | tasks | GET /api/v2/ms-objects/mine | replace |
| GET /api/ms-objects/project/:projectId | Defined in server/ms-sync-routes.ts | unknown | tasks | GET /api/v2/ms-objects/project/:projectId | replace |
| GET /api/ms-sync/status | Defined in server/ms-sync-routes.ts | unknown | tasks | GET /api/v2/ms-sync/status | replace |
| GET /api/ms-teams/channels/:teamId/:channelId/messages | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/ms-teams/channels/:teamId/:channelId/messages | replace |
| GET /api/ms-teams/chats | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/ms-teams/chats | replace |
| GET /api/ms-teams/chats/:chatId/messages | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/ms-teams/chats/:chatId/messages | replace |
| GET /api/ms-teams/joined | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/ms-teams/joined | replace |
| GET /api/ms-teams/project-chat/:projectId | Defined in server/ms-sync-routes.ts | yes | tasks | GET /api/v2/ms-teams/project-chat/:projectId | replace |
| GET /api/my-work/all-tasks | Defined in server/ms-sync-routes.ts | yes | tasks | GET /api/v2/my-work/all-tasks | replace |
| GET /api/mytool/daily-review | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/daily-review | replace |
| GET /api/mytool/dod-templates | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/dod-templates | replace |
| GET /api/mytool/email-links | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/email-links | replace |
| GET /api/mytool/escalated-priorities | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/escalated-priorities | replace |
| GET /api/mytool/preferences | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/preferences | replace |
| GET /api/mytool/settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/settings | replace |
| GET /api/mytool/support-tickets | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/support-tickets | replace |
| GET /api/mytool/tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/tasks | replace |
| GET /api/mytool/timeblocks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/timeblocks | replace |
| GET /api/mytool/triage-inbox | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/triage-inbox | replace |
| GET /api/mytool/triage-rules | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/triage-rules | replace |
| GET /api/mytool/unclassified-tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/mytool/unclassified-tasks | replace |
| GET /api/notifications | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/notifications | replace |
| GET /api/notifications/event-types | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/notifications/event-types | replace |
| GET /api/notifications/unread-count | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/notifications/unread-count | replace |
| GET /api/operational-tasks/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/operational-tasks/:projectName | replace |
| GET /api/operational-tasks/task/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/operational-tasks/task/:id | replace |
| GET /api/outlook/events | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/outlook/events | replace |
| GET /api/outlook/folders | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/outlook/folders | replace |
| GET /api/outlook/messages | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/outlook/messages | replace |
| GET /api/outlook/messages/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/outlook/messages/:id | replace |
| GET /api/outlook/status | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/outlook/status | replace |
| GET /api/overview | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/overview | replace |
| GET /api/pd-assignable-users | Defined in server/routes/auth-routes.ts | yes | new-schema-or-unknown | GET /api/v2/pd-assignable-users | review |
| GET /api/pd-pm-handover/:projectId | Defined in server/handover-routes.ts | yes | projects | GET /api/v2/pd-pm-handover/:projectId | replace |
| GET /api/pd-pm-handover/control | Defined in server/handover-routes.ts | yes | projects | GET /api/v2/pd-pm-handover/control | replace |
| GET /api/pd-pm-handover/status-map | Defined in server/handover-routes.ts | unknown | projects | GET /api/v2/pd-pm-handover/status-map | replace |
| GET /api/pd-pm-handover/submitted | Defined in server/handover-routes.ts | yes | projects | GET /api/v2/pd-pm-handover/submitted | replace |
| GET /api/pd/clients | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/clients | replace |
| GET /api/pd/clients/project-counts | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/clients/project-counts | replace |
| GET /api/pd/dashboard | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/dashboard | replace |
| GET /api/pd/projects/search | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/projects/search | replace |
| GET /api/pd/tickets | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/tickets | replace |
| GET /api/pd/tickets/:id | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/tickets/:id | replace |
| GET /api/pd/users | Defined in server/pd-routes.ts | yes | projects, tasks | GET /api/v2/pd/users | replace |
| GET /api/phase-template-items/:itemId/history | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/phase-template-items/:itemId/history | replace |
| GET /api/phase-templates | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/phase-templates | replace |
| GET /api/phase-templates/:id | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/phase-templates/:id | replace |
| GET /api/phase-templates/:id/preview | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/phase-templates/:id/preview | replace |
| GET /api/plan-edit-notifications | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/plan-edit-notifications | replace |
| GET /api/planning-board/pm-capacity | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-board/pm-capacity | replace |
| GET /api/planning-board/projects | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-board/projects | replace |
| GET /api/planning-board/scenario-capacity | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-board/scenario-capacity | replace |
| GET /api/planning-board/scenario-projects | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-board/scenario-projects | replace |
| GET /api/planning-tasks/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-tasks/:projectName | replace |
| GET /api/planning-tasks/:projectName/summary-rollup | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/planning-tasks/:projectName/summary-rollup | replace |
| GET /api/pm-assignable-users | Defined in server/routes/auth-routes.ts | yes | new-schema-or-unknown | GET /api/v2/pm-assignable-users | review |
| GET /api/pm-otg/mode | Defined in server/pm-on-the-go-routes.ts | yes | projects | GET /api/v2/pm-otg/mode | replace |
| GET /api/pm-otg/projects | Defined in server/pm-on-the-go-routes.ts | yes | projects | GET /api/v2/pm-otg/projects | replace |
| GET /api/pm-otg/projects/:projectId/compliance | Defined in server/pm-on-the-go-routes.ts | yes | projects | GET /api/v2/pm-otg/projects/:projectId/compliance | replace |
| GET /api/pm-otg/projects/:projectId/snapshot | Defined in server/pm-on-the-go-routes.ts | yes | projects | GET /api/v2/pm-otg/projects/:projectId/snapshot | replace |
| GET /api/pm/calendar-events | Defined in server/pm-routes.ts | yes | projects, tasks | GET /api/v2/pm/calendar-events | replace |
| GET /api/pm/dashboard | Defined in server/pm-routes.ts | yes | projects, tasks | GET /api/v2/pm/dashboard | replace |
| GET /api/pm/priority-items | Defined in server/pm-routes.ts | yes | projects, tasks | GET /api/v2/pm/priority-items | replace |
| GET /api/pm/users | Defined in server/pm-routes.ts | yes | projects, tasks | GET /api/v2/pm/users | replace |
| GET /api/po/:projectName | Defined in server/po-routes.ts | yes | new-schema-or-unknown | GET /api/v2/po/:projectName | review |
| GET /api/po/:projectName/:poId/pdf | Defined in server/po-routes.ts | yes | new-schema-or-unknown | GET /api/v2/po/:projectName/:poId/pdf | review |
| GET /api/portfolio-dashboard | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolio-dashboard | replace |
| GET /api/portfolios | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios | replace |
| GET /api/portfolios/:id | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios/:id | replace |
| GET /api/portfolios/:id/available-projects | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios/:id/available-projects | replace |
| GET /api/portfolios/:id/key-dates | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios/:id/key-dates | replace |
| GET /api/portfolios/:id/rollups | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios/:id/rollups | replace |
| GET /api/portfolios/:id/timeline | Defined in server/portfolio-routes.ts | yes | projects, expenses | GET /api/v2/portfolios/:id/timeline | replace |
| GET /api/procurement/:id | Defined in server/procurement-routes.ts | yes | new-schema-or-unknown | GET /api/v2/procurement/:id | review |
| GET /api/procurement/pipeline/summary | Defined in server/procurement-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/procurement/pipeline/summary | review |
| GET /api/procurement/project/:projectId | Defined in server/procurement-routes.ts | yes | new-schema-or-unknown | GET /api/v2/procurement/project/:projectId | review |
| GET /api/program-dashboard | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/program-dashboard | replace |
| GET /api/program-expenses | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/program-expenses | replace |
| GET /api/program-expenses/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/program-expenses/:projectName | replace |
| GET /api/program-inflows | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/program-inflows | replace |
| GET /api/program/cos | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/program/cos | replace |
| GET /api/project-detail-master | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/project-detail-master | replace |
| GET /api/project-info | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/project-info | replace |
| GET /api/project-plan/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/project-plan/:projectName | replace |
| GET /api/project-plan/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/project-plan/overrides | replace |
| GET /api/project-plans | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/project-plans | replace |
| GET /api/project-team/:projectName | Defined in server/engineering-routes.ts | unknown | projects, tasks | GET /api/v2/project-team/:projectName | replace |
| GET /api/projects | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/projects | replace |
| GET /api/projects-summary | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/projects-summary | replace |
| GET /api/projects/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/projects/:id | replace |
| GET /api/projects/:id/handover-gates | Defined in server/handover-routes.ts | yes | projects | GET /api/v2/projects/:id/handover-gates | replace |
| GET /api/projects/:id/handover-history | Defined in server/handover-routes.ts | yes | projects | GET /api/v2/projects/:id/handover-history | replace |
| GET /api/projects/:projectId/eng-stages | Defined in server/eng-stage-routes.ts | yes | projects, tasks | GET /api/v2/projects/:projectId/eng-stages | replace |
| GET /api/projects/:projectId/eng-stages/:stageId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | GET /api/v2/projects/:projectId/eng-stages/:stageId | replace |
| GET /api/projects/:projectId/eng-tasks | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/projects/:projectId/eng-tasks | replace |
| GET /api/projects/:projectId/phase-history | Defined in server/engineering-routes.ts | yes | projects, tasks | GET /api/v2/projects/:projectId/phase-history | replace |
| GET /api/projects/:projectId/template-applications | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/projects/:projectId/template-applications | replace |
| GET /api/projects/:projectName/change-notices | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/projects/:projectName/change-notices | replace |
| GET /api/projects/:projectName/working-plan | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/projects/:projectName/working-plan | replace |
| GET /api/quality/access/status | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/access/status | review |
| GET /api/quality/all-items | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/all-items | review |
| GET /api/quality/checklists | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/checklists | review |
| GET /api/quality/dashboard | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/dashboard | review |
| GET /api/quality/holidays | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/holidays | review |
| GET /api/quality/plan-warnings/:projectName | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/plan-warnings/:projectName | review |
| GET /api/quality/postmortem/:projectName | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/postmortem/:projectName | review |
| GET /api/quality/project/:projectName/checklist | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/project/:projectName/checklist | review |
| GET /api/quality/project/:projectName/plan-links | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/project/:projectName/plan-links | review |
| GET /api/quality/project/:projectName/summary | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/project/:projectName/summary | review |
| GET /api/quality/project/:projectName/warnings | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/project/:projectName/warnings | review |
| GET /api/quality/sp-browse | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/sp-browse | review |
| GET /api/quality/sp-file-link | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/sp-file-link | review |
| GET /api/quality/templates | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/templates | review |
| GET /api/quality/templates/:templateId | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/templates/:templateId | review |
| GET /api/quality/users | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/quality/users | review |
| GET /api/quality/warnings | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | GET /api/v2/quality/warnings | review |
| GET /api/raid/:id | Defined in server/raid-routes.ts | yes | projects | GET /api/v2/raid/:id | replace |
| GET /api/raid/cross-project | Defined in server/raid-routes.ts | unknown | projects | GET /api/v2/raid/cross-project | replace |
| GET /api/raid/project/:projectId | Defined in server/raid-routes.ts | yes | projects | GET /api/v2/raid/project/:projectId | replace |
| GET /api/readiness/core-master-data | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/readiness/core-master-data | replace |
| GET /api/readiness/cutover-post-validation | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/readiness/cutover-post-validation | replace |
| GET /api/refresh/latest | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/refresh/latest | replace |
| GET /api/rev-tracker | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/rev-tracker | replace |
| GET /api/revenue-tab/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/revenue-tab/:projectName | replace |
| GET /api/revenue-tab/:projectName/task-alerts | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/revenue-tab/:projectName/task-alerts | replace |
| GET /api/revenue-tracking/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/revenue-tracking/overrides | replace |
| GET /api/revenues | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/revenues | replace |
| GET /api/role-auth/me | Defined in server/role-auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/role-auth/me | review |
| GET /api/role-auth/passwords | Defined in server/role-auth-routes.ts | yes | new-schema-or-unknown | GET /api/v2/role-auth/passwords | review |
| GET /api/role-auth/roles | Defined in server/role-auth-routes.ts | unknown | new-schema-or-unknown | GET /api/v2/role-auth/roles | review |
| GET /api/roles | Defined in server/role-management.ts | yes | new-schema-or-unknown | GET /api/v2/roles | review |
| GET /api/roles/:role | Defined in server/role-management.ts | yes | new-schema-or-unknown | GET /api/v2/roles/:role | review |
| GET /api/scenarios | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/scenarios | replace |
| GET /api/scenarios/:id/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/scenarios/:id/overrides | replace |
| GET /api/search | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/search | replace |
| GET /api/settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/settings | replace |
| GET /api/sharepoint/discover-sites | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/sharepoint/discover-sites | replace |
| GET /api/sharepoint/site-drives/:siteId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/sharepoint/site-drives/:siteId | replace |
| GET /api/sp-sync/audit-log | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/audit-log | replace |
| GET /api/sp-sync/config | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/config | replace |
| GET /api/sp-sync/discover/columns/:siteId/:listId | Defined in server/sync-routes.ts | unknown | projects, tasks | GET /api/v2/sp-sync/discover/columns/:siteId/:listId | replace |
| GET /api/sp-sync/discover/list-by-name/:siteId/:listName | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/discover/list-by-name/:siteId/:listName | replace |
| GET /api/sp-sync/discover/lists/:siteId | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/discover/lists/:siteId | replace |
| GET /api/sp-sync/discover/site-by-url | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/discover/site-by-url | replace |
| GET /api/sp-sync/discover/sites | Defined in server/sync-routes.ts | unknown | projects, tasks | GET /api/v2/sp-sync/discover/sites | replace |
| GET /api/sp-sync/intake-requests | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/intake-requests | replace |
| GET /api/sp-sync/intake-requests/:id | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/intake-requests/:id | replace |
| GET /api/sp-sync/intake-requests/by-project/:projectId | Defined in server/sync-routes.ts | unknown | projects, tasks | GET /api/v2/sp-sync/intake-requests/by-project/:projectId | replace |
| GET /api/sp-sync/intake-tasks/:requestId | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/intake-tasks/:requestId | replace |
| GET /api/sp-sync/status | Defined in server/sync-routes.ts | yes | projects, tasks | GET /api/v2/sp-sync/status | replace |
| GET /api/sp-sync/task-templates | Defined in server/sync-routes.ts | unknown | projects, tasks | GET /api/v2/sp-sync/task-templates | replace |
| GET /api/task-activity/:taskId | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/task-activity/:taskId | replace |
| GET /api/task-attachments/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/task-attachments/:taskId | replace |
| GET /api/task-checklists/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/task-checklists/:taskId | replace |
| GET /api/task-comments/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/task-comments/:taskId | replace |
| GET /api/tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/tasks | replace |
| GET /api/template-constants | Defined in server/template-routes.ts | yes | projects, tasks | GET /api/v2/template-constants | replace |
| GET /api/tr-register | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | GET /api/v2/tr-register | review |
| GET /api/tr-register/:id | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | GET /api/v2/tr-register/:id | review |
| GET /api/tracker-monthly/:type | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/tracker-monthly/:type | replace |
| GET /api/uploads | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/uploads | replace |
| GET /api/user-project-folder/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/user-project-folder/:projectName | replace |
| GET /api/users/assignable | Defined in server/ms-sync-routes.ts | yes | tasks | GET /api/v2/users/assignable | replace |
| GET /api/v2/audit/activity | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/audit/activity | keep |
| GET /api/v2/dashboard/:role | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/dashboard/:role | keep |
| GET /api/v2/lookups/:type | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/lookups/:type | keep |
| GET /api/v2/me | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/me | keep |
| GET /api/v2/me/permissions | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/me/permissions | keep |
| GET /api/v2/projects | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects | keep |
| GET /api/v2/projects/:projectId | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId | keep |
| GET /api/v2/projects/:projectId/development | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/development | keep |
| GET /api/v2/projects/:projectId/engineering | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/engineering | keep |
| GET /api/v2/projects/:projectId/engineering/designs | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/engineering/designs | keep |
| GET /api/v2/projects/:projectId/finance | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance | keep |
| GET /api/v2/projects/:projectId/finance/cashflow | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance/cashflow | keep |
| GET /api/v2/projects/:projectId/finance/cos | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance/cos | keep |
| GET /api/v2/projects/:projectId/finance/expenditure | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance/expenditure | keep |
| GET /api/v2/projects/:projectId/finance/revenue | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance/revenue | keep |
| GET /api/v2/projects/:projectId/finance/summary | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/finance/summary | keep |
| GET /api/v2/projects/:projectId/health | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/health | keep |
| GET /api/v2/projects/:projectId/lifecycle | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/lifecycle | keep |
| GET /api/v2/projects/:projectId/milestones | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/milestones | keep |
| GET /api/v2/projects/:projectId/overview | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/overview | keep |
| GET /api/v2/projects/:projectId/procurement | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/procurement | keep |
| GET /api/v2/projects/:projectId/procurement/invoices | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/procurement/invoices | keep |
| GET /api/v2/projects/:projectId/procurement/items | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/procurement/items | keep |
| GET /api/v2/projects/:projectId/procurement/pos | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/procurement/pos | keep |
| GET /api/v2/projects/:projectId/quality | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/quality | keep |
| GET /api/v2/projects/:projectId/quality/checks | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/quality/checks | keep |
| GET /api/v2/projects/:projectId/work-items | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | GET /api/v2/projects/:projectId/work-items | keep |
| GET /api/version | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/version | replace |
| GET /api/weekly-reviews-all | Defined in server/weekly-review-routes.ts | yes | projects | GET /api/v2/weekly-reviews-all | replace |
| GET /api/weekly-reviews/:projectName | Defined in server/weekly-review-routes.ts | yes | projects | GET /api/v2/weekly-reviews/:projectName | replace |
| GET /api/weekly-reviews/:projectName/:id | Defined in server/weekly-review-routes.ts | yes | projects | GET /api/v2/weekly-reviews/:projectName/:id | replace |
| GET /api/work-items | Defined in server/dependency-routes.ts | yes | projects, tasks | GET /api/v2/work-items | replace |
| GET /api/work-items/:id/viewers | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | GET /api/v2/work-items/:id/viewers | replace |
| GET /api/work-items/deleted | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/work-items/deleted | replace |
| GET /api/writeback-audit | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/writeback-audit | replace |
| GET /api/writeback-mappings | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/writeback-mappings | replace |
| GET /api/writeback/workbook-sheets | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | GET /api/v2/writeback/workbook-sheets | replace |
| PATCH /api/admin/recovery/project/:id | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | PATCH /api/v2/admin/recovery/project/:id | replace |
| PATCH /api/admin/recovery/tasks/:id | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | PATCH /api/v2/admin/recovery/tasks/:id | replace |
| PATCH /api/admin/users/:userId/password | Defined in server/role-management.ts | yes | new-schema-or-unknown | PATCH /api/v2/admin/users/:userId/password | review |
| PATCH /api/admin/users/:userId/role | Defined in server/role-management.ts | yes | new-schema-or-unknown | PATCH /api/v2/admin/users/:userId/role | review |
| PATCH /api/approvals/general/:id | Defined in server/approvals-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/approvals/general/:id | review |
| PATCH /api/calendar/schedule-task | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/calendar/schedule-task | replace |
| PATCH /api/change-notices/:noticeId | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/change-notices/:noticeId | replace |
| PATCH /api/change-requests/:id | Defined in server/change-control-routes.ts | yes | projects | PATCH /api/v2/change-requests/:id | replace |
| PATCH /api/commissioning/:id | Defined in server/commissioning-routes.ts | yes | projects | PATCH /api/v2/commissioning/:id | replace |
| PATCH /api/cos-tracker/toggle-realised/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/cos-tracker/toggle-realised/:id | replace |
| PATCH /api/deliverables/:id | Defined in server/engineering-routes.ts | yes | projects, tasks | PATCH /api/v2/deliverables/:id | replace |
| PATCH /api/deliverables/files/:fileId/approve | Defined in server/engineering-routes.ts | unknown | projects, tasks | PATCH /api/v2/deliverables/files/:fileId/approve | replace |
| PATCH /api/dependencies/:id | Defined in server/dependency-routes.ts | yes | projects, tasks | PATCH /api/v2/dependencies/:id | replace |
| PATCH /api/ee-info/story/node/:id | Defined in server/ee-info-routes.ts | yes | projects | PATCH /api/v2/ee-info/story/node/:id | replace |
| PATCH /api/eng-stages/approvals/:id | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/approvals/:id | replace |
| PATCH /api/eng-stages/deliverables/:id/approve | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/deliverables/:id/approve | replace |
| PATCH /api/eng-stages/stages/:stageId/status | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/stages/:stageId/status | replace |
| PATCH /api/eng-stages/tasks/:taskId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/tasks/:taskId | replace |
| PATCH /api/eng-stages/template-deliverables/:delId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/template-deliverables/:delId | replace |
| PATCH /api/eng-stages/template-tasks/:taskId | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/template-tasks/:taskId | replace |
| PATCH /api/eng-stages/templates/:id | Defined in server/eng-stage-routes.ts | yes | projects, tasks | PATCH /api/v2/eng-stages/templates/:id | replace |
| PATCH /api/eng/deliverables/:id/acknowledge | Defined in server/engineering-routes.ts | yes | projects, tasks | PATCH /api/v2/eng/deliverables/:id/acknowledge | replace |
| PATCH /api/eng/tasks/:id | Defined in server/engineering-routes.ts | yes | projects, tasks | PATCH /api/v2/eng/tasks/:id | replace |
| PATCH /api/eng/warnings/:id | Defined in server/engineering-routes.ts | unknown | projects, tasks | PATCH /api/v2/eng/warnings/:id | replace |
| PATCH /api/expenditure/font-color-toggle | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/expenditure/font-color-toggle | replace |
| PATCH /api/feedback/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/feedback/:id | replace |
| PATCH /api/invoice-captures/:id | Defined in server/invoice-capture-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/invoice-captures/:id | review |
| PATCH /api/key-date-mappings/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/key-date-mappings/:id | replace |
| PATCH /api/lifecycle-board/projects/:id | Defined in server/lifecycle-routes.ts | yes | projects, tasks | PATCH /api/v2/lifecycle-board/projects/:id | replace |
| PATCH /api/lifecycle-board/projects/:id/execution-gate | Defined in server/lifecycle-routes.ts | yes | projects, tasks | PATCH /api/v2/lifecycle-board/projects/:id/execution-gate | replace |
| PATCH /api/lifecycle-board/projects/:id/phase | Defined in server/lifecycle-routes.ts | yes | projects, tasks | PATCH /api/v2/lifecycle-board/projects/:id/phase | replace |
| PATCH /api/lifecycle-board/projects/:id/restore | Defined in server/lifecycle-routes.ts | yes | projects, tasks | PATCH /api/v2/lifecycle-board/projects/:id/restore | replace |
| PATCH /api/meetings/action-items/:id/dismiss | Defined in server/meeting-routes.ts | yes | tasks | PATCH /api/v2/meetings/action-items/:id/dismiss | replace |
| PATCH /api/ms-objects/:id/dismiss | Defined in server/ms-sync-routes.ts | yes | tasks | PATCH /api/v2/ms-objects/:id/dismiss | replace |
| PATCH /api/mytool/tasks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/mytool/tasks/:id | replace |
| PATCH /api/mytool/timeblocks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/mytool/timeblocks/:id | replace |
| PATCH /api/mytool/triage-rules/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/mytool/triage-rules/:id | replace |
| PATCH /api/operational-tasks/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/operational-tasks/:id | replace |
| PATCH /api/outlook/events/:eventId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/outlook/events/:eventId | replace |
| PATCH /api/pd/clients/:id | Defined in server/pd-routes.ts | yes | projects, tasks | PATCH /api/v2/pd/clients/:id | replace |
| PATCH /api/pd/tickets/:id | Defined in server/pd-routes.ts | yes | projects, tasks | PATCH /api/v2/pd/tickets/:id | replace |
| PATCH /api/phase-template-items/:itemId | Defined in server/template-routes.ts | yes | projects, tasks | PATCH /api/v2/phase-template-items/:itemId | replace |
| PATCH /api/phase-templates/:id/activate | Defined in server/template-routes.ts | yes | projects, tasks | PATCH /api/v2/phase-templates/:id/activate | replace |
| PATCH /api/plan-edit-notifications/:id/resolve | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/plan-edit-notifications/:id/resolve | replace |
| PATCH /api/planning-tasks/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/planning-tasks/:taskId | replace |
| PATCH /api/po/:poId/status | Defined in server/po-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/po/:poId/status | review |
| PATCH /api/procurement/:id | Defined in server/procurement-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/procurement/:id | review |
| PATCH /api/project-info/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/project-info/:id | replace |
| PATCH /api/projects-summary/:projectInfoId/escalation | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/projects-summary/:projectInfoId/escalation | replace |
| PATCH /api/projects-summary/:projectName/latest-update | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/projects-summary/:projectName/latest-update | replace |
| PATCH /api/projects/:projectId/phase | Defined in server/engineering-routes.ts | yes | projects, tasks | PATCH /api/v2/projects/:projectId/phase | replace |
| PATCH /api/quality/users/:userId/role | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | PATCH /api/v2/quality/users/:userId/role | review |
| PATCH /api/raid/:id | Defined in server/raid-routes.ts | yes | projects | PATCH /api/v2/raid/:id | replace |
| PATCH /api/role-auth/password | Defined in server/role-auth-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/role-auth/password | review |
| PATCH /api/sp-sync/config/mapping | Defined in server/sync-routes.ts | unknown | projects, tasks | PATCH /api/v2/sp-sync/config/mapping | replace |
| PATCH /api/sp-sync/intake-requests/:id | Defined in server/sync-routes.ts | yes | projects, tasks | PATCH /api/v2/sp-sync/intake-requests/:id | replace |
| PATCH /api/sp-sync/intake-tasks/:taskId | Defined in server/sync-routes.ts | yes | projects, tasks | PATCH /api/v2/sp-sync/intake-tasks/:taskId | replace |
| PATCH /api/task-checklist-items/:id | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/task-checklist-items/:id | replace |
| PATCH /api/tasks/reassign | Defined in server/ms-sync-routes.ts | yes | tasks | PATCH /api/v2/tasks/reassign | replace |
| PATCH /api/tr-register/:id | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/tr-register/:id | review |
| PATCH /api/tr-register/:id/complete | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | PATCH /api/v2/tr-register/:id/complete | review |
| PATCH /api/v2/projects/:projectId/engineering/designs | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/engineering/designs | keep |
| PATCH /api/v2/projects/:projectId/finance/variations | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/finance/variations | keep |
| PATCH /api/v2/projects/:projectId/milestones/:id | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/milestones/:id | keep |
| PATCH /api/v2/projects/:projectId/procurement/items/:id | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/procurement/items/:id | keep |
| PATCH /api/v2/projects/:projectId/quality/checks | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/quality/checks | keep |
| PATCH /api/v2/projects/:projectId/work-items/:id | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | PATCH /api/v2/projects/:projectId/work-items/:id | keep |
| PATCH /api/weekly-reviews/:projectName/:id | Defined in server/weekly-review-routes.ts | yes | projects | PATCH /api/v2/weekly-reviews/:projectName/:id | replace |
| PATCH /api/working-plan/tasks/:taskId | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/working-plan/tasks/:taskId | replace |
| PATCH /api/writeback-mappings/:id | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | PATCH /api/v2/writeback-mappings/:id | replace |
| POST /api/admin/backfill | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/backfill | replace |
| POST /api/admin/backfill-invoice-confirmed | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/backfill-invoice-confirmed | replace |
| POST /api/admin/clear-all-data | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/clear-all-data | replace |
| POST /api/admin/folder-config | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/folder-config | replace |
| POST /api/admin/import/retry-failed | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/import/retry-failed | replace |
| POST /api/admin/import/run | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/import/run | replace |
| POST /api/admin/import/single | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/import/single | replace |
| POST /api/admin/mark-active | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/mark-active | replace |
| POST /api/admin/recovery/restore | Defined in server/admin-recovery-routes.ts | yes | projects, tasks | POST /api/v2/admin/recovery/restore | replace |
| POST /api/admin/refresh-data | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/refresh-data | replace |
| POST /api/admin/scan-folder | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/scan-folder | replace |
| POST /api/admin/sp-settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/sp-settings | replace |
| POST /api/admin/sp-settings/test | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/admin/sp-settings/test | replace |
| POST /api/admin/users | Defined in server/role-management.ts | yes | new-schema-or-unknown | POST /api/v2/admin/users | review |
| POST /api/approvals/general | Defined in server/approvals-routes.ts | yes | new-schema-or-unknown | POST /api/v2/approvals/general | review |
| POST /api/auth/login | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/auth/login | review |
| POST /api/auth/logout | Defined in server/routes/auth-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/auth/logout | review |
| POST /api/budgets | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/budgets | replace |
| POST /api/cashflow-2026/available-payment | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/cashflow-2026/available-payment | replace |
| POST /api/cashflow-2026/opening-balance | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/cashflow-2026/opening-balance | replace |
| POST /api/cashflow-2026/opex-budget | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/cashflow-2026/opex-budget | replace |
| POST /api/cashflow-2026/opex-weekly | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/cashflow-2026/opex-weekly | replace |
| POST /api/cashflow/planning-overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/cashflow/planning-overrides | replace |
| POST /api/change-requests | Defined in server/change-control-routes.ts | yes | projects | POST /api/v2/change-requests | replace |
| POST /api/clients | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/clients | replace |
| POST /api/commissioning | Defined in server/commissioning-routes.ts | yes | projects | POST /api/v2/commissioning | replace |
| POST /api/cos-status-override | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/cos-status-override | replace |
| POST /api/deliverable-capture/upload | Defined in server/deliverable-capture-routes.ts | yes | projects | POST /api/v2/deliverable-capture/upload | replace |
| POST /api/deliverables | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/deliverables | replace |
| POST /api/deliverables/:id/feedback | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/deliverables/:id/feedback | replace |
| POST /api/deliverables/:id/files | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/deliverables/:id/files | replace |
| POST /api/deliverables/:id/revise | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/deliverables/:id/revise | replace |
| POST /api/dependencies | Defined in server/dependency-routes.ts | yes | projects, tasks | POST /api/v2/dependencies | replace |
| POST /api/ee-info/import/obsidian-zip | Defined in server/ee-info-routes.ts | unknown | projects | POST /api/v2/ee-info/import/obsidian-zip | replace |
| POST /api/ee-info/nodes | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/nodes | replace |
| POST /api/ee-info/nodes/:id/assets | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/nodes/:id/assets | replace |
| POST /api/ee-info/nodes/:nodeId/editors | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/nodes/:nodeId/editors | replace |
| POST /api/ee-info/nodes/:nodeId/metrics | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/nodes/:nodeId/metrics | replace |
| POST /api/ee-info/os/processes | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/os/processes | replace |
| POST /api/ee-info/os/processes/:processId/steps | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/os/processes/:processId/steps | replace |
| POST /api/ee-info/os/processes/:slug/sop | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/os/processes/:slug/sop | replace |
| POST /api/ee-info/os/seed | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/os/seed | replace |
| POST /api/ee-info/post-seed-align | Defined in server/ee-info-routes.ts | unknown | projects | POST /api/v2/ee-info/post-seed-align | replace |
| POST /api/ee-info/story/auto-seed | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/story/auto-seed | replace |
| POST /api/ee-info/story/seed-demo | Defined in server/ee-info-routes.ts | yes | projects | POST /api/v2/ee-info/story/seed-demo | replace |
| POST /api/eng-stages/stages/:stageId/complete | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/stages/:stageId/complete | replace |
| POST /api/eng-stages/stages/:stageId/deliverables | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/stages/:stageId/deliverables | replace |
| POST /api/eng-stages/stages/:stageId/override-complete | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/stages/:stageId/override-complete | replace |
| POST /api/eng-stages/tasks/:taskId/deliverables | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/tasks/:taskId/deliverables | replace |
| POST /api/eng-stages/templates/:id/deliverables | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/templates/:id/deliverables | replace |
| POST /api/eng-stages/templates/:id/tasks | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/eng-stages/templates/:id/tasks | replace |
| POST /api/eng/backfill-assignees | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/eng/backfill-assignees | replace |
| POST /api/eng/file-pointers | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/eng/file-pointers | replace |
| POST /api/eng/tasks | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks | replace |
| POST /api/eng/tasks/:id/comments | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/comments | replace |
| POST /api/eng/tasks/:id/link | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/link | replace |
| POST /api/eng/tasks/:id/send-deliverable | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/send-deliverable | replace |
| POST /api/eng/tasks/:id/send-for-approval | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/send-for-approval | replace |
| POST /api/eng/tasks/:id/subtasks | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/subtasks | replace |
| POST /api/eng/tasks/:id/watchers | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/eng/tasks/:id/watchers | replace |
| POST /api/eng/tasks/bulk-update | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/eng/tasks/bulk-update | replace |
| POST /api/eng/warnings/:id/acknowledge | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/eng/warnings/:id/acknowledge | replace |
| POST /api/eng/warnings/scan | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/eng/warnings/scan | replace |
| POST /api/engineering/access/verify | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/engineering/access/verify | review |
| POST /api/error-log | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/error-log | replace |
| POST /api/excel-updates/bulk-confirm | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/excel-updates/bulk-confirm | replace |
| POST /api/expenditure/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expenditure/overrides | replace |
| POST /api/expense-task-links/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expense-task-links/:projectName | replace |
| POST /api/expense-task-links/:projectName/:expenseId/date-override | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expense-task-links/:projectName/:expenseId/date-override | replace |
| POST /api/expenses/add-category | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expenses/add-category | replace |
| POST /api/expenses/add-line | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expenses/add-line | replace |
| POST /api/expenses/insert-task-as-line | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/expenses/insert-task-as-line | replace |
| POST /api/feedback | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/feedback | replace |
| POST /api/finance/cos/overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/finance/cos/overrides | replace |
| POST /api/finance/revenue/overrides | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/finance/revenue/overrides | replace |
| POST /api/financial-close/upload | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/financial-close/upload | replace |
| POST /api/home/notes | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/home/notes | replace |
| POST /api/invoice-captures | Defined in server/invoice-capture-routes.ts | yes | new-schema-or-unknown | POST /api/v2/invoice-captures | review |
| POST /api/key-date-mappings | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/key-date-mappings | replace |
| POST /api/lifecycle-board/projects/:id/rag | Defined in server/lifecycle-routes.ts | yes | projects, tasks | POST /api/v2/lifecycle-board/projects/:id/rag | replace |
| POST /api/lifecycle-board/projects/link-engineering | Defined in server/lifecycle-routes.ts | yes | projects, tasks | POST /api/v2/lifecycle-board/projects/link-engineering | replace |
| POST /api/lifecycle-board/projects/merge | Defined in server/lifecycle-routes.ts | yes | projects, tasks | POST /api/v2/lifecycle-board/projects/merge | replace |
| POST /api/lifecycle-board/projects/promote-engineering | Defined in server/lifecycle-routes.ts | yes | projects, tasks | POST /api/v2/lifecycle-board/projects/promote-engineering | replace |
| POST /api/meetings/action-items/:id/convert-to-priority | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/meetings/action-items/:id/convert-to-priority | replace |
| POST /api/meetings/action-items/:id/convert-to-project | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/meetings/action-items/:id/convert-to-project | replace |
| POST /api/meetings/action-items/:id/convert-to-task | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/meetings/action-items/:id/convert-to-task | replace |
| POST /api/meetings/manual | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/meetings/manual | replace |
| POST /api/meetings/test-webhook | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/meetings/test-webhook | replace |
| POST /api/ms-objects/:id/convert-to-task | Defined in server/ms-sync-routes.ts | yes | tasks | POST /api/v2/ms-objects/:id/convert-to-task | replace |
| POST /api/ms-objects/:id/tag-project | Defined in server/ms-sync-routes.ts | yes | tasks | POST /api/v2/ms-objects/:id/tag-project | replace |
| POST /api/ms-sync/trigger | Defined in server/ms-sync-routes.ts | yes | tasks | POST /api/v2/ms-sync/trigger | replace |
| POST /api/ms-teams/channels/:teamId/:channelId/messages | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/ms-teams/channels/:teamId/:channelId/messages | replace |
| POST /api/ms-teams/chats/:chatId/messages | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/ms-teams/chats/:chatId/messages | replace |
| POST /api/mytool/dod-templates | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/dod-templates | replace |
| POST /api/mytool/email-links | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/email-links | replace |
| POST /api/mytool/support-ticket | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/support-ticket | replace |
| POST /api/mytool/tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/tasks | replace |
| POST /api/mytool/timeblocks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/timeblocks | replace |
| POST /api/mytool/triage-rules | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/mytool/triage-rules | replace |
| POST /api/notifications/:id/confirm | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/notifications/:id/confirm | replace |
| POST /api/notifications/mark-all-read | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/notifications/mark-all-read | replace |
| POST /api/notifications/mark-read | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/notifications/mark-read | replace |
| POST /api/operational-tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/operational-tasks | replace |
| POST /api/operational-tasks/bulk-update | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/operational-tasks/bulk-update | replace |
| POST /api/outlook/email-to-task | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/email-to-task | replace |
| POST /api/outlook/events | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/events | replace |
| POST /api/outlook/messages/:id/forward | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/messages/:id/forward | replace |
| POST /api/outlook/messages/:id/reply | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/messages/:id/reply | replace |
| POST /api/outlook/refresh | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/refresh | replace |
| POST /api/outlook/send | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/send | replace |
| POST /api/outlook/send-approval | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/outlook/send-approval | replace |
| POST /api/pd-pm-handover/:projectId/accept | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/pd-pm-handover/:projectId/accept | replace |
| POST /api/pd-pm-handover/:projectId/reject | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/pd-pm-handover/:projectId/reject | replace |
| POST /api/pd-pm-handover/:projectId/submit | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/pd-pm-handover/:projectId/submit | replace |
| POST /api/pd/clients | Defined in server/pd-routes.ts | yes | projects, tasks | POST /api/v2/pd/clients | replace |
| POST /api/pd/tickets | Defined in server/pd-routes.ts | yes | projects, tasks | POST /api/v2/pd/tickets | replace |
| POST /api/pd/tickets/:id/spawn-tasks | Defined in server/pd-routes.ts | yes | projects, tasks | POST /api/v2/pd/tickets/:id/spawn-tasks | replace |
| POST /api/phase-templates | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/phase-templates | replace |
| POST /api/phase-templates/:id/clone | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/phase-templates/:id/clone | replace |
| POST /api/phase-templates/:id/items | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/phase-templates/:id/items | replace |
| POST /api/plan-edit-notifications/bulk-resolve | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/plan-edit-notifications/bulk-resolve | replace |
| POST /api/planning-tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/planning-tasks | replace |
| POST /api/planning-tasks/bulk | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/planning-tasks/bulk | replace |
| POST /api/pm-otg/projects/:projectId/compliance/risk-confirm | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/compliance/risk-confirm | replace |
| POST /api/pm-otg/projects/:projectId/escalate | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/escalate | replace |
| POST /api/pm-otg/projects/:projectId/generate-po | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/generate-po | replace |
| POST /api/pm-otg/projects/:projectId/link-invoice | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/link-invoice | replace |
| POST /api/pm-otg/projects/:projectId/log-delay | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/log-delay | replace |
| POST /api/pm-otg/projects/:projectId/log-risk | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/log-risk | replace |
| POST /api/pm-otg/projects/:projectId/raise-variation | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/raise-variation | replace |
| POST /api/pm-otg/projects/:projectId/site-visit | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/site-visit | replace |
| POST /api/pm-otg/projects/:projectId/update-progress | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/update-progress | replace |
| POST /api/pm-otg/projects/:projectId/upload-photo | Defined in server/pm-on-the-go-routes.ts | yes | projects | POST /api/v2/pm-otg/projects/:projectId/upload-photo | replace |
| POST /api/po/generate | Defined in server/po-routes.ts | yes | new-schema-or-unknown | POST /api/v2/po/generate | review |
| POST /api/portfolios | Defined in server/portfolio-routes.ts | yes | projects, expenses | POST /api/v2/portfolios | replace |
| POST /api/portfolios/:id/assign-project | Defined in server/portfolio-routes.ts | yes | projects, expenses | POST /api/v2/portfolios/:id/assign-project | replace |
| POST /api/portfolios/:id/move-project | Defined in server/portfolio-routes.ts | yes | projects, expenses | POST /api/v2/portfolios/:id/move-project | replace |
| POST /api/portfolios/:id/rollout-plans | Defined in server/portfolio-routes.ts | yes | projects, expenses | POST /api/v2/portfolios/:id/rollout-plans | replace |
| POST /api/procurement | Defined in server/procurement-routes.ts | yes | new-schema-or-unknown | POST /api/v2/procurement | review |
| POST /api/project-plan/delete-tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/project-plan/delete-tasks | replace |
| POST /api/project-plan/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/project-plan/overrides | replace |
| POST /api/project-plan/structure | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/project-plan/structure | replace |
| POST /api/project-team | Defined in server/engineering-routes.ts | unknown | projects, tasks | POST /api/v2/project-team | replace |
| POST /api/projects | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/projects | replace |
| POST /api/projects-summary/:projectName/edit | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/projects-summary/:projectName/edit | replace |
| POST /api/projects/:id/handover-gates/:gateId/complete | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/projects/:id/handover-gates/:gateId/complete | replace |
| POST /api/projects/:id/handover-gates/:gateId/reopen | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/projects/:id/handover-gates/:gateId/reopen | replace |
| POST /api/projects/:id/handover-gates/:gateId/update-checklist | Defined in server/handover-routes.ts | yes | projects | POST /api/v2/projects/:id/handover-gates/:gateId/update-checklist | replace |
| POST /api/projects/:projectId/apply-template | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/projects/:projectId/apply-template | replace |
| POST /api/projects/:projectId/eng-stages/generate | Defined in server/eng-stage-routes.ts | yes | projects, tasks | POST /api/v2/projects/:projectId/eng-stages/generate | replace |
| POST /api/projects/:projectId/generate-eng-tasks | Defined in server/engineering-routes.ts | yes | projects, tasks | POST /api/v2/projects/:projectId/generate-eng-tasks | replace |
| POST /api/projects/:projectId/phase-preview | Defined in server/template-routes.ts | yes | projects, tasks | POST /api/v2/projects/:projectId/phase-preview | replace |
| POST /api/projects/:projectName/change-notices | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/projects/:projectName/change-notices | replace |
| POST /api/projects/:projectName/dependencies | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/projects/:projectName/dependencies | replace |
| POST /api/projects/:projectName/working-plan/renumber-wbs | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/projects/:projectName/working-plan/renumber-wbs | replace |
| POST /api/projects/:projectName/working-plan/reset | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/projects/:projectName/working-plan/reset | replace |
| POST /api/quality/access/verify | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/access/verify | review |
| POST /api/quality/admin/bulk-create-checklists | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/quality/admin/bulk-create-checklists | review |
| POST /api/quality/holidays | Defined in server/quality-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/quality/holidays | review |
| POST /api/quality/postmortem/:projectName | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/postmortem/:projectName | review |
| POST /api/quality/project/:projectName/item/:itemInstanceId | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/item/:itemInstanceId | review |
| POST /api/quality/project/:projectName/item/:itemInstanceId/approve | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/item/:itemInstanceId/approve | review |
| POST /api/quality/project/:projectName/item/:itemInstanceId/evidence | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/item/:itemInstanceId/evidence | review |
| POST /api/quality/project/:projectName/item/:itemInstanceId/evidence/upload | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/item/:itemInstanceId/evidence/upload | review |
| POST /api/quality/project/:projectName/item/:itemInstanceId/send-for-approval | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/item/:itemInstanceId/send-for-approval | review |
| POST /api/quality/project/:projectName/items | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/items | review |
| POST /api/quality/project/:projectName/plan-link | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/plan-link | review |
| POST /api/quality/project/:projectName/recalculate-warnings | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/recalculate-warnings | review |
| POST /api/quality/project/:projectName/risk-answer | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/project/:projectName/risk-answer | review |
| POST /api/quality/warning/:warningId/acknowledge | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/warning/:warningId/acknowledge | review |
| POST /api/quality/warning/:warningId/resolve | Defined in server/quality-routes.ts | yes | new-schema-or-unknown | POST /api/v2/quality/warning/:warningId/resolve | review |
| POST /api/raid | Defined in server/raid-routes.ts | yes | projects | POST /api/v2/raid | replace |
| POST /api/refresh | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/refresh | replace |
| POST /api/reprocess-all | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/reprocess-all | replace |
| POST /api/revenue-tab/:projectName/costed | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/revenue-tab/:projectName/costed | replace |
| POST /api/revenue-tab/:projectName/date-override | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/revenue-tab/:projectName/date-override | replace |
| POST /api/revenue-tab/:projectName/link-task | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/revenue-tab/:projectName/link-task | replace |
| POST /api/revenue-tracking/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/revenue-tracking/overrides | replace |
| POST /api/role-auth/login | Defined in server/role-auth-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/role-auth/login | review |
| POST /api/role-auth/seed | Defined in server/role-auth-routes.ts | unknown | new-schema-or-unknown | POST /api/v2/role-auth/seed | review |
| POST /api/roles | Defined in server/role-management.ts | yes | new-schema-or-unknown | POST /api/v2/roles | review |
| POST /api/scenarios | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/scenarios | replace |
| POST /api/scenarios/:id/duplicate | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/scenarios/:id/duplicate | replace |
| POST /api/scenarios/:id/overrides | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/scenarios/:id/overrides | replace |
| POST /api/scenarios/:id/reset | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/scenarios/:id/reset | replace |
| POST /api/sp-sync/config | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/config | replace |
| POST /api/sp-sync/config/auto-detect | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/config/auto-detect | replace |
| POST /api/sp-sync/cp-signed/:requestId | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/cp-signed/:requestId | replace |
| POST /api/sp-sync/generate-tasks/:requestId | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/generate-tasks/:requestId | replace |
| POST /api/sp-sync/pull | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/pull | replace |
| POST /api/sp-sync/push | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/push | replace |
| POST /api/sp-sync/resolve-conflict/:requestId | Defined in server/sync-routes.ts | yes | projects, tasks | POST /api/v2/sp-sync/resolve-conflict/:requestId | replace |
| POST /api/task-attachments | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/task-attachments | replace |
| POST /api/task-checklist-items | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/task-checklist-items | replace |
| POST /api/task-checklists | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/task-checklists | replace |
| POST /api/task-comments | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/task-comments | replace |
| POST /api/tr-register | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | POST /api/v2/tr-register | review |
| POST /api/tr-register/:id/link | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | POST /api/v2/tr-register/:id/link | review |
| POST /api/tr-register/:id/suggest-links | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | POST /api/v2/tr-register/:id/suggest-links | review |
| POST /api/tr-register/:id/suggestion-decision | Defined in server/tr-register-routes.ts | yes | new-schema-or-unknown | POST /api/v2/tr-register/:id/suggestion-decision | review |
| POST /api/tracker-monthly | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/tracker-monthly | replace |
| POST /api/upload | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/upload | replace |
| POST /api/ux/role-aware-interaction | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/ux/role-aware-interaction | replace |
| POST /api/v2/imports/:domain | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/imports/:domain | keep |
| POST /api/v2/projects/:projectId/development/handover | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/development/handover | keep |
| POST /api/v2/projects/:projectId/engineering/designs | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/engineering/designs | keep |
| POST /api/v2/projects/:projectId/finance/variations | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/finance/variations | keep |
| POST /api/v2/projects/:projectId/milestones | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/milestones | keep |
| POST /api/v2/projects/:projectId/procurement/invoices | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/procurement/invoices | keep |
| POST /api/v2/projects/:projectId/procurement/items | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/procurement/items | keep |
| POST /api/v2/projects/:projectId/procurement/pos | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/procurement/pos | keep |
| POST /api/v2/projects/:projectId/quality/checks | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/quality/checks | keep |
| POST /api/v2/projects/:projectId/work-items | Defined in server/api/v2/routes/v2-routes.ts | unknown | projects | POST /api/v2/projects/:projectId/work-items | keep |
| POST /api/webhooks/graph | Defined in server/ms-sync-routes.ts | unknown | tasks | POST /api/v2/webhooks/graph | replace |
| POST /api/webhooks/read-ai | Defined in server/meeting-routes.ts | yes | tasks | POST /api/v2/webhooks/read-ai | replace |
| POST /api/weekly-reviews/:projectName | Defined in server/weekly-review-routes.ts | yes | projects | POST /api/v2/weekly-reviews/:projectName | replace |
| POST /api/work-items/:id/viewers | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/work-items/:id/viewers | replace |
| POST /api/work-items/delete | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/work-items/delete | replace |
| POST /api/work-items/restore | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/work-items/restore | replace |
| POST /api/working-plan/tasks | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | POST /api/v2/working-plan/tasks | replace |
| POST /api/writeback-mappings | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/writeback-mappings | replace |
| POST /api/writeback/execute | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/writeback/execute | replace |
| POST /api/writeback/preview | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/writeback/preview | replace |
| POST /api/writeback/rollback/:auditId | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | POST /api/v2/writeback/rollback/:auditId | replace |
| PUT /api/dashboard/widget-config | Defined in server/engineering-routes.ts | unknown | projects, tasks | PUT /api/v2/dashboard/widget-config | replace |
| PUT /api/ee-info/nodes/:id | Defined in server/ee-info-routes.ts | yes | projects | PUT /api/v2/ee-info/nodes/:id | replace |
| PUT /api/ee-info/nodes/:nodeId/details | Defined in server/ee-info-routes.ts | yes | projects | PUT /api/v2/ee-info/nodes/:nodeId/details | replace |
| PUT /api/ee-info/os/nodes/:id | Defined in server/ee-info-routes.ts | yes | projects | PUT /api/v2/ee-info/os/nodes/:id | replace |
| PUT /api/eng/local-synced-save/config | Defined in server/engineering-routes.ts | yes | projects, tasks | PUT /api/v2/eng/local-synced-save/config | replace |
| PUT /api/mytool/daily-review | Defined in server/routes.ts | unknown | projects, expenses, revenues, tasks, budgets | PUT /api/v2/mytool/daily-review | replace |
| PUT /api/mytool/preferences | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PUT /api/v2/mytool/preferences | replace |
| PUT /api/mytool/settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PUT /api/v2/mytool/settings | replace |
| PUT /api/pd-pm-handover/:projectId/draft | Defined in server/handover-routes.ts | yes | projects | PUT /api/v2/pd-pm-handover/:projectId/draft | replace |
| PUT /api/pd-pm-handover/:projectId/excel-tracker | Defined in server/handover-routes.ts | yes | projects | PUT /api/v2/pd-pm-handover/:projectId/excel-tracker | replace |
| PUT /api/pm-otg/mode | Defined in server/pm-on-the-go-routes.ts | yes | projects | PUT /api/v2/pm-otg/mode | replace |
| PUT /api/portfolios/:id | Defined in server/portfolio-routes.ts | yes | projects, expenses | PUT /api/v2/portfolios/:id | replace |
| PUT /api/portfolios/:portfolioId/rollout-plans/:planId | Defined in server/portfolio-routes.ts | yes | projects, expenses | PUT /api/v2/portfolios/:portfolioId/rollout-plans/:planId | replace |
| PUT /api/roles/:role | Defined in server/role-management.ts | yes | new-schema-or-unknown | PUT /api/v2/roles/:role | review |
| PUT /api/settings | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PUT /api/v2/settings | replace |
| PUT /api/user-project-folder/:projectName | Defined in server/routes.ts | yes | projects, expenses, revenues, tasks, budgets | PUT /api/v2/user-project-folder/:projectName | replace |