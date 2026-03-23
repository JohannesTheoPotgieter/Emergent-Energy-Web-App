# FRONTEND CONSISTENCY AUDIT

**Date:** 2026-03-19
**Scope:** UI behavioral consistency across the Project Detail page and task management subsystems
**Standard:** "The app behaves consistently enough that users can trust it as the right place to work"

---

## 1. TASK MODEL CONSISTENCY AUDIT

### 1.1 Status Naming Consistency

| Task Type | Status Values | Format | Consistent? |
|-----------|--------------|--------|-------------|
| **Operational Tasks** | "TO DO", "In Progress", "Blocked", "Done", "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "COMPLETE" | Mixed case | NO |
| **MyTool Tasks** | inbox, planned, in_progress, blocked, waiting, done, cancelled | lowercase_snake | NO (different from operational) |
| **Work Items** | "Not Started", "In Progress", "Complete", "Delayed" (from taskStatusEnum) | Title Case | NO (different from both above) |
| **Engineering Tasks** | NOT_STARTED, IN_PROGRESS, COMPLETE, ON_HOLD | UPPER_SNAKE | NO (different casing again) |
| **Quality Items** | not_started, in_progress, review, approved | lowercase_snake | NO (similar to MyTool but different values) |
| **Engineering Stages** | "complete", "in_progress", "not_started" | lowercase_snake | Note: "complete" vs "COMPLETE" in board |

**Finding:** 5 different status naming conventions across 5 task types. A user working across task types will encounter inconsistent status labels, styles, and capitalization.

**Trust Impact:** HIGH — Users cannot build reliable mental model of "what statuses mean" across the app.

---

### 1.2 Status Badge Consistency

| Task Type | Badge Location | Badge Style |
|-----------|---------------|-------------|
| **Operational** | TaskDetailDrawer, BoardView | Colored badges: `bg-blue-100 text-blue-700` for "IN PROGRESS", etc. Defined in `project-detail.tsx:252-257` |
| **Engineering** | EngTasksTab inline | Same badge color map used (`STATUS_BADGE` object at `project-detail.tsx:252-257`) |
| **Plan Tasks** | UnifiedPlanTab | Progress bar (0-100%) rather than status badge |
| **Quality** | QualityTab | Status-specific styling (not_started=gray, in_progress=blue, review=amber, approved=green) |
| **MyTool** | MyWorkTasksPage | Different badge component with status-specific colors |

**Finding:** Badge rendering is not shared across task types. Each component defines its own color mapping.

**Trust Impact:** MEDIUM — Visual inconsistency but functionally clear.

---

### 1.3 Delete Behavior Consistency

| Task Type | Delete Method | Undo Available? | Confirmation Dialog? |
|-----------|-------------|-----------------|---------------------|
| **Operational** | Hard delete (removes record) | NO | Yes (confirm dialog) |
| **MyTool** | Soft delete (`deletedAt` timestamp) | NO (no restore UI) | Yes |
| **Work Items** | Soft delete (`deletedAt` timestamp) | NO (no restore UI) | Yes |
| **Engineering** | Soft delete (`softDeletedAt`) | NO (no restore UI) | Yes (`deleteConfirmId` state) |
| **Plan (baseline)** | Soft delete via override (`deletedFlag=1`) | NO (no restore UI) | Yes |
| **Quality** | Cascade delete (parent checklist) | NO | Yes |

**Finding:** Operational tasks are the only type using hard delete. All others use soft delete but none provide a "restore" mechanism. Users cannot undo any deletion regardless of method.

**Trust Impact:** HIGH — Inconsistent deletion semantics. Users may expect "undo" for accidentally deleted tasks.

---

### 1.4 Field Consistency Across Task Types

