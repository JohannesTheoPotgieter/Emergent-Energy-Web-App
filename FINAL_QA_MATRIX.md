# Final QA Test Matrix

## Version: 1.0 | Date: 2026-03-06

## Test Categories

### 1. Authentication & Authorization (12 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-001 | Login with valid credentials | JWT token returned, redirect to dashboard | PASS |
| QA-002 | Login with invalid password | 401 error, no token | PASS |
| QA-003 | Access admin route as non-admin | 403 Forbidden | PASS |
| QA-004 | Access admin route as COO_ADMIN | 200 OK | PASS |
| QA-005 | Access admin route as CEO_ADMIN | 200 OK | PASS |
| QA-006 | API call without Bearer token | 401 auth_required | PASS |
| QA-007 | EPM access code challenge | Locks after 5 failures, 15-min lockout | PASS |
| QA-008 | QM access code challenge | Same lockout behavior | PASS |
| QA-009 | Role change via admin panel | Role updated, audit logged | PASS |
| QA-010 | Self-delete prevention | 400 error "Cannot delete your own account" | PASS |
| QA-011 | Delete role with assigned users | 409 error, users must be reassigned first | PASS |
| QA-012 | System role delete prevention | 403 error "Cannot delete system roles" | PASS |

### 2. Task Management (10 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-013 | Create operational task | Task created with normalized status | PASS |
| QA-014 | Create task with empty title | Validation error returned | PASS |
| QA-015 | Update task status to "Done" | Stored as canonical "complete" | PASS |
| QA-016 | Update task status to "In Progress" | Stored as canonical "in_progress" | PASS |
| QA-017 | MyWork board shows 5 columns | todo, in_progress, review, blocked, complete | PASS |
| QA-018 | Recurring task completion | New instance created with status "todo" | PASS |
| QA-019 | Baseline task promotion | Status normalized (todo/in_progress/complete) | PASS |
| QA-020 | Task validation on create | Title required, validates before storage | PASS |
| QA-021 | Task validation on update | Empty title rejected | PASS |
| QA-022 | Bulk task operations | Status changes logged individually | PASS |

### 3. Admin Recovery (8 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-023 | Search tasks by title | Partial match returns results | PASS |
| QA-024 | Filter by task type | Only selected type returned | PASS |
| QA-025 | Edit task status via recovery | Status normalized, audit logged | PASS |
| QA-026 | Edit task assignee via recovery | Owner updated, audit logged | PASS |
| QA-027 | Edit task project linkage | Project changed, audit logged | PASS |
| QA-028 | Restore soft-deleted item | Item restored, confirmation shown | PASS |
| QA-029 | Recovery edit confirmation dialog | AlertDialog shown before save | PASS |
| QA-030 | Restore confirmation dialog | AlertDialog shown before restore | PASS |

### 4. Admin Control Center (6 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-031 | System health endpoint | Returns DB status, user/project counts | PASS |
| QA-032 | Feature flag toggle | Flag updated, audit logged | PASS |
| QA-033 | Integration status | Returns MS365 connection info | PASS |
| QA-034 | System enums endpoint | Returns phases, RAG values, workstreams | PASS |
| QA-035 | Clear sessions (dangerous) | Requires confirmation, clears sessions | PASS |
| QA-036 | Non-admin access to control center | 403 Forbidden | PASS |

### 5. Audit Logging (8 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-037 | Role permission update logged | entityType=role_permissions, action=update | PASS |
| QA-038 | User role change logged | Includes previousRole, newRole | PASS |
| QA-039 | User creation logged | Includes username, email, role | PASS |
| QA-040 | User deletion logged | Includes userName, email | PASS |
| QA-041 | Admin recovery edit logged | Includes taskId, taskSource, updates | PASS |
| QA-042 | Password reset logged | action=password_reset, userName included | PASS |
| QA-043 | Feature flag toggle logged | Includes key, value | PASS |
| QA-044 | Dangerous action logged | Includes action type and description | PASS |

### 6. Financial Access Control (6 tests)
| ID | Test Case | Expected | Status |
|---|---|---|---|
| QA-045 | Accountant views cost lines | 200 OK | PASS |
| QA-046 | Engineer cannot view cost lines | 403 or empty based on entity perms | PASS |
| QA-047 | CFO edits revenue lines | 200 OK | PASS |
| QA-048 | PM views cashflow | 200 OK | PASS |
| QA-049 | Project Developer cannot edit financials | Restricted by entity permissions | PASS |
| QA-050 | OPEX updates require finance role | Enforced by requireAdmin | PASS |

## Summary
- **Total Tests**: 50
- **Pass**: 50
- **Fail**: 0
- **Assessment**: RELEASE READY
