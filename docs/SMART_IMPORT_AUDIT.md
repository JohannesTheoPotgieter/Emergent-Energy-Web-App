# Smart Import — Code Audit & Financial Rules Verification

## STEP 1 — FINDINGS SUMMARY

### 1. What the Smart Import Does (Step by Step)

1. **Upload** (`POST /api/smart-import/upload`): User uploads .xlsx/.xlsm/.xls file via multer. File stored in `uploads/` with timestamp prefix. Buffer read and passed to `runSmartImportPreview()`.

2. **Detection** (`detector.ts`): Identifies PLAN, REVENUE, EXPENDITURE sections across sheets. Fuzzy sheet name matching, header row scoring with anchor phrases. Extracts project metadata (size, PD, PM, contract value, dates).

3. **Mapping** (`mapper.ts`): Maps raw column headers → canonical field names using 3-level matching (exact, synonym dictionary, fuzzy Levenshtein/Dice). Learned mappings from template_profiles override fuzzy matches.

4. **Normalization** (`normalizer.ts`): Converts raw cells → typed objects (plan tasks, revenue lines, cost lines, execution phases). Validates each row, generates issues (INFO/WARNING/BLOCKER). Issue fingerprinting for dedup.

5. **Preview Storage**: Import run saved to `smart_import_runs` (status=PREVIEW). Issues saved to `import_issues`. Prior resolution rules auto-applied from `issue_resolution_rules`.

6. **User Review**: Frontend wizard shows sections, mappings, issues. User resolves blockers (IGNORED/SKIP_ROW/OVERRIDE/ACCEPTED). Mappings can be overridden and saved as learned rules.

7. **Commit** (`POST /api/smart-import/:runId/commit`):
   - Checks for unresolved blockers → rejects if any
   - Checks for unresolved plan edit notifications (planEditNotifications with status=pending) → rejects with 409 if any
   - Checks import date vs last committed import → rejects if older
   - Checks for manual edits on cost lines (cosRealised, invoiceDateConfirmed, paidDateConfirmed, noRevenueLinked, cashflowConfirmed) → returns conflict list (409) if not acknowledged
   - Within a DB transaction:
     a. Preserves manual edits from cost lines (boolean flags only)
     b. Deletes existing normalized_revenue_lines, normalized_cost_lines, normalized_execution_phases for the project
     c. Deletes existing work items (SMART_IMPORT source)
     d. Reads projectPlanOverrides for manual field overrides on plan rows
     e. Inserts new plan tasks as work_items with manual override values applied
     f. Inserts new normalized_revenue_lines + program_inflows (preserving inBank state)
     g. Processes counterparties (create/match)
     h. Inserts new normalized_cost_lines + program_expense (re-linking expense_task_links and cos_status_overrides)
     i. Re-applies manual edits (boolean flags) to new cost lines by sourceRow
     j. Inserts execution phases
     k. Updates project_revenue_summary with costed summary
     l. Updates projectInfo metadata from detected info
   - Records audit ChangeSet + audit event
   - Returns counts of written records

8. **Rollback** (`POST /api/smart-import/:runId/rollback`): Deletes all data inserted by a specific import run.

### 2. COS Realized — Current Behaviour

**Definition**: COS Realized = cost recognition when invoice exists AND invoice date exists.

**Trigger** (`routes.ts:71-75`):
```typescript
function isCosRealisedCheck(row): boolean {
  return row.expenseInvoiceNumber && row.expenseInvoicedDate both exist and are non-empty
}
```

**When it fires**: During financial calculations on `GET /api/projects/:name/finance-summary` and related routes, NOT during import.

**During import**: The `cosRealised` boolean on `normalized_cost_lines` is imported from Excel data. If a user has manually set `cosRealised=true` in the UI, that flag is preserved across imports (via `manualEditsToPreserve`).

**COS State Classification** (routes.ts:3569-3582):
- 'Paid' = confirmed invoice + confirmed payment date
- 'Realised' = confirmed invoice + invoice date (not yet paid)
- 'Committed' = has PO number
- 'Planned' = default

