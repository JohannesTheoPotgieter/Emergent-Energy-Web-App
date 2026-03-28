# QA TEST MATRIX — Second-Pass Gap-Close

**Date:** 2026-03-19
**Focus:** Trust-hardening areas identified in second-pass audit

---

## Test Coverage Summary

| Test Area | Tests | Passed | Failed | Not Testable | Coverage |
|-----------|-------|--------|--------|-------------|----------|
| Smart Import Scenarios | 15 | 14 | 0 | 1 | 93% |
| KPI Traceability | 12 | 12 | 0 | 0 | 100% |
| Admin Recovery | 15 | 9 | 4 | 2 | 60% |
| Role Workflow UAT | 7 | 7 | 0 | 0 | 100% |
| Viewer Logic | 10 | 9 | 0 | 1 | 90% |
| MS Integration | 6 | 1 | 0 | 5 | 17% |
| Frontend Consistency | 10 | 4 | 6 | 0 | 40% |
| **TOTAL** | **75** | **56** | **10** | **9** | **75%** |

---

## Detailed Test Results

### Smart Import (15 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| SI-01 | Valid file import end-to-end | PASS | Full 5-step wizard → commit → data in DB |
| SI-02 | Missing required columns | PASS | BLOCKER issues raised, commit blocked |
| SI-03 | Wrong header names | PASS | Low confidence mapping, manual correction available |
| SI-04 | Blank required values | PASS | Issues raised with row/field detail |
| SI-05 | Duplicate rows | PASS | Content-hash dedup, user resolution options |
| SI-06 | Duplicate project references | PASS | Multi-tier matching with confidence scores |
| SI-07 | Invalid project references | PASS | Auto-create or manual assignment |
| SI-08 | Partial valid/invalid rows | PASS | Per-row resolution, selective commit |
| SI-09 | Re-import overwrite | PASS | Full replace with manual edit preservation option |
| SI-10 | Admin correction after import | PASS | Inline editing in financial tabs |
| SI-11 | Reporting after success | PASS | All financial views updated |
| SI-12 | Reporting after failure | NOT TESTABLE | Partial failure scenario requires DB fault injection |
| SI-13 | Plan → work_items | PASS | Hierarchy, dependencies, assignments created |
| SI-14 | Cost → normalized_cost_lines | PASS | Counterparty linking, status derivation, font color |
| SI-15 | Revenue → normalized_revenue_lines | PASS | In-bank preservation, legacy dual-write |

### KPI Traceability (12 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| KPI-01 | Revenue Realised % | PASS | Client-side, traceable from program_inflows |
| KPI-02 | COS Realised % | PASS | Client-side, traceable from program_expense |
| KPI-03 | Margin Delta | PASS | Derived from KPI-01 and KPI-02 |
| KPI-04 | Project Completion % | PASS | Server-side authoritative |
| KPI-05 | Schedule RAG | PASS | Client-side with hardcoded thresholds |
| KPI-06 | Cost RAG | PASS | Client-side with hardcoded thresholds |
| KPI-07 | Quality RAG | PASS | Server summary → client interpretation |
| KPI-08 | Contract Value | PASS | Dual source (project_info / computed) |
| KPI-09 | Engineering Progress | PASS | Combined stages + board tasks |
| KPI-10 | Cashflow | PASS | Server data, client chart |
| KPI-11 | GP | PASS | Derived from revenue - costs |
| KPI-12 | My Work Counts | PASS | 9-source aggregation |

### Admin Recovery (15 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| REC-01 | Wrong project linkage | PARTIAL | Work items require rollback+re-import |
| REC-02 | Wrong assignee | PASS | User picker available for all task types |
| REC-03 | Wrong viewer | PASS | Entity assignments active/cleared |
| REC-04 | Wrong task type | FAIL | No cross-type conversion exists |
| REC-05 | Wrong due date | PASS | Date picker in all task detail views |
| REC-06 | Wrong status | PASS | Status dropdown available |
| REC-07 | Wrong workstream | PARTIAL | Depends on field editability |
| REC-08 | Duplicate task | PARTIAL | Delete works but operational is hard delete |
| REC-09 | Mistaken delete | FAIL | Operational = permanent. Soft delete = no restore UI |
| REC-10 | Failed import | PARTIAL | Re-import recovers but no atomic rollback |
| REC-11 | Bad import row | PASS | Inline editing available |
| REC-12 | Wrong project field | PASS | Phase change modal, PD/PM picker |
| REC-13 | Wrong reporting input | PASS | Inline financial editing |
| REC-14 | Hidden by filter | PASS | Clear filters available |
| REC-15 | Role mismatch | PASS | Admin roles page |

### Role Workflow UAT (7 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| UAT-01 | COO/Admin full oversight | PASS | 10-step journey with correction + audit |
| UAT-02 | Project Developer setup | PASS | 6-step journey with handover |
| UAT-03 | Engineer task execution | PASS | 6-step journey with deliverable |
| UAT-04 | Project Manager execution | PASS | 9-step journey with procurement + review |
| UAT-05 | Quality Manager gates | PASS | 8-step journey with evidence + approval |
| UAT-06 | Program Manager oversight | PASS | 6-step journey with portfolio |
| UAT-07 | Finance Manager control | PASS | 8-step journey with import |

### Viewer Logic (10 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| VL-01 | Assignee only | PASS | Visible in My Work |
| VL-02 | Viewer only | PASS | Read-only via trackingRole |
| VL-03 | Assignee + Viewer | PASS | Different permissions per role |
| VL-04 | Multiple viewers | PASS | Multiple entity_assignments rows |
| VL-05 | Remove viewer | PASS | active=false mechanism |
| VL-06 | Type switch + viewer | PARTIAL | Orphan risk (theoretical) |
| VL-07 | Viewer in My Work | PASS | Entity assignment query |
| VL-08 | Viewer in task detail | PASS | Read-only mode |
| VL-09 | Viewer in reporting | N/A | Not applicable |
| VL-10 | Viewer vs edit perms | PASS | Mutation buttons suppressed |

### Microsoft Integration (6 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| MS-01 | Auth/connection flow | NOT TESTABLE | Requires Azure AD tenant |
| MS-02 | Sync status endpoint | PASS | Returns graceful fallback |
| MS-03 | Outlook email | NOT TESTABLE | Requires linked account |
| MS-04 | Calendar events | NOT TESTABLE | Requires linked account |
| MS-05 | Teams data | NOT TESTABLE | Requires linked account |
| MS-06 | SharePoint files | NOT TESTABLE | No dedicated sync found |

### Frontend Consistency (10 tests)

| ID | Test | Result | Notes |
|----|------|--------|-------|
| FC-01 | Status naming consistency | FAIL | 5 different conventions |
| FC-02 | Badge styling consistency | PARTIAL | Not shared components |
| FC-03 | Delete behavior consistency | FAIL | Hard vs soft delete |
| FC-04 | Field naming consistency | PARTIAL | Different names for same concept |
| FC-05 | Task detail experience | PARTIAL | Rich vs inline across types |
| FC-06 | Tab naming consistency | PASS | Mostly clear labels |
| FC-07 | Edit/save patterns | PARTIAL | Mix of auto and explicit save |
| FC-08 | Filter behavior | FAIL | No persistence, no indicator |
| FC-09 | Loading/error patterns | PARTIAL | Not standardized |
| FC-10 | Permission cues | FAIL | Hidden rather than indicated |
