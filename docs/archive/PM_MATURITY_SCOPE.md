# PM Maturity Scope — V1.2

## Overview
V1.2 introduces eight PM Maturity features that extend the Emergent Energy platform's project management capabilities from basic tracking to full lifecycle management.

## Features in Scope

### 1. Dependencies
- Task-to-task dependencies with FS/SS/FF/SF types and lag days
- Circular dependency detection using graph traversal
- Integrated into Task Detail Drawer via DependencyManager component
- Backend: `server/dependency-routes.ts`
- Table: `work_item_dependencies` (pre-existing, now exposed via API)

### 2. Approvals Enhancement
- General-purpose approval CRUD (create, approve, reject, cancel)
- Enhanced `approvals` table with: `related_entity_type`, `related_entity_id`, `assigned_approver`, `due_date`, `project_id`, `approval_category`
- Project-scoped filtering
- Unified view in ProjectApprovalsTab (engineering + quality + general)
- Backend: `server/approvals-routes.ts` (enhanced)

### 3. Change Control
- Seven-stage pipeline: Draft → Submitted → Under Review → Approved → Rejected → Implemented → Closed
- Tracks cost impact, schedule impact, change type (scope/cost/schedule/technical/commercial)
- Server-validated status transitions
- Backend: `server/change-control-routes.ts`
- Table: `change_requests`

### 4. RAID Log
- Four types: Risk, Assumption, Issue, Decision
- Priority levels: Low, Medium, High, Critical
- Owner assignment, due dates, mitigation/response fields
- Inline editing with expandable cards
- Backend: `server/raid-routes.ts`
- Table: `raid_items`

### 5. Procurement
- Eight-stage pipeline: Requested → Quoted → Approved → Ordered → Partially Received → Received → Invoiced → Closed
- Links to suppliers (counterparties), POs, and approvals
- Expected vs actual cost tracking
- Backend: `server/procurement-routes.ts`
- Table: `procurement_items`

### 6. Subcontractor Controls
- Project-level subcontractor assignments with work packages
- Status tracking: active, completed, suspended, terminated
- Performance notes and key dates
- Backend: `server/subcontractor-routes.ts` (enhanced)
- Table: `project_subcontractor_assignments`

### 7. Commissioning & Closeout
- Toggle between commissioning and closeout views
- Checklist-style UI grouped by category
- Progress tracking per category with visual bars
- Status: Not Started → In Progress → Ready for Review → Approved → Closed
- Backend: `server/commissioning-routes.ts`
- Table: `commissioning_items`

### 8. PM On The Go Integration
- Three new mobile action cards: Add Procurement, Update Commissioning, Review Approvals
- Same data model and permissions as desktop
- Inline forms with SearchableSelect dropdowns
- Backend: Existing PM OTG routes enhanced

## Out of Scope
- Cross-project RAID rollup dashboard (future)
- Automated CPM schedule recalculation on dependency change (future)
- Procurement-to-PO auto-linking workflow (future)
- Mobile offline support (future)
