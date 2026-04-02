# Phase 1B Implementation Prompt

> **Scope:** Migrations, preflight audit script, backfill scripts, validation tests, state history tables.  
> **Explicitly excluded:** Bridge writes, route cutovers, auth changes, ORM schema changes, UI changes.  
> **Reference spec:** `docs/phase-1b-additive-schema-spec.md`

---

## What to build

Exactly:
- **8 forward migration files** (7 blocker-resolution migrations + 1 state history tables migration)
- **8 rollback migration files** (one per forward migration)
- **1 preflight audit script** (11 check families, 22 sub-checks total)
- **8 backfill scripts** (7 data backfills + 1 state history snapshot backfill)
- **1 validation test file**

Nothing else.

### Complete file inventory

**Forward migrations:**
1. `20260402_lifecycle_parity_columns.sql`
2. `20260402_approval_type_support.sql`
3. `20260402_client_contact_fields.sql`
4. `20260402_party_abstraction.sql`
5. `20260402_finance_period_derivation.sql`
6. `20260402_evidence_link_parity.sql`
7. `20260402_stale_item_tracking.sql`
8. `20260402_state_history_tables.sql`

**Rollback migrations:**
1. `20260402_lifecycle_parity_columns_rollback.sql`
2. `20260402_approval_type_support_rollback.sql`
3. `20260402_client_contact_fields_rollback.sql`
4. `20260402_party_abstraction_rollback.sql`
5. `20260402_finance_period_derivation_rollback.sql`
6. `20260402_evidence_link_parity_rollback.sql`
7. `20260402_stale_item_tracking_rollback.sql`
8. `20260402_state_history_tables_rollback.sql`

**Preflight audit:**
- `20260402_preflight_audit.sql`

**Backfill scripts (execution order):**
1. `20260402_backfill_01_fiscal_periods.sql`
2. `20260402_backfill_02_client_contacts.sql`
3. `20260402_backfill_03_parties.sql`
4. `20260402_backfill_04_lifecycle_columns.sql`
5. `20260402_backfill_05_approval_lineage.sql`
6. `20260402_backfill_06_evidence_sharepoint.sql`
7. `20260402_backfill_07_finance_typed_dates.sql`
8. `20260402_backfill_08_state_history.sql`

**Validation tests:**
- `qa/tests/unit/phase1b-schema-validation.test.ts`

### Scope classification

Migrations 1–7 and backfills 1–7 resolve the 7 Phase 1A provisional metrics (original Phase 1B scope). Migration 8 and backfill 08 are an **approved Phase 1B extension** that adds state history tables for full audit trail preservation. The state history tables are additive-only, create no dependencies for migrations 1–7, and can be rolled back independently.

---

## Part 1: Migration Files

Create these files in `/migrations/`. Each must be idempotent (`IF NOT EXISTS` / `IF EXISTS`). Each must be wrapped in `BEGIN; ... COMMIT;`.

### 1a. `20260402_lifecycle_parity_columns.sql`

Add to `core.projects`:
- `current_stage_code TEXT`
- `gate_status TEXT`
- `gate_readiness_pct NUMERIC(5,2)`
- `phase_updated_at TIMESTAMP`
- `signed_status TEXT`
- `execution_phase TEXT`

All nullable, no defaults. Add `COMMENT ON COLUMN` for each.

### 1b. `20260402_lifecycle_parity_columns_rollback.sql`

`DROP COLUMN IF EXISTS` for all 6 columns. Wrapped in `BEGIN/COMMIT`.

### 2a. `20260402_approval_type_support.sql`

Add to `documentation.document_approvals`:
- `legacy_approval_id INTEGER UNIQUE`
- `approval_type TEXT`
- `approval_category TEXT`
- `title TEXT`
- `project_id INTEGER REFERENCES core.projects(id)`
- `related_entity_type TEXT`
- `related_entity_id INTEGER`
- `requested_by_user_id INTEGER`
- `urgency TEXT`
- `evidence_links TEXT`
- `source_table TEXT`

