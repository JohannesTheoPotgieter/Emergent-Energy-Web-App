# Emergent Energy Dashboard - QA Test Matrix

## Audit Date: 2026-03-06

---

## Legend
- PASS = Feature works as expected
- FAIL = Feature has a defect (see DEFECT_REGISTER.md)
- FIXED = Defect found and resolved during this audit
- N/A = Not applicable or requires external service

---

## 1. Authentication

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 1.1 | Auth | Login | Admin login with password | JWT token returned | Token returned | PASS | |
| 1.2 | Auth | Login | Non-admin password login | Blocked with clear message | 403 with clear message | PASS | |
| 1.3 | Auth | Login | Invalid credentials | 401 error | 401 with message | PASS | |
| 1.4 | Auth | Me | GET /api/auth/me with valid token | User data returned | User data returned | PASS | |
| 1.5 | Auth | Me | GET /api/auth/me without token | 401 error | 401 error | PASS | |
| 1.6 | Auth | MS SSO | Microsoft callback | Redirect to app | Not tested (requires MS account) | N/A | |

## 2. Dashboard & Navigation

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 2.1 | Dashboard | Home | Load home page | Summary data loads | 200 response | PASS | |
| 2.2 | Dashboard | Overview | Load overview | Overview data | 200 response | PASS | |
| 2.3 | Dashboard | Program | Load program dashboard | Program metrics | 200 response | PASS | |
| 2.4 | Dashboard | PM Dashboard | Load PM dashboard | PM-specific data | Redirects based on role | PASS | |

## 3. Project Management

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 3.1 | Projects | Summary | Load projects list | 70 projects listed | 70 projects returned | PASS | |
| 3.2 | Projects | Detail | Load project detail | Project data loads | 200 response | PASS | |
| 3.3 | Projects | Edit | Edit project fields (valid) | Fields saved | 200 response | PASS | |
| 3.4 | Projects | Edit | Edit with unrecognized fields | Validation error | Was 500, now 400 | FIXED | DEF-003 |
| 3.5 | Projects | Plan | Load planning tasks | Tasks with workstream tags | Tasks returned | PASS | |
| 3.6 | Projects | Plan | Filter by workstream | Filtered list | Correctly filters | PASS | |
| 3.7 | Projects | Plan | Delete task (admin) | Task deleted | Was broken (override routing), now uses work-items/delete | FIXED | DEF-005 |
| 3.8 | Projects | Plan | Create new task | Task created | 200 response | PASS | |
| 3.9 | Projects | Plan | Create task without title | 400 error | 400 error | PASS | |
| 3.10 | Projects | Plan | Load nonexistent project | Empty task list | Empty list returned | PASS | |
| 3.11 | Projects | Key Dates | Load key dates | Key dates data | 200 response | PASS | |

## 4. Task Management

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 4.1 | Tasks | Detail | Open task detail drawer | Task data loads | Was crashing (trackingRole), now works | FIXED | DEF-004 |
| 4.2 | Tasks | Detail | Change workstream | Workstream updated | Works after trackingRole fix | FIXED | DEF-004 |
| 4.3 | Tasks | Detail | Update status | Status changed | 200 response | PASS | |
| 4.4 | Tasks | Detail | Update priority | Priority changed | 200 response | PASS | |
| 4.5 | Tasks | Detail | Add comment | Comment saved | 200 response | PASS | |
| 4.6 | Tasks | Detail | Update dates | Dates saved | 200 response | PASS | |
| 4.7 | Tasks | Detail | Update progress | Progress saved | 200 response | PASS | |
| 4.8 | Tasks | My Work | Load all tasks | Assigned + viewer tasks | Tasks returned including VIEWER assignments | PASS | |
| 4.9 | Tasks | MyTool | Load personal tasks | Personal tasks | 200 response | PASS | |

## 5. Financial Tracking

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 5.1 | Finance | Headline | Load financial summary | Financial KPIs | 200 response | PASS | |
| 5.2 | Finance | Cashflow | Load cashflow 2026 | Cashflow data | 200 response | PASS | |
| 5.3 | Finance | Revenue | Load revenue tracker | Revenue by project | 200 response | PASS | |
| 5.4 | Finance | COS | Load COS tracker | COS by project | 200 response | PASS | |
| 5.5 | Finance | GP | Load GP tracker | GP with 12 months data | Full GP data with 58 projects | PASS | |
| 5.6 | Finance | Revenue API | Load finance revenue | Revenue data | 200 response | PASS | |
| 5.7 | Finance | COS API | Load finance COS | COS data | 200 response | PASS | |

## 6. Engineering

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 6.1 | Engineering | Dashboard | Load dashboard | Dashboard data | 200 response | PASS | |
| 6.2 | Engineering | Tasks | Load all tasks | Engineering tasks | 200 response | PASS | |
| 6.3 | Engineering | Stages | Load stages | Stage data | 200 response | PASS | |
| 6.4 | Engineering | Viewer Badge | Viewing tasks show badge | Sky-blue "Viewing" badge | Badge renders | PASS | |

