# Permission Enforcement Matrix

## Roles Reference
| Code | Label | Level | Is Admin |
|------|-------|-------|----------|
| CEO_ADMIN | CEO | Executive | Yes |
| COO_ADMIN | COO | Executive | Yes |
| CCO | CCO | C-Suite | No |
| CFO | CFO | C-Suite | No |
| PROGRAM_MANAGER | Program Manager | Management | No |
| PROGRAM_FINANCE_MANAGER | Program Finance Mgr | Management | No |
| CONSTRUCTION_MANAGER | Construction Mgr | Management | No |
| QUALITY_MANAGER | Quality Manager | Management | No |
| ENGINEERING_MANAGER | Engineering Mgr | Management | No |
| PROJECT_MANAGER_SITE | Project Manager | Operational | No |
| PROJECT_DEVELOPER | Project Developer | Operational | No |
| ENGINEER | Engineer | Operational | No |
| ACCOUNTANT | Accountant | Operational | No |

## Page Access Matrix

| Page | CEO | COO | CCO | CFO | PM_MGR | PFM | CONST_MGR | QM | ENG_MGR | PM_SITE | PD | ENGR | ACCT |
|------|-----|-----|-----|-----|--------|-----|-----------|-----|---------|---------|-----|------|------|
| / (Home) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➡️/pm | ✅ | ✅ | ✅ |
| /dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /projects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /project/:name | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /pm-dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /cashflow | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| /revenue | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /cos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| /cos-control | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /cashflow-forecast | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /engineering | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /engineering/tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /engineering/inbox | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /quality | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /smart-import | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /lifecycle-board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /execution-board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /portfolios | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /notifications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /leaderboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /ee-info | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /tr-register | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /feedback | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /my-tool | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /pd | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| /admin/* | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Legend: ✅ = Allowed, ❌ = Blocked/Redirected, ➡️/pm = Redirected to PM Dashboard

## API Mutation Permission Matrix

| Endpoint | Method | Required Permission | Admin Only |
|----------|--------|-------------------|------------|
| /api/projects | POST | requireAdmin | Yes |
| /api/projects/:name | PATCH | can_edit_project_info | No |
| /api/reprocess-all | POST | requireAdmin | Yes |
| /api/upload | POST | requireAuth | No |
| /api/writeback-mappings | POST | requireAdmin | Yes |
| /api/writeback-mappings/:id | PATCH | requireAdmin | Yes |
| /api/writeback-mappings/:id | DELETE | requireAdmin | Yes |
| /api/cashflow-2026/opening-balance | POST | requireAdmin | Yes |
| /api/opex/budget | POST | requireAdmin | Yes |
| /api/opex/weekly-manual | POST | requireAdmin | Yes |
| /api/ee-info/nodes | POST | requireCOO | Yes |
| /api/ee-info/nodes/:id | PUT | requireCOO | Yes |
| /api/ee-info/nodes/:id | DELETE | requireCOO | Yes |
| /api/ee-info/import/obsidian-zip | POST | requireCOO | Yes |
| /api/ee-info/os/seed | POST | requireCOO | Yes |
| /api/roles/:role | PUT | requireAdmin | Yes |
| /api/roles | POST | requireAdmin | Yes |
| /api/admin/users/:userId/role | PATCH | requireAdmin | Yes |
| /api/admin/ms-integration/:key | PUT | requireAdmin | Yes |
| /api/admin/ms-integration/test-sharepoint | POST | requireAdmin | Yes |
| /api/admin/ms-integration/browse-drive | POST | requireAdmin | Yes |
| /api/mytool/company-priorities | POST | requirePriorityAdmin | Execs+PM |
| /api/outlook/send-approval | POST | requireAdmin | Yes |
| /api/sp-sync/discover/sites | GET | requireCOO | Yes |
| /api/sp-sync/pull | POST | requireCOO | Yes |
| /api/sp-sync/push | POST | requireCOO | Yes |
| /api/quality/access/verify | POST | requireAdminOrQm | Partial |
| /api/pd/tickets | POST | requireAuth | No |
| /api/pd/tickets/:id | PATCH | requireAuth | No |
| /api/pd/clients | POST | requireAuth | No |
| /api/eng/tasks/:id | PATCH | requireAuth | No |
| /api/smart-import/upload | POST | requireAuth | No |
| /api/smart-import/:runId/commit | POST | requireAuth | No |
| /api/smart-import/:runId/mapping | PATCH | requireAuth | No |
| /api/smart-import/:runId/issue/:issueId/resolve | PATCH | requireAuth | No |
| /api/notifications/:id/read | PATCH | requireAuth | No |
| /api/portfolios | POST | requireAdmin | Yes |

## Backend Permission Enforcement Gaps

| Endpoint | Issue | Severity |
|----------|-------|----------|
| GET /api/overview | No auth required — exposes project summary | LOW (read-only public dashboard) |
| GET /api/home/summary | No auth required | LOW |
| GET /api/program/cos | No auth required — exposes financial data | MEDIUM |
| GET /api/pd/tickets | No role check — any authenticated user can view all PD tickets | LOW |
| PATCH /api/pd/tickets/:id | No role check — any user can edit PD tickets | MEDIUM |
| POST /api/pd/clients | No role check — any user can create clients | LOW |
| GET /api/quality/templates | No role check beyond auth | LOW |

## Automated Test Coverage

Tests validating permission enforcement are located in:
- `qa/tests/api/auth-routes.test.ts` — Backend permission enforcement tests
- `qa/tests/e2e/smoke.spec.ts` — Frontend route access by role