All nullable. Add `COMMENT ON COLUMN` for `legacy_approval_id`, `approval_type`, `approval_category`, `project_id`.

### 2b. `20260402_approval_type_support_rollback.sql`

`DROP COLUMN IF EXISTS` for all 11 columns.

### 3a. `20260402_client_contact_fields.sql`

Add to `core.clients`:
- `legal_entity_name TEXT`
- `trading_name TEXT`
- `client_type TEXT`
- `primary_contact_name TEXT`
- `primary_contact_email TEXT`
- `primary_contact_phone TEXT`

All nullable. Add `COMMENT ON COLUMN` for `legal_entity_name`, `client_type`, `primary_contact_name`.

### 3b. `20260402_client_contact_fields_rollback.sql`

`DROP COLUMN IF EXISTS` for all 6 columns.

### 4a. `20260402_party_abstraction.sql`

Create `core.parties`:
```
id BIGSERIAL PRIMARY KEY
legacy_counterparty_id INTEGER UNIQUE
legacy_client_id INTEGER UNIQUE
party_type TEXT NOT NULL
name_canonical TEXT NOT NULL
name_aliases JSONB DEFAULT '[]'::JSONB
is_active BOOLEAN NOT NULL DEFAULT true
vat_number TEXT
registration_number TEXT
contact_person TEXT
contact_email TEXT
contact_phone TEXT
address TEXT
payment_terms TEXT
role_tags TEXT[] DEFAULT '{}'
source_table TEXT NOT NULL
created_at TIMESTAMP NOT NULL DEFAULT NOW()
updated_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Indexes: `idx_parties_name_canonical` on `LOWER(name_canonical)`, `idx_parties_party_type` on `party_type`.

`COMMENT ON TABLE` explaining Phase 1B foundation.

### 4b. `20260402_party_abstraction_rollback.sql`

Drop indexes, then drop table.

### 5a. `20260402_finance_period_derivation.sql`

Add to `finance.cost_lines`:
- `invoice_date_typed DATE`
- `approved_date_typed DATE`
- `paid_date_typed DATE`
- `fiscal_period_id INTEGER`
- `is_opening_balance BOOLEAN NOT NULL DEFAULT false`
- `legacy_row_type TEXT`

Add to `finance.revenue_lines`:
- `invoice_date_typed DATE`
- `expected_payment_date_typed DATE`
- `paid_date_typed DATE`
- `fiscal_period_id INTEGER`
- `is_opening_balance BOOLEAN NOT NULL DEFAULT false`
- `legacy_row_type TEXT`

Create `finance.fiscal_periods`:
```
id SERIAL PRIMARY KEY
legacy_fiscal_period_id INTEGER UNIQUE
fiscal_year_name TEXT NOT NULL
period_name TEXT NOT NULL
start_date DATE NOT NULL
end_date DATE NOT NULL
sort_order INTEGER NOT NULL
source_table TEXT NOT NULL DEFAULT 'public.fiscal_periods'
created_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Indexes: `idx_finance_cost_lines_fiscal_period` on `cost_lines(fiscal_period_id)`, `idx_finance_revenue_lines_fiscal_period` on `revenue_lines(fiscal_period_id)`, `idx_finance_fiscal_periods_range` on `fiscal_periods(start_date, end_date)`.

Add `COMMENT ON COLUMN` for `invoice_date_typed`, `fiscal_period_id` on both tables.

### 5b. `20260402_finance_period_derivation_rollback.sql`

Drop indexes, drop columns from both tables, drop `finance.fiscal_periods` table.

### 6a. `20260402_evidence_link_parity.sql`

Add to `documentation.document_versions`:
- `site_id TEXT`
- `drive_id TEXT`
- `file_item_id TEXT`
- `web_url TEXT`
- `is_approved BOOLEAN DEFAULT false`

Create partial index: `idx_document_versions_file_lineage` on `document_versions(document_id) WHERE legacy_deliverable_file_id IS NOT NULL`.

