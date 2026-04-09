# Prompt 9 — Temporal Financial Insert Points

All locations in the codebase that INSERT, UPDATE, or DELETE rows in the 8 temporal financial tables. These are the points where temporal column management (`effective_from`, `effective_to`, `snapshot_run_id`) must be integrated when the import pipeline is updated (Prompt 10+).

---

## 1. `server/smart-import-routes.ts` — Bulk Import (DELETE + INSERT)

The smart-import pipeline uses a **delete-then-reinsert** pattern per project per import run.

| Table | Pattern | Lines (approx) |
|-------|---------|-----------------|
| `normalized_revenue_lines` | DELETE by projectId → bulk INSERT | ~L1698/1702 (DELETE), ~L1923 (INSERT) |
| `normalized_cost_lines` | DELETE by projectId → bulk INSERT + UPDATE to re-apply manual edits | ~L1699/1703 (DELETE), ~L2125 (INSERT), ~L2145 (UPDATE) |
| `program_inflows` | DELETE by projectName → bulk INSERT | ~L1956 (DELETE), ~L2004 (INSERT) |
| `program_expense` | DELETE by projectName → bulk INSERT | ~L2193 (DELETE), ~L2233 (INSERT) |
| `project_revenue_summary` | DELETE by projectId → INSERT | DELETE + INSERT in upload handler |

**Rollback operations** (DELETE by importRunId): ~L2572-2577

**Manual edit preservation**: After reimport, `normalized_cost_lines` re-applies preserved manual edits (`cosRealised`, `invoiceDateConfirmed`, `paidDateConfirmed`, `cashflowConfirmed`) via UPDATE at ~L2145.

### Temporal migration action:
- **Before DELETE**: SET `effective_to = NOW()` on existing rows instead of hard-deleting.
- **On INSERT**: Set `effective_from = NOW()`, `effective_to = NULL`, `snapshot_run_id = <current_run_id>`.
- **Rollback DELETEs**: Convert to SET `effective_to = NOW()` (or re-open previously closed rows).
- This converts the destructive pattern into a soft-close + new-version pattern.

---

## 2. `server/storage.ts` — Service Layer Functions

Storage functions that create, delete, or upsert rows:

| Function | Table | Pattern |
|----------|-------|---------|
| `createExpense()` (~L681) | `normalized_cost_lines` | INSERT (legacy API) |
| `deleteExpensesByProject()` (~L710) | `normalized_cost_lines` | DELETE by project |
| `createManyProgramExpenses()` (~L1123) | `program_expense` | Batch INSERT |
| `deleteProgramExpensesByProject()` (~L1129) | `program_expense` | DELETE (replace pattern) |
| `updateProgramExpenseFields()` (~L1161) | `program_expense` | UPDATE individual fields |
| `createRevenue()` (~L730) | `normalized_revenue_lines` | INSERT (legacy API) |
| `deleteRevenuesByProject()` (~L757) | `normalized_revenue_lines` | DELETE by project |
| `createManyProgramInflows()` (~L1201) | `program_inflows` | Batch INSERT |
| `deleteProgramInflowsByProject()` (~L1207) | `program_inflows` | DELETE (replace pattern) |
| `createManyCashflowPoints()` (~L1334) | `cashflow_points` | Batch INSERT (100-record chunks) |
| `deleteCashflowPointsByProject()` (~L1341) | `cashflow_points` | DELETE by project |
| `createManyFinanceRevenueMonthly()` (~L1364) | `finance_revenue_monthly` | Batch INSERT (100-record chunks) |
| `deleteFinanceRevenueMonthlyByProject()` (~L1371) | `finance_revenue_monthly` | DELETE by project |
| `createManyFinanceCosMonthly()` (~L1394) | `finance_cos_monthly` | Batch INSERT (100-record chunks) |
| `deleteFinanceCosMonthlyByProject()` (~L1401) | `finance_cos_monthly` | DELETE by project |
| `upsertProjectRevenueSummary()` (~L2060) | `project_revenue_summary` | UPSERT (UPDATE or INSERT) |

### Temporal migration action:
- Default values (`effective_from = NOW()`, `effective_to = NULL`) handle new inserts automatically via the migration defaults.
- **DELETE functions**: Convert to `SET effective_to = NOW()` instead of hard delete.
- **Upsert functions**: Close the old row (`SET effective_to = NOW()`) before inserting the replacement.
- Pass `snapshot_run_id` when called from an import context.

---

## 3. `server/subcontractor-routes.ts` — Procurement Operations

