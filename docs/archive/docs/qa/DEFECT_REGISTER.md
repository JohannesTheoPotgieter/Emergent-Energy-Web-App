# DEFECT REGISTER — Second-Pass Gap-Close Audit

**Date:** 2026-03-19
**Scope:** Project Detail page and all connected subsystems

---

## Defects Found During Trust-Hardening Pass

| ID | Gap Area | Severity | Root Cause | Operational Impact | UI Recoverable? | Fix Recommendation |
|----|----------|----------|------------|-------------------|-----------------|-------------------|
| GC-001 | Smart Import Rollback | **P1 — HIGH** | Rollback deletes `normalized_*` and `work_items` but does NOT revert `program_expense` or `program_inflows` (legacy tables) | Legacy tables retain import data after rollback. Financial reports querying legacy tables show stale data. Dual-source divergence. | NO — rollback action itself is incomplete | Extend rollback to delete `program_expense` and `program_inflows` rows matching the import run ID |
| GC-002 | Task Delete Inconsistency | **P2 — MEDIUM** | Operational tasks use `DELETE` (hard delete); all other task types use soft delete (`deletedAt`/`softDeletedAt`) | Accidentally deleted operational tasks are permanently lost. No undo. Admins cannot recover. Comments, checklists, attachments cascade-deleted. | NO | Convert operational task delete to soft delete. Add `deletedAt` column to `operational_tasks`. Add admin "Recently Deleted" view |
| GC-003 | Financial KPI Client-Side Computation | **P2 — MEDIUM** | Revenue Realised %, COS Realised %, Margin Delta, RAG statuses all computed in `project-detail.tsx` (client-side) from multiple independent API queries | No single authoritative API endpoint for project health. If any query fails or returns partial data, KPIs may be wrong. Different pages computing same metric could show different values. | N/A — architectural issue | Create server-side `/api/projects/:id/health-summary` endpoint that computes all KPIs authoritatively |
| GC-004 | Microsoft Integration Overstated | **P1 — HIGH** | MS integration previously rated "Ready" but requires live Azure AD linked account to test actual data retrieval (email, calendar, Teams) | Users may expect working MS integration. Graceful fallback (empty data) is not the same as "feature works." False confidence in deployment readiness. | N/A — testing gap | Reclassify as "Code Complete / Untestable Without Environment." Require UAT with real MS accounts. Add "Not Connected" indicator in UI rather than silent empty state |
| GC-005 | RAG Threshold Hardcoding | **P3 — LOW** | Schedule RAG (0/3 overdue), Cost RAG (90%/100%), Quality RAG thresholds are hardcoded in `project-detail.tsx:1080-1095` | Thresholds may not match actual business rules. Different project types/sizes may need different thresholds. No admin configuration possible. | NO — requires code change | Move RAG thresholds to configurable settings (project-level or system-level) |
| GC-006 | Manual Edits vs Import Conflict | **P2 — MEDIUM** | Smart Import detects 7+ conflict types when project has manual edits. Resolution UI requires per-field decisions (cosRealised, invoiceDateConfirmed, paidDateConfirmed, noRevenueLinked, cashflowConfirmed) | Users may unknowingly overwrite manual financial corrections. Complex conflict resolution UI may lead to wrong choices. | PARTIALLY — conflict UI exists but is complex | Add "Keep All Manual Edits" default option prominently. Add diff preview showing exactly what changes |
| GC-007 | Smart Import Partial Failure | **P2 — MEDIUM** | Commit logic uses delete-before-insert pattern without full transaction wrapping. If insert fails after delete, project data is empty until re-import | Temporary data loss for project. Financial reports show zero. Users may panic. No automatic recovery. | PARTIALLY — re-import recovers data | Wrap entire commit in a single database transaction. If any insert fails, rollback all changes |
| GC-008 | No Task Type Conversion | **P2 — MEDIUM** | No UI or API to convert a task from one type to another (e.g., operational → engineering) | User must manually recreate task in correct type, losing comments/history/attachments. Time-consuming and error-prone. | NO | Add "Convert Task Type" API endpoint and UI action |
| GC-009 | Status Naming Inconsistency | **P3 — LOW** | 5 different status naming conventions across 5 task types: Mixed case, lowercase_snake, Title Case, UPPER_SNAKE, etc. | Users cannot build consistent mental model. Communication about task status requires knowing which task type. Cross-type reporting requires status mapping. | N/A — design issue | Unify status display via shared `<StatusBadge>` component with a canonical status-to-display mapping |
| GC-010 | Engineering Status Casing | **P3 — LOW** | Engineering stages use lowercase "complete" but engineering board/tasks use uppercase "COMPLETE" | Client-side code must handle both casings. Risk of missed filtering or counting. (`project-detail.tsx:1179-1185` combines both) | N/A — data consistency issue | Normalize all engineering statuses to consistent casing at API level |
| GC-011 | Soft Delete Without Restore UI | **P2 — MEDIUM** | Engineering tasks, MyTool tasks, work items, and plan tasks all support soft delete (`deletedAt`/`softDeletedAt`) but no "Restore" or "Recently Deleted" UI exists | Soft-deleted items are invisible to all queries. Functionally equivalent to hard delete from user perspective. DB storage cost without user benefit. | NO — no restore mechanism | Add admin "Recently Deleted" page that queries soft-deleted records and allows restore |
| GC-012 | Contract Value Dual Source | **P3 — LOW** | `project_info.contract_value` can differ from sum of `program_inflows.milestoneAmount`. Client falls back to computed sum if `contract_value` is null. | Two sources of truth for same number. If import updates milestones but not project_info, values may diverge. | PARTIALLY — admin can update project_info | Add auto-reconciliation or warning when contract_value != sum(milestones) |

---

## Summary by Severity

| Severity | Count | Items |
|----------|-------|-------|
| P1 — HIGH | 2 | GC-001 (rollback incomplete), GC-004 (MS integration overstated) |
| P2 — MEDIUM | 6 | GC-002, GC-003, GC-006, GC-007, GC-008, GC-011 |
| P3 — LOW | 4 | GC-005, GC-009, GC-010, GC-012 |

## Priority Fix Order

1. **GC-007** — Wrap import commit in transaction (prevents data loss)
2. **GC-001** — Extend rollback to legacy tables (prevents stale data)
3. **GC-002** — Convert operational delete to soft delete (prevents permanent data loss)
4. **GC-004** — Reclassify MS integration honestly (prevents false confidence)
5. **GC-003** — Server-side KPI endpoint (prevents inconsistent reporting)
6. **GC-011** — Add restore UI for soft-deleted items
7. **GC-008** — Task type conversion feature
8. **GC-006** — Simplify import conflict resolution
9. **GC-009** — Unify status naming
10. **GC-005** — Configurable RAG thresholds
11. **GC-010** — Normalize engineering status casing
12. **GC-012** — Contract value reconciliation
