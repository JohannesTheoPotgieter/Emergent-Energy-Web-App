# Emergent Energy Dashboard — Frontend Consistency Audit

## Audit Date: 2026-03-06

---

## Purpose
This audit evaluates whether the app behaves consistently enough that users can trust it as the right place to work. Inconsistencies that teach users wrong habits or make the app feel unreliable are flagged.

---

## 1. Status Naming Consistency

### Finding: INCONSISTENT — Multiple status sets coexist

| Task Source | "New" | "Working" | "Finished" | "Blocked" | "Other" |
|-------------|-------|-----------|-----------|-----------|---------|
| Plan Tasks | Not Started | In Progress | Done | Blocked | — |
| Engineering | TO DO | IN PROGRESS | COMPLETE | HOLD | NEEDS APPROVAL, QC APPROVED, PROVIDE FEEDBACK |
| MyTool | inbox, planned | in_progress | done | blocked | waiting, cancelled |
| Operational | TO DO | IN PROGRESS | COMPLETE | HOLD | PROJECTS ASSISTANCE, NEEDS APPROVAL |

**Impact on Trust**: A user working across Plan and Engineering views will see "Done" on one screen and "COMPLETE" on another for the same logical state. The `normalizeStatus()` function in `my-work-tasks.tsx` bridges this gap at the view layer, but the underlying inconsistency creates confusion.

**Severity: MEDIUM** — Addressed by normalization but violates the principle of consistent user mental model.

---

## 2. Badge Rendering Consistency

### Finding: INCONSISTENT — Color mappings duplicated across components

| Component | Status Color Mapping | Badge Style |
|-----------|---------------------|-------------|
| TaskDetailDrawer | Hardcoded `statusColor` object: Done→green-100, In Progress→blue-100 | `Badge` with colored background |
| UnifiedPlanTab | `statusIcon` function using Lucide icons (CheckCircle2 for Done) | Icon-based, no colored badge |
| my-work-tasks | `PRIORITY_BADGE` mapping: critical→red-500, high→orange-500 | `Badge` with solid colored background |
| Engineering views | `StatusChip` or custom local variants | Mixed chip/badge |

**Impact on Trust**: Users learn different visual cues on different screens. "Done" is a green badge on one screen and a checkmark icon on another. Priority "High" might be orange in one place and a different shade elsewhere.

**Severity: MEDIUM** — Creates visual learning inconsistency.

**Recommendation**: Extract a shared `StatusBadge` and `PriorityBadge` component used everywhere.

---

## 3. Same Action, Same Place

### Finding: MOSTLY CONSISTENT with exceptions

| Action | Plan Tab | Engineering | My Work | MyTool |
|--------|----------|------------|---------|--------|
| Open Task Detail | Click row → Drawer | Click row → Drawer | Click row → Drawer | Click row → Drawer (separate component) |
| Edit Status | Dropdown in Drawer | Dropdown in Drawer | Dropdown in Drawer | Dropdown in Drawer |
| Edit Dates | Inline + Drawer | Drawer only | Drawer only | Drawer only |
| Delete Task | Trash icon in Drawer | Trash icon in Drawer | Trash icon in Drawer | Trash icon in Drawer |
| Assign User | User icon on row | User icon on row | N/A | N/A |
| Filter Tasks | Workstream filter | Status filter | Source/status filter | Bucket filter |

**Key Exception**: The Plan tab supports inline editing (percentage, WBS, dates directly in the grid) while other views only support editing via the drawer. This is a power-user feature but creates inconsistency — users may expect inline editing everywhere.

**Severity: LOW** — Inline editing in Plan tab is a positive power feature, not a negative inconsistency.

---

## 4. Edit/Delete/Save Patterns

### Finding: INCONSISTENT confirmation patterns

| Pattern | Where Used | Confirmation Method |
|---------|-----------|-------------------|
| Save on blur | TaskDetailDrawer title/description | Auto-save, no button |
| Save with button | Phase change modal | Explicit "Save" button |
| Delete with state toggle | Some task lists | `confirmDelete` state → "Are you sure?" text |
| Delete with AlertDialog | Other locations | Full AlertDialog component |
| Inline edit commit | Plan tab cells | Save on blur or Enter key |
| Override save | Revenue/Expenditure grids | Inline cell → auto-save override |

**Impact on Trust**: Users can't predict whether their changes will auto-save or require a button. On the Plan tab, changes auto-save on blur. In modals, they require explicit confirmation. Delete confirmation varies between simple text and full dialog.

**Severity: MEDIUM** — Users may lose data expecting auto-save where it doesn't exist, or be surprised by auto-save where they expected a "Cancel" option.

---

## 5. Loading/Error/Empty State Patterns

### Finding: INCONSISTENT

| Pattern | Implementation | Where |
|---------|---------------|-------|
| Spinner loading | `Loader2` spin animation | Most pages |
| Skeleton loading | `Skeleton` placeholders | my-work-tasks |
| EnergyLoader | Custom branded loader | Sporadic |
| No loading indicator | Immediate render | Some tabs |
| Error toast | `useToast` notification | Mutations |
| Inline error | Text message in card | Some queries |
| Error boundary | Global catch | App level |
| Empty state component | `empty.tsx` component | Available but inconsistently used |
| Inline "No data" text | Plain text | Most tabs |

**Impact on Trust**: When a page is loading, users see different feedback depending on which page they're on. Some pages show a branded energy loader, others show a generic spinner, and some just show nothing. Empty states range from a designed component to a plain "No data available" string.