| Field | Operational | MyTool | Work Items | Engineering | Quality |
|-------|------------|--------|------------|-------------|---------|
| **Title** | `title` | `title` | `title` | `title` | via `qcTemplateItem.name` |
| **Description** | `description` | `notes` | `description` | `description` | via template |
| **Status** | `status` (text) | `status` (enum) | `status` (text) | `status` (enum) | `qmStatus` (text) |
| **Priority** | `priority` (text) | `priority` (enum) | `priority` (text) | N/A | N/A |
| **Due Date** | `dueDate` | `dueAt` (timestamp) | `endDate` | `dueDate` | `endDate` |
| **Assignee** | `ownerUserId` + `assigneeUserIds[]` | `ownerUserId` | via `workItemAssignments` | `assigneeUserId` | `assigneeUserId` |
| **% Complete** | `percentComplete` | N/A | `percentComplete` | N/A | N/A (binary approved/not) |
| **Parent** | `parentTaskId` | N/A | `parentId` | N/A | `checklistId` |
| **Watchers** | `watchers[]` | N/A | via `workItemAssignments` (VIEWER role) | N/A | N/A |

**Finding:** Assignment model varies significantly — arrays vs FK vs join table. Due date field naming is inconsistent (`dueDate` vs `dueAt` vs `endDate`). Priority exists for some types, not others.

**Trust Impact:** MEDIUM — Different mental models required for different task types.

---

### 1.5 Task Detail Drawers

| Task Type | Component | Features |
|-----------|-----------|----------|
| **Operational** | `TaskDetailDrawer.tsx` | Comments, checklists, attachments, deliverables, activity log, dependencies, blocking reasons |
| **MyTool** | `mytool/TaskDetailDrawer.tsx` | Notes, next step, definition of done, completion note, dependencies, recurring settings |
| **Engineering** | Inline expand in `EngTasksTab` | Basic fields only — status, priority, assignee, dates. No comments/attachments |
| **Quality** | Inline in `QualityTab` | Evidence upload, approval workflow, risk assessment |
| **Plan Tasks** | Inline in `UnifiedPlanTab` + optional TaskDetailDrawer | Date editing, progress, Gantt visualization |

**Finding:** Two full-featured task detail drawers exist (operational and MyTool) with different feature sets. Engineering and quality tasks have inline editing only — no comparable drawer experience.

**Trust Impact:** MEDIUM — Users accustomed to rich task detail in operational tasks may expect the same for engineering tasks.

---

### 1.6 Visibility Rules

| Task Type | Who Can See? | Filter Mechanism |
|-----------|-------------|-----------------|
| **Operational** | Owner, assignees, watchers, admins | `projectName` + assignee match |
| **MyTool** | Owner only | `ownerUserId` match |
| **Work Items** | Anyone with project view permission | `projectId` + permission check |
| **Engineering** | Anyone with engineering view permission | `projectId` + `pd_eng_tasks:view` |
| **Quality** | Anyone with quality view permission | `projectName` + `pd_quality:view` |

**Finding:** Visibility rules are role/permission-based for most types but owner-only for MyTool tasks. Consistent with intent (personal vs project tasks).

**Trust Impact:** LOW — Aligned with business logic.

---

## 2. NAMING CONSISTENCY

### 2.1 Tab Labels

| Section | Sub-Tab Key | Display Label | Consistent Pattern? |
|---------|------------|--------------|---------------------|
| Delivery | task-grid | "Plan" | OK |
| Delivery | board | "Board" | OK |
| Delivery | calendar | "Calendar" | OK |
| Delivery | raid | "RAID" | OK (acronym) |
| Delivery | commissioning | "Commissioning" | OK |
| Commercial | revenue-tracking | "Inflows" | INCONSISTENT — key says "revenue-tracking" but label says "Inflows" |
| Commercial | expenditure | "COS / Costs" | INCONSISTENT — dual name may confuse |
| Commercial | monthly-realisation | "COS Tracker" | INCONSISTENT — key says "monthly-realisation" but label says "COS Tracker" |
| Commercial | revenue-tracker | "Revenue" | OK |
| Commercial | gp-tracker | "GP" | OK (abbreviation) |
| Commercial | cashflow | "Cashflow" | OK |
| Commercial | procurement | "Procurement" | OK |
| Commercial | change-control | "Changes" | OK (shortened) |
| Commercial | subcontractors | "Subs" | OK (shortened) |
| Collaboration | chat | "Comms" | INCONSISTENT — key says "chat" but label says "Comms" |
| Collaboration | history | "Audit" | INCONSISTENT — key says "history" but label says "Audit" |

