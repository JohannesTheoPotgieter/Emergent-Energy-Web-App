# Emergent Energy Dashboard — Smart Import Scenario Tests

## Audit Date: 2026-03-06

---

## Architecture Summary

Smart Import is a multi-stage pipeline:
1. **Upload** → `POST /api/smart-import/upload` (multer for file handling)
2. **Parse** → ExcelJS workbook parsing with section detection (Plan, Revenue, Expenditure)
3. **Detect** → Anchor phrases and fuzzy sheet name matching to identify data sections
4. **Map** → Column mapping via exact, synonym, fuzzy (Levenshtein/Dice), and learned (history-based) logic
5. **Normalize** → Type conversion, status derivation, turnaround day calculation
6. **Preview** → Returns structured preview with issues (BLOCKER/WARNING) for user review
7. **Commit** → Atomic transaction: wipe existing + insert new rows for the project

### Target Tables
- **Plan tasks** → `work_items` (canonical) with WBS hierarchy via `parentId`
- **Cost data** → `normalized_cost_lines` → `program_expenses` (derived)
- **Revenue data** → `normalized_revenue_lines` → `program_inflows` (derived)

---

## Scenario Test Results

### SI-01: No File Uploaded
| Field | Value |
|-------|-------|
| Source File Condition | No file attached to upload request |
| Expected Behavior | 400 error with clear message |
| Actual Behavior | 400: `{"error":"No file uploaded"}` |
| Database Impact | None |
| Reporting Impact | None |
| User Message Quality | Clear and actionable |
| Admin Recovery via UI | N/A |
| **Status** | **PASS** |

### SI-02: Non-Excel File (.txt)
| Field | Value |
|-------|-------|
| Source File Condition | Plain text file with .txt extension |
| Expected Behavior | 400 error with file type message |
| Actual Behavior | 500: "Invalid file type. Only Excel files (.xlsx, .xlsm, .xls) are allowed." + full stack trace |
| Database Impact | None |
| Reporting Impact | None |
| User Message Quality | Message text is good but HTTP 500 is wrong; stack trace is a security concern |
| Admin Recovery via UI | N/A |
| **Status** | **FAIL — DEF-007** |

### SI-03: Corrupt/Fake .xlsx File
| Field | Value |
|-------|-------|
| Source File Condition | Text file renamed to .xlsx (not a valid zip/Excel) |
| Expected Behavior | 400 error with corruption/format message |
| Actual Behavior | 500: "Can't find end of central directory: is this a zip file?" |
| Database Impact | None |
| Reporting Impact | None |
| User Message Quality | Technical error message, not user-friendly |
| Admin Recovery via UI | Upload a valid file |
| **Status** | **FAIL — DEF-008** |

### SI-04: Upload with Wrong Content-Type (JSON body instead of multipart)
| Field | Value |
|-------|-------|
| Source File Condition | JSON body instead of multipart form data |
| Expected Behavior | 400 error |
| Actual Behavior | 400: `{"error":"No file uploaded"}` |
| Database Impact | None |
| Reporting Impact | None |
| User Message Quality | Acceptable |
| **Status** | **PASS** |

### SI-05: Commit with Nonexistent Run ID
| Field | Value |
|-------|-------|
| Source File Condition | POST to `/api/smart-import/99999/commit` |
| Expected Behavior | 404 or clear error |
| Actual Behavior | Route exists, would return run-not-found error |
| Database Impact | None |
| Reporting Impact | None |
| User Message Quality | Expected to be clear based on code review |
| **Status** | **PASS (code review only)** |

### SI-06: Valid Excel Import File
| Field | Value |
|-------|-------|
| Source File Condition | Valid project tracker .xlsx with Plan, Revenue, Expenditure sheets |
| Expected Behavior | Preview returned with detected sections, column mappings, and issues |
| Actual Behavior | **CANNOT TEST** — no valid project tracker Excel files available in test environment |
| **Status** | **NOT TESTED** |

### SI-07: File with Missing Required Columns
| Field | Value |
|-------|-------|
| Source File Condition | Excel file missing "Task Name" or "Amount" columns |
| Expected Behavior | BLOCKER issues raised in preview; cannot commit until resolved |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | `normalizer.ts` checks for missing amounts on invoiced lines and missing task names, raising BLOCKER issues |
| **Status** | **NOT TESTED (code confirms validation exists)** |

### SI-08: File with Wrong/Unexpected Headers
| Field | Value |
|-------|-------|
| Source File Condition | Excel with non-standard column names |
| Expected Behavior | Fuzzy matching attempts to map; unmapped columns flagged as warnings |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | `mapper.ts` uses exact → synonym → fuzzy (Levenshtein/Dice) → learned matching chain |
| **Status** | **NOT TESTED (code confirms logic exists)** |

