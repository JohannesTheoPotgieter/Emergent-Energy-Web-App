# Full Pre-Go-Live Operational Review

## Date: 2026-03-06
## System: Emergent Energy Dashboard v1
## Reviewer: Agent (automated)
## Purpose: Pre-go-live hardening review across all execution surfaces

---

## 1. Scope of Review

10 tasks covering:
- T001: My Work default filtering & prioritisation
- T002: My Work filter architecture & screen density
- T003: Task routing & ownership logic
- T004: Project routing & state logic
- T005: Role-based default views & Command Center
- T006: Permissions UI truthfulness
- T007: Archive/closed/completed handling consistency
- T008: Admin control & governance — exception dashboard
- T009: Cross-module consistency pass
- T010: Full QA & documentation

## 2. Review Findings

### 2.1 My Work Execution Surface (T001 + T002)
**Before**: Default sort was priority/asc, completed tasks shown alongside active, 4th KPI card showed "Completed" count, no urgency quick-filters.

**After**:
- Default sort changed to `dueDate/asc` with urgency-first tiebreaker (overdue > blocked > then sortField)
- Completed/cancelled/done tasks hidden by default; "Show Done" toggle added
- 4th KPI card replaced: "Completed" → "Due This Week" (with today count sub-metric)
- Urgency quick-filter buttons added: Overdue, Due 7d, Blocked — separated from source tabs
- Filter summary bar updated with new filter badges
- Clear-all includes all new filter types
- Source tab spacing tightened for density

### 2.2 Task Routing & Ownership (T003)
**Finding**: Task routing already follows ownership via user-scoped `/api/my-work/all-tasks` endpoint. Tasks with no assignee now surface in COO/Admin/Program Manager KPIs as "Unassigned" metric.

**Changes**:
- Command Center: COO/Admin and Program Manager roles now see "Unassigned" KPI card when unassigned tasks exist
- Normalised task status function extracted to module level for reuse

### 2.3 Project Routing & State (T004)
**Before**: Projects sorted by selected field only, no ownership priority. PM column showed "Unassigned" plainly.

**After**:
- Projects owned by the current user sort first in the project list
- PM dropdown shows "No PM" in red when no PM is assigned
- Active/archived tab split already existed (confirmed working)

### 2.4 Role-Based Command Center (T005)
**Before**: All roles saw the same core KPIs (My Tasks, Overdue, Blocked). COO/Admin saw Active Projects + Revenue/COS.

**After**: COO/Admin and Program Manager now see an "Unassigned" KPI when unassigned tasks exist. Role-specific KPIs remain for each category. Quick links are role-appropriate.

### 2.5 Permissions UI Truthfulness (T006)
**Before**: Single info box explaining "how it works" for sidebar navigation toggles. No distinction between what permissions are enforced vs UI-level.

**After**: Added "Permission Scope" notice explaining:
- Navigation access: fully enforced (sidebar + route blocking)
- Entity permissions: mostly UI-level visibility controls
- Row-level ownership scoping: handled by application logic, not configurable here

### 2.6 Archive Handling Consistency (T007)
**Review of existing state**:
| Page | Handling | Status |
|---|---|---|
| My Work | Now hides completed by default (new) | Fixed |
| Engineering Dashboard | Filters completed/cancelled from priorities | OK |
| QM Dashboard | Had statusFilter default "all" | Fixed → defaults to "active" |
| Execution Board | Only shows archivedStatus=ACTIVE | OK |
| Lifecycle Board | Filters ARCHIVED_MERGED and non-ACTIVE | OK |
| PM Dashboard | Shows aggregate counts including done | OK (dashboard view) |
| Projects | Active/Archived tabs | OK |

### 2.7 Admin Exception Dashboard (T008)
**New**: Operational Exceptions section added to Admin Control Center:
- Backend endpoint: `GET /api/admin/control-center/operational-exceptions`
- Queries: unassigned tasks, projects without PM, blocked items, overdue by owner
- Frontend: 4 exception metric cards (colour-coded) + overdue-by-owner breakdown
- All queries use `Promise.all` for performance

### 2.8 Cross-Module Consistency (T009)
**Verified consistent across modules**:
- Status colours: blocked=red-500, complete=emerald-500, in_progress=blue-500, review=amber-500, cancelled=slate-300
- Due date handling: consistent `differenceInCalendarDays` / `parseISO` pattern
- Status normalisation: consistent across My Work, Command Center, Engineering
- Badge styling: consistent variant and colour usage

## 3. Summary

| Area | Changes | Risk |
|---|---|---|
| My Work defaults | High impact, better UX | Low |
| Filter architecture | Medium, better density | Low |
| Task routing | Low touch, KPI addition | Low |
| Project routing | Sort + visual flag | Low |
| Command Center | KPI enhancement | Low |
| Permissions UI | Honesty notice | Low |
| Archive handling | QM default changed | Low |
| Admin exceptions | New section + endpoint | Low |
| Cross-module | Verification only | None |
