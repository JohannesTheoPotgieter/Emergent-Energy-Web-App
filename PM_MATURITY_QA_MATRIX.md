# PM Maturity QA Matrix — V1.2

## Test Categories

### Dependencies (T001/T002)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| D1 | GET /api/dependencies/project/:id returns empty array for new project | `{ dependencies: [] }` | PASS |
| D2 | POST /api/dependencies creates FS dependency | 201 with dependency object | PASS |
| D3 | POST /api/dependencies with circular path returns 400 | `{ error: "Circular dependency detected" }` | PASS |
| D4 | DELETE /api/dependencies/:id removes dependency | 200 success | PASS |
| D5 | DependencyManager shows predecessor/successor badges | Badges render with task titles | PASS |
| D6 | DependencyManager prevents self-dependency | Validation error | PASS |
| D7 | Audit event logged on create/delete | audit_events table has entries | PASS |

### Approvals Enhancement (T003/T004)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| A1 | POST /api/approvals/general creates approval | 201 with approval object | PASS |
| A2 | PATCH /api/approvals/general/:id approves | Status updated, decidedBy set | PASS |
| A3 | GET /api/approvals/general?projectId=X filters by project | Only project's approvals returned | PASS |
| A4 | ProjectApprovalsTab shows general approvals | General type with violet badges | PASS |
| A5 | Admin approvals page shows "General" filter | Filter tab visible and functional | PASS |
| A6 | Enhanced columns exist in database | All 6 new columns present | PASS |

### Change Control (T005)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| C1 | POST creates change request in draft status | 201 with CR object | PASS |
| C2 | PATCH with invalid transition returns 400 | Error message with valid options | PASS |
| C3 | Pipeline visualisation shows counts per status | Coloured bars with counts | PASS |
| C4 | Change type badges render correctly | Colour-coded by type | PASS |
| C5 | Audit logged on all state changes | Events in audit_events | PASS |

### RAID (T006)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| R1 | POST creates RAID item with type validation | Only risk/assumption/issue/decision accepted | PASS |
| R2 | Filter by type shows correct items | Tab buttons filter correctly | PASS |
| R3 | Priority badges colour-coded | Critical=red, high=orange, medium=yellow, low=gray | PASS |
| R4 | Inline editing saves without dialog | PATCH updates successfully | PASS |

### Procurement (T007)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| P1 | POST creates procurement item | 201 with item object | PASS |
| P2 | Status transitions validated server-side | Invalid transitions rejected | PASS |
| P3 | Supplier select populated from counterparties | SearchableSelect shows suppliers | PASS |
| P4 | KPI summary shows totals | Expected/actual cost, counts | PASS |

### Subcontractor Controls (T008)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| S1 | POST creates assignment | 201 with assignment object | PASS |
| S2 | Status options: active/completed/suspended/terminated | All statuses accepted | PASS |
| S3 | Links to counterparty register | counterparty_id FK valid | PASS |

### Commissioning (T009)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| M1 | POST creates commissioning item | 201 with item object | PASS |
| M2 | Toggle between commissioning/closeout | Filters by item_type | PASS |
| M3 | Progress bars per category | Calculated from item statuses | PASS |
| M4 | Overdue items highlighted | Visual indicator on past-due items | PASS |

### PM On The Go (T010)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| G1 | Add Procurement card creates item | POST to /api/procurement succeeds | PASS |
| G2 | Commissioning card shows items with status | GET and PATCH work | PASS |
| G3 | Approvals card shows pending, approve/reject work | Actions processed | PASS |

### Permissions (T011)
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| X1 | 5 new permission entities in admin roles | Visible in Project Detail Tabs | PASS |
| X2 | New tabs visible in project detail | RAID, Changes, Procurement, Commissioning | PASS |
| X3 | Tab routing works via URL params | Direct links resolve correctly | PASS |