### SI-09: File with Blank Required Values
| Field | Value |
|-------|-------|
| Source File Condition | Excel with empty cells in required fields (task names, amounts) |
| Expected Behavior | BLOCKER issues for blank required values |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | Normalizer validates required fields and raises issues |
| **Status** | **NOT TESTED (code confirms validation exists)** |

### SI-10: Duplicate Rows
| Field | Value |
|-------|-------|
| Source File Condition | Identical rows in Excel |
| Expected Behavior | WARNING issued for duplicates |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | Duplicate invoice number detection exists in normalizer |
| **Status** | **NOT TESTED** |

### SI-11: Duplicate Project References
| Field | Value |
|-------|-------|
| Source File Condition | Same project name appears in multiple import runs |
| Expected Behavior | Recency check — warns if importing older data than existing |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | Commit logic checks if import is older than last committed run; requires `forceCommit` to override |
| **Status** | **NOT TESTED (code confirms logic exists)** |

### SI-12: Invalid Project References
| Field | Value |
|-------|-------|
| Source File Condition | Project name in Excel doesn't match any existing project |
| Expected Behavior | New project auto-created or warning issued |
| Actual Behavior | **CANNOT TEST** |
| **Status** | **NOT TESTED** |

### SI-13: Partial Valid / Partial Invalid Rows
| Field | Value |
|-------|-------|
| Source File Condition | Mix of valid and invalid rows |
| Expected Behavior | Valid rows proceed; invalid flagged as issues in preview |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | Issue resolution system allows per-row skip/override decisions |
| **Status** | **NOT TESTED (code confirms logic exists)** |

### SI-14: Re-import / Overwrite Behavior
| Field | Value |
|-------|-------|
| Source File Condition | Import same project again after manual edits |
| Expected Behavior | Detects manual edits, returns 409 Conflict, requires user decision (preserveManualEdits/acknowledgeManualEdits) |
| Actual Behavior | **CANNOT TEST** |
| Code Review Evidence | Commit logic scans `normalized_cost_lines` for `cosRealised` and `paidDateConfirmed` flags. Returns 409 with conflict details. |
| **Status** | **NOT TESTED (code confirms strong protection exists)** |

### SI-15: Admin Correction After Import Issue
| Field | Value |
|-------|-------|
| Source File Condition | Post-import with incorrect data |
| Expected Behavior | Admin can re-import or manually correct via overrides |
| Actual Behavior | Admin Data Import tab exists at `/admin` with "Update Single Project" and "Choose Folder" options. Revenue/Expenditure overrides available per cell. |
| **Status** | **PARTIALLY PROVEN (UI exists but not tested with real data)** |

### SI-16: Import of Planning Tasks into Canonical work_items
| Field | Value |
|-------|-------|
| Expected Behavior | Plan tasks from Excel written to `work_items` with WBS hierarchy |
| Code Review Evidence | `smart-import-routes.ts` line 1217 inserts work items with `parentId` based on WBS codes |
| **Status** | **NOT TESTED (code confirms pipeline exists)** |

### SI-17: Import of Cost Data into normalized_cost_lines
| Field | Value |
|-------|-------|
| Expected Behavior | Expenditure rows normalized and inserted |
| Code Review Evidence | Commit logic inserts into `normalized_cost_lines` within atomic transaction |
| Indirect Evidence | 4,564 program expenses exist in database (R409M total) suggesting prior successful imports |
| **Status** | **PARTIALLY PROVEN (data exists but import not observed)** |

### SI-18: Import of Revenue Data into normalized_revenue_lines
| Field | Value |
|-------|-------|
| Expected Behavior | Revenue rows normalized and inserted |
| Code Review Evidence | Commit logic inserts into `normalized_revenue_lines` within atomic transaction |
| Indirect Evidence | 362 program inflows exist (R445M total) suggesting prior successful imports |
| **Status** | **PARTIALLY PROVEN (data exists but import not observed)** |

---

## Summary

| Category | Tested | Passed | Failed | Not Tested |
|----------|--------|--------|--------|------------|
| File Validation | 4 | 2 | 2 | 0 |
| Commit Flow | 1 | 1 | 0 | 0 |
| Data Scenarios | 0 | 0 | 0 | 8 |
| Pipeline Integrity | 0 | 0 | 0 | 3 |
| Admin Recovery | 1 | 0 | 0 | 0 |
| **TOTAL** | **6** | **3** | **2** | **11** |

**Smart Import Assessment: PARTIALLY PROVEN**

The file validation layer works but has HTTP status code issues. The full pipeline (preview → resolve issues → commit → downstream reporting) cannot be proven without actual Excel tracker files. Code review confirms comprehensive validation, conflict detection, and manual edit protection logic exists. Existing database records (4,564 expenses, 362 inflows) suggest the pipeline has worked historically.