**Finding:** Several tab keys don't match their display labels. This creates confusion when URLs contain tab keys (e.g., `?tab=revenue-tracking` but user sees "Inflows").

**Trust Impact:** LOW — Users don't typically see URL params, but developers maintaining the code may be confused.

---

### 2.2 Section vs Tab Naming

| Major Tab | Display Label | Internal Key |
|-----------|--------------|--------------|
| Tab 1 | "Delivery" | `delivery` |
| Tab 2 | "Commercial" | `commercial` |
| Tab 3 | "Engineering" | `engineering` |
| Tab 4 | "Quality" | `quality` |
| Tab 5 | "Records" | `collaboration` |

**Finding:** Tab 5 displays as "Records" but internal key is `collaboration`. `SECTION_DEFAULT_SUBTAB` uses `collaboration` key.

**Trust Impact:** LOW — Internal naming inconsistency, not user-facing.

---

## 3. EDIT/SAVE PATTERN CONSISTENCY

| Area | Edit Pattern | Save Mechanism | Feedback |
|------|-------------|----------------|----------|
| **Task status** | Inline dropdown | Immediate PATCH on change | Toast notification |
| **Task fields** | TaskDetailDrawer form | Save button or auto-save | Toast notification |
| **Revenue milestones** | Inline table editing | Save button per row | Toast notification |
| **Cost lines** | Inline table editing | Save button per row | Toast notification |
| **Plan tasks (Gantt)** | Drag-and-drop + inline edit | Auto-save on interaction | No explicit feedback |
| **Quality items** | Inline status + approval dialog | Button actions | Toast notification |
| **Phase change** | Modal dialog | Explicit "Update Phase" button | Toast notification |
| **RAG status** | Dialog with comment | Explicit save button | Toast notification |
| **PD/PM assignment** | Inline picker | Auto-save on selection | Toast notification |

**Finding:** Mix of auto-save (plan tasks, PD/PM assignment) and explicit-save (phase change, financials). Most actions provide toast feedback. Gantt drag-and-drop lacks explicit save confirmation.

**Trust Impact:** MEDIUM — Users may not know if Gantt changes are saved.

---

## 4. FILTER BEHAVIOR CONSISTENCY

| Component | Filter Type | Reset Available? | Persistence |
|-----------|------------|-----------------|-------------|
| **UnifiedPlanTab** | Search + column filters | Yes (clear button) | Session only |
| **EngTasksTab** | Status, priority, phase dropdowns | Yes (clear filters) | Session only |
| **BoardView** | Kanban columns (status-based) | N/A (columns are the filter) | N/A |
| **CalendarView** | Month navigation | N/A | Session only |
| **Commercial tabs** | Varies per tab | Varies | Session only |
| **Quality tab** | Phase-based grouping | N/A | N/A |

**Finding:** Filters are not persisted across navigation. Returning to a tab resets all filters. No "X items hidden by filters" indicator.

**Trust Impact:** MEDIUM — Users may lose filter context when switching tabs.

---

## 5. LOADING/ERROR PATTERN CONSISTENCY

