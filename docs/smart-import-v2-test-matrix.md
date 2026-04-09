# Smart Import v2 — Test Matrix

**Last updated:** 2026-04-08

---

## Automated test coverage

| Test file | Tests | Category |
|-----------|-------|----------|
| `smart-import-v2-ux.test.ts` | 51 | UX labels, components, jargon absence |
| `smart-import-incremental-commit.test.ts` | 39 | Commit executor, field resolution, canonical targets |
| `smart-import-conflict-engine.test.ts` | 43 | 3-way merge cases, row/section merge |
| `smart-import-planner-spine.test.ts` | 39 | Canonical source alignment, row matcher |
| `smart-import-commit-guard.test.ts` | 18 | Atomic commit guard |
| `smart-import-authorization.test.ts` | 14 | Permission checks |
| `smart-import-storage-retention.test.ts` | 1 | Temporal retention |
| **Total** | **205** | |

---

## Backend behavior checks

| # | Check | Automated? | Test file |
|---|-------|-----------|-----------|
| B1 | First import classifies all rows as NEW (BASELINE mode) | Yes | planner-spine |
| B2 | Second identical import classifies all rows as UNCHANGED | Yes | planner-spine |
| B3 | Changed field in file → CHANGED classification | Yes | planner-spine |
| B4 | Missing row in file → MISSING_FROM_UPLOAD classification | Yes | planner-spine |
| B5 | 3-way merge: upload changed, app did not → AUTO_ACCEPT_FILE | Yes | conflict-engine |
| B6 | 3-way merge: app changed, upload did not → KEEP_APP | Yes | conflict-engine |
| B7 | 3-way merge: both changed differently → CONFLICT | Yes | conflict-engine |
| B8 | 3-way merge: upload blank, app edited → KEEP_APP | Yes | conflict-engine |
| B9 | 3-way merge: all same → UNCHANGED | Yes | conflict-engine |
| B10 | Unresolved conflicts block commit (409) | Yes | conflict-engine |
| B11 | Resolved conflicts apply chosen values | Yes | incremental-commit |
| B12 | UNCHANGED fields not included in update | Yes | incremental-commit |
| B13 | PLAN writes to work_items (canonical) | Yes | planner-spine, incremental-commit |
| B14 | REVENUE writes to normalized_revenue_lines (canonical) | Yes | planner-spine, incremental-commit |
| B15 | EXPENDITURE writes to normalized_cost_lines (canonical) | Yes | planner-spine, incremental-commit |
| B16 | Does NOT write to programExpense as canonical | Yes | incremental-commit |
| B17 | Does NOT write to programInflows as canonical | Yes | incremental-commit |
| B18 | Does NOT write to normalizedPlanTasks | Yes | planner-spine, incremental-commit |
| B19 | milestoneNo persisted in revenue writes | Yes | conflict-engine |
| B20 | milestoneNo loaded in baseline reader | Yes | conflict-engine |
| B21 | v2 conflict gate runs before v1 manual-edit check | Yes | conflict-engine |
| B22 | Atomic commit guard prevents double-commit | Yes | commit-guard |
| B23 | Import permissions enforced | Yes | authorization |

---

## UX checks

| # | Check | Automated? | Test file |
|---|-------|-----------|-----------|
| U1 | V2 is default mode (useV2 starts true) | Yes | v2-ux |
| U2 | Step labels are plain language | Yes | v2-ux |
| U3 | Import mode shows "First-time import" or "Update" | Yes | v2-ux |
| U4 | Section names use "Schedule", "Revenue", "Costs" | Yes | v2-ux |
| U5 | Classification labels use "New data", "Updated data", etc. | Yes | v2-ux |
| U6 | Conflict actions say "Keep current app value" / "Use uploaded value" | Yes | v2-ux |
| U7 | No "canonical", "normalization", "fingerprint" in main UI | Yes | v2-ux |
| U8 | Advanced details collapsed by default | Yes | v2-ux |
| U9 | Technical details only in Advanced Details panel | Yes | v2-ux |
| U10 | Confirm screen says "Confirm import" not "commit" | Yes | v2-ux |
| U11 | Result screen includes dashboard refresh note | Yes | v2-ux |
| U12 | Decision step shows 3-value comparison | Yes | v2-ux |
| U13 | Bulk decision buttons available | Yes | v2-ux |
| U14 | Modular component structure (not one giant file) | Yes | v2-ux |

