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
| STAB-011 | HIGH | Audit Logging | smart-import-routes.ts has 0 audit logging calls across 10+ mutating endpoints (upload, commit, rollback) | Import operations — the highest-risk data ingestion path — are not visible in the audit trail | No — requires code fix | **OPEN** |
| STAB-012 | MEDIUM | Audit Logging | sync-routes.ts has 0 audit logging calls across 10 mutating endpoints (SharePoint push/pull) | SharePoint sync operations not tracked in audit trail | No — requires code fix | **OPEN** |
| STAB-013 | MEDIUM | Audit Logging | server/departments/*.ts has 0 audit logging calls across ~15 mutating endpoints | Financial close uploads, reprocess operations not tracked | No — requires code fix | **OPEN** |
| STAB-014 | MEDIUM | Audit Logging | ~30 endpoints in routes.ts missing audit logging (scenarios CRUD, bulk operations, comment deletion, planning task PATCH) | Some user actions not captured in audit trail | No — requires code fix | **OPEN** |
| STAB-015 | LOW | Admin Recovery | Project recovery form missing sizeKwp, contractValue, and clientId fields — backend supports these but frontend doesn't expose them | Admin cannot fix project size/contract value through recovery UI; must use project detail page or database | Partially — can edit via project detail page, not via recovery | **OPEN** |

---

## Summary

| Category | Fixed | Open | Total |
|---|---|---|---|
| Stabilization Session | 10 | 5 | 15 |
| Prior Audit Session (DEF-001 to DEF-013) | 13 | 0 | 13 |
| **Total All Sessions** | **23** | **5** | **28** |

### Open Defect Breakdown by Severity
| Severity | Count | IDs |
|---|---|---|
| HIGH | 1 | STAB-011 (Smart Import audit logging) |
| MEDIUM | 3 | STAB-012, STAB-013, STAB-014 |
| LOW | 1 | STAB-015 (Project recovery missing fields) |

### Recommended Priority Fixes
1. **STAB-011** (HIGH): Add logAuditFromReq to smart-import-routes.ts upload/commit/rollback — critical governance gap
2. **STAB-014** (MEDIUM): Add audit logging to remaining ~30 routes.ts endpoints — audit completeness
3. **STAB-012 + STAB-013** (MEDIUM): Add audit logging to sync-routes.ts and departments — operational visibility
