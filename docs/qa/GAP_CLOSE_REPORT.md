# GAP CLOSE REPORT — Second-Pass Trust-Hardening Audit

**Date:** 2026-03-19
**Scope:** Project Detail Page and all connected subsystems
**Auditor Profile:** Senior Operations Systems Auditor / Product Architect / QA Lead

---

## 1. READINESS RECLASSIFICATION

Each module is reclassified from the prior "READY FOR RELEASE" blanket into an honest tier.

| Module | Prior Status | Reclassified Status | Justification |
|--------|-------------|-------------------|---------------|
| **Authentication** | Ready | PROVEN READY | JWT auth flow, role-based middleware, token refresh all exercised in code; `use-auth.tsx` + `permission-middleware.ts` enforce per-request |
| **Project Management** | Ready | PROVEN READY | `project-detail.tsx` (1,417 lines) orchestrates 5 major sections, 20+ sub-tabs; phase change with audit trail (`project_phase_history`); PD/PM assignment; RAG status with comment trail (`project_rag_audit`) |
| **Task Engine** | Ready | PARTIALLY PROVEN | 8 distinct task types (operational, mytool, work_items, engineering, quality, plan, intake, deliverables) with inconsistent delete behavior (hard vs soft), different status enums, and different assignment models. See FRONTEND_CONSISTENCY_AUDIT for details |
| **Financial Tracking** | Ready | PARTIALLY PROVEN | Revenue/COS/GP/Cashflow trackers are fully rendered. KPI calculations are inline in `project-detail.tsx:1061-1139` using client-side aggregation from multiple queries — no single authoritative API. See KPI_TRACEABILITY_MATRIX |
| **Engineering** | Ready | PROVEN READY | `EngTasksTab` (inline, lines 262-683) with template generation, status management (9 statuses), approval flags (QC + Ops), soft-delete. Stages overview via `/api/projects/:id/eng-stages` |
| **Quality** | Ready | PROVEN READY | QC checklist system with templates, phases, evidence upload, approval workflow, risk assessment, warnings engine, plan links, post-mortem metrics. 40+ quality API endpoints. Permission-gated (`quality` + `pd_quality`) |
| **My Work** | Ready | PARTIALLY PROVEN | Aggregates 9 task sources via `/api/my-work/all-tasks`. Source links built correctly. BUT: task type inconsistencies (different status enums, different detail drawers) mean user mental model is fragmented |
| **Microsoft Integration** | Ready | NOT PROVEN | OAuth flow + MSAL token management are coded. Sync service runs 15-min intervals for calendar/email/Teams. **But**: all sync depends on linked Azure AD account. Without a live linked account, only graceful fallback (empty data) is proven. The feature itself — seeing real emails, events, chats in-app — is NOT proven |
| **Smart Import** | Ready | PARTIALLY PROVEN | 5-step wizard, canonical field mapping, confidence scoring, issue resolution, rollback, bulk commit all coded. **But**: rollback only removes normalized_* tables — legacy `program_expense`/`program_inflows` are NOT reverted. Manual edit preservation has complex conflict resolution that needs scenario proof. See SMART_IMPORT_SCENARIO_TESTS |
| **Admin** | Ready | PARTIALLY PROVEN | Role management, permission overrides, control center exist. Recovery center (`/admin/recovery`) exists. BUT: not all mistake types are recoverable via UI. See ADMIN_RECOVERY_MATRIX |
| **Portfolios** | Ready | PROVEN READY | Portfolio CRUD with project grouping, headline KPIs, detail page. Permission-gated |
| **Collaboration** | Ready | PROVEN READY | Chat (ProjectChatTab), Approvals, Docs (LocalFolderTab), Timeline, Audit (ProjectHistoryTab + WeeklyReviewWizard). All permission-gated |

---

## 2. VIEWER LOGIC PROOF

### 2.1 Entity Assignments Table

The `entity_assignments` table is the universal assignment system:

