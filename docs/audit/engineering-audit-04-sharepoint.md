# Audit 4: SharePoint Connector Status

**Date:** 2026-03-19
**Scope:** SharePoint integration — what exists, what's missing, phased build plan
**Status:** Read-only audit — no changes made

---

## Executive Summary

The SharePoint integration is **~85% complete on the backend, ~15% on the frontend**. Core pull/push logic, conflict detection, audit logging, and connector abstraction are production-ready. What's missing is primarily the COO control UI and conflict resolver UI.

---

## 1. What Exists

### Database Tables (All Defined in Schema)

| Table | Purpose |
|-------|---------|
| `sp_list_config` | SharePoint site/list credentials, column mapping, sync state |
| `intake_requests` | Synced items from SharePoint (40+ fields) with conflict tracking |
| `intake_tasks` | Task checklist per intake request with DoD items |
| `sync_audit_log` | Comprehensive audit trail for all sync operations |
| `mock_sp_items` | Seeded mock SharePoint items for testing |
| `sp_file_pointers` | References to SharePoint files linked to entities |

### Connector Abstraction (`server/intake-connector.ts`, 164 lines)

```
IntakeConnector interface:
  fetchItems(), updateItem(), getColumns(), isAvailable()

SharePointConnector — Real Graph API implementation
MockConnector — Full mock with 24 pre-configured columns, etag simulation
getConnector() — Factory, auto-selects real vs mock
```

### Backend Routes (`server/sync-routes.ts`, 835 lines)

**Discovery (COO-only):**
- `GET /api/sp-sync/discover/sites`, `/site-by-url`, `/lists/:siteId`, `/list-by-name`, `/columns/:siteId/:listId`

**Configuration (COO-only):**
- `GET/POST /api/sp-sync/config`, `POST /config/auto-detect`, `PATCH /config/mapping`

**Sync Operations (COO-only):**
- `POST /api/sp-sync/pull` — Fetch from SharePoint → upsert intake_requests (with conflict detection)
- `POST /api/sp-sync/push` — Write app metadata back to SharePoint

**Conflict Management (COO-only):**
- `POST /api/sp-sync/resolve-conflict/:requestId` — Per-field resolution (keep_sp, keep_app, merge)

**Intake CRUD:**
- `GET /api/sp-sync/intake-requests`, `/:id`, `/by-project/:projectId`
- `PATCH /api/sp-sync/intake-requests/:id`
- Task generation and CP Signed endpoints

**Audit:**
- `GET /api/sp-sync/audit-log`, `/status`

### Graph API Client (`server/sharepoint.ts`, 244 lines)
- Auth via Replit Connectors OAuth
- Operations: `graphGet`, `graphGetBuffer`, `testConnection`, `listFolderChildren`, `browseFolders`, `downloadSingleFile`, `detectChanges`

### File Pointer CRUD (`engineering-routes.ts`)
- `GET /api/eng/file-pointers/:entityType/:entityId`
- `POST /api/eng/file-pointers`
- `DELETE /api/eng/file-pointers/:id`

### Frontend Components
- **SharePointFilesTab.tsx** — File browser with breadcrumb navigation, folder browsing, download/open
- **LocalFolderTab.tsx** — Browser File System Access API for local folder linking

### Access Controls
- `requireCOO` middleware on all discovery, config, pull, push, resolve-conflict endpoints
- Configuration locked to COO_ADMIN role

### Audit Logging
- All sync operations logged to `syncAuditLog`
- Tracks: action, actorRole, direction, summary, errors, conflicts, counts

---

## 2. What's Missing

### 2.1 No COO Control Panel UI
- No admin page for COO to trigger pull/push
- No configuration wizard for site/list discovery
- No column mapping UI
- No sync history browser
- No status dashboard

### 2.2 No Conflict Resolution UI
- Conflict detection works on backend
- Conflicts stored in `syncConflict` + `conflictFieldsJson`
- Resolution endpoint exists
- **But no frontend UI to display or resolve conflicts**

### 2.3 Incomplete Push-to-SharePoint
- Push currently only updates metadata columns: `appProjectKey`, `appLastPushed`, `appSyncStatus`, `appLink`
- `forcePushShared` parameter exists but is gated (requires explicit flag)
- No UI to trigger push with field selection

### 2.4 No Graph API Client Library Usage
- `@microsoft/microsoft-graph-client@3.0.7` in package.json but NOT used
- Uses custom fetch-based `graphGet`/`graphPatch` instead

### 2.5 Missing Field Ownership Enforcement
- `spListConfig` has `fieldOwnershipJson` but SP_OWNED/APP_OWNED fields are hardcoded constants
- No validation that push only updates SP-owned fields

### 2.6 No Batch/Retry Logic
- Pull/push operations have no retry on failure
- No idempotency keys
- Partial sync failures not recoverable

---

## 3. Phased Build Plan

### Phase 1: Intake Management Dashboard (1 week)
**Goal:** Make current backend visible and controllable
- Create `/pages/sharepoint-intake.tsx`
- Show intake_requests with status badges (new/updated/conflict/synced)
- Add "Resolve Conflict" action button → modal with field-level chooser
- Add "Refresh from SharePoint" button (manual pull trigger)
- **Effort:** ~2 days

### Phase 2: Configuration UI (1 week)
**Goal:** Move SP configuration from CLI to in-app UI
- Settings page tab: SharePoint Lists config
- Current config display, "Reconfigure" button
- Column mapping editor (auto-detect + manual)
- Sync direction selector (Pull-Only / Push-Only / Bidirectional)
- **Effort:** ~2 days

### Phase 3: Conflict Resolution UI (1-2 weeks)
**Goal:** COO can resolve conflicts without API calls
- Conflict list view (intake_requests where `syncConflict = true`)
- Side-by-side comparison per conflicted field
- Radio buttons: Keep SP / Keep App / Merge (comments only)
- Backend already implemented — just needs UI
- **Effort:** ~3 days

### Phase 4: Real SharePoint Connector (1-2 weeks)
**Goal:** Swap mock for real Graph API
- Requires: Replit Connectors configured with real tenant, Azure OAuth app registration
- Permissions needed: `Sites.Read.All`, `Lists.ReadWrite.All`, `Files.Read.All`
- No core code changes needed — just environment/infrastructure setup
- Add retry logic for transient failures, pagination for large lists
- **Effort:** ~5 days

---

## 4. Risk Areas

| Risk | Severity | Notes |
|------|----------|-------|
| Graph API rate limits | MEDIUM | No pagination or retry implemented |
| Field sync correctness | MEDIUM | No pre-sync validation that mapping still valid |
| Data loss on delete | HIGH | No soft-delete on SharePoint → hard deletes cascade |
| User adoption | LOW | COO training needed on conflict resolution |

---

## Status Summary

| Aspect | Backend | Frontend | Overall |
|--------|---------|----------|---------|
| Pull from SP | Complete | No UI | 50% |
| Push to SP | Metadata only | No UI | 30% |
| Conflict detection | Complete | No UI | 50% |
| Conflict resolution | Complete | No UI | 50% |
| File browsing | Complete | Complete | 100% |
| Audit logging | Complete | No UI | 50% |
| Access controls | Complete | N/A | 100% |
| Mock connector | Complete | N/A | 100% |
| Real connector | Ready | N/A | 80% (needs infra) |