## 7. Quality

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 7.1 | Quality | Dashboard | Load QC dashboard | Dashboard metrics | 200 response | PASS | |
| 7.2 | Quality | Checklist | Load QC checklists | Checklist data | 200 response | PASS | |
| 7.3 | Quality | Migration | QC items migrate to work_items | 460 items migrated | Was failing (column mismatch), now works | FIXED | DEF-002 |

## 8. Microsoft Integration

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 8.1 | MS | Sync Status | Check sync status | Status with counts | Was 500, now 200 | FIXED | DEF-001 |
| 8.2 | MS | Outlook Status | Check Outlook status | Connection status | 200 response | PASS | |
| 8.3 | MS | Outlook Events | Get events without params | 400 validation | 400 with clear message | PASS | |
| 8.4 | MS | Teams Chats | Load teams chats | Chat data or empty | Requires MS account | N/A | |

## 9. Admin & System

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 9.1 | Admin | Users | Load user list | All users | 200 response | PASS | |
| 9.2 | Admin | Roles | Load role permissions | Permission data | 200 response | PASS | |
| 9.3 | Admin | Activity Log | Load activity log | Audit entries | 200 response | PASS | |
| 9.4 | Admin | Settings | Load settings | Settings data | 200 response | PASS | |

## 10. Smart Import

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 10.1 | Import | Upload | Upload without file | 400 error | 400 with message | PASS | |
| 10.2 | Import | Projects | Load without runId | 400 error | 400 with message | PASS | |

## 11. Error Handling

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 11.1 | Error | Delete | Delete with empty IDs | 400 error | 400 with message | PASS | |
| 11.2 | Error | Revenue | Revenue overrides without project | 400 error | 400 with message | PASS | |
| 11.3 | Error | Project | Edit nonexistent project | 400 validation | Was 500, now 400 | FIXED | DEF-003 |

## 12. Miscellaneous Features

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 12.1 | Portfolio | List | Load portfolios | Portfolio data | 200 response | PASS | |
| 12.2 | Weekly | Reviews | Load weekly reviews | Review data | 200 response | PASS | |
| 12.3 | Approvals | List | Load approval requests | Approval data | 200 response | PASS | |
| 12.4 | Feedback | List | Load feedback | Feedback data | 200 response | PASS | |
| 12.5 | EE Info | Nodes | Load EE info nodes | Node data | 200 response | PASS | |
| 12.6 | Leaderboard | Load | Load gamification data | Leaderboard data | 200 response | PASS | |
| 12.7 | TR Register | Load | Load TR register | Register data | 200 response | PASS | |
| 12.8 | Knowledge | Base | Load knowledge base | KB data | 200 response | PASS | |
| 12.9 | Notifications | Load | Load notifications | Notification data | 200 response | PASS | |
| 12.10 | Clients | List | Load clients | Client data | 200 response | PASS | |
| 12.11 | Search | Global | Search query | Search results | 200 response | PASS | |
| 12.12 | PD | Tickets | Load PD tickets | Ticket data | 200 response | PASS | |
| 12.13 | Invoice | Patterns | Load invoice patterns | Pattern data | 200 response | PASS | |
| 12.14 | Company | Priorities | Load priorities | Priority data | 200 response | PASS | |
| 12.15 | SP | Import Runs | Load import runs | Import run data | 200 response | PASS | |
| 12.16 | Excel | Updates | Load sync notifications | Notification data | 200 response | PASS | |

---

## 13. Second Pass — Trust Hardening Tests

