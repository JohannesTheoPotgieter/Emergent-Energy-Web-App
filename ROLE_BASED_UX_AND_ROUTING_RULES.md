# Role-Based UX and Routing Rules

## Date: 2026-03-06
## System: Emergent Energy Dashboard v1

---

## 1. Role Categories

| Role Group | Roles | Default Landing | Key Surfaces |
|---|---|---|---|
| Executive Overview | ADMIN, COO_ADMIN, CEO_ADMIN | Command Center | Lifecycle Board, Execution Board, Cashflow, Admin |
| Project Development | PROJECT_DEVELOPER | Command Center | PD Dashboard, PD Tickets, Clients |
| Engineering | ENGINEER, ENGINEERING_MANAGER, ENG_PROGRAM_MANAGER | Command Center | Engineering Dashboard, Task Board, Quality |
| Project Management | PROJECT_MANAGER_SITE, CONSTRUCTION_MANAGER | Command Center | PM Dashboard, PM On-the-Go, Quality |
| Quality Management | QUALITY_MANAGER | Command Center | Quality Dashboard, Approvals |
| Program Management | PROGRAM_MANAGER | Command Center | Execution Board, Portfolios, Weekly Reviews |
| Finance | CFO, PROGRAM_FINANCE_MANAGER, ACCOUNTANT, CCO | Command Center | Cashflow, COS Tracker, Revenue, GP Tracker |

## 2. Task Routing Rules

### Ownership-Based Routing
- Tasks assigned to a user appear in their My Work view
- Tasks where user is a viewer appear with "Viewing" badge
- Tracking filter shows tasks where user is creator, assignee, both, or viewer

### Exception Routing (COO/Admin/Program Manager)
- Unassigned tasks (no `assigned_to`) surface as "Unassigned" KPI in Command Center
- Projects without PM surface as management exception (red "No PM" indicator in project list)
- Overdue-by-owner breakdown available in Admin Operational Exceptions

### Default Sort & Filter Logic
- My Work: sorted by due date ascending, overdue first, blocked second
- Completed/cancelled hidden by default; toggleable via "Show Done"
- Source tabs and urgency quick-filters separated by divider
- Urgency filters: Overdue, Due 7d, Blocked (mutually exclusive quick toggles)

## 3. Project Routing Rules

### Ownership Priority
- Projects owned by current user (PM match) sort first in project list
- Projects without PM show red "No PM" placeholder in PM column

### State Handling
- Active projects shown by default via "Active" tab
- Archived projects in separate "Archived" tab
- Execution Board: only shows archivedStatus=ACTIVE
- Lifecycle Board: filters out ARCHIVED_MERGED and non-ACTIVE

## 4. Permission Gating

### Navigation Level
- Sidebar items gated by role `sections` array
- Routes protected by permission checks at route level

### Entity Level
- View/Edit/Approve/Override/Delete permissions per entity
- UI visibility controlled; admin endpoints separately protected
- Row-level ownership not configurable via permissions UI

## 5. Command Center KPIs by Role

| Role Group | KPIs Shown |
|---|---|
| All Roles | My Tasks, Overdue, Blocked |
| COO/Admin | + Active Projects, Unassigned, Revenue, COS |
| Program Manager | + Active Projects, Unassigned |
| PM | + Project Tasks |
| Engineer | + Eng Tasks |
| QM | + QC Items, Pending Reviews |
| Finance | + Revenue, COS |
| PD | + Active Projects |