| Component | Loading State | Error State | Empty State |
|-----------|--------------|-------------|-------------|
| **Project Detail** | `EnergyLoader` with "Loading project data..." | "Project Not Found" with back button | N/A |
| **EngTasksTab** | Inline "Loading engineering tasks..." | Returns empty task array | "No tasks found" with create button |
| **Commercial tabs** | Tab-specific loading spinners | Varies per tab | Varies per tab |
| **Quality tab** | Loading spinner | Error boundary | "No checklist" with setup prompt |
| **Collaboration tabs** | Varies | Varies | Varies |

**Finding:** Loading states use a mix of `EnergyLoader`, `Loader2` spinner, and inline text. Error handling is not standardized — some tabs show error boundaries, others fail silently with empty data.

**Trust Impact:** MEDIUM — Inconsistent loading/error feedback may make users unsure if data is loading or missing.

---

## 6. PERMISSION CUE CONSISTENCY

| Scenario | How App Handles It |
|----------|--------------------|
| **Tab hidden due to permission** | Tab button not rendered. User sees no indication they're missing a tab |
| **Action disabled due to permission** | Button disabled or not rendered. No tooltip explaining "you need X permission" |
| **Data hidden due to permission** | Section not rendered. No "access restricted" placeholder |

**Finding:** Permission enforcement is "invisible" — restricted content simply doesn't appear. Users have no way to know what they're missing or why.

**Trust Impact:** LOW-MEDIUM — Appropriate for security but may cause confusion when users expect to see content they've been told about.

---

## 7. OVERALL CONSISTENCY SCORECARD

| Area | Score | Justification |
|------|-------|---------------|
| **Status naming** | 2/5 | 5 different conventions across task types |
| **Badge styling** | 3/5 | Mostly colored badges but not shared components |
| **Delete behavior** | 2/5 | Hard vs soft delete inconsistency; no undo for any |
| **Field naming** | 3/5 | Core fields present but named differently |
| **Task detail experience** | 3/5 | Two rich drawers; other types inline-only |
| **Tab naming** | 4/5 | Mostly clear; a few key-label mismatches |
| **Edit/save patterns** | 3/5 | Mix of auto-save and explicit-save |
| **Filter behavior** | 3/5 | Functional but not persisted or indicated |
| **Loading/error patterns** | 3/5 | Functional but inconsistent components |
| **Permission cues** | 3/5 | Secure but invisible to users |

**Overall Score: 2.9 / 5**

---

## 8. ITEMS THAT TEACH USERS THE WRONG HABIT

1. **"I deleted a task in the board view, I can probably undo it"** — No. Operational tasks are hard-deleted. No undo, no trash, no recovery.

2. **"I'll use the same status names when talking about tasks"** — Can't. Engineering uses "COMPLETE", operational uses "Done", quality uses "approved", MyTool uses "done" (lowercase).

3. **"If I set a filter, it'll still be there when I come back"** — No. All filters reset on tab navigation.

4. **"The Gantt saved my changes automatically"** — Maybe. Auto-save on drag is not clearly communicated.

5. **"I can see the same task detail for any task type"** — No. Engineering tasks have a minimal inline expand; operational tasks have a full drawer with comments, checklists, attachments.

---

## 9. RECOMMENDATIONS (Prioritized by Trust Impact)

1. **HIGH: Unify status naming** — Create shared status constants and display map. All task types should render through one `<StatusBadge>` component.

2. **HIGH: Convert operational task delete to soft delete** — Add `deletedAt` column. Add "Recently Deleted" section in admin or task management.

3. **MEDIUM: Add save confirmation to Gantt** — Toast or subtle indicator when drag/edit saves successfully.

4. **MEDIUM: Add "N items hidden by filters" indicator** — Helps users understand that data exists but is filtered out.

5. **MEDIUM: Standardize task detail experience** — Engineering tasks should have comparable detail drawer (comments, attachments) to operational tasks.

6. **LOW: Align tab keys with display labels** — `revenue-tracking` → `inflows`, `history` → `audit`, etc.

7. **LOW: Add permission hint tooltips** — When a feature is hidden due to permission, show a subtle "Restricted" indicator rather than nothing.