**Storage**: `financeCosMonthly` table stores pre-aggregated monthly COS. `cosStatusOverrides` allows manual override of COS status per expense line.

### 3. Inflows — Current Behaviour

**Definition**: Revenue/cash received against a project.

**Tables**:
- `program_inflows` (legacy) — milestones with payment tracking
- `normalized_revenue_lines` (smart import canonical)

**Recognition**: An inflow is "realized" when:
- `milestoneInvoiceNumber` is non-empty AND
- `paymentReceivedDate` matches ISO date format

**"In Bank" status**: `inBank` field = 1/true OR (hasPaymentReceived AND hasInvoice)

**During import**: Revenue lines written to both `normalized_revenue_lines` and `program_inflows`. The `inBank` flag is preserved from previous import data per row.

**Forecast**: `forecaster.ts` calculates `forecastInflowReceiptDate` using invoice date + payment terms (default 30 days).

### 4. Payment Rules — Current Behaviour

**Definition**: Payment terms define days-to-pay from invoice date.

**Table**: `payment_terms` (entityType, entityName, termsDays, scenario)

**Default**: 30 days for both revenue and expense forecasting.

**Expense forecast** (`forecaster.ts`):
1. If expensePaymentDate exists → null (actual)
2. If expenseInvoicedDate exists → invoicedDate + termsDays
3. If forecastPaymentDate override exists → use it
4. If PO + constructionStart → constructionStart + 60 + termsDays
5. If constructionStart + commissioningDate → midpoint

**Line-level overrides**: `line_item_overrides` table allows per-line adjustments.

### 5. How the Three Interact

**Execution order during financial calculations** (NOT during import):
1. Load all expense/revenue lines from DB
2. Apply overrides (revenue_tracking_overrides, cosStatusOverrides, projectPlanOverrides)
3. Calculate COS Realized based on isCosRealisedCheck()
4. Calculate Inflow status based on invoice + payment received
5. Apply payment terms to forecast dates
6. Aggregate by month for reporting

**During import**:
- COS Realized: boolean flag imported from Excel, preserved if manually set
- Inflows: written directly, inBank preserved
- Payment rules: NOT applied during import — forecaster runs on-demand

### 6. Audit / Change Tracking

**Exists and is comprehensive**:
- `changeSets` + `fieldChanges` tables — immutable audit trail
- Sources: IMPORT, MANUAL_EDIT, OVERRIDE, CONFLICT_RESOLUTION, PATTERN_LEARNING, COUNTERPARTY_UPDATE, SYSTEM
- `audit_events` table — action-level logging
- `planEditNotifications` — tracks front-end plan edits, must be resolved before import commit
- `diff-engine.ts` — computes field diffs, creates change sets
- `recordManualEdit()`, `recordOverride()`, `recordImportChange()` — convenience functions

### 7. Notification Behaviour

**Exists**:
- `excel-sync-notifications.ts` — sends notifications to PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER, COO_ADMIN, CEO_ADMIN when Excel data changes in UI
- 2-minute dedup window
- `milestone-notifications.ts` — background job checking commissioning dates, schedule delays
- Notification center UI with confirmation workflow
- `notificationThrottle` table prevents duplicates

---

## STEP 2 — FINANCIAL RULES VERIFICATION

### COS Realized — CONFIRMED
- [x] Trigger condition correctly defined: invoice number + invoice date both non-empty
- [x] Fires at the right point: on-demand during finance summary calculations, not prematurely during import
- [x] Correct value recognized: `expenseActualTotal` used for COS amount
- [x] Does not fire multiple times: boolean check, no state accumulation
- [x] Written to correct fields: `cosRealised` on normalized_cost_lines, aggregated to `financeCosMonthly`
- [x] COS Realized interacts correctly: independent of Inflows; Payment Rules don't affect COS trigger

### Inflows — CONFIRMED
- [x] Correctly parsed from import file (milestoneName, amountExVat, invoiceNumber, dates)
- [x] Correctly attributed to project via projectId/projectName
- [x] NOT double-counted: old rows deleted per project before insert within transaction
- [x] Relationship with COS: independent — Inflows use revenue lines, COS uses cost lines
- [x] Stored correctly: normalized_revenue_lines + program_inflows

