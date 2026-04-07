# Final Defect Register

## Version: 2.0 | Date: 2026-03-06

---

## Stabilization Session — Fixed Defects

| ID | Severity | Category | Description | Resolution | Recoverable via UI | Status |
|---|---|---|---|---|---|---|
| STAB-001 | HIGH | Audit Logging | role-management.ts had 7 mutating endpoints (role CRUD, user CRUD, password resets) with zero audit logging — critical admin actions completely invisible to governance | Added logAuditFromReq to all 7 endpoints with entity type, action, and detailed changesJson including before/after on role changes | N/A — governance gap, not data | **FIXED** |
| STAB-002 | MEDIUM | Task Normalization | Baseline task promotion wrote legacy status values ("Not Started", "Done", "In Progress") instead of canonical ("todo", "complete", "in_progress") | Changed to canonical values at routes.ts lines 10319-10321 (both promotion code paths) | Yes — admin can fix via Recovery Center status edit | **FIXED** |
| STAB-003 | MEDIUM | Task Normalization | Recurring task creation set new instance status to "planned" (non-canonical) instead of "todo" | Changed to canonical "todo" at routes.ts line 12762 | Yes — admin can fix via Recovery Center status edit | **FIXED** |
| STAB-004 | LOW | Task Logic | MyTool task completion check compared against "done" after normalization converts to "complete", causing recurring task re-creation to fail | Updated check to accept both "complete" and "done" at routes.ts line 12746 | N/A — logic fix | **FIXED** |
| STAB-005 | MEDIUM | Admin Recovery | Task edit save button in Recovery Center had no confirmation dialog — admin could accidentally modify tasks | Added AlertDialog confirmation with task description and audit warning | N/A — UX fix | **FIXED** |
| STAB-006 | MEDIUM | Admin Recovery | Deleted item restore in Recovery Center had no confirmation dialog | Added AlertDialog confirmation showing item count | N/A — UX fix | **FIXED** |
| STAB-007 | MEDIUM | Task Normalization | Admin recovery PATCH handler did not call normalizeStatus before writing to database — admin could store non-canonical values | Added normalizeStatus call at admin-recovery-routes.ts line 187 | Yes — admin can re-edit via Recovery Center | **FIXED** |

---

## Stabilization Session — Open Defects

| ID | Severity | Category | Description | Operational Impact | Recoverable via UI | Status |
|---|---|---|---|---|---|---|
| STAB-008 | MEDIUM | Task Normalization | `PATCH /api/planning-tasks/:taskId` wrote raw "Done" when percentComplete=100 instead of canonical "complete" | Added normalizeStatus + normalizePriority at handler entry, updated "Done" checks to also accept canonical "complete" | Yes — admin can fix status via Recovery Center | **FIXED** |
| STAB-009 | MEDIUM | Task Normalization | `POST /api/operational-tasks/bulk-update` did not normalize status — wrote raw values from client | Added normalizeStatus + normalizePriority before bulk update loop | Yes — admin can fix individual tasks via Recovery Center | **FIXED** |
| STAB-010 | LOW | Admin Recovery | Project recovery save button had no AlertDialog confirmation dialog — saved immediately on click | Added AlertDialog wrapping save button with project ID, name, and audit warning | Yes — admin can re-edit; action is audit-logged | **FIXED** |
| STAB-011 | HIGH | Audit Logging | smart-import-routes.ts had 0 audit logging calls across 12 mutating endpoints (upload, commit, rollback, mapping, resolve, etc.) | Added 12 logAuditFromReq calls covering all mutating endpoints: upload, project-info, mapping, resolve, ignore-all-blockers, allow-all, apply-prior-resolutions, commit, rollback, bulk-commit, retry | N/A — governance gap fixed | **FIXED** |
| STAB-012 | MEDIUM | Audit Logging | sync-routes.ts had 0 audit logging calls across 10 mutating endpoints (SharePoint push/pull) | Added 10 logAuditFromReq calls covering: configure, auto-detect, update-mapping, pull, push, resolve-conflict, cp-signed, intake-request update, intake-task update, generate-tasks | N/A — governance gap fixed | **FIXED** |
| STAB-013 | MEDIUM | Audit Logging | server/departments/*.ts directory does not exist — original defect was based on incorrect assumptions | No action needed — the directory doesn't exist. Financial operations are handled in routes.ts and already have audit logging | N/A — false positive | **CLOSED (Invalid)** |
| STAB-014 | MEDIUM | Audit Logging | ~23 endpoints in routes.ts missing audit logging (settings, clients, refresh, backfill, notifications, key-date-mappings, Teams messages, project folders, scan-folder, reprocess-all) | Added 18 logAuditFromReq calls. 5 remaining endpoints intentionally excluded: login (pre-auth), logout (cleanup), writeback/preview (read-only), error-log (already persisted), outlook/refresh (no mutation) | N/A — governance gap fixed | **FIXED** |
| STAB-015 | LOW | Admin Recovery | Project recovery form was missing sizeKwp, contractValue, and clientId fields — backend supported these but frontend didn't expose them | Added Size (kWp), Contract Value, and Client ID fields to ProjectRecoveryTab edit form with proper number inputs | Yes — all fields now editable via recovery | **FIXED** |

---

## Summary

| Category | Fixed | Open | Total |
|---|---|---|---|
| Stabilization Session | 14 | 0 | 15* |
| Prior Audit Session (DEF-001 to DEF-013) | 13 | 0 | 13 |
| **Total All Sessions** | **27** | **0** | **28*** |

*STAB-013 was closed as invalid (false positive — the directory doesn't exist)

### Open Defect Breakdown
None. All identified defects have been fixed or closed.

### Intentionally Excluded from Audit Logging (5 endpoints)
These endpoints are intentionally not audit-logged due to their nature:
1. `POST /api/auth/login` — Pre-authentication; user identity not yet established
2. `POST /api/auth/logout` — Session cleanup; no data mutation
3. `POST /api/writeback/preview` — Read-only preview; no data modification
4. `POST /api/error-log` — Client error reporter; already persists to error_log table
5. `POST /api/outlook/refresh` — Token refresh; no data mutation

### Audit Coverage Summary
- **Total audit calls**: 292 across all server files
- **routes.ts**: 145 calls
- **smart-import-routes.ts**: 12 calls (was 0)
- **sync-routes.ts**: 11 calls (was 0)
- **role-management.ts**: 8 calls
- **Other route files**: 116 calls
