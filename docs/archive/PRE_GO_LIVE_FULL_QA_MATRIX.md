# Pre-Go-Live Full QA Matrix

## Date: 2026-03-06
## System: Emergent Energy Dashboard v1
## Test Scope: All changes from pre-go-live hardening session (T001-T009)

---

## Test Results Summary

| Category | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| My Work Defaults (T001) | 8 | 8 | 0 | 0 |
| My Work Filters (T002) | 7 | 7 | 0 | 0 |
| Task Routing (T003) | 5 | 5 | 0 | 0 |
| Project Routing (T004) | 5 | 5 | 0 | 0 |
| Command Center (T005) | 6 | 6 | 0 | 0 |
| Permissions UI (T006) | 4 | 4 | 0 | 0 |
| Archive Handling (T007) | 7 | 7 | 0 | 0 |
| Admin Exceptions (T008) | 6 | 6 | 0 | 0 |
| Cross-Module (T009) | 5 | 5 | 0 | 0 |
| Regression | 12 | 12 | 0 | 0 |
| **Total** | **65** | **65** | **0** | **0** |

---

## Detailed Test Cases

### T001: My Work Defaults

| ID | Test | Expected | Result |
|---|---|---|---|
| MW-001 | Default sort field is `dueDate` | Sort button shows "Due↑" by default | PASS |
| MW-002 | Completed tasks hidden by default | No complete/done/cancelled tasks in list | PASS |
| MW-003 | "Show Done" toggle works | Clicking reveals completed tasks; button turns green with count | PASS |
| MW-004 | Overdue tasks sort first | Tasks with past due dates appear before others | PASS |
| MW-005 | Blocked tasks sort second | Blocked tasks appear after overdue, before normal | PASS |
| MW-006 | KPI card 4 shows "Due This Week" | Violet card with 7-day count, today sub-metric | PASS |
| MW-007 | "Completed" KPI card removed | No green "Completed" hero card | PASS |
| MW-008 | Status filter override | Selecting "complete" in status filter shows completed regardless of "Show Done" | PASS |

### T002: My Work Filters

| ID | Test | Expected | Result |
|---|---|---|---|
| MF-001 | Urgency quick-filters visible | Overdue, Due 7d, Blocked buttons after source tabs | PASS |
| MF-002 | Overdue quick-filter works | Clicking filters to overdue tasks only; red badge shown | PASS |
| MF-003 | Due 7d quick-filter works | Filters to tasks due within 7 days; violet badge shown | PASS |
| MF-004 | Blocked quick-filter works | Filters to blocked tasks only; orange badge shown | PASS |
| MF-005 | Quick-filters are exclusive | Clicking one deselects the other | PASS |
| MF-006 | Filter summary includes new types | Summary bar shows Due 7d/Blocked/+Done badges | PASS |
| MF-007 | Clear-all resets new filters | Clear-all button resets overdue/dueThisWeek/blocked | PASS |

### T003: Task Routing

| ID | Test | Expected | Result |
|---|---|---|---|
| TR-001 | User-scoped tasks in My Work | Only user's assigned/viewer tasks appear | PASS |
| TR-002 | COO/Admin sees unassigned KPI | Command Center shows "Unassigned" card when applicable | PASS |
| TR-003 | Program Manager sees unassigned KPI | Command Center shows "Unassigned" card when applicable | PASS |
| TR-004 | Regular PM doesn't see unassigned KPI | PM role doesn't get "Unassigned" card | PASS |
| TR-005 | Completed excluded from active boards | My Work default hides completed | PASS |

### T004: Project Routing

| ID | Test | Expected | Result |
|---|---|---|---|
| PR-001 | Owned projects sort first | Projects where user is PM appear at top of list | PASS |
| PR-002 | No-PM projects flagged | PM dropdown shows red "No PM" text | PASS |
| PR-003 | Active/Archived tabs work | Active tab shows is_active projects; archived shows others | PASS |
| PR-004 | Active tab is default | Project list opens on Active tab | PASS |
| PR-005 | Sort still works within ownership | Within owned/unowned groups, selected sort applies | PASS |

### T005: Command Center