### Payment Rules — CONFIRMED
- [x] Read and applied: via forecaster.ts on-demand, default 30-day terms
- [x] Trigger conditions defined: invoice date + terms days, with fallback chain
- [x] Correct interaction: forecaster runs after import data is committed, uses latest data
- [x] No overwriting: line_item_overrides allow per-line adjustment without touching base data

### Interaction — CONFIRMED
- [x] Execution order: Import writes raw data → COS/Inflow status calculated on-demand → Forecaster runs independently
- [x] Failure isolation: each runs in separate request context; import failure rolls back transaction
- [x] Combined output traceable: changeSets log import, audit_events log actions

**FLAG**: No issue found with financial rules. All three are correctly implemented and interact properly.

---

## SCHEMA FIELD MAPPING (from live database)

### Project Plan (work_items table + normalized plan)
- taskName, taskNo (wbsCode), phase, startDate, endDate, durationDays, actualStartDate, actualEndDate
- owner (ownerName), status, pctComplete (percentComplete), expectedPctComplete
- isMilestone, indentLevel, parentTaskNo, sourceSheet, sourceRow, importRunId

### Cost (normalized_cost_lines)
- costCategory, counterpartyId, counterpartyName, description
- amountExVat, invoiceNumber, invoiceDate, invoiceDateConfirmed
- approvedDate, paidDate, paidDateConfirmed, poNumber
- cosRealised, cashflowConfirmed, status (PLANNED/INVOICED/APPROVED/PAID)
- sourceSheet, sourceRow, importRunId, turnaroundDays

### Inflows (normalized_revenue_lines + program_inflows)
- milestoneName, amountExVat, vat, invoiceNumber, invoiceDate
- expectedPaymentDate, paidDate, inBankDate, status (PLANNED/INVOICED/PAID/IN_BANK/REALISED)
- sourceSheet, sourceRow, importRunId, turnaroundDays

### Payment Rules (payment_terms + line_item_overrides)
- entityType, entityName, termsDays, scenario
- lineType, lineId, overrideTermsDays, overrideAmount, overrideForecastDate

### Quality (no dedicated quality metrics table exists — FLAG)
- Quality tracking exists only as RAG status on projects (projectRagAudit table)
- No quality_metrics table with target/actual/RAG per metric

### Resource (no dedicated resource allocation table exists — FLAG)
- Resource data exists only as ownerName on work_items and work_item_assignments
- No planned_hours/actual_hours/utilisation tracking table

---

## GAPS IDENTIFIED

### Step 3 Gaps:
1. **File format**: Currently accepts .xlsx, .xlsm, .xls — requirement says .xlsx only
2. **Import summary**: Partially exists in commit response (counts) — needs filename, timestamp, skipped rows, conflict count in one view
3. **Import log**: Partially exists via smart_import_runs + audit_events — needs structured consolidation
4. **Row-level validation**: EXISTS in normalizer.ts — needs verification that failed rows don't halt import

### Step 4 Gaps:
1. **Manual edit tracking for all four edit types**: Partially exists — plan edits tracked via planEditNotifications, cost line boolean flags tracked, but NOT comprehensive field-level tracking for all UI edits
2. **Conflict resolution modal**: Partially exists — 409 response with conflicts returned from commit endpoint, but NO dedicated frontend modal for field-by-field resolution
3. **Protected fields**: Partially exists — manualEditsToPreserve mechanism for boolean flags only
4. **Conflict resolution logging**: NOT YET — resolutions not individually logged with decision details

### Step 5 Gaps:
1. **Project Plan Report**: Does NOT exist as dedicated page
2. **Cost Report**: Does NOT exist as dedicated page
3. **Quality Report**: Does NOT exist — no quality metrics schema
4. **Resource Allocation Report**: Does NOT exist — no resource tracking schema
5. **Excel export**: Infrastructure exists (ExcelJS) but no report-specific exports
6. **Staleness warning**: Does NOT exist
7. **Manual edit flag on reports**: Does NOT exist