**Severity: LOW-MEDIUM** — Doesn't break functionality but creates an inconsistent feel.

---

## 6. Naming/Terminology Consistency

### Finding: INCONSISTENT — Dual terminology in use

| Concept | Term 1 | Term 2 | Where |
|---------|--------|--------|-------|
| Money coming in | Revenue | Inflows | UI tab titles vs. API (`program_inflows`) |
| Money going out | Expenditure | COS (Cost of Sales) | UI tabs vs. Finance views |
| Task collection | My Work | MyTool | Different pages, different scopes |
| Task grouping | Workstream | Primary Workstream | Plan tasks vs. Operational tasks |
| Project progress | % Complete | Percent Complete | Plan tab inline vs. Drawer field name |

**Impact on Trust**: Users may not realize "Inflows" in the database/import context is the same as "Revenue" in the UI. "Expenditure" tab and "COS Tracker" both show cost data but use different terms. "My Work" shows all assigned tasks while "MyTool" shows only personal tasks — the distinction isn't immediately clear.

**Severity: MEDIUM** — Creates cognitive overhead for new users.

---

## 7. Filter Behavior Consistency

### Finding: MOSTLY CONSISTENT

| View | Filter Type | Persistence | Clear All |
|------|------------|------------|-----------|
| Plan Tab | Workstream dropdown | Session | Reset on navigation |
| Engineering | Status tabs | Session | Click "All" tab |
| My Work | Source/status pills | Session | Click "All" |
| MyTool | Bucket selector | Session | Click "All" |
| Financial | Project selector | Session | Clear selection |
| Cashflow | Multi-select project | Session | Clear all |

All filters reset on navigation (no persistent filter state). This is consistent but could frustrate users who navigate away and return.

**Severity: LOW**

---

## 8. Permission Cues

### Finding: CONSISTENT

Permission gating follows a clear pattern:
- Sidebar items hidden for unauthorized roles
- Routes return access denied or redirect
- Admin endpoints return 403 for non-admin
- Entity-level permissions control view/edit/approve/delete separately

The user always knows what they can see and what they can't. Hidden items don't show confusing "Access Denied" states — they simply don't appear.

**Severity: NONE** — Well implemented.

---

## 9. Task Detail Drawer Expectations

### Finding: TWO DIFFERENT DRAWERS

| Feature | Main TaskDetailDrawer | MyTool TaskDetailDrawer |
|---------|----------------------|------------------------|
| Location | `TaskDetailDrawer.tsx` | `mytool/TaskDetailDrawer.tsx` |
| Status options | Done/Not Started/In Progress/Blocked | inbox/planned/in_progress/blocked/waiting/done/cancelled |
| Unique fields | Workstream, WBS, % complete, assignees, deliverables, activity log | Next Step, Definition of Done, Completion Note, bucket, recurrence |
| Comments | Yes (activity log) | Limited |
| Attachments | Yes (deliverables) | No |

Users working with both plan tasks and personal tasks encounter two different drawer experiences. The structure is similar (title, status, description, dates) but the details differ significantly.

**Severity: LOW** — Different task types legitimately need different fields. The UX pattern (drawer opening from right) is consistent.

---

## 10. Overall Trust Assessment

### Trust-Building Patterns (Positive)
1. **Permission gating is consistent** — users always see what they're allowed to
2. **Drawer pattern is universal** — click a task, get a drawer, regardless of source
3. **Financial override system is visible** — blue dots mark manual changes
4. **Save feedback is clear** — toast notifications confirm mutations
5. **Error messages are actionable** — validation errors explain what's wrong

### Trust-Undermining Patterns (Negative)
1. **Status naming fragmentation** — same logical state has different names across views
2. **Badge/color inconsistency** — same status has different visual representation
3. **Terminology duplication** — Revenue/Inflows, Expenditure/COS, My Work/MyTool
4. **Auto-save unpredictability** — some fields auto-save, some need buttons
5. **Delete confirmation varies** — sometimes a dialog, sometimes inline text
6. **Loading states differ** — spinner vs skeleton vs branded loader vs nothing

---

## Summary

| Area | Rating | Impact |
|------|--------|--------|
| Status Naming | INCONSISTENT | MEDIUM |
| Badge Rendering | INCONSISTENT | MEDIUM |
| Action Placement | MOSTLY CONSISTENT | LOW |
| Save Patterns | INCONSISTENT | MEDIUM |
| Loading/Error/Empty | INCONSISTENT | LOW-MEDIUM |
| Terminology | INCONSISTENT | MEDIUM |
| Filter Behavior | MOSTLY CONSISTENT | LOW |
| Permission Cues | CONSISTENT | NONE |
| Task Detail | TWO VARIANTS | LOW |

**Overall Frontend Consistency: PARTIALLY CONSISTENT**

The app has strong structural patterns (drawers, permission gating, navigation) but inconsistent micro-patterns (status names, badge colors, save behavior, terminology). Users can learn to navigate the app effectively, but the inconsistencies add cognitive load and may reduce confidence in the system as a single source of truth.

**Recommendation Priority:**
1. **HIGH**: Unify status naming across all task types (single normalized enum displayed everywhere)
2. **HIGH**: Standardize terminology (pick "Revenue" or "Inflows", not both)
3. **MEDIUM**: Extract shared badge/chip components for status and priority
4. **MEDIUM**: Standardize delete confirmation to always use AlertDialog
5. **LOW**: Standardize loading states (pick one pattern)
