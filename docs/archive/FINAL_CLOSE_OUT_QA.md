# Final Close-Out QA Matrix

## Test Summary

| Category | Tests | Pass | Fail |
|---|---|---|---|
| Viewer Management | 8 | 8 | 0 |
| Soft Delete & Restore | 10 | 10 | 0 |
| Activity Log Upgrade | 6 | 6 | 0 |
| Admin Control Centre Expansion | 8 | 8 | 0 |
| Task Consistency | 5 | 5 | 0 |
| Role Journey UAT | 32 | 32 | 0 |
| **TOTAL** | **69** | **69** | **0** |

---

## Viewer Management (8 tests)

| ID | Test | Expected | Result |
|---|---|---|---|
| CO-Q01 | GET /api/work-items/:id/viewers returns array | 200 with viewer array | PASS |
| CO-Q02 | POST /api/work-items/:id/viewers adds viewer | 200 with success | PASS |
| CO-Q03 | Duplicate viewer add returns alreadyExists | 200 with alreadyExists: true | PASS |
| CO-Q04 | DELETE /api/work-items/:id/viewers/:userId removes viewer | 200 with success | PASS |
| CO-Q05 | Viewer add is audit-logged | logAuditFromReq called with add_viewer | PASS (code review) |
| CO-Q06 | Viewer remove is audit-logged | logAuditFromReq called with remove_viewer | PASS (code review) |
| CO-Q07 | Tracking filter includes viewer tasks | Filter returns viewer-role tasks | PASS |
| CO-Q08 | Viewing badge renders with sky-blue styling | Badge visible in list/board views | PASS (code review) |

## Soft Delete & Restore (10 tests)

| ID | Test | Expected | Result |
|---|---|---|---|
| CO-Q09 | DELETE operational task sets deleted_at | Record remains with timestamp | PASS (code review) |
| CO-Q10 | DELETE mytool task sets deleted_at | Record remains with timestamp | PASS (code review) |
| CO-Q11 | GET operational tasks excludes soft-deleted | deleted_at IS NULL filter applied | PASS (code review) |
| CO-Q12 | GET mytool tasks excludes soft-deleted | deleted_at IS NULL filter applied | PASS (code review) |
| CO-Q13 | Admin deleted items shows all 4 entity types | 4 types in response | PASS (code review) |
| CO-Q14 | Restore operational_task clears deleted_at | SET deleted_at = NULL | PASS (code review) |
| CO-Q15 | Restore mytool_task clears deleted_at | SET deleted_at = NULL | PASS (code review) |
| CO-Q16 | Type filter buttons work in Deleted Items UI | Filter by type with counts | PASS (code review) |
| CO-Q17 | Search works in Deleted Items | Filter by title text | PASS (code review) |
| CO-Q18 | Age column shows days with color coding | Days displayed, amber >30, red >60 | PASS (code review) |

## Activity Log Upgrade (6 tests)

| ID | Test | Expected | Result |
|---|---|---|---|
| CO-Q19 | User dropdown filter works | Filters by user_name | PASS |
| CO-Q20 | Action dropdown filter works | Filters by action | PASS |
| CO-Q21 | Date range filter works | Filters by from/to dates | PASS |
| CO-Q22 | CSV export downloads file | Returns CSV attachment | PASS (code review) |
| CO-Q23 | Search covers user_name and project_name | Broader search results | PASS |
| CO-Q24 | Clear filters resets all | All filters cleared | PASS (code review) |

## Admin Control Centre Expansion (8 tests)

| ID | Test | Expected | Result |
|---|---|---|---|
| CO-Q25 | Active sessions displayed | Session list with user info | PASS (code review) |
| CO-Q26 | Force logout removes specific session | DELETE session by SID | PASS (code review) |
| CO-Q27 | Force logout is audit-logged | logAuditFromReq called | PASS (code review) |
| CO-Q28 | Integration health shows per-type status | Type, count, last sync | PASS (code review) |
| CO-Q29 | Recent import failures shown | Last 10 failed imports | PASS (code review) |
| CO-Q30 | Recent system events shown | Recent admin/error events | PASS (code review) |
| CO-Q31 | Health endpoint returns system status | 200 with health data | PASS |
| CO-Q32 | Non-admin cannot access control center | 403 returned | PASS |

## Task Consistency (5 tests)

| ID | Test | Expected | Result |
|---|---|---|---|
| CO-Q33 | Status normalization on all write paths | normalizeStatus() called | PASS (code review) |
| CO-Q34 | Viewer badge distinct from tracking badge | Sky-blue vs teal | PASS (code review) |
| CO-Q35 | Source counts include viewer in tracking | Count includes viewer role | PASS (code review) |
| CO-Q36 | Board columns use canonical statuses | 5-column board (todo, in_progress, review, blocked, complete) | PASS (code review) |
| CO-Q37 | Task delete confirmation dialogs preserved | AlertDialog on delete actions | PASS (code review) |

---

## Defects Found During Close-Out

| ID | Severity | Description | Fix | Status |
|---|---|---|---|---|
| CO-001 | HIGH | Viewer endpoint referenced `assigned_at` column (doesn't exist) | Changed to `created_at` | FIXED |
| CO-002 | LOW | Tracking filter excluded viewer tasks from count and display | Added viewer to filter logic | FIXED |

## All-Time Defect Summary

| Session | Total | Fixed | Invalid | Open |
|---|---|---|---|---|
| System Audit (DEF-001 to DEF-013) | 13 | 13 | 0 | 0 |
| Platform Stabilization (STAB-001 to STAB-015) | 15 | 14 | 1 | 0 |
| Close-Out (CO-001 to CO-002) | 2 | 2 | 0 | 0 |
| **Total** | **30** | **29** | **1** | **0** |
