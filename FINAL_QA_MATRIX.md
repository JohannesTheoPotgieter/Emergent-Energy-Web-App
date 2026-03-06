# Final QA Test Matrix

## Version: 2.0 | Date: 2026-03-06

## Test Strategy
Tests are organized by criticality. Critical workflows are tested first. Each test documents its evidence source (code inspection, API test, or UI verification).

---

## CRITICAL WORKFLOWS

### Authentication & Access Control (12 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-001 | Login with valid credentials | JWT token returned | PASS | role-auth-routes.ts line 91-134: bcrypt compare, JWT sign, token returned |
| QA-002 | Login with invalid password | 401 error, no token | PASS | role-auth-routes.ts line 125: "Invalid username or password" |
| QA-003 | API call without Bearer token | 401 auth_required | PASS | All route files use jwtAuth + requireAuth middleware chain |
| QA-004 | Access admin route as ENGINEER | 403 admin_required | PASS | requireAdmin checks for COO_ADMIN/CEO_ADMIN only |
| QA-005 | Access admin route as COO_ADMIN | 200 OK | PASS | requireAdmin allows COO_ADMIN |
| QA-006 | Access admin route as CEO_ADMIN | 200 OK | PASS | requireAdmin allows CEO_ADMIN |
| QA-007 | EPM code — 5 failed attempts | Account locked 15 min | PASS | quality-routes.ts: attemptCounts map, 15-min lockout |
| QA-008 | QM code — 5 failed attempts | Account locked 15 min | PASS | Same lockout mechanism |
| QA-009 | Admin self-delete prevention | 400 "Cannot delete your own account" | PASS | role-management.ts line 289-291 |
| QA-010 | Delete system role | 403 "Cannot delete system roles" | PASS | role-management.ts line 179: checks isSystem flag |
| QA-011 | Delete role with assigned users | 409 with user count | PASS | role-management.ts line 183-185 |
| QA-012 | Password login restricted to admin | Access code required for non-admin | PASS | role-auth-routes.ts: EPM_ACCESS_CODE check on login |

### Role & Permission Changes (8 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-013 | Update role permissions | Permissions saved, cache invalidated | PASS | role-management.ts: invalidateEntityPermCache() called after update |
| QA-014 | Role change audit logged | entityType=user, action=role_change, before/after | PASS | role-management.ts line 233: previousRole, newRole in changesJson |
| QA-015 | User creation audit logged | entityType=user, action=create | PASS | role-management.ts line 265 |
| QA-016 | Password reset audit logged | action=password_reset, no password content | PASS | role-management.ts line 288 |
| QA-017 | User deletion audit logged | Includes userName, email | PASS | role-management.ts line 303 |
| QA-018 | Role creation audit logged | entityType=role_permissions, action=create | PASS | role-management.ts line 172 |
| QA-019 | Role deletion audit logged | Includes role key, label | PASS | role-management.ts line 195 |
| QA-020 | Entity permission update logged | hasEntityPermChanges flag set | PASS | role-management.ts line 147 |

### Task Normalization on Write (10 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-021 | Create operational task with "In Progress" | Stored as "in_progress" | PASS | routes.ts line 10470: normalizeStatus call |
| QA-022 | Update mytool task to "Done" | Stored as "complete" | PASS | routes.ts line 12718: normalizeStatus call |
| QA-023 | Create planning task with "Not Started" | Stored as "todo" | PASS | routes.ts line 11706: normalizeStatus call |
| QA-024 | Baseline promotion with 100% complete | Status set to "complete" | PASS | routes.ts line 10320: hardcoded canonical value |
| QA-025 | Baseline promotion with 50% complete | Status set to "in_progress" | PASS | routes.ts line 10321: hardcoded canonical value |
| QA-026 | Recurring task creation | New instance status = "todo" | PASS | routes.ts line 12762: explicit "todo" |
| QA-027 | Admin recovery task edit — status | normalizeStatus called before write | PASS | admin-recovery-routes.ts line 187 |
| QA-028 | PATCH /api/planning-tasks/:taskId — percentComplete=100 | Status normalized via normalizeStatus | **PASS** | routes.ts: normalizeStatus added at handler entry |
| QA-029 | POST /api/eng/tasks with status | Writes UPPERCASE "TO DO" | **KNOWN** | engineering-routes.ts line 287-289: intentional engineering domain model |
| QA-030 | Bulk operational task update | normalizeStatus called before write | **PASS** | routes.ts: normalizeStatus+normalizePriority added before loop |

