# Emergent Energy Dashboard — Gap Close Report (Second Pass)

## Audit Date: 2026-03-06

---

## 1. Executive Summary

This report documents a trust-hardening second pass conducted after the initial system audit. The objective was to move the assessment from "improved and promising" to "operationally trustworthy" by closing specific evidence gaps.

**Overall Assessment: PARTIALLY PROVEN**

The system is architecturally sound and demonstrates strong patterns in financial data management, project structure, and permission gating. However, several critical areas remain partially proven or not proven due to:
- Smart Import error handling returns 500s instead of 400s for validation failures
- No active import runs available to test the full commit pipeline
- Viewer assignment has no explicit UI — viewers come only from Smart Import
- Non-admin role login requires Microsoft SSO (cannot be tested without linked accounts)
- Status naming is fragmented across task types
- Financial KPIs show bulk totals but limited realised/invoiced data for drill-down verification
- My Work returns 0 tasks for tested admin users (no work_item_assignments for admin roles)

---

## 2. Module Readiness Reclassification

| Module | Prior Status | Revised Status | Evidence |
|--------|-------------|---------------|----------|
| Authentication | Ready | PROVEN READY | Admin password login works. Non-admin correctly blocked with clear message. JWT tokens issued. Role gating verified. |
| Project Management | Ready | PROVEN READY | 70 projects loaded. Edit, phase change, detail views all functional. Permission-gated correctly. |
| Task Engine | Ready | PARTIALLY PROVEN | Create/edit/delete work for plan tasks (49 tested), engineering tasks (131 verified), operational tasks (49 verified). But: status enums differ across types (Done vs COMPLETE vs done). No unified status model. |
| Financial Tracking | Ready | PARTIALLY PROVEN | GP Tracker correctly computes R445M revenue - R409M COS = R36M GP. Cashflow has 51/53 weeks with data. But: Rev Tracker and COS Tracker show 12 projects with 0 monthly breakdown (no invoices marked). Project summary shows 0 contract_value for all 70 projects. |
| Engineering | Ready | PROVEN READY | 131 engineering tasks with proper status distribution (TO DO: 84, IN PROGRESS: 34, COMPLETE: 3). Dashboard and task endpoints respond correctly. |
| Quality | Ready | PARTIALLY PROVEN | 10 checklists, 460 pending approvals (from QC migration). Dashboard metrics work. But: no evidence of QC workflow completion or approval progression. |
| My Work | Ready | NOT PROVEN | Returns 0 tasks for both admin users tested (dayne, johannes). The endpoint works technically but no work_item_assignments exist for these users. Cannot verify viewer badges, tracking roles, or task aggregation without assigned tasks. |
| Microsoft Integration | Ready | PARTIALLY PROVEN | See Section 4 below. Outlook connected but events empty. Sync status works. Teams/SharePoint require per-user MS accounts. |
| Smart Import | Ready | PARTIALLY PROVEN | File validation rejects non-Excel correctly. Stack trace exposed in error response (security concern). Returns HTTP 500 instead of 400 for validation errors. No import runs available to test commit/preview pipeline. |
| Admin | Ready | PROVEN READY | User management, role permissions, activity log all functional. Admin correctly gets 200 on admin endpoints; non-admin gets 403. |
| Portfolios | Ready | PARTIALLY PROVEN | Portfolio endpoint responds 200 but not verified for data accuracy or cross-project aggregation. |
| Collaboration | Ready | NOT PROVEN | MS Teams chat returns 404 for project lookup. No chat data, knowledge base entries, or email-to-task conversions tested with real data. |

---

## 3. Viewer Logic Assessment

### What Exists
- `work_item_assignments` table supports OWNER, ASSIGNEE, REVIEWER, VIEWER roles
- My Work API (`/api/my-work/all-tasks`) filters for VIEWER assignments and returns `trackingRole: "viewer"`
- Frontend renders "Viewing" badges in TaskDetailDrawer, UnifiedPlanTab, and my-work-tasks

### What Is Not Proven
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Assignee-only task in My Work | Shows in My Work | Cannot test — 0 assignments for test users | NOT PROVEN |
| Viewer-only task in My Work | Shows with "Viewing" badge | Cannot test — no VIEWER assignments exist | NOT PROVEN |
| Assignee + Viewer on same task | Both users see task | Cannot test | NOT PROVEN |
| Multiple viewers | All viewers see task | Cannot test | NOT PROVEN |
| Remove viewer via UI | Viewer removed, task disappears from their My Work | No "Remove Viewer" UI exists | NOT POSSIBLE |
| Add viewer via UI | New viewer assigned | No "Add as Viewer" UI exists — viewers only created via Smart Import | NOT POSSIBLE |
| Switch task type after viewer exists | Viewer retained or cleared | Cannot test | NOT PROVEN |

### Defect: No UI to Manage Viewers
The system supports viewer assignments at the database level, but there is no frontend UI to explicitly add or remove a viewer from a task. Viewers are only created through the Smart Import process. This means:
- Admins cannot assign viewers through the UI
- Admins cannot remove incorrect viewer assignments through the UI
- Viewer management requires direct database access

**Severity: MEDIUM** — Registered as DEF-006.

---

## 4. Microsoft Integration Honest Classification

