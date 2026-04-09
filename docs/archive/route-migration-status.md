# Route Migration Status: server/routes.ts → Domain Files

## Goal
Reduce `server/routes.ts` to 0 lines by extracting all route handlers into domain-specific files.

## Current State
- **Total lines**: 9,513
- **Total route handlers**: 187
- **Status**: FROZEN — no new routes allowed

## Already Extracted (in separate files, NOT in routes.ts)
These route groups were never in routes.ts or were extracted in prior work:

| Domain | File | Handler Count |
|--------|------|---------------|
| Notifications | server/notification-routes.ts | ~10 |
| Reports | server/report-routes.ts | ~15 |
| Smart Import | server/smart-import-routes.ts | ~28 |
| Finance (departmental) | server/departments/finance-routes.ts | ~50 |
| Engineering | server/engineering-routes.ts | ~20 |
| Lifecycle | server/lifecycle-routes.ts | ~30 |
| Stage Collaboration | server/stage-collaboration-routes.ts | ~15 |
| Collaboration Workflow | server/collaboration-workflow-routes.ts | ~15 |
| Performance | server/routes/performance-routes.ts | ~5 |
| Gates | server/routes/gates-routes.ts | ~10 |
| Cashflow 2026 | server/routes/register-cashflow-2026-routes.ts | ~5 |

## Remaining in routes.ts (187 handlers by domain)

| # | Domain | Prefix | Handlers | Priority | Status |
|---|--------|--------|----------|----------|--------|
| 1 | **MyTool** | /api/mytool/* | 34 | P0 | **Phase 1 — This PR** |
| 2 | Admin | /api/admin/* | 18 | P1 | Pending |
| 3 | Outlook/MS | /api/outlook/*, /api/ms-* | 20 | P1 | Pending |
| 4 | Work Items | /api/work-items/* | 6 | P2 | Pending |
| 5 | Revenue Tab | /api/revenue-tab/* | 6 | P2 | Pending |
| 6 | Project Plan | /api/project-plan/* | 6 | P2 | Pending |
| 7 | Export | /api/export/* | 5 | P2 | Pending |
| 8 | Writeback | /api/writeback/* | 8 | P2 | Pending |
| 9 | Feedback | /api/feedback/* | 4 | P3 | Pending |
| 10 | Expense Links | /api/expense-task-links/* | 4 | P3 | Pending |
| 11 | Expenditure | /api/expenditure/* | 4 | P3 | Pending |
| 12 | Cashflow (legacy) | /api/cashflow/* | 4 | P3 | Pending |
| 13 | Remaining misc | Various | ~68 | P4 | Pending |

## Phase 1 Complete
- [x] Add FROZEN header to routes.ts
- [x] Create this tracking document
- [x] Extract mytool routes → server/routes/mytool-routes.ts (34 handlers)
- [x] Create route-registry.ts entry point
- [x] Add CI line-count check

## Rules
1. One domain group per PR
2. Verify each group with tests before marking complete
3. Mark extracted routes with `// EXTRACTED to server/routes/<file>.ts` in routes.ts
4. Do NOT remove from routes.ts until verified
5. All new routes go in server/routes/ or server/departments/