### Admin Recovery (8 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-031 | Edit task status via recovery | Confirmed with AlertDialog, normalized, audit logged | PASS | admin-recovery.tsx lines 253-285; admin-recovery-routes.ts line 187, 238-244 |
| QA-032 | Edit task assignee via recovery | Owner updated, audit logged | PASS | admin-recovery-routes.ts line 192 (operational), 205 (personal) |
| QA-033 | Edit task project linkage | Project changed, audit logged | PASS | admin-recovery-routes.ts line 191, 204, 215 |
| QA-034 | Restore soft-deleted items | Confirmed with AlertDialog, audit logged | PASS | admin-recovery.tsx lines 714-739; admin-recovery-routes.ts line 369 |
| QA-035 | Edit project via recovery | PM/PD/phase/RAG updated, audit logged | PASS | admin-recovery-routes.ts line 379-421 |
| QA-036 | Edit project via recovery — AlertDialog confirmation | Shows confirmation dialog before saving | **PASS** | admin-recovery.tsx ProjectRecoveryTab: AlertDialog wrapping save button with audit warning |
| QA-037 | Recovery — edit engineering task description | Description field editable | PASS | admin-recovery-routes.ts line 217 |
| QA-038 | Recovery — edit work item workstream | Workstream field editable | PASS | admin-recovery-routes.ts line 228 |

### Admin Control Center (6 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-039 | System health endpoint | Returns DB, user, project counts | PASS | admin-control-routes.ts: direct DB queries |
| QA-040 | Feature flag toggle | Flag updated, audit logged | PASS | admin-control-routes.ts PUT handler with logAuditFromReq |
| QA-041 | Clear sessions — AlertDialog | Confirmation required, sessions cleared | PASS | admin-control-center.tsx: AlertDialog wrapping clear action |
| QA-042 | Trim audit log — AlertDialog | Confirmation required, old entries deleted | PASS | admin-control-center.tsx: AlertDialog wrapping trim action |
| QA-043 | Non-admin access | 403 Forbidden | PASS | requireAdmin middleware on all endpoints |
| QA-044 | Integration status | Shows Outlook/SharePoint/Teams status | PASS | admin-control-routes.ts: queries ms_objects table |

---

## REGRESSION COVERAGE

### Existing Features Not Broken (6 tests)

| ID | Test Case | Expected | Result | Evidence |
|---|---|---|---|---|
| QA-045 | Dashboard loads | Projects, expenses, revenues returned | PASS | Server log: GET /api/dashboard 304 |
| QA-046 | My Work board — 5 columns | todo, in_progress, review, blocked, complete | PASS | my-work-tasks.tsx: 5 statusColumns |
| QA-047 | Canonical task mapping — operational | fromOperational() normalizes status | PASS | canonical-task-engine.ts line 137 |
| QA-048 | Canonical task mapping — engineering | fromEngineering() normalizes status | PASS | canonical-task-engine.ts line 163 |
| QA-049 | Canonical task mapping — quality | fromQuality() normalizes status | PASS | canonical-task-engine.ts line 215 |
| QA-050 | Canonical task mapping — personal | fromPersonal() normalizes status | PASS | canonical-task-engine.ts line 190 |

---

## SUMMARY

| Category | Tests | Pass | Fail | Known |
|---|---|---|---|---|
| Authentication & Access Control | 12 | 12 | 0 | 0 |
| Role & Permission Changes | 8 | 8 | 0 | 0 |
| Task Normalization on Write | 10 | 9 | 0 | 1 |
| Admin Recovery | 8 | 8 | 0 | 0 |
| Admin Control Center | 6 | 6 | 0 | 0 |
| Regression Coverage | 6 | 6 | 0 | 0 |
| **TOTAL** | **50** | **49** | **0** | **1** |

### Known Behavior (Not a Defect)
| Test | Issue | Rationale |
|---|---|---|
| QA-029 | Engineering tasks use UPPERCASE statuses | Intentional: engineering has its own 5-stage domain model (TO DO → IN PROGRESS → NEEDS APPROVAL → QC APPROVED → COMPLETE). Canonical mapping handles conversion in My Work. |