---

## File upload checks

| # | Check | Automated? | Notes |
|---|-------|-----------|-------|
| F1 | Single .xlsx file uploads successfully | Partial | UploadStep tested in v1; same component reused |
| F2 | Single .xlsm file uploads successfully | Partial | Same engine |
| F3 | File over 50MB rejected with clear error | Manual | Server-side limit |
| F4 | Non-Excel file rejected with clear error | Manual | Multer filter |
| F5 | Corrupt file shows helpful error message | Manual | Parser error handling |

---

## Folder upload checks

| # | Check | Automated? | Notes |
|---|-------|-----------|-------|
| FO1 | Folder upload selects all .xlsx/.xlsm files | Manual | webkitdirectory browser API |
| FO2 | Each file creates its own import run | Yes (structure) | Same upload endpoint |
| FO3 | Folder and file use same review flow | Yes | v2-ux |
| FO4 | Batch mode available for multiple files | Yes (structure) | BulkCommitPanel |

---

## Conflict checks

| # | Check | Automated? | Test file |
|---|-------|-----------|-----------|
| C1 | True conflict detected (both diverged) | Yes | conflict-engine |
| C2 | Non-conflict auto-resolved (upload only changed) | Yes | conflict-engine |
| C3 | Non-conflict preserved (app only changed) | Yes | conflict-engine |
| C4 | All conflicts must be resolved before commit | Yes | conflict-engine |
| C5 | Resolved conflict decisions are audit-logged | Yes | conflict-engine |
| C6 | Bulk "keep all" / "use all" applies to all fields | Yes (structure) | v2-ux |

---

## Commit behavior checks

| # | Check | Automated? | Test file |
|---|-------|-----------|-----------|
| CM1 | v2 path does NOT soft-close all rows | Yes | incremental-commit |
| CM2 | UNCHANGED rows are not touched | Yes | incremental-commit |
| CM3 | NEW rows are inserted | Yes | incremental-commit |
| CM4 | CHANGED rows updated in-place (PLAN) or soft-close+replace (REVENUE/EXPENDITURE) | Yes | incremental-commit |
| CM5 | MISSING rows are kept (not deleted) | Yes | incremental-commit |
| CM6 | App-owned fields carried forward on replacement rows | Yes | incremental-commit |
| CM7 | Import run marked COMMITTED after success | Yes | incremental-commit |
| CM8 | Dashboard metrics refreshed after commit | Yes (structure) | stabilization |

---

## Post-commit messaging checks

| # | Check | Automated? | Test file |
|---|-------|-----------|-----------|
| P1 | Result screen shows accurate counts | Yes (structure) | v2-ux |
| P2 | Dashboard refresh note is honest | Yes | v2-ux, stabilization |
| P3 | Response includes v2 incremental details | Yes | stabilization |

---

## Manual regression checks

These should be verified manually before production rollout:

| # | Check | Risk |
|---|-------|------|
| M1 | Import a real project tracker file end-to-end | High |
| M2 | Import same file a second time — verify zero changes | High |
| M3 | Edit a value in the app, then re-import — verify conflict detected | High |
| M4 | Resolve a conflict, then commit — verify correct value wins | High |
| M5 | Upload a folder with 3+ files — verify batch flow works | Medium |
| M6 | Switch between Simple and Advanced view mid-flow | Low |
| M7 | Verify dashboard reflects import after ~10 seconds | Medium |
| M8 | Verify rollback still works for v2-committed runs | Medium |
| M9 | Verify existing expense_task_links remain valid after v2 import | Medium |