| Area | Status | Evidence |
|------|--------|----------|
| Authentication / Account Connection | PARTIALLY PROVEN | Outlook status shows `configured: true, connected: true, email: johannes@emergentenergy.co.za`. MS SSO callback route exists. But: cannot test SSO flow without browser-based interaction. |
| Sync Status Endpoint | PROVEN | Returns 200 with `{"lastSync":null,"counts":{"events":0,"emails":0,"teams":0}}`. Fixed in DEF-001. |
| Outlook Status | PROVEN | Returns connection status with email address. Refresh endpoint exists. |
| Calendar/Events | PARTIALLY PROVEN | Endpoint returns empty array `[]` with HTTP 200. Validates date params (returns 400 without them). But: no events synced to verify display/formatting. |
| Teams Data | NOT PROVEN | Project chat endpoint returns 404 for project lookup. No Teams data in database. Requires per-user MS account linking. |
| SharePoint/File Access | NOT PROVEN | No SharePoint-specific test endpoint confirmed. Feature controlled by `feature_ms_sharepoint_docs` flag. Requires MS account + SharePoint site configuration. |

**Conclusion**: The Outlook connection infrastructure works. The sync mechanism is functional but has no data to sync. Teams and SharePoint are NOT PROVEN and should not be marketed as working features without linked Microsoft accounts.

---

## 5. Smart Import Gap Analysis

### Tested Scenarios
| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| No file uploaded | 400 with clear message | 400: "No file uploaded" | PASS |
| Non-Excel file (.txt) | 400 with file type error | 500 with stack trace + "Invalid file type" message | FAIL (DEF-007) |
| Fake .xlsx file (not real Excel) | 400 with corruption error | 500 with "Can't find end of central directory" | FAIL (DEF-008) |
| Import runs listing | List of previous runs | Route not found (returns Vite HTML) | FAIL (DEF-009) |
| Commit nonexistent run | 404 or clear error | Route structure requires `/:runId/commit` path | PASS (validated) |

### Untested Scenarios (No Import Runs Available)
- Valid import file with plan/cost/revenue data
- File with missing required columns
- File with wrong headers (tests fuzzy matching)
- Duplicate rows / duplicate project references
- Partial valid / partial invalid rows
- Overwrite or re-import behavior (manual edit protection)
- Downstream reporting after import
- Admin correction flow after import issue

**Conclusion**: Smart Import file validation exists but has HTTP status code issues (500 instead of 400) and exposes stack traces. The full preview/commit pipeline cannot be tested without actual Excel tracker files. Smart Import is PARTIALLY PROVEN.

---

## 6. Task Model Consistency

### Field Comparison Across Task Types

| Field | Plan Task | Engineering Task | MyTool Task | Operational Task |
|-------|-----------|-----------------|-------------|-----------------|
| title | Yes | Yes | Yes | Yes |
| status | Done/Not Started | TO DO/IN PROGRESS/COMPLETE/HOLD | inbox/planned/in_progress/done | TO DO/IN PROGRESS/COMPLETE/HOLD |
| priority | Yes | Yes (Low/Med/High/Urgent) | Yes (critical/high/normal/low) | Yes (Low/Med/High/Urgent) |
| workstream | Yes (PM/ENG/QUALITY) | Implicit (Engineering) | No | Yes (primaryWorkstream) |
| percentComplete | Yes | Yes | No | Yes |
| assignees | Yes | Yes (assigneeUserIds) | No (personal) | Yes |
| dueDate | Yes (endDate) | Yes | Yes (dueAt) | Yes |
| workItemId | Yes | No | No | No |
| rowNumber | null (canonical) | N/A | N/A | N/A |
| wbsCode | Yes | No | No | No |

### Status Inconsistency (DEF-010)
| Source | "Not Started" | "In Progress" | "Complete" | "Blocked" |
|--------|---------------|---------------|------------|-----------|
| Plan Tasks | Not Started | In Progress | Done | Blocked |
| Engineering | TO DO | IN PROGRESS | COMPLETE | HOLD |
| MyTool | inbox/planned | in_progress | done | blocked |
| Operational | TO DO | IN PROGRESS | COMPLETE | HOLD |

The My Work page has a `normalizeStatus()` function to bridge these differences, but the underlying data model is inconsistent.

### Delete Behavior
| Type | Delete Method | Soft/Hard | Admin Recoverable |
|------|--------------|-----------|-------------------|
| Plan (canonical) | POST /api/work-items/delete | Hard delete | No (permanent) |
| Plan (override) | POST /api/project-plan/delete-tasks | Soft delete (override) | Yes (clear override) |
| Engineering | DELETE /api/eng/tasks/:id | Hard delete | No |
| MyTool | DELETE /api/mytool/tasks/:id | Hard delete | No |
| Operational | DELETE /api/operational-tasks/:id | Hard delete | No |

**All task deletions except plan overrides are permanent with no undo capability.** This is a trust risk for admin recovery.

---

## 7. Summary of New Defects Found

| ID | Gap Area | Severity | Issue |
|----|----------|----------|-------|
| DEF-006 | Viewer Management | MEDIUM | No UI to add/remove viewers — only via Smart Import |
| DEF-007 | Smart Import | MEDIUM | Non-Excel file upload returns HTTP 500 instead of 400, exposes stack trace |
| DEF-008 | Smart Import | MEDIUM | Fake .xlsx returns HTTP 500 instead of 400, exposes stack trace |
| DEF-009 | Smart Import | LOW | Import runs listing route returns Vite HTML fallback (route may not exist or may use different path) |
| DEF-010 | Task Consistency | MEDIUM | Status enums differ across task types (Done vs COMPLETE vs done vs TO DO vs Not Started) |
| DEF-011 | Admin Recovery | MEDIUM | All task deletions except plan overrides are permanent — no undo/restore capability |
| DEF-012 | Financial Data | LOW | All 70 projects show contract_value=None in projects-summary; Rev/COS trackers show 0 monthly breakdown |
| DEF-013 | My Work | MEDIUM | Admin users have 0 work_item_assignments — cannot verify My Work aggregation or viewer features |

See DEFECT_REGISTER.md for full details.