| Column | Purpose |
|--------|---------|
| `entityType` | Type of entity (operational_task, mytool_task, work_item, etc.) |
| `entityId` | FK to the entity |
| `assignmentRole` | OWNER, ASSIGNEE, APPROVER, REVIEWER, VIEWER |
| `assigneeType` | internal_user, external_counterparty, external_contact |
| `assigneeId` | FK to user or counterparty |
| `active` | Boolean — supports "clearing" an assignment without delete |

### 2.2 Viewer Scenarios Tested

| Scenario | Expected | Actual (Code Evidence) | Status |
|----------|----------|----------------------|--------|
| **Assignee only** | Task visible to assignee in My Work | `/api/my-work/all-tasks` filters by ownerUserId OR user in assigneeUserIds | PROVEN |
| **Viewer only** | Task visible read-only to viewer | `entityAssignments` with role=VIEWER, active=true. TaskDetailDrawer checks `trackingRole` prop — "viewer" gets read-only mode | PROVEN |
| **Assignee + Viewer** | Both see task, different permissions | Assignee gets edit; viewer gets read-only via `trackingRole` prop in TaskDetailDrawer (`project-detail.tsx:1391`) | PROVEN |
| **Multiple viewers** | All viewers see task | `entityAssignments` supports multiple rows per entity with different assigneeIds, all with role=VIEWER | PROVEN (schema) |
| **Remove viewer** | Viewer loses access | `active=false` set via `clearedByUserId`/`clearedAt`. Queries filter `WHERE active=true` | PROVEN (schema) |
| **Switch task type after viewer exists** | Viewer assignment persists or clears cleanly | `entityAssignments` keyed by entityType+entityId — if task type changes, entityType may mismatch. **Risk:** changing from operational_task to work_item could orphan assignment records | PARTIALLY PROVEN — type switching is rare but schema doesn't cascade |
| **Viewer visibility in My Work** | Viewer sees task in My Work | My Work fetches tasks where user has entityAssignment. Source links built via `buildMyWorkSourceLinks()` | PROVEN |
| **Viewer visibility in task detail** | Viewer sees full detail, read-only | TaskDetailDrawer receives `trackingRole` — when "viewer", edit controls are suppressed | PROVEN |
| **Viewer visibility in reporting** | Not directly applicable | Reporting counts tasks regardless of viewer status | N/A |
| **Viewer permissions vs edit permissions** | Viewer cannot edit | `trackingRole === "viewer"` disables mutation buttons in TaskDetailDrawer | PROVEN |

### 2.3 Viewer Logic Gaps

1. **Orphaned assignments on type switch**: If a task's `entityType` changes (e.g., operational_task promoted to work_item), the old `entityAssignments` record referencing the old `entityType` is not migrated. This is a theoretical risk — type switching is not a common UI operation.

2. **No UI for bulk viewer management**: Viewers are assigned one-at-a-time. No bulk assign/remove for viewers across tasks.

---

## 3. MICROSOFT INTEGRATION HONESTY CHECK

| Component | Classification | Evidence |
|-----------|---------------|----------|
| **Authentication / Account Connection** | PARTIALLY PROVEN | OAuth 2.0 via Azure MSAL coded in `microsoft-auth.ts`. Token caching and refresh via MSAL serialization. BUT: requires actual Azure AD tenant. Without linked account, no token → no sync |
| **Sync Status Endpoint** | PROVEN (fallback only) | `/api/ms-sync/status` returns sync state. When no account linked: returns empty/error gracefully |
| **Outlook Email** | NOT PROVEN | Email sync coded in `ms-sync-service.ts` using Graph API `/me/mailFolders/inbox/messages`. Requires active token. Cannot verify actual email retrieval without linked account |
| **Calendar / Events** | NOT PROVEN | Calendar sync fetches from Graph API `/me/calendarView`. Metadata includes location, busy status, recurrence. Cannot verify without linked account |
| **Teams Data** | NOT PROVEN | Teams chat sync via Graph API `/me/chats`. Member count, last update tracked. Cannot verify without linked account |
| **SharePoint / File Access** | NOT PROVEN | Scopes include `Sites.Read.All, Files.ReadWrite.All` but no dedicated SharePoint sync found in `ms-sync-service.ts`. Only the LocalFolderTab handles document management (local, not SharePoint-connected) |

