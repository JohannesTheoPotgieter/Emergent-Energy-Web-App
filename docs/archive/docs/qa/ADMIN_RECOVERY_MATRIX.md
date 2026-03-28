# ADMIN RECOVERY MATRIX

**Date:** 2026-03-19
**Product Principle:** "Users should learn that if something must be done correctly, it should be done through the app front end, and admins should be able to correct normal operational mistakes through the UI."

---

## Recovery Scenarios

### REC-01: Wrong Project Linkage

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | A task or cost line is linked to the wrong project |
| **Recoverable via UI?** | PARTIALLY |
| **UI Path** | Operational tasks: Edit task → change project assignment. Cost lines: ExpenditureEditableTab allows inline field editing. Smart Import: rollback + re-import with correct project assignment |
| **Limitation** | Work items from Smart Import can only be re-linked via rollback + re-import. No direct "move to different project" action on work_items |
| **Recommended Fix** | Add "Move to Project" action for work_items in task management UI |

---

### REC-02: Wrong Assignee

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Task assigned to wrong person |
| **Recoverable via UI?** | YES |
| **UI Path** | TaskDetailDrawer → click assignee field → select correct user from picker. For engineering tasks: inline assignee dropdown in EngTasksTab. For project PD/PM: ProjectCommandHeader → click PD/PM name → user picker |
| **Limitation** | None |
| **Recommended Fix** | N/A — fully recoverable |

---

### REC-03: Wrong Viewer

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Wrong person added as viewer to a task |
| **Recoverable via UI?** | YES |
| **UI Path** | TaskDetailDrawer → viewer section → remove viewer (sets `active=false` in `entity_assignments`) → add correct viewer |
| **Limitation** | None — entity_assignments supports active/cleared states |
| **Recommended Fix** | N/A |

---

### REC-04: Wrong Task Type

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Task created as operational when it should be engineering, or vice versa |
| **Recoverable via UI?** | NO |
| **UI Path** | No "convert task type" feature exists. User must manually create new task of correct type and delete the old one |
| **Limitation** | Different task types live in different tables (`operational_tasks` vs `engineering_tasks` vs `work_items`). No cross-table migration UI |
| **Recommended Fix** | Add "Convert Task Type" action or at minimum document the manual recreation workflow |

---

### REC-05: Wrong Due Date

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Task has incorrect due date |
| **Recoverable via UI?** | YES |
| **UI Path** | TaskDetailDrawer → date picker → update due date. For plan tasks: UnifiedPlanTab → inline date editing or drag-resize on Gantt. For engineering tasks: inline date field in EngTasksTab |
| **Limitation** | None |
| **Recommended Fix** | N/A |

---

### REC-06: Wrong Status

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Task marked as "Done" when it's still in progress |
| **Recoverable via UI?** | YES |
| **UI Path** | TaskDetailDrawer → status dropdown → select correct status. For engineering tasks: inline status dropdown. For quality items: QualityTab item status update. Status history tracked via `work_item_status_history` |
| **Limitation** | Approval-based statuses (QC_APPROVED, OPERATIONAL_APPROVAL) may have one-way transitions enforced by `task-workflow-guard.ts` |
| **Recommended Fix** | Ensure admin override for approval status reversals |

---

### REC-07: Wrong Workstream

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Work item created in wrong workstream (e.g., PM instead of ENG) |
| **Recoverable via UI?** | PARTIALLY |
| **UI Path** | For work_items: depends on whether workstream field is editable in TaskDetailDrawer. For engineering tasks: taskTypeTag field may be editable |
| **Limitation** | Workstream determines which tab the task appears in. Changing workstream may make task "disappear" from current view without clear indication of where it went |
| **Recommended Fix** | Add workstream edit with destination preview |

---

### REC-08: Duplicate Task

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Same task created twice |
| **Recoverable via UI?** | PARTIALLY |
| **UI Path** | Delete one of the duplicates. For operational tasks: delete button in TaskDetailDrawer (hard delete). For engineering tasks: delete via EngTasksTab (soft delete). For work items: soft delete |
| **Limitation** | Operational task deletion is HARD DELETE — no undo. If wrong duplicate deleted, the original data is lost |
| **Recommended Fix** | Convert operational task delete to soft delete, or add confirmation with task detail preview |

---

### REC-09: Mistaken Delete

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | User accidentally deletes a task |
| **Recoverable via UI?** | DEPENDS ON TASK TYPE |
| **UI Path** | Engineering tasks: `softDeletedAt` set — theoretically recoverable but no "restore" UI exists. MyTool tasks: `deletedAt` set — same issue. Work items: `deletedAt` set — same. Operational tasks: HARD DELETED — **NOT recoverable** |
| **Limitation** | No "trash" or "recently deleted" feature in the UI. Soft-deleted records exist in DB but are invisible to all queries |
| **Recommended Fix** | Add Recovery Center for soft-deleted items. Convert operational task delete to soft delete |