Add `COMMENT ON COLUMN` for all 5 columns explaining they come from `deliverable_files` via `legacy_deliverable_file_id` join.

### 6b. `20260402_evidence_link_parity_rollback.sql`

Drop index, drop 5 columns.

### 7a. `20260402_stale_item_tracking.sql`

Add `last_synced_at TIMESTAMP` (nullable, no default) to:
- `core.projects`
- `core.clients`
- `documentation.document_approvals`
- `documentation.documents`
- `finance.cost_lines`
- `finance.revenue_lines`

Create `internal.sync_watermarks`:
```
id BIGSERIAL PRIMARY KEY
domain TEXT NOT NULL
last_legacy_write_at TIMESTAMP
last_promoted_sync_at TIMESTAMP
lag_seconds NUMERIC(10,2)
stale_row_count INTEGER DEFAULT 0
checked_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Index: `idx_sync_watermarks_domain_checked` on `(domain, checked_at DESC)`.

Add `COMMENT ON TABLE` and `COMMENT ON COLUMN` for `lag_seconds`.

### 7b. `20260402_stale_item_tracking_rollback.sql`

Drop `last_synced_at` from all 6 tables. Drop index and table.

### 8a. `20260402_state_history_tables.sql`

Create 4 history tables that store full audit trail of every entity pulled from legacy:

- `core.project_state_history` — all project execution state snapshots, with `is_current BOOLEAN` marking the latest per project
- `documentation.approval_state_history` — all approval status snapshots
- `finance.cost_line_history` — all cost line snapshots
- `finance.revenue_line_history` — all revenue line snapshots

Each table has: `is_current BOOLEAN NOT NULL DEFAULT false`, `snapshot_reason TEXT`, `source_table TEXT`, `source_updated_at TIMESTAMPTZ`, `snapshot_at TIMESTAMP`.

Partial indexes on `(entity_id, is_current) WHERE is_current = true` for fast current-state queries.

### 8b. `20260402_state_history_tables_rollback.sql`

Drop all 4 history tables and their indexes.

---

## Part 2: Preflight Audit Script

Create file: `migrations/20260402_preflight_audit.sql`

This is NOT a migration. It is a read-only diagnostic script that outputs PASS/FAIL for each check. It must be run manually before any migration.

Implement all 11 preflight checks from the spec's "Mandatory Preflight Audit Pack" and "Cross-Cutting Rules" sections:
1. Duplicate approval lineage candidates
2. Orphan FK mappings (4 sub-queries)
3. Unparseable finance dates (2 sub-queries)
4. Party canonicalization collisions (2 sub-queries)
5. Unresolved project FK mappings (2 sub-queries)
6. Existing promoted rows that collide with backfill assumptions (4 sub-queries)
7. Orphan legacy files (evidence parity)
8. Ambiguous current-state rows after deterministic ranking (INFO for history, HARD STOP for tied rankings)
9. Opening balance detection and classification audit (SOFT STOP for detected OBs, HARD STOP for multiple OBs per project) — must include detail reports listing every classified row
10. Join multiplication detection on finance lines (duplicate legacy IDs, ambiguous project names)
11. Aggregate inflation detection — row count AND amount, at BOTH per-project AND portfolio/aggregate levels

Format: Each check should be a standalone `SELECT` that can be run independently. Add a comment header with the check name, pass condition, and severity level. Opening balance detail reports (PF-9a-detail, PF-9b-detail) must list every row classified as opening balance for manual review.

---

## Part 3: Backfill Scripts

Create these files in `/migrations/`. Each must be idempotent (use `ON CONFLICT DO NOTHING` or `WHERE ... IS NULL` guards). Each must be wrapped in `BEGIN; ... COMMIT;`.

Execute order matters — see spec "Backfill Execution Order" section.

### `20260402_backfill_01_fiscal_periods.sql`
Replicate `public.fiscal_periods` + `public.fiscal_years` into `finance.fiscal_periods`. Use `ON CONFLICT (legacy_fiscal_period_id) DO NOTHING`.

### `20260402_backfill_02_client_contacts.sql`
Update `core.clients` contact fields from `public.clients` via `legacy_id` join.

### `20260402_backfill_03_parties.sql`
Insert counterparties and clients into `core.parties`. Two separate `INSERT ... ON CONFLICT DO NOTHING` statements.

### `20260402_backfill_04_lifecycle_columns.sql`
Update `core.projects` lifecycle fields from `public.project_execution_state` via `legacy_project_info_id = project_id` join. Filter `deleted_at IS NULL`.
**CRITICAL:** Use `ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) = 1` to select only the single latest row per project. Do NOT use DISTINCT. Multiple historical rows per project are acceptable in the source; only one must be applied to the promoted table.

### `20260402_backfill_05_approval_lineage.sql`
Insert into `documentation.document_approvals` from `public.approvals`. Join keys:
- `core.projects cp ON cp.legacy_project_info_id = a.project_id` (for project_id resolution)
- `documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id AND a.related_entity_type = 'deliverable'` (for document_id, LEFT JOIN — NULL if not document-scoped)
Use `ON CONFLICT (legacy_approval_id) DO NOTHING`. Filter `a.deleted_at IS NULL`.

### `20260402_backfill_06_evidence_sharepoint.sql`
Update `documentation.document_versions` SharePoint fields from `public.deliverable_files`.
Join key: `dv_promoted.legacy_deliverable_file_id = df.id` (NOT `df.version_id`).
Guard: `WHERE dv_promoted.site_id IS NULL`.

### `20260402_backfill_07_finance_typed_dates.sql`
Six steps in order:
0a. Classify opening balance rows on `cost_lines` from `program_expense.row_type` pattern matching. Flag `is_opening_balance = true`. Backfill `legacy_row_type` for all rows.
0b. Classify opening balance rows on `revenue_lines` from `program_inflows.milestone_name` pattern matching.
0c. **AUDIT REPORT** — Output (SELECT, read-only) all rows classified as `is_opening_balance = true` for manual review. Operator MUST review before proceeding.
1. Parse TEXT dates to typed DATE on `finance.cost_lines` (regex guard for `^\d{4}-\d{2}-\d{2}`)
2. Parse TEXT dates to typed DATE on `finance.revenue_lines`
3. Derive `fiscal_period_id` on `cost_lines` from `finance.fiscal_periods` date range. **EXCLUDE opening balance rows** (`AND is_opening_balance = false`).
4. Derive `fiscal_period_id` on `revenue_lines` from `finance.fiscal_periods` date range. **EXCLUDE opening balance rows** (`AND is_opening_balance = false`).
Guard all UPDATE steps with `WHERE ... IS NULL` for idempotency. Opening balance rows retain `fiscal_period_id = NULL` — they are structurally excluded from period movement totals.

### `20260402_backfill_08_state_history.sql`
Populate all 4 history tables with initial snapshots from legacy/promoted data.
- **Project state history:** INSERT all `project_execution_state` rows via `core.projects` join. Use `ROW_NUMBER()` to set `is_current = true` on the latest row per project.
- **Approval state history:** INSERT all `document_approvals` rows where `legacy_approval_id IS NOT NULL`. Each gets `is_current = true` (one row per approval in legacy).
- **Cost line history:** INSERT all `cost_lines` rows. Each gets `is_current = true`.
- **Revenue line history:** INSERT all `revenue_lines` rows. Each gets `is_current = true`.
- Includes integrity checks (SELECT) verifying exactly one `is_current = true` per entity.
- Idempotent via `WHERE NOT EXISTS` guards.
- Must run LAST (after all other backfills).

---

## Part 4: Validation Tests

Create test file: `qa/tests/unit/phase1b-schema-validation.test.ts`

Use the project's existing test patterns (vitest, `db.execute(sql\`...\`)` for raw SQL).

