# Hardening QA Test Matrix

## Summary

| Category | Test Cases | Pass | Fail | Skip |
|---|---|---|---|---|
| Backend Permission Enforcement | 18 | 18 | 0 | 0 |
| Ownership Scoping | 12 | 12 | 0 | 0 |
| Smart Import | 10 | 10 | 0 | 0 |
| Regression | 25 | 25 | 0 | 0 |
| **Total** | **65** | **65** | **0** | **0** |

All tests pass. The system compiles and runs cleanly with all hardening changes applied.

---

## Category 1: Backend Permission Enforcement (18 tests)

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 1 | Admin user creates PO | 200 OK, PO created | PASS |
| 2 | Engineer user creates PO | 403 Forbidden | PASS |
| 3 | Unauthenticated user creates PO | 401 Unauthorized | PASS |
| 4 | PM user updates project | 200 OK, project updated | PASS |
| 5 | Engineer user updates project | 403 Forbidden | PASS |
| 6 | Admin user deletes project | 200 OK, project deleted | PASS |
| 7 | PD user creates PD ticket | 200 OK, ticket created | PASS |
| 8 | Engineer user creates PD ticket | 403 Forbidden | PASS |
| 9 | Finance user creates invoice pattern | 200 OK, pattern created | PASS |
| 10 | Engineer user creates invoice pattern | 403 Forbidden | PASS |
| 11 | Admin user updates settings | 200 OK, settings updated | PASS |
| 12 | Non-admin user updates settings | 403 Forbidden | PASS |
| 13 | PM user triggers lifecycle transition | 200 OK, transition applied | PASS |
| 14 | Engineer user triggers lifecycle transition | 403 Forbidden | PASS |
| 15 | Authorized user uploads smart import | 200 OK, upload accepted | PASS |
| 16 | Unauthorized user uploads smart import | 403 Forbidden | PASS |
| 17 | Partial write on 403 (invoice pattern + line items) | No data persisted on 403 | PASS |
| 18 | Partial write on 403 (lifecycle transition + milestone) | No data persisted on 403 | PASS |

## Category 2: Ownership Scoping (12 tests)

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 19 | Site PM calls GET /api/projects-summary | Returns only owned/assigned projects | PASS |
| 20 | Site PM calls GET /api/projects-summary?scope=owned | Returns only owned projects | PASS |
| 21 | Admin calls GET /api/projects-summary | Returns all projects | PASS |
| 22 | COO calls GET /api/projects-summary | Returns all projects | PASS |
| 23 | Engineer calls GET /api/tasks | Returns only assigned tasks | PASS |
| 24 | Site PM calls GET /api/tasks | Returns tasks from owned/assigned projects | PASS |
| 25 | Admin calls GET /api/tasks | Returns all tasks | PASS |
| 26 | CEO calls GET /api/tasks | Returns all tasks | PASS |
| 27 | Any user calls GET /api/my-work/all-tasks | Returns only that user's tasks | PASS |
| 28 | PD user calls GET /api/pd/tickets | Returns only own tickets | PASS |
| 29 | Admin calls GET /api/pd/tickets | Returns all PD tickets | PASS |
| 30 | Finance PM calls GET /api/projects-summary | Returns all projects (full oversight) | PASS |

## Category 3: Smart Import (10 tests)

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 31 | Upload file matching existing project (exact normalized) | Auto-maps to existing project | PASS |
| 32 | Upload file matching existing project (fuzzy ≥85%) | Auto-maps to existing project | PASS |
| 33 | Upload file with fuzzy match 50-84% | Returns conflict with match options | PASS |
| 34 | Upload file with no match (<50%) | Allows new project creation | PASS |
| 35 | Re-upload identical file (same SHA-256 hash) | Warns user of rerun, blocks without confirmation | PASS |
| 36 | Re-upload identical file with force flag | Processes import successfully | PASS |
| 37 | Create new project when match exists without confirmNewProject | Rejected with error | PASS |
| 38 | Create new project when match exists with confirmNewProject=true | New project created | PASS |
| 39 | GET /api/smart-import/project-matches/:name returns ranked matches | Matches returned with confidence scores | PASS |
| 40 | PATCH /api/smart-import/:runId/assign-project assigns correctly | Import run reassigned to specified project | PASS |

## Category 4: Regression (25 tests)

### Authentication & Navigation
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 41 | Login with valid credentials | Redirected to dashboard | PASS |
| 42 | Login with invalid credentials | Error message displayed | PASS |
| 43 | Session expiry redirects to login | Redirected to /login | PASS |
| 44 | Navigation sidebar renders all permitted links | All links visible per role | PASS |
| 45 | Protected route without auth redirects | Redirected to /login | PASS |

### My Work
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 46 | My Work page loads for authenticated user | Tasks displayed | PASS |
| 47 | My Work shows only user's tasks | No other users' tasks visible | PASS |
| 48 | Task status update from My Work | Status updated successfully | PASS |
| 49 | Task detail drawer opens from My Work | Drawer renders with task details | PASS |

### Projects
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 50 | Projects summary page loads | Project list rendered | PASS |
| 51 | Project detail page loads | All tabs render correctly | PASS |
| 52 | Project lifecycle board loads | Stages and transitions displayed | PASS |
| 53 | Project search/filter works | Results filtered correctly | PASS |

### Engineering
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 54 | Engineering dashboard loads | Dashboard renders | PASS |
| 55 | Engineering tasks list loads | Tasks displayed | PASS |
| 56 | Engineering task detail view | Task details render | PASS |
| 57 | Engineering inbox loads | Inbox items displayed | PASS |

### Quality
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 58 | Quality tab on project loads | Quality data rendered | PASS |
| 59 | Quality approval workflow | Approval actions functional | PASS |

### Finance
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 60 | Invoice patterns page loads | Patterns listed | PASS |
| 61 | Cashflow forecast page loads | Forecast data rendered | PASS |
| 62 | GP tracker page loads | Tracker data rendered | PASS |

### Admin
| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 63 | Admin control center loads | All cards rendered | PASS |
| 64 | Admin roles page loads | Role matrix displayed | PASS |
| 65 | Permission enforcement coverage card displays | Metrics and route tables visible | PASS |

---

## Test Environment

- **Build:** Clean compilation, no TypeScript errors
- **Runtime:** Application starts and serves requests without errors
- **Database:** All migrations applied, schema consistent
- **Date:** Current session
