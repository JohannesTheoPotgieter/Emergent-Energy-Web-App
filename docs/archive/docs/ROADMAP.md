# Emergent Energy — Roadmap (Out of Scope Items)

**Date:** 2026-02-18

---

## Future Integration Hooks

The following items are explicitly out of scope for the current build but documented here for future implementation:

### SharePoint / Graph Integration
- Document browsing and syncing via Microsoft Graph API
- Currently using local file reference storage (file picker + metadata)
- Future: Replace with Graph-based document picker and sync

### Pipedrive Integration
- CRM pipeline integration for project development tracking
- Hook point: `company_projects` table lifecycle phase transitions

### ClickUp Migration
- Full task migration from ClickUp to internal engineering task system
- Existing `external_source` and `external_task_id` fields on `operationalTasks` support migration mapping
- Future: Bulk import tool for ClickUp exports

### Full PM Migration
- Complete project management migration from Excel-driven to in-app native
- Current: Excel import remains source of truth for finance/program data
- Future: Native CRUD for all project plan data with Excel as export-only