---

### REC-10: Failed Import Run

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Smart Import commit fails mid-execution |
| **Recoverable via UI?** | PARTIALLY |
| **UI Path** | Re-upload the file and re-import. Failed run shows as FAILED status in import history. User can start fresh import |
| **Limitation** | If failure occurred after delete-before-insert, project data may be temporarily empty. No automatic recovery of pre-import state |
| **Recommended Fix** | Wrap commit in a single database transaction for atomicity |

---

### REC-11: Bad Import-Created Row

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Import created a cost line with wrong amount or wrong supplier |
| **Recoverable via UI?** | YES |
| **UI Path** | ExpenditureEditableTab → inline edit the row. RevenueTrackingTab → inline edit milestones. Changes saved as manual edits, preserved on re-import if user selects `preserveManualEdits=true` |
| **Limitation** | None for individual field corrections. Structural issues (wrong project assignment) require rollback + re-import |
| **Recommended Fix** | N/A for field edits. Add row-level "unlink from import" option for structural issues |

---

### REC-12: Wrong Project Field

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Project has wrong contract value, wrong size_kwp, or wrong phase |
| **Recoverable via UI?** | YES |
| **UI Path** | Phase: ProjectCommandHeader → Phase Change button → modal with reason field + audit trail. PD/PM: click name → user picker. Size/contract value: via admin project edit or Smart Import re-import |
| **Limitation** | Some project_info fields (size_kwp, contract_value) may not have direct inline edit — only via import or admin tools |
| **Recommended Fix** | Add inline edit for size_kwp and contract_value in ProjectCommandHeader |

---

### REC-13: Wrong Reporting Input Record

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | A revenue milestone has wrong amount, affecting GP calculations |
| **Recoverable via UI?** | YES |
| **UI Path** | Commercial tab → Inflows → inline edit milestone amount. Manual edits stored in `revenue_milestone_manual` table |
| **Limitation** | Client-side KPIs recompute on next data fetch. No explicit "recalculate" button |
| **Recommended Fix** | N/A — auto-updates on data change |

---

### REC-14: Hidden Task Due to Bad Filter State

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | Task exists but user can't find it because filters hide it |
| **Recoverable via UI?** | YES |
| **UI Path** | Clear all filters. UnifiedPlanTab has filter/search. BoardView shows all status columns. EngTasksTab has status/priority/phase filters with clear action |
| **Limitation** | No "show all tasks including filtered" toggle. User must know to clear filters |
| **Recommended Fix** | Add "X tasks hidden by filters" indicator with "show all" link |

---

### REC-15: Role/Permission Mismatch

| Attribute | Detail |
|-----------|--------|
| **Mistake Scenario** | User has wrong role or missing permission for a feature |
| **Recoverable via UI?** | YES (admin only) |
| **UI Path** | Admin → Users & Roles (`/admin/roles`) → edit user role. Permission overrides via `userPermissionOverrides` table. Entity-level permission overrides via role configuration |
| **Limitation** | Only COO_ADMIN and CEO_ADMIN can modify roles. No self-service role request |
| **Recommended Fix** | N/A — admin control is appropriate for security |

---

## Summary

| Scenario | Recoverable via UI? | Risk Level |
|----------|---------------------|------------|
| REC-01: Wrong project linkage | PARTIALLY | MEDIUM |
| REC-02: Wrong assignee | YES | LOW |
| REC-03: Wrong viewer | YES | LOW |
| REC-04: Wrong task type | **NO** | HIGH |
| REC-05: Wrong due date | YES | LOW |
| REC-06: Wrong status | YES | LOW |
| REC-07: Wrong workstream | PARTIALLY | MEDIUM |
| REC-08: Duplicate task | PARTIALLY | MEDIUM |
| REC-09: Mistaken delete | **DEPENDS** | HIGH (operational tasks) |
| REC-10: Failed import run | PARTIALLY | HIGH |
| REC-11: Bad import-created row | YES | LOW |
| REC-12: Wrong project field | YES | LOW |
| REC-13: Wrong reporting input | YES | LOW |
| REC-14: Hidden task (filters) | YES | LOW |
| REC-15: Role/permission mismatch | YES (admin) | LOW |

### Not Fixable Through UI (Must Be Flagged)

1. **Wrong task type** — no cross-table task type conversion
2. **Accidentally deleted operational task** — hard delete, no recovery
3. **Soft-deleted items** — exist in DB but no restore UI
4. **Failed import partial data loss** — no transaction atomicity guarantee

### Product Principle Verdict: PARTIALLY MET

9 of 15 scenarios are fully recoverable via UI. 4 are partially recoverable. 2 have significant gaps (task type conversion, operational task hard delete). The principle is substantially met for day-to-day operations but has gaps for less common but impactful mistakes.