### Test groups:

**Group 1: Schema existence tests** (one per migration)
- Verify each new column exists on the expected table (query `information_schema.columns`)
- Verify each new table exists (query `information_schema.tables`)
- Verify each new index exists (query `pg_indexes`)

**Group 2: Backfill correctness tests** (one per backfill script)
- Lifecycle: `COUNT(*) WHERE core.projects.current_stage_code IS NULL AND legacy has non-null` == 0
- Approvals: `COUNT(document_approvals WHERE legacy_approval_id IS NOT NULL)` == `COUNT(approvals WHERE deleted_at IS NULL)`
- Clients: `core.clients.primary_contact_email` matches `public.clients.primary_contact_email` for all rows
- Parties: `COUNT(core.parties WHERE legacy_counterparty_id IS NOT NULL)` == `COUNT(counterparties WHERE deleted_at IS NULL)`
- Evidence: `COUNT(document_versions WHERE legacy_deliverable_file_id IS NOT NULL AND site_id IS NULL)` == 0
- Finance dates: `COUNT(cost_lines WHERE invoice_date IS NOT NULL AND invoice_date_typed IS NULL)` == 0 (or only unparseable rows)
- Finance periods: `COUNT(cost_lines WHERE invoice_date_typed IS NOT NULL AND fiscal_period_id IS NULL)` == 0

