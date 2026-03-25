# Productivity and Prioritisation Fixes

## Date: 2026-03-06
## System: Emergent Energy Dashboard v1

---

## 1. My Work Defaults (T001)

### Sort Order
- **Before**: Priority ascending (critical first, then high, normal, low)
- **After**: Due date ascending with urgency-first tiebreakers:
  1. Overdue tasks always surface first
  2. Blocked tasks surface second
  3. Then standard sort field applies (default: due date ascending)

### Completed Task Visibility
- **Before**: All tasks shown including completed/cancelled
- **After**: Completed/cancelled/done tasks hidden by default
- **Toggle**: "Show Done" button in toolbar (green when active, shows count)
- **Exception**: If user explicitly selects status filters (e.g., clicks "complete" in filter bar), those override the default hiding

### KPI Cards
- **Before**: Active, Overdue, High Priority, Completed (with completion rate bar)
- **After**: Active, Overdue (clickable filter), High Priority, Due This Week
  - Due This Week: shows 7-day count with "due today" callout and "awaiting review" sub-metric
  - Overdue card: still clickable to toggle overdue-only filter

## 2. Filter Architecture (T002)

### Source vs Urgency Separation
- **Before**: Source tabs only (All, Personal, Operational, Plan, etc.)
- **After**: Source tabs + urgency quick-filters separated by vertical divider
  - Source tabs: All, Personal, Operational, Plan, Engineering, Quality, Approvals, TR Register, Tracking, Deliverables, Notifications
  - Urgency quick-filters: Overdue (red), Due 7d (violet), Blocked (orange)
  - Quick filters are mutually exclusive (selecting one deselects others)
  - Each shows count when items exist, with colour-coded text when active

### Active Filter Summary
- Updated to show new filter types (Due 7d badge, Blocked badge, +Done badge)
- Clear-all button resets all filter types including new urgency filters

### Spacing & Density
- Source tab buttons: reduced from `px-2 py-1` to `px-1.5 py-0.5`, font from `text-[11px]` to `text-[10px]`
- Tighter gaps in filter row (gap-1 instead of gap-0.5)

## 3. Project Routing (T004)

### Ownership Priority Sort
- Projects where the current user is the PM now sort first in the project list
- Applied as primary sort key before user-selected sort field

### Unassigned PM Visual Flag
- PM dropdown shows "No PM" in red text when no PM is assigned
- Visual distinction helps identify projects needing management attention

## 4. Command Center Enhancements (T005)

### COO/Admin & Program Manager
- "Unassigned" KPI card appears when there are tasks without an owner
- Shows count of unassigned operational/plan/engineering/quality tasks
- Red colour with "Needs owner" subtitle

## 5. Admin Operational Exceptions (T008)

### New Section: Operational Exceptions
- **Location**: Admin Control Center, between summary cards and quick links
- **Metrics**:
  - Unassigned Tasks (red when > 0)
  - Projects Without PM (amber when > 0)
  - Blocked Items (orange when > 0)
  - Total Overdue (neutral)
- **Breakdown**: Overdue-by-owner table showing top 10 owners with overdue counts
- **Backend**: `GET /api/admin/control-center/operational-exceptions` (admin-only, 4 parallel queries)

## 6. QM Dashboard Default (T007)

### Status Filter Default
- **Before**: `statusFilter` defaulted to `"all"` (showing completed projects alongside active)
- **After**: `statusFilter` defaults to `"active"` (showing only active projects by default)
- Users can still switch to "all" or "completed" views