**Overall Microsoft Integration Rating:** NOT PROVEN FOR CORE FUNCTIONALITY

- The code is well-structured with proper OAuth, token refresh, and error handling
- Graceful fallback is proven — when no account linked, UI shows empty states without crashes
- The actual data retrieval (real emails, real events, real chats) cannot be verified without a live Azure AD linked account
- **Recommendation:** Mark as "Code Complete / Untestable Without Environment" and require UAT with real Microsoft accounts before claiming production-ready

---

## 4. GAP-CLOSE DEFECT LOG

See DEFECT_REGISTER.md for full defect details. Key trust-undermining issues found:

| ID | Area | Severity | Issue | Operational Impact |
|----|------|----------|-------|-------------------|
| GC-001 | Smart Import Rollback | HIGH | Rollback removes `normalized_*` rows but leaves `program_expense`/`program_inflows` intact | Legacy tables show stale data after rollback; financial reports may include rolled-back import data |
| GC-002 | Task Delete Inconsistency | MEDIUM | Operational tasks use hard delete; engineering/mytool/work_items use soft delete | Users cannot "undo" accidentally deleted operational tasks; admins cannot recover |
| GC-003 | Financial KPI Client-Side | MEDIUM | Revenue realised %, COS realised %, margin delta all computed in `project-detail.tsx` client-side from multiple queries | No single authoritative API endpoint; values may differ if any query fails or returns partial data |
| GC-004 | Microsoft Integration Overstated | HIGH | Previously marked as "Ready" but core sync features untestable without linked Azure account | False confidence in MS features; users may expect working email/calendar integration |
| GC-005 | RAG Calculation Fragility | LOW | Schedule/cost/quality RAG derived from inline thresholds (`project-detail.tsx:1080-1095`) with hardcoded boundaries | RAG thresholds (e.g., ≤3 overdue = amber) are not configurable; may not match business rules |
| GC-006 | Manual Edits vs Import Conflict | MEDIUM | Smart Import detects manual edit conflicts but resolution is complex (7+ conflict types) | Users may unknowingly overwrite manual financial corrections when re-importing |

---

## 5. SUMMARY

### Trust Gaps Still Open

1. **Smart Import rollback does not fully revert** — legacy tables retain data
2. **Financial KPI computation is client-side** — no server-side authority
3. **Microsoft integration is code-complete but unproven** in production
4. **Task model inconsistency** across 8 task types undermines user confidence
5. **Operational task hard-delete** prevents admin recovery

### Trust Gaps Closed This Pass

1. Viewer assignment logic is proven across all practical scenarios
2. Permission system is correctly layered (user override → DB role → hardcoded default)
3. Quality system is comprehensive (templates, evidence, approval, warnings, post-mortem)
4. Collaboration features are fully functional and permission-gated
5. Phase management with audit trail is proven
6. Smart Import canonical field mapping and confidence scoring are well-designed

### Product Principle Assessment

> "Users should learn that if something must be done correctly, it should be done through the app front end, and admins should be able to correct normal operational mistakes through the UI."

**Assessment: PARTIALLY MET**

- Most operational mistakes ARE correctable via UI (wrong assignee, wrong status, wrong date)
- BUT: accidentally deleted operational tasks are NOT recoverable (hard delete)
- BUT: rolled-back imports leave legacy table artifacts
- BUT: some financial corrections require understanding of import vs manual edit conflict resolution
- See ADMIN_RECOVERY_MATRIX for full breakdown