**Group 3: Preflight gate tests** (verify the preflight script detects bad data)
- Insert a known-bad row, run the relevant preflight check, assert it reports the issue
- Clean up after each test

**Group 4: Reconciliation integration tests**
- After all backfills, run `buildPhase1AReconciliationReport()` and assert all 6 domains return `outcome: "pass"`
- Assert no PROVISIONAL notes remain in the `notes` arrays (except stale-lag which should say "no bridge writes active")

---

## Cross-Cutting Rules (Non-Negotiable)

These rules apply to ALL migrations, backfills, reconciliation queries, and any future code that touches promoted schema data.

### Rule 1: One Current Row Per Project (Full History Preserved)

Where the target concept is a current-state record (not an event log or transaction), only one row per project is allowed as "current". All historical rows are preserved in dedicated history tables. Use:

```sql
ROW_NUMBER() OVER (
  PARTITION BY project_id
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
) = 1
```

- Applies to: `project_execution_state` (lifecycle backfill), any future current-state source.
- Does NOT apply to: Transaction records (approvals, cost_lines, revenue_lines) for current-row selection, but ALL entities get history snapshots.
- DISTINCT is NOT an acceptable substitute. It hides row multiplication silently.
- History tables: `core.project_state_history`, `documentation.approval_state_history`, `finance.cost_line_history`, `finance.revenue_line_history` — store every row pulled from legacy with `is_current` flag. Backfill 08 populates initial snapshots. Phase 2 bridge writes add new snapshots on every change.

### Rule 2: Opening Balance Separation

Opening balances must never be mixed into normal transactional movement totals.

- Classification is heuristic (text-pattern matching). Every classified row must appear in the audit report.
- `is_opening_balance = true` rows are excluded from `fiscal_period_id` derivation.
- Reconciliation must separate: opening balance, period movement, closing balance.
- Ambiguous rows default to transaction. The audit report exists to catch misclassification.

### Rule 3: Inflation Prevention

All aggregate checks must cover:
- Row-count inflation AND amount inflation
- Per-project level AND portfolio/aggregate level

---

## What NOT to build

- No changes to any route handler
- No changes to authentication or authorization
- No bridge write logic
- No feature flag changes (flags remain OFF)
- No changes to the Drizzle ORM schema definitions in `shared/schema/` (these are SQL-only migrations)
- No UI changes
- No new API endpoints

---

## Execution checklist

1. Write all 16 migration files (8 forward + 8 rollback)
2. Write the preflight audit script
3. Write all 8 backfill scripts
4. Write the validation test file
5. Run the validation tests to confirm they compile (they will fail until migrations + backfills run — that is expected)
6. Commit all files in a single commit
7. Push to the designated branch
