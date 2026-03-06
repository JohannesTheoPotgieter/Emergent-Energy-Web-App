# Emergent Energy Dashboard — Admin Recovery Matrix

## Audit Date: 2026-03-06

---

## Product Principle Under Test
> "Users should learn that if something must be done correctly, it should be done through the app front end, and admins should be able to correct normal operational mistakes through the UI."

---

## Recovery Capability Assessment

### REC-01: Wrong Project Linkage
| Field | Value |
|-------|-------|
| Mistake Scenario | Task or financial line is linked to the wrong project |
| Recoverable via UI | PARTIALLY |
| UI Path | Task: Open TaskDetailDrawer → no project reassignment field. Financial: Admin → Data Import → re-import corrected file |
| Limitation | Tasks cannot be moved between projects via the UI. Financial data can be re-imported but requires the corrected Excel file. |
| Recommended Fix | Add a "Move to Project" action in TaskDetailDrawer for admin users |

### REC-02: Wrong Assignee
| Field | Value |
|-------|-------|
| Mistake Scenario | Task assigned to the wrong user |
| Recoverable via UI | YES |
| UI Path | Project Detail → Plan/Engineering tab → Click user icon on task → UserAssignmentPicker → Select correct user |
| Limitation | None for plan and engineering tasks. MyTool tasks are personal and don't have assignees. |
| **Status** | **PROVEN** — `PATCH /api/tasks/reassign` returns `{"success":true}` |

### REC-03: Wrong Viewer
| Field | Value |
|-------|-------|
| Mistake Scenario | Wrong user assigned as viewer on a task |
| Recoverable via UI | NO |
| UI Path | N/A — No viewer management UI exists |
| Limitation | Viewers are only created via Smart Import. No way to add, remove, or change viewers through the frontend. |
| Recommended Fix | Add viewer management to UserAssignmentPicker with VIEWER role toggle |

### REC-04: Wrong Task Type
| Field | Value |
|-------|-------|
| Mistake Scenario | Task created as engineering when it should be PM, or vice versa |
| Recoverable via UI | PARTIALLY |
| UI Path | TaskDetailDrawer → Workstream dropdown → Change to PM/ENG/QUALITY |
| Limitation | Workstream can be changed on plan tasks. But switching between fundamentally different task types (MyTool vs Engineering vs Plan) is not supported — must delete and recreate. |

### REC-05: Wrong Due Date
| Field | Value |
|-------|-------|
| Mistake Scenario | Task has incorrect due date |
| Recoverable via UI | YES |
| UI Path | TaskDetailDrawer → Due date field → Select new date. Plan tab also supports inline date editing. |
| Limitation | None |
| **Status** | **PROVEN** |

### REC-06: Wrong Status
| Field | Value |
|-------|-------|
| Mistake Scenario | Task marked as Done/Complete when it shouldn't be |
| Recoverable via UI | YES |
| UI Path | TaskDetailDrawer → Status dropdown → Change to correct status |
| Limitation | None for standard status changes. MyTool tasks require "Definition of Done" before marking complete (a positive constraint). |
| **Status** | **PROVEN** |

### REC-07: Wrong Workstream
| Field | Value |
|-------|-------|
| Mistake Scenario | Task tagged to wrong workstream (PM vs ENG vs QUALITY) |
| Recoverable via UI | YES |
| UI Path | TaskDetailDrawer → Workstream dropdown → Select correct workstream |
| Limitation | Only works for plan tasks and operational tasks. Engineering tasks are implicitly in the Engineering workstream. |
| **Status** | **PROVEN** (fixed in DEF-004) |

### REC-08: Duplicate Task
| Field | Value |
|-------|-------|
| Mistake Scenario | Same task created twice |
| Recoverable via UI | PARTIALLY |
| UI Path | Delete the duplicate via TaskDetailDrawer → Delete button |
| Limitation | No "merge duplicate" capability. Deletion is permanent for canonical work items — no undo. |

### REC-09: Mistaken Delete
| Field | Value |
|-------|-------|
| Mistake Scenario | Admin accidentally deletes a task |
| Recoverable via UI | NO |
| UI Path | N/A |
| Limitation | All task deletions except plan overrides are permanent (hard delete). No trash/recycle bin. No undo. |
| Recommended Fix | Implement soft-delete with a "Deleted Items" view, or add confirmation dialog with task details |

