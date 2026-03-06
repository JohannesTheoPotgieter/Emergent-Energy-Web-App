# PM Maturity Release Note — V1.2.0

## Release Summary
Version 1.2.0 introduces eight PM Maturity features that extend the platform from project tracking to full lifecycle management. All features reuse existing audit, permissions, and authentication infrastructure.

## What's New

### Project Detail Tabs
- **RAID Log** — Risks, Assumptions, Issues, Decisions with priority badges, inline editing, and filtering
- **Change Control** — Seven-stage change request pipeline with cost/schedule impact tracking
- **Procurement** — Eight-stage procurement pipeline with supplier linking and KPI summary
- **Commissioning & Closeout** — Checklist-style interface with progress tracking per category

### Task Management
- **Dependencies** — FS/SS/FF/SF dependencies with lag days, circular detection, and Task Detail Drawer integration

### Approvals
- **General-Purpose Approvals** — CRUD framework with entity linking, approver assignment, due dates, and project filtering
- **Unified View** — ProjectApprovalsTab shows engineering, quality, and general approvals together

### Mobile (PM On The Go)
- **Add Procurement** — Create procurement items from the field
- **Update Commissioning** — Inline status updates for commissioning checklists
- **Review Approvals** — Approve or reject pending items from mobile

### Admin
- **5 New Permission Entities** — RAID, Change Control, Procurement, Commissioning, Dependencies all permission-gated
- **Subcontractor Assignments** — Project-level contractor tracking with work packages

## Database Changes
- 6 new tables: `change_requests`, `raid_items`, `procurement_items`, `commissioning_items`, `invoice_captures`, `project_subcontractor_assignments`
- 6 new columns on `approvals` table
- All created via startup migrations (IF NOT EXISTS), no destructive changes

## Breaking Changes
None. All new features are additive. Existing endpoints, tables, and UI are unchanged.

## Readiness Assessment
**READY FOR CONTROLLED INTERNAL USE**
- All routes have permission middleware
- All mutations are audit-logged
- Status transitions are server-validated
- Frontend follows established patterns (SearchableSelect, react-query, Bearer auth)
- Known limitations documented in defect register (cross-project rollup, CPM recalc, auto-PO linking deferred to V1.3)