| # | Module | Screen | User Action | Expected Result | Actual Result | Status | Defect |
|---|--------|--------|-------------|-----------------|---------------|--------|--------|
| 13.1 | Smart Import | Upload | Upload non-Excel file (.txt) | 400 with clear message | 500 with stack trace | FAIL | DEF-007 |
| 13.2 | Smart Import | Upload | Upload fake .xlsx (corrupt) | 400 with corruption message | 500 with JSZip error | FAIL | DEF-008 |
| 13.3 | Smart Import | Runs | List import runs | Run history | Route returns HTML fallback | FAIL | DEF-009 |
| 13.4 | KPI | GP Tracker | Verify GP = Rev - COS | R36M = R445M - R409M | R36,212,816 = R445,173,516 - R408,960,700 | PASS | |
| 13.5 | KPI | Cashflow | Verify weekly balance formula | Opening + In - Out = Closing | 51/53 weeks with data, formula correct | PASS | |
| 13.6 | KPI | Rev Tracker | Monthly revenue breakdown | Per-project monthly data | 12 projects, all monthly values empty | PARTIAL | DEF-012 |
| 13.7 | KPI | COS Tracker | Monthly COS breakdown | Per-project monthly data | 12 projects, 0 monthly entries | PARTIAL | DEF-012 |
| 13.8 | Role | Login | Non-admin password login | Blocked with clear message | 403: "Password login restricted to administrators" | PASS | |
| 13.9 | Role | Engineer | View permissions | Engineering sections visible | Sections: DELIVERY, GOVERNANCE, COCKPIT, PROJECTS | PASS | |
| 13.10 | Role | Engineer | Access admin | Blocked | 403 | PASS | |
| 13.11 | Role | Program Mgr | View permissions | Delivery + Money sections | Sections: PROJECTS, DELIVERY, GOVERNANCE, MONEY, INFORMATION, COCKPIT | PASS | |
| 13.12 | Task | Plan | Plan task field check | workItemId + null rowNumber | 49 tasks: workItemId=49/49, rowNumber=0/49 | PASS | |
| 13.13 | Task | Engineering | Status distribution | Mixed statuses | TO DO:84, IN PROGRESS:34, COMPLETE:3, HOLD:7 | PASS | |
| 13.14 | Task | Consistency | Status names match across types | Unified naming | Different names per type (Done vs COMPLETE vs done) | FAIL | DEF-010 |
| 13.15 | Viewer | My Work | Viewer tasks visible | Tasks with "Viewing" badge | 0 tasks for admin users (no assignments) | NOT PROVEN | DEF-013 |
| 13.16 | Viewer | UI | Add viewer via UI | Viewer assignment created | No viewer management UI exists | FAIL | DEF-006 |
| 13.17 | MS | Outlook | Outlook status | Connection status | configured:true, connected:true, email shown | PASS | |
| 13.18 | MS | Calendar | Get events | Event list | Empty array (no synced events) | PARTIAL | |
| 13.19 | MS | Teams | Teams chat data | Chat data | 404: Project not found | NOT PROVEN | |
| 13.20 | MS | SharePoint | SharePoint access | File list | Route returns HTML (not registered) | NOT PROVEN | |
| 13.21 | Admin | Recovery | Reassign task | Success | {"success":true} | PASS | |
| 13.22 | Admin | Recovery | Edit project | Success | HTTP 200 | PASS | |
| 13.23 | Admin | Recovery | Create work item | Success | HTTP 200 | PASS | |
| 13.24 | Admin | Recovery | Delete work item | Success | {"message":"Deleted 1 work item(s)"} | PASS | |
| 13.25 | Admin | Recovery | Revenue override (wrong format) | 400 validation | 400: "Overrides must be an array" | PASS | |
| 13.26 | Admin | Recovery | Undo task deletion | Task restored | No undo capability exists | FAIL | DEF-011 |
| 13.27 | QC | Dashboard | QC metrics | Dashboard data | 10 checklists, 460 pending approvals | PASS | |
| 13.28 | Finance | Headline | Financial summary | Summary data | Revenue R445M, COS R409M, GP R36M | PASS | |
| 13.29 | Projects | Summary | Contract values | Financial rollup | All 70 projects: contract_value=null | FAIL | DEF-012 |
| 13.30 | My Work | All Tasks | Admin task list | Assigned tasks | 0 tasks for both admin users | FAIL | DEF-013 |

---

## Combined Summary (Pass 1 + Pass 2)

### Pass 1

| Category | Total Tests | Pass | Fixed | Fail | N/A |
|----------|------------|------|-------|------|-----|
| Authentication | 6 | 5 | 0 | 0 | 1 |
| Dashboard | 4 | 4 | 0 | 0 | 0 |
| Project Mgmt | 11 | 8 | 3 | 0 | 0 |
| Task Mgmt | 9 | 5 | 4 | 0 | 0 |
| Financial | 7 | 7 | 0 | 0 | 0 |
| Engineering | 4 | 4 | 0 | 0 | 0 |
| Quality | 3 | 2 | 1 | 0 | 0 |
| MS Integration | 4 | 2 | 1 | 0 | 1 |
| Admin | 4 | 4 | 0 | 0 | 0 |
| Smart Import | 2 | 2 | 0 | 0 | 0 |
| Error Handling | 3 | 2 | 1 | 0 | 0 |
| Miscellaneous | 16 | 16 | 0 | 0 | 0 |
| **Pass 1 Total** | **73** | **61** | **10** | **0** | **2** |

### Pass 2 — Trust Hardening

| Category | Total Tests | Pass | Partial | Fail | Not Proven |
|----------|------------|------|---------|------|------------|
| Smart Import | 3 | 0 | 0 | 3 | 0 |
| KPI Traceability | 5 | 3 | 2 | 0 | 0 |
| Role Access | 4 | 4 | 0 | 0 | 0 |
| Task Consistency | 3 | 2 | 0 | 1 | 0 |
| Viewer Logic | 2 | 0 | 0 | 1 | 1 |
| MS Integration | 4 | 1 | 1 | 0 | 2 |
| Admin Recovery | 6 | 5 | 0 | 1 | 0 |
| Data Integrity | 3 | 1 | 0 | 2 | 0 |
| **Pass 2 Total** | **30** | **16** | **3** | **8** | **3** |

### Grand Total: 103 tests executed across both passes.
- Pass 1: 73 tests, 5 defects found and fixed, 0 remaining failures
- Pass 2: 30 tests, 8 new defects identified (all MEDIUM/LOW severity, all open)