| Operation | Table | Pattern | Line (approx) |
|-----------|-------|---------|----------------|
| Rebuild from program_expense | `normalized_cost_lines` | DELETE all where sourceSheet='program_expense' → batch INSERT (500-record chunks) | ~L411 (DELETE), ~L481 (INSERT) |
| Rename counterparty | `normalized_cost_lines` | UPDATE counterpartyName | ~L545 |
| Delete counterparty | `normalized_cost_lines` | DELETE by counterpartyId or counterpartyName | ~L573/577 |
| Update counterparty type | `normalized_cost_lines` | UPDATE counterpartyType | ~L610/614 |
| Merge counterparties | `normalized_cost_lines` | UPDATE name + id for source lines | ~L686/692 |
| Link to counterparty | `normalized_cost_lines` | UPDATE counterpartyId | ~L781 |

### Temporal migration action:
- **INSERT**: Defaults handle `effective_from`. No `snapshot_run_id` needed (manual entry).
- **DELETE**: Convert to `SET effective_to = NOW()` instead of hard delete.
- **UPDATE** (counterparty ops): These are metadata updates on current rows — no temporal versioning needed for field-level edits.

---

## 4. `server/routes.ts` — Route-level Operations

| Route | Table | Pattern | Line (approx) |
|-------|-------|---------|----------------|
| Bulk file upload | `normalized_cost_lines`, `normalized_revenue_lines` | DELETE by project → INSERT parsed Excel data | ~L5520 (DELETE), ~L5561/5577 (INSERT) |
| Excel upload workflow | `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` | INSERT via txStorage | ~L5457 |
| Reprocess uploads | `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` | INSERT | ~L5736/5739/5742 |
| Admin refresh data | `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` | INSERT | ~L8814-8816 |
| File refresh | `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` | INSERT | ~L9104/9107/9110 |
| Excel upload | `project_revenue_summary` | UPSERT | ~L5598 |

### Temporal migration action:
- **DELETE + INSERT patterns**: Convert DELETE to soft-close, set temporal columns on INSERT.
- **Pure INSERTs**: Defaults handle `effective_from`.

---

## 5. `server/invoice-pattern-routes.ts` — Pattern Classification

| Operation | Table | Pattern | Line (approx) |
|-----------|-------|---------|----------------|
| Delete pattern rule | `normalized_cost_lines` | UPDATE: clear patternRuleId, patternClassifiedAt, patternInferredType | ~L340 |
| Match invoices | `normalized_cost_lines` | UPDATE: set pattern classification fields | ~L626 |
| Admin reset-tags | `normalized_cost_lines` | UPDATE: clear all pattern fields | ~L741 |
| Delete counterparty | `normalized_cost_lines` | UPDATE: clear counterpartyId | ~L1174 |

### Temporal migration action:
- These are all field-level UPDATE operations on metadata columns — no temporal versioning needed. They modify attributes of current rows, not financial amounts.

---

## 6. `server/departments/finance-routes.ts` — Finance Dashboard

| Operation | Table | Pattern | Line (approx) |
|-----------|-------|---------|----------------|
| Sync revenue status from program_inflows | `normalized_revenue_lines` | UPDATE: paidDateConfirmed, paidDateFontColor, paidDate, inBankDate | ~L2842 |

### Temporal migration action:
- Field-level status sync — no temporal versioning needed for status flags.

---

## 7. `server/deliverable-capture-routes.ts` — Deliverable Upload

| Operation | Table | Pattern | Line (approx) |
|-----------|-------|---------|----------------|
| Set invoice number from upload | `normalized_cost_lines` | UPDATE invoiceNumber | ~L175 |
| Set invoice number from upload | `normalized_revenue_lines` | UPDATE invoiceNumber | ~L179 |

### Temporal migration action:
- Field-level metadata update — no temporal versioning needed.

---

## 8. Other Locations

| File | Table | Pattern | Notes |
|------|-------|---------|-------|
| `server/db.ts` (~L775) | `normalized_cost_lines` | UPDATE | Schema migration: initializes cost_line_status field |
| `server/backfillInvoiceConfirmed.ts` (~L183) | `normalized_cost_lines` | UPDATE | One-time backfill for invoice/payment date confirmed flags |

### Temporal migration action:
- Migration/backfill scripts — no temporal changes needed.

---

## Summary: Migration Priority

| Priority | Location | Reason |
|----------|----------|--------|
| **P0** | `smart-import-routes.ts` | Bulk import is the primary data source; DELETE→soft-close is the biggest temporal win |
| **P1** | `storage.ts` DELETE + upsert functions | DELETEs need soft-close; upserts need old-row closure |
| **P2** | `subcontractor-routes.ts` DELETE ops | Convert hard delete to soft close |
| **P3** | `routes.ts` bulk upload DELETE+INSERT | Convert DELETE to soft-close in upload workflows |
| **P4** | All INSERT-only paths | Already handled by column defaults — no code change needed |
| **—** | Field-level UPDATEs (invoice-pattern, finance, deliverable) | No temporal versioning needed for metadata edits |

No existing SELECT queries need modification — the temporal columns are additive and the current `SELECT *` patterns will include them transparently.