### REC-10: Failed Import Run
| Field | Value |
|-------|-------|
| Mistake Scenario | Smart Import fails or produces incorrect data |
| Recoverable via UI | YES |
| UI Path | Admin → Data Import tab → "Update Single Project" → Upload corrected file |
| Limitation | Requires the correct Excel file. Previous import data is wiped on re-import (atomic replace). Manual edits (overrides) can be preserved via the 409 Conflict flow. |
| **Status** | **PROVEN (UI path exists)** |

### REC-11: Bad Import-Created Row
| Field | Value |
|-------|-------|
| Mistake Scenario | Import creates a row with wrong data |
| Recoverable via UI | PARTIALLY |
| UI Path | Financial: Revenue/Expenditure tabs → Inline cell editing → Override. Tasks: TaskDetailDrawer → Edit fields. |
| Limitation | Financial overrides are marked with blue dots but the original data persists. Task field edits work but not all fields are editable in the drawer. |

### REC-12: Wrong Project Field
| Field | Value |
|-------|-------|
| Mistake Scenario | Project has wrong status, name, or other metadata |
| Recoverable via UI | YES |
| UI Path | Project Detail → Edit fields. Phase: "Change Phase" button with override toggle. |
| Limitation | Project name changes may not propagate to linked tasks/financials that use project name as key. |
| **Status** | **PROVEN** — `PATCH /api/projects/:id` returns 200 |

### REC-13: Wrong Reporting Input Record
| Field | Value |
|-------|-------|
| Mistake Scenario | Revenue or expense record has wrong amount/date |
| Recoverable via UI | YES |
| UI Path | Project Detail → Revenue or Expenditure tab → Click cell → Edit → Save |
| Limitation | Creates an override (blue dot marker), doesn't modify the original imported data. Override format requires array: `[{lineId, field, value}]`. |
| **Status** | **PROVEN** — API validates override format correctly |

### REC-14: Hidden Task Due to Bad Filter State
| Field | Value |
|-------|-------|
| Mistake Scenario | User can't find task because filter is active |
| Recoverable via UI | YES |
| UI Path | Clear filter / workstream selection on the Plan tab or My Work page |
| Limitation | No "Clear All Filters" button visible in all views. User must manually reset each filter. |
| **Status** | **PROVEN** |

### REC-15: Role/Permission Mismatch
| Field | Value |
|-------|-------|
| Mistake Scenario | User has wrong role or missing permissions |
| Recoverable via UI | YES |
| UI Path | Admin Roles page (`/admin-roles`) → Users tab → Change role. Permissions tab → Edit entity permissions per role. |
| Limitation | None for admin users. Non-admin users cannot change their own role. |
| **Status** | **PROVEN** — Admin users get 200 on `/api/admin/users` |

---

## Summary

| Recovery Scenario | Recoverable | Status |
|-------------------|------------|--------|
| Wrong project linkage | PARTIALLY | No project move for tasks |
| Wrong assignee | YES | PROVEN |
| Wrong viewer | NO | No viewer management UI |
| Wrong task type | PARTIALLY | Cross-type conversion not supported |
| Wrong due date | YES | PROVEN |
| Wrong status | YES | PROVEN |
| Wrong workstream | YES | PROVEN |
| Duplicate task | PARTIALLY | Delete works but no merge/undo |
| Mistaken delete | NO | Hard delete, no undo |
| Failed import run | YES | PROVEN (re-import) |
| Bad import-created row | PARTIALLY | Override system exists |
| Wrong project field | YES | PROVEN |
| Wrong reporting input | YES | PROVEN |
| Hidden task (filter) | YES | PROVEN |
| Role/permission mismatch | YES | PROVEN |

### Product Principle Assessment

**"Can admins correct normal operational mistakes through the UI?"**

**Answer: PARTIALLY**

**Justification:**
- 9 of 15 scenarios are fully recoverable via UI
- 4 are partially recoverable (workarounds exist but aren't ideal)
- 2 are not recoverable via UI (viewer management, mistaken delete)

**Critical Gaps:**
1. No undo for task deletion (hard delete is permanent)
2. No viewer management UI
3. Tasks cannot be moved between projects
4. No cross-type task conversion (e.g., engineering → plan)