| ID | Test | Expected | Result |
|---|---|---|---|
| CC-001 | COO/Admin KPIs include exceptions | Active Projects + Unassigned (if any) + Revenue + COS | PASS |
| CC-002 | PM KPIs show Project Tasks | KPI shows operational task count | PASS |
| CC-003 | Engineer KPIs show Eng Tasks | KPI shows engineering task count | PASS |
| CC-004 | QM KPIs show QC Items | KPI shows quality task and pending review counts | PASS |
| CC-005 | Attention items sorted by urgency | Overdue first, blocked second, pending third | PASS |
| CC-006 | Quick links are role-appropriate | Each role group sees different quick link sets | PASS |

### T006: Permissions UI

| ID | Test | Expected | Result |
|---|---|---|---|
| PU-001 | Honesty notice visible | "Permission Scope" amber box appears below info box | PASS |
| PU-002 | Navigation scope documented | Notice explains navigation is fully enforced | PASS |
| PU-003 | Entity scope documented | Notice explains entity permissions are mostly UI-level | PASS |
| PU-004 | Ownership scope documented | Notice explains row-level scoping is application logic | PASS |

### T007: Archive Handling

| ID | Test | Expected | Result |
|---|---|---|---|
| AH-001 | My Work hides completed by default | Completed/done/cancelled not shown | PASS |
| AH-002 | QM Dashboard defaults to active | Status filter starts at "active" not "all" | PASS |
| AH-003 | Engineering Dashboard filters completed | Priorities exclude completed/cancelled | PASS |
| AH-004 | Execution Board shows ACTIVE only | Only archivedStatus=ACTIVE projects | PASS |
| AH-005 | Lifecycle Board filters archived | ARCHIVED_MERGED and non-ACTIVE excluded | PASS |
| AH-006 | Projects page has Active/Archived tabs | Tab navigation works correctly | PASS |
| AH-007 | PM Dashboard shows aggregate counts | Done counts shown as information, not clutter | PASS |

### T008: Admin Exceptions

| ID | Test | Expected | Result |
|---|---|---|---|
| AE-001 | Backend endpoint returns data | GET /api/admin/control-center/operational-exceptions responds 200 | PASS |
| AE-002 | Admin-only enforcement | Non-admin users get 403 | PASS |
| AE-003 | Unassigned tasks count correct | Counts tasks with NULL/empty assigned_to | PASS |
| AE-004 | Unassigned projects count correct | Counts active projects with NULL/empty PM | PASS |
| AE-005 | Overdue-by-owner breakdown shown | Table lists owners with overdue counts | PASS |
| AE-006 | Colour coding on exception cards | Red/amber/orange when counts > 0 | PASS |

### T009: Cross-Module Consistency

| ID | Test | Expected | Result |
|---|---|---|---|
| CM-001 | Status colours consistent | blocked=red, complete=emerald, in_progress=blue, review=amber | PASS |
| CM-002 | Due date handling consistent | Same differenceInCalendarDays/parseISO pattern | PASS |
| CM-003 | Status normalisation consistent | Same normalisation logic across My Work and Command Center | PASS |
| CM-004 | Badge styling consistent | Same variant/colour patterns across modules | PASS |
| CM-005 | Terminology aligned | "blocked", "overdue", "complete" used consistently | PASS |

### Regression Tests

| ID | Test | Expected | Result |
|---|---|---|---|
| REG-001 | App starts without errors | Server starts on port 5000, no crashes | PASS |
| REG-002 | Authentication works | Login/logout flow functional | PASS |
| REG-003 | My Work list renders | Task list loads and displays | PASS |
| REG-004 | My Work board renders | Board view with 5 columns | PASS |
| REG-005 | Projects page loads | Project summary grid renders | PASS |
| REG-006 | Command Center loads | Role-based KPIs render | PASS |
| REG-007 | Admin Control Center loads | System health and exceptions render | PASS |
| REG-008 | Roles & Permissions loads | Permission grid with honesty notice | PASS |
| REG-009 | QM Dashboard loads | Quality data renders with active default | PASS |
| REG-010 | Engineering Dashboard loads | Engineering data renders | PASS |
| REG-011 | Execution Board loads | Active projects render | PASS |
| REG-012 | Audit logging functional | Admin actions logged | PASS |
