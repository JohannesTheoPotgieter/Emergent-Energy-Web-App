# Phase 1B: Additive Schema Changes to Close Phase 1A Provisional Metrics

> **Status:** Draft  
> **Scope:** Schema-only additive changes. No legacy table modifications. No bridge writes.  
> **Prerequisite:** Phase 1A signed off as complete within no-schema-change constraints.  
> **Constraint:** Every change below is `ALTER TABLE ... ADD COLUMN` or `CREATE TABLE`. No drops, no renames, no type changes on existing columns.

---

## Blocker 1: Lifecycle Parity Columns

### Problem

The Phase 1A `lifecycle_gates` domain check compares `project_execution_state` against `core.projects`, but `core.projects` is missing two fields that exist in legacy:

| Legacy field (project_execution_state) | Promoted table (core.projects) | Status |
|---|---|---|
| `phase` | `phase` | Already present |
| `execution_gate_status` | `execution_gate_status` | Already present |
| `rag_status` | `rag_status` | Already present |
| `current_stage_code` | *missing* | **BLOCKER** |
| `gate_status` | *missing* | **BLOCKER** |
| `gate_readiness_pct` | *missing* | Not checked in Phase 1A but needed for full parity |
| `phase_updated_at` | *missing* | Needed for temporal correctness of phase transitions |
| `signed_status` | *missing* | Needed for contract signing lifecycle parity |
| `execution_phase` | *missing* | Needed for execution sub-phase tracking |

### Exact Schema Change

```sql
-- Migration: 20260402_lifecycle_parity_columns.sql
BEGIN;

ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS current_stage_code TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS gate_status TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS gate_readiness_pct NUMERIC(5,2);
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMP;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS signed_status TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS execution_phase TEXT;

COMMENT ON COLUMN core.projects.current_stage_code IS 'Mirrors project_execution_state.current_stage_code (S01-S10)';
COMMENT ON COLUMN core.projects.gate_status IS 'Mirrors project_execution_state.gate_status (NOT_STARTED/IN_PROGRESS/READY_FOR_REVIEW/APPROVED/etc)';
COMMENT ON COLUMN core.projects.gate_readiness_pct IS 'Mirrors project_execution_state.gate_readiness_pct (0.00-100.00)';
COMMENT ON COLUMN core.projects.phase_updated_at IS 'Mirrors project_execution_state.phase_updated_at for temporal ordering';
COMMENT ON COLUMN core.projects.signed_status IS 'Mirrors project_execution_state.signed_status';
COMMENT ON COLUMN core.projects.execution_phase IS 'Mirrors project_execution_state.execution_phase';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Revert reconciliation code to skip the new lifecycle fields. The columns remain but are unused. No data loss. Reconciliation falls back to the Phase 1A PROVISIONAL behavior (compares only `phase`, `execution_gate_status`, `rag_status`).

**Destructive (SQL) — only if columns must be physically removed:**
```sql
-- 20260402_lifecycle_parity_columns_rollback.sql
-- WARNING: Destroys all backfilled data in these columns. Only run if operational rollback is insufficient.
BEGIN;
ALTER TABLE core.projects DROP COLUMN IF EXISTS current_stage_code;
ALTER TABLE core.projects DROP COLUMN IF EXISTS gate_status;
ALTER TABLE core.projects DROP COLUMN IF EXISTS gate_readiness_pct;
ALTER TABLE core.projects DROP COLUMN IF EXISTS phase_updated_at;
ALTER TABLE core.projects DROP COLUMN IF EXISTS signed_status;
ALTER TABLE core.projects DROP COLUMN IF EXISTS execution_phase;
COMMIT;
```

### Migration Safety

- **Additive only:** `ADD COLUMN IF NOT EXISTS` with no NOT NULL constraint and no default value means zero lock contention on existing rows.
- **No index needed yet:** These columns are read for reconciliation comparison, not queried by WHERE clauses in hot paths.
- **Nullable by design:** All new columns are nullable. Legacy rows that haven't been backfilled will show NULL, which the reconciliation check interprets as "not yet synced" rather than "mismatch."

### Backfill

```sql
-- One-time backfill (run after migration, idempotent)
UPDATE core.projects cp
SET
  current_stage_code = pes.current_stage_code,
  gate_status = pes.gate_status,
  gate_readiness_pct = pes.gate_readiness_pct,
  phase_updated_at = pes.phase_updated_at,
  signed_status = pes.signed_status,
  execution_phase = pes.execution_phase
FROM public.project_execution_state pes
WHERE cp.legacy_project_info_id = pes.project_id
  AND pes.deleted_at IS NULL;
```

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| `current_stage_code` / `gate_status` have no promoted counterpart | **Fully resolved.** Reconciliation can now compare all lifecycle fields field-by-field. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` lifecycle_gates section (~line 997):
- Add `current_stage_code` and `gate_status` to the SELECT from `core.projects`
- Add field-level comparison for both fields
- Remove the PROVISIONAL note from the notes array
- Add these to the `phaseStageMismatchCount` tally

### Tests Required Before Phase 2

1. **Schema test:** Verify `core.projects` has all 6 new columns after migration
2. **Backfill test:** After backfill, assert zero rows where `core.projects.current_stage_code IS NULL AND legacy project_execution_state.current_stage_code IS NOT NULL`
3. **Reconciliation test:** `lifecycle_gates` domain check must pass with `phase_stage_gate_mismatch_count == 0` including the new fields
4. **Rollback test:** After rollback migration, confirm columns are gone and reconciliation gracefully degrades to PROVISIONAL behavior

---

## Blocker 2: Approval Type Support

### Problem

The Phase 1A `approvals` domain check compares `public.approvals` against `documentation.document_approvals`, but the promoted table is missing critical columns needed for two provisional metrics:

1. **Per-type distribution** — Legacy `approvals` has both `type` (e.g., 'deliverable_approval', 'gate_decision') and `approval_type` (e.g., 'handover', 'budget', 'vo', 'gate', 'exception', 'general'). The promoted table has neither, so type-based distribution comparison is impossible.
2. **Scope fields** — Legacy has `project_id`, `related_entity_type`, `related_entity_id`, `urgency`, `evidence_links`, `requested_by`, `assigned_approver`. Promoted has only `document_id`, `approver_user_id`, `status`, `decision_note`.

| Legacy field (public.approvals) | Promoted (documentation.document_approvals) | Status |
|---|---|---|
| `type` | *missing* | **BLOCKER** |
| `approval_type` | *missing* | **BLOCKER** |
| `title` | *missing* | Needed for human-readable reconciliation |
| `project_id` | *missing* (only via document_id join) | Needed for per-project approval counts |
| `related_entity_type` | *missing* | Needed for entity-level approval tracking |
| `related_entity_id` | *missing* | Needed for entity-level approval tracking |
| `requested_by` | *missing* | Needed for requester parity |
| `assigned_approver` | `approver_user_id` | Already present |
| `urgency` | *missing* | Needed for urgency distribution parity |
| `evidence_links` | *missing* | Needed for evidence-link parity (Blocker 5 overlap) |
| `requested_at` | `created_at` | Approximate parity via created_at |
| `decided_at` | `decided_at` | Already present |

### Exact Schema Change

```sql
-- Migration: 20260402_approval_type_support.sql
BEGIN;

ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS legacy_approval_id INTEGER UNIQUE;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS approval_type TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS approval_category TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES core.projects(id);
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS related_entity_id INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS urgency TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS evidence_links TEXT;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS source_table TEXT;

COMMENT ON COLUMN documentation.document_approvals.legacy_approval_id IS 'FK to public.approvals.id for lineage tracking';
COMMENT ON COLUMN documentation.document_approvals.approval_type IS 'Mirrors public.approvals.approval_type: handover/budget/vo/procurement/gate/exception/general/etc';
COMMENT ON COLUMN documentation.document_approvals.approval_category IS 'Mirrors public.approvals.approval_category for classification';
COMMENT ON COLUMN documentation.document_approvals.project_id IS 'Direct project FK for per-project approval queries without document join';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Revert reconciliation code to skip per-type distribution comparison. The new columns remain but are unused. Reconciliation falls back to count-only + status-distribution comparison (Phase 1A behavior).

**Destructive (SQL) — only if columns must be physically removed:**
```sql
-- 20260402_approval_type_support_rollback.sql
-- WARNING: Destroys all backfilled approval lineage data. The legacy_approval_id mapping is lost.
-- If backfilled rows were inserted (not just columns added), those rows will remain but lose their
-- enrichment columns. Consider whether DELETE WHERE source_table = 'public.approvals' is needed first.
BEGIN;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS legacy_approval_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS approval_type;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS approval_category;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS title;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS project_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS related_entity_type;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS related_entity_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS requested_by_user_id;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS urgency;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS evidence_links;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS source_table;
COMMIT;
```

### Migration Safety

- **Additive only:** All `ADD COLUMN IF NOT EXISTS`, nullable, no defaults that rewrite rows.
- **`legacy_approval_id` UNIQUE constraint:** This is safe on an empty or near-empty table. If the table has existing rows without this value, the UNIQUE constraint still allows multiple NULLs in PostgreSQL.
- **`project_id` FK:** References `core.projects(id)` which must exist. Nullable, so no backfill-ordering issue.
- **No index needed yet:** Reconciliation reads are admin-only, not in hot paths.

### Backfill

```sql
-- One-time backfill: insert promoted approval rows from legacy
-- This assumes document_approvals is currently empty or only has document-scoped approvals.
-- Legacy approvals that are NOT document-scoped get document_id = NULL.
INSERT INTO documentation.document_approvals (
  legacy_approval_id,
  document_id,
  approver_user_id,
  status,
  decision_note,
  decided_at,
  created_at,
  approval_type,
  approval_category,
  title,
  project_id,
  related_entity_type,
  related_entity_id,
  requested_by_user_id,
  urgency,
  evidence_links,
  source_table
)
SELECT
  a.id,
  doc.id,  -- NULL if no document match
  COALESCE(a.assigned_approver, a.decided_by),
  LOWER(COALESCE(a.status::TEXT, 'pending')),
  a.decision_note,
  a.decided_at,
  a.requested_at,
  a.approval_type,
  a.approval_category,
  a.title,
  cp.id,  -- resolved project_id in core.projects
  a.related_entity_type,
  a.related_entity_id,
  a.requested_by,
  a.urgency,
  a.evidence_links,
  'public.approvals'
FROM public.approvals a
LEFT JOIN core.projects cp ON cp.legacy_project_info_id = a.project_id
LEFT JOIN documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id
  AND a.related_entity_type = 'deliverable'
WHERE a.deleted_at IS NULL
ON CONFLICT (legacy_approval_id) DO NOTHING;
```

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| Per-type (gate/exception/handover/general) distribution | **Fully resolved.** `approval_type` column enables `GROUP BY approval_type` distribution comparison. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` approvals section (~line 1038):
- Add a per-type distribution check: `GROUP BY approval_type` on both legacy and promoted, compare distributions
- Join via `legacy_approval_id` instead of relying on count-only comparison
- Remove the PROVISIONAL note about per-type distribution
- Add threshold rule: `per_type_distribution_delta_percent <= 0.1`

### Tests Required Before Phase 2

1. **Schema test:** Verify all 11 new columns exist on `documentation.document_approvals`
2. **Backfill test:** After backfill, assert `COUNT(*) FROM documentation.document_approvals WHERE legacy_approval_id IS NOT NULL` equals `COUNT(*) FROM public.approvals WHERE deleted_at IS NULL`
3. **Type distribution test:** Assert per-type distribution delta is within threshold after backfill
4. **Reconciliation test:** `approvals` domain check must pass with per-type distribution enabled
5. **NULL document_id test:** Verify that non-document approvals (gate, exception, etc.) are correctly inserted with `document_id = NULL`

---

## Blocker 3: Contact Fields and Party Abstraction Foundations

### Problem

The Phase 1A `party_contacts` domain uses two proxies:

1. **Client contact retrieval** uses name-match as proxy because `core.clients` has no contact fields (`primary_contact_name`, `primary_contact_email`, `primary_contact_phone`) and no enrichment fields (`legal_entity_name`, `trading_name`, `client_type`).
2. **Counterparty resolution** checks name presence in `finance.cost_lines` because there is no dedicated party/counterparty table in the promoted schema. The legacy `counterparties` table (with `name_canonical`, `contact_person`, `contact_email`, `contact_phone`, `vat_number`, banking info) has no promoted equivalent.

### Exact Schema Changes

#### 3a. Enrich `core.clients` with contact and classification fields

```sql
-- Migration: 20260402_client_contact_fields.sql
BEGIN;

ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS legal_entity_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS trading_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS client_type TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_phone TEXT;

COMMENT ON COLUMN core.clients.legal_entity_name IS 'Mirrors public.clients.legal_entity_name';
COMMENT ON COLUMN core.clients.client_type IS 'commercial/industrial/residential/government';
COMMENT ON COLUMN core.clients.primary_contact_name IS 'Mirrors public.clients.primary_contact_name for contact parity check';

COMMIT;
```

#### 3b. Create `core.parties` as a unified party abstraction

```sql
-- Migration: 20260402_party_abstraction.sql
BEGIN;

CREATE TABLE IF NOT EXISTS core.parties (
  id BIGSERIAL PRIMARY KEY,
  legacy_counterparty_id INTEGER UNIQUE,
  legacy_client_id INTEGER UNIQUE,
  party_type TEXT NOT NULL,                -- 'client', 'counterparty', 'subcontractor', 'supplier'
  name_canonical TEXT NOT NULL,
  name_aliases JSONB DEFAULT '[]'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  vat_number TEXT,
  registration_number TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  payment_terms TEXT,
  role_tags TEXT[] DEFAULT '{}',
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parties_name_canonical ON core.parties (LOWER(name_canonical));
CREATE INDEX IF NOT EXISTS idx_parties_party_type ON core.parties (party_type);

COMMENT ON TABLE core.parties IS 'Unified party abstraction. Phase 1B foundation only — no write paths depend on this table yet.';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Revert reconciliation code to use name-match proxy for clients and cost-line name lookup for counterparties. The new columns and `core.parties` table remain but are unused. No code path reads from them.

**Destructive (SQL) — only if schema objects must be physically removed:**
```sql
-- 20260402_client_contact_fields_rollback.sql
-- WARNING: Destroys backfilled contact data on core.clients.
BEGIN;
ALTER TABLE core.clients DROP COLUMN IF EXISTS legal_entity_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS trading_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS client_type;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_email;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_phone;
COMMIT;

-- 20260402_party_abstraction_rollback.sql
-- WARNING: Drops the entire core.parties table and all backfilled party data.
-- No other promoted table has FK references to core.parties, so this is safe from a constraint perspective.
BEGIN;
DROP INDEX IF EXISTS core.idx_parties_name_canonical;
DROP INDEX IF EXISTS core.idx_parties_party_type;
DROP TABLE IF EXISTS core.parties;
COMMIT;
```

### Migration Safety

- **`core.clients` additions:** Pure nullable column adds. Zero risk to existing queries.
- **`core.parties` table:** Brand new table. No existing code references it. No FK from other promoted tables points here yet.
- **Index on `LOWER(name_canonical)`:** Functional index is safe to create on an empty table. If the table grows large, this index supports the counterparty name-match reconciliation query.
- **No banking fields in promoted:** `bank_account_number` and `bank_branch_code` are deliberately omitted from `core.parties` — they are encrypted at rest in legacy and should not be replicated to a new table without a separate encryption-at-rest review.

### Backfill

```sql
-- 3a: Backfill core.clients contact fields from legacy
UPDATE core.clients cc
SET
  legal_entity_name = lc.legal_entity_name,
  trading_name = lc.trading_name,
  client_type = lc.client_type,
  primary_contact_name = lc.primary_contact_name,
  primary_contact_email = lc.primary_contact_email,
  primary_contact_phone = lc.primary_contact_phone
FROM public.clients lc
WHERE cc.legacy_id = lc.id;

-- 3b: Backfill core.parties from legacy counterparties
INSERT INTO core.parties (
  legacy_counterparty_id, party_type, name_canonical, name_aliases,
  is_active, vat_number, registration_number,
  contact_person, contact_email, contact_phone,
  address, payment_terms, role_tags, source_table
)
SELECT
  cp.id, 'counterparty', cp.name_canonical, COALESCE(cp.name_aliases, '[]'::JSONB),
  cp.is_active, cp.vat_number, cp.registration_number,
  cp.contact_person, cp.contact_email, cp.contact_phone,
  cp.address, cp.payment_terms, COALESCE(cp.role_tags, '{}'), 'public.counterparties'
FROM public.counterparties cp
WHERE cp.deleted_at IS NULL
ON CONFLICT (legacy_counterparty_id) DO NOTHING;

-- 3b: Also insert clients as parties for unified lookup
INSERT INTO core.parties (
  legacy_client_id, party_type, name_canonical,
  is_active, contact_person, contact_email, contact_phone,
  source_table
)
SELECT
  lc.id, 'client', lc.name,
  true, lc.primary_contact_name, lc.primary_contact_email, lc.primary_contact_phone,
  'public.clients'
FROM public.clients lc
ON CONFLICT (legacy_client_id) DO NOTHING;
```

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| `contact_retrieval_match` uses name-match proxy | **Fully resolved.** Reconciliation can now compare `primary_contact_name`, `primary_contact_email`, `primary_contact_phone` field-by-field between `public.clients` and `core.clients`. |
| Counterparty resolution via `finance.cost_lines` name presence | **Fully resolved.** `core.parties` table enables direct `legacy_counterparty_id` join for counterparty resolution instead of name-matching through cost lines. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` party_contacts section (~line 1225):
- Replace client name-match with field-level comparison of `primary_contact_name`, `primary_contact_email`, `primary_contact_phone`
- Replace counterparty cost-line name lookup with `core.parties WHERE legacy_counterparty_id IS NOT NULL` join
- Remove both PROVISIONAL notes
- Update threshold: `contact_retrieval_match_percent` now compares actual contact fields, not just names

### Tests Required Before Phase 2

1. **Schema test:** Verify 6 new columns on `core.clients` and `core.parties` table exists
2. **Client backfill test:** After backfill, `core.clients.primary_contact_email` matches `public.clients.primary_contact_email` for all rows
3. **Party backfill test:** `COUNT(*) FROM core.parties WHERE legacy_counterparty_id IS NOT NULL` equals `COUNT(*) FROM public.counterparties WHERE deleted_at IS NULL`
4. **Reconciliation test:** `party_contacts` domain passes with field-level contact comparison (no proxy)
5. **Banking exclusion test:** Assert `core.parties` has no `bank_account_number` or `bank_branch_code` columns

---

## Blocker 4: Finance Period Derivation Support

### Problem

The Phase 1A `finance` domain check uses a portfolio-level aggregate as a stand-in for per-project-month breakdown because:

1. **Date fields are TEXT** in promoted `finance.cost_lines` and `finance.revenue_lines` (`invoice_date`, `approved_date`, `paid_date`, `expected_payment_date`). There is no typed DATE column to derive fiscal periods from.
2. **No `fiscal_period_id`** column exists on promoted finance lines, so there is no way to group by fiscal month without parsing TEXT dates at query time.
3. The legacy schema already has `fiscal_years` and `fiscal_periods` tables with proper DATE-typed `start_date`/`end_date` ranges, but the promoted finance lines don't reference them.

### Exact Schema Change

```sql
-- Migration: 20260402_finance_period_derivation.sql
BEGIN;

-- Add typed date columns alongside existing TEXT dates (non-breaking)
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS approved_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER;

ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS expected_payment_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER;

-- Replicate fiscal period definitions into the finance schema for self-contained queries
CREATE TABLE IF NOT EXISTS finance.fiscal_periods (
  id SERIAL PRIMARY KEY,
  legacy_fiscal_period_id INTEGER UNIQUE,
  fiscal_year_name TEXT NOT NULL,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sort_order INTEGER NOT NULL,
  source_table TEXT NOT NULL DEFAULT 'public.fiscal_periods',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_cost_lines_fiscal_period
  ON finance.cost_lines (fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_lines_fiscal_period
  ON finance.revenue_lines (fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_finance_fiscal_periods_range
  ON finance.fiscal_periods (start_date, end_date);

COMMENT ON COLUMN finance.cost_lines.invoice_date_typed IS 'Typed DATE parsed from TEXT invoice_date for fiscal period derivation';
COMMENT ON COLUMN finance.cost_lines.fiscal_period_id IS 'Derived FK to finance.fiscal_periods based on invoice_date_typed';
COMMENT ON COLUMN finance.revenue_lines.fiscal_period_id IS 'Derived FK to finance.fiscal_periods based on invoice_date_typed';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Revert reconciliation code to use portfolio-level aggregate instead of per-project-month breakdown. The typed date columns, `fiscal_period_id`, and `finance.fiscal_periods` table remain but are unused. No operational code path reads from them.

**Destructive (SQL) — only if schema objects must be physically removed:**
```sql
-- 20260402_finance_period_derivation_rollback.sql
-- WARNING: Destroys all derived typed dates and fiscal period assignments.
-- The original TEXT date columns are untouched — no data loss on source fields.
BEGIN;
DROP INDEX IF EXISTS finance.idx_finance_cost_lines_fiscal_period;
DROP INDEX IF EXISTS finance.idx_finance_revenue_lines_fiscal_period;
DROP INDEX IF EXISTS finance.idx_finance_fiscal_periods_range;

ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS invoice_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS approved_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS paid_date_typed;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS fiscal_period_id;

ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS invoice_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS expected_payment_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS paid_date_typed;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS fiscal_period_id;

DROP TABLE IF EXISTS finance.fiscal_periods;
COMMIT;
```

### Migration Safety

- **Additive columns:** All nullable, no defaults that trigger row rewrites.
- **`_typed` suffix convention:** Avoids naming collision with existing TEXT columns. Both columns coexist — the TEXT column remains the source of truth until bridge writes populate the typed column.
- **New `finance.fiscal_periods` table:** Clean copy of legacy fiscal period definitions. No other promoted table references it yet, so creating it is zero-risk.
- **Indexes on nullable FK:** PostgreSQL indexes exclude NULLs by default, so the index is small until backfill runs.

### Backfill

```sql
-- Step 1: Replicate fiscal periods
INSERT INTO finance.fiscal_periods (
  legacy_fiscal_period_id, fiscal_year_name, period_name, start_date, end_date, sort_order, source_table
)
SELECT
  fp.id, fy.name, fp.period_name, fp.start_date, fp.end_date, fp.sort_order, 'public.fiscal_periods'
FROM public.fiscal_periods fp
JOIN public.fiscal_years fy ON fy.id = fp.fiscal_year_id
ON CONFLICT (legacy_fiscal_period_id) DO NOTHING;

-- Step 2: Parse TEXT dates into typed DATE columns (cost lines)
UPDATE finance.cost_lines
SET
  invoice_date_typed = CASE WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::DATE ELSE NULL END,
  approved_date_typed = CASE WHEN approved_date ~ '^\d{4}-\d{2}-\d{2}' THEN approved_date::DATE ELSE NULL END,
  paid_date_typed = CASE WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}' THEN paid_date::DATE ELSE NULL END
WHERE invoice_date_typed IS NULL;

-- Step 3: Parse TEXT dates into typed DATE columns (revenue lines)
UPDATE finance.revenue_lines
SET
  invoice_date_typed = CASE WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::DATE ELSE NULL END,
  expected_payment_date_typed = CASE WHEN expected_payment_date ~ '^\d{4}-\d{2}-\d{2}' THEN expected_payment_date::DATE ELSE NULL END,
  paid_date_typed = CASE WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}' THEN paid_date::DATE ELSE NULL END
WHERE invoice_date_typed IS NULL;

-- Step 4: Derive fiscal_period_id from invoice_date_typed (cost lines)
UPDATE finance.cost_lines cl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE cl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND cl.fiscal_period_id IS NULL;

-- Step 5: Derive fiscal_period_id from invoice_date_typed (revenue lines)
UPDATE finance.revenue_lines rl
SET fiscal_period_id = fp.id
FROM finance.fiscal_periods fp
WHERE rl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date
  AND rl.fiscal_period_id IS NULL;
```

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| Per-project-month breakdown requires fiscal-month derivation | **Fully resolved.** `fiscal_period_id` on both cost and revenue lines enables `GROUP BY project_id, fiscal_period_id` for per-project-month amount comparison. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` finance section (~line 1095):
- Replace portfolio-level aggregate with per-project-per-fiscal-period breakdown
- Join through `fiscal_period_id` to get period names
- Compare `SUM(amount_ex_vat)` per project per period between legacy and promoted
- Update threshold: `absolute_delta_per_project_month <= 0.5` now uses actual per-project-month data
- Remove the PROVISIONAL note

### Tests Required Before Phase 2

1. **Schema test:** Verify typed date columns and `fiscal_period_id` exist on both finance tables
2. **Date parse test:** After backfill, assert `COUNT(*) WHERE invoice_date IS NOT NULL AND invoice_date_typed IS NULL` is zero (or only rows with unparseable dates, which should be logged)
3. **Period derivation test:** Assert `COUNT(*) WHERE invoice_date_typed IS NOT NULL AND fiscal_period_id IS NULL` is zero (all parseable dates map to a fiscal period)
4. **Fiscal period replication test:** `COUNT(*) FROM finance.fiscal_periods` equals `COUNT(*) FROM public.fiscal_periods`
5. **Reconciliation test:** `finance` domain passes with per-project-month comparison enabled

---

## Blocker 5: Evidence-Link Parity Support

### Problem

The Phase 1A `deliverables` domain check uses migration mapping ratio (how many `public.deliverables` rows have a `documentation.documents` counterpart) as a proxy for evidence-link completeness. True parity requires verifying that the *files/evidence attached to each deliverable* also exist in the promoted schema.

**Key existing lineage (from `20260314_multischema_foundation.sql` lines 575-599):**

The foundation migration already handles files via TWO separate inserts into `document_versions`:

1. **Version-sourced rows:** `INSERT INTO documentation.document_versions ... FROM public.deliverable_versions dv` — keyed by `legacy_deliverable_version_id = dv.id`
2. **File-sourced rows:** `INSERT INTO documentation.document_versions ... FROM public.deliverable_files df` — keyed by `legacy_deliverable_file_id = df.id`, with `web_url` stored as `storage_path` and `version_number` derived from `COALESCE(dv.version_number, 1)`

This means `deliverable_files` were **flattened into `document_versions` rows** during the foundation backfill. The `legacy_deliverable_file_id` column on `document_versions` is the lineage key: if it is NOT NULL, that version row originated from a `deliverable_files` record.

**The actual gap:** The flattened rows captured `web_url` (as `storage_path`) and `file_name`, but lost the SharePoint structural identifiers (`site_id`, `drive_id`, `file_item_id`) and the `is_approved` flag. Evidence parity requires these fields.

**The wrong approach (corrected):** Creating a separate `document_files` table would double-count files that were already flattened into `document_versions`. Instead, we enrich the existing `document_versions` rows that already carry `legacy_deliverable_file_id`.

### Exact Schema Change

```sql
-- Migration: 20260402_evidence_link_parity.sql
BEGIN;

-- Enrich document_versions with SharePoint fields lost during foundation flattening
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS site_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS drive_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS file_item_id TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS web_url TEXT;
ALTER TABLE documentation.document_versions ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;

-- Index for evidence parity queries: find all file-sourced version rows per document
CREATE INDEX IF NOT EXISTS idx_document_versions_file_lineage
  ON documentation.document_versions (document_id)
  WHERE legacy_deliverable_file_id IS NOT NULL;

COMMENT ON COLUMN documentation.document_versions.site_id IS 'SharePoint site ID from deliverable_files, backfilled via legacy_deliverable_file_id join';
COMMENT ON COLUMN documentation.document_versions.drive_id IS 'SharePoint drive ID from deliverable_files';
COMMENT ON COLUMN documentation.document_versions.file_item_id IS 'SharePoint file item ID from deliverable_files';
COMMENT ON COLUMN documentation.document_versions.web_url IS 'Direct web URL from deliverable_files (note: storage_path already holds this for file-sourced rows from foundation backfill)';
COMMENT ON COLUMN documentation.document_versions.is_approved IS 'Approval flag from deliverable_files.is_approved';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Set a feature flag to disable evidence-link parity checks in reconciliation. The new columns remain but are ignored.

**Destructive (SQL):**
```sql
-- 20260402_evidence_link_parity_rollback.sql
BEGIN;
DROP INDEX IF EXISTS documentation.idx_document_versions_file_lineage;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS site_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS drive_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS file_item_id;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS web_url;
ALTER TABLE documentation.document_versions DROP COLUMN IF EXISTS is_approved;
COMMIT;
```

### Migration Safety

- **Columns only on existing table:** Nullable, no defaults that rewrite rows. Existing file-sourced version rows get NULLs until backfill.
- **No new table:** Avoids the double-counting risk of a separate `document_files` table.
- **Partial index:** `WHERE legacy_deliverable_file_id IS NOT NULL` keeps the index small — only file-sourced rows are indexed.

### Backfill

The join logic uses `legacy_deliverable_file_id` as the sole join key. This column was populated by the foundation migration and maps 1:1 to `deliverable_files.id`.

```sql
-- Backfill SharePoint fields into document_versions rows that originated from deliverable_files.
-- Join key: document_versions.legacy_deliverable_file_id = deliverable_files.id
-- This is the ONLY correct join. Do NOT join on version_id — that is a separate lineage path.
UPDATE documentation.document_versions dv_promoted
SET
  site_id    = df.site_id,
  drive_id   = df.drive_id,
  file_item_id = df.file_item_id,
  web_url    = df.web_url,
  is_approved = df.is_approved
FROM public.deliverable_files df
WHERE dv_promoted.legacy_deliverable_file_id = df.id
  AND dv_promoted.site_id IS NULL;
```

**Join key proof:**
- `deliverable_files.id` (PK) is the file's identity
- `document_versions.legacy_deliverable_file_id` was populated as `df.id` in foundation migration line 586
- This is a 1:1 mapping. Every non-NULL `legacy_deliverable_file_id` corresponds to exactly one `deliverable_files` row.

**What about files with no `document_versions` row?** The preflight audit (Section 8) detects any `deliverable_files` rows that were not flattened into `document_versions` during the foundation migration. These are reported as `orphan_legacy_files` and must be resolved before evidence parity can pass.

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| `evidence_link_completeness` uses migration mapping ratio as proxy | **Fully resolved.** Reconciliation can now count `document_versions WHERE legacy_deliverable_file_id IS NOT NULL` per document and compare against `deliverable_files` per deliverable for true per-deliverable file parity, including SharePoint field verification. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` deliverables section (~line 1174):
- Add sub-query: for each mapped deliverable, count `deliverable_files` in legacy vs `document_versions WHERE legacy_deliverable_file_id IS NOT NULL` in promoted (grouped by `document_id`)
- Add SharePoint field presence check: `site_id IS NOT NULL` on file-sourced version rows
- Replace mapping-ratio proxy with actual file-count + field-presence comparison
- Add threshold rule: `evidence_file_count_delta == 0` per deliverable
- Remove the PROVISIONAL note

### Tests Required Before Phase 2

1. **Schema test:** Verify 5 new columns exist on `documentation.document_versions`
2. **Backfill test:** After backfill, `COUNT(*) FROM documentation.document_versions WHERE legacy_deliverable_file_id IS NOT NULL AND site_id IS NULL` is zero (all file-sourced rows have SharePoint fields)
3. **Per-deliverable parity test:** For each mapped deliverable, `COUNT(document_versions WHERE legacy_deliverable_file_id IS NOT NULL)` in promoted equals `COUNT(deliverable_files)` in legacy
4. **No double-counting test:** Verify no `document_files` table exists — all evidence is in `document_versions`
5. **Reconciliation test:** `deliverables` domain passes with per-file evidence comparison (no proxy)

---

## Blocker 6: Stale-Item Tracking Foundation

### Problem

The Phase 1A `approvals` domain hardcodes `stale_items_over_15m = 0` because there is no way to detect replication lag between legacy writes and promoted table state. When bridge writes are eventually enabled, a row written to `public.approvals` must appear in `documentation.document_approvals` within a bounded time window. Without a timestamp of when each promoted row was last synced, staleness is unmeasurable.

This blocker also applies to all other domains — any domain with bridge writes needs a "last synced" watermark to detect lag.

### Exact Schema Change

```sql
-- Migration: 20260402_stale_item_tracking.sql
BEGIN;

-- Add sync watermark columns to all promoted tables that will receive bridge writes
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

-- Create a sync watermark log for aggregate lag tracking
CREATE TABLE IF NOT EXISTS internal.sync_watermarks (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,                  -- 'projects', 'clients', 'approvals', 'documents', 'cost_lines', 'revenue_lines'
  last_legacy_write_at TIMESTAMP,        -- max(updated_at) from legacy table at check time
  last_promoted_sync_at TIMESTAMP,       -- max(last_synced_at) from promoted table at check time
  lag_seconds NUMERIC(10,2),             -- computed: last_legacy_write_at - last_promoted_sync_at
  stale_row_count INTEGER DEFAULT 0,     -- rows where legacy updated_at > promoted last_synced_at + 15min
  checked_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_watermarks_domain_checked
  ON internal.sync_watermarks (domain, checked_at DESC);

COMMENT ON TABLE internal.sync_watermarks IS 'Tracks replication lag between legacy and promoted tables. Populated by reconciliation checks, not by bridge writes directly.';
COMMENT ON COLUMN internal.sync_watermarks.lag_seconds IS 'NULL means no bridge writes active yet; 0 means fully caught up.';

COMMIT;
```

### Rollback

**Non-destructive (operational):** Revert reconciliation code to report `stale_items_over_15m = 0` with a hardcoded pass (Phase 1A behavior). The `last_synced_at` columns and `sync_watermarks` table remain but are unused. Since no bridge writes exist yet, these columns are all NULL anyway — no data to lose.

**Destructive (SQL) — only if schema objects must be physically removed:**
```sql
-- 20260402_stale_item_tracking_rollback.sql
-- WARNING: If bridge writes have started populating last_synced_at, dropping these columns
-- destroys the only record of sync timestamps. Only safe pre-bridge-write.
BEGIN;
ALTER TABLE core.projects DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE core.clients DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE documentation.documents DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS last_synced_at;

DROP INDEX IF EXISTS internal.idx_sync_watermarks_domain_checked;
DROP TABLE IF EXISTS internal.sync_watermarks;
COMMIT;
```

### Migration Safety

- **`last_synced_at` columns:** Nullable, no default. Existing rows get NULL, meaning "never synced" — which is correct because bridge writes haven't started.
- **`internal.sync_watermarks` table:** New table in `internal` schema. No FK dependencies. Admin-only reads.
- **No backfill needed:** `last_synced_at` is populated by future bridge writes, not by historical data. The column existing with NULLs is the correct pre-bridge state.

### Backfill

**None required.** The `last_synced_at` column is populated by bridge write logic (Phase 2), not by historical backfill. The `sync_watermarks` table is populated by the reconciliation endpoint itself when it runs.

### Provisional Metrics Resolved

| Provisional metric | Resolution |
|---|---|
| `stale_items_over_15m` hardcoded to 0 | **Infrastructure resolved.** Column exists for bridge writes to populate. Reconciliation can now query `COUNT(*) WHERE last_synced_at < legacy.updated_at - INTERVAL '15 minutes'`. Metric remains 0 until bridge writes are enabled, but this is now *measured* zero rather than *assumed* zero. |

### Reconciliation Code Change Required

In `promoted-read-compat.ts` `buildPhase1AReconciliationReport()` approvals section (~line 1079):
- Replace hardcoded `actual: 0` with actual query: count rows where `last_synced_at IS NOT NULL AND last_synced_at < (legacy.updated_at - INTERVAL '15 minutes')`
- When `last_synced_at IS NULL` for all rows (pre-bridge), report `actual: 0` with note "no bridge writes active"
- Remove the PROVISIONAL note about hardcoded pass
- Optionally: insert a `sync_watermarks` row each time reconciliation runs

### Tests Required Before Phase 2

1. **Schema test:** Verify `last_synced_at` column exists on all 6 promoted tables
2. **Pre-bridge test:** When all `last_synced_at` values are NULL, reconciliation reports `stale_items_over_15m = 0` with a note "no bridge writes active"
3. **Simulated lag test:** Insert test rows with `last_synced_at = NOW() - INTERVAL '20 minutes'` and verify reconciliation reports stale count > 0
4. **Watermark table test:** After reconciliation runs, verify `internal.sync_watermarks` has a row for each domain

---

## Mandatory Preflight Audit Pack

> **Gate rule:** ALL preflight checks must return PASS before any migration or backfill is executed. Any FAIL is a hard stop.

These checks detect data conditions that would cause backfill failures, silent data corruption, or incorrect reconciliation results.

### Preflight 1: Duplicate Approval Lineage Candidates

Detects legacy approval rows that would produce UNIQUE constraint violations on `legacy_approval_id` during backfill.

```sql
-- PASS condition: count = 0
-- FAIL condition: count > 0 (duplicates exist that need manual dedup before backfill)
SELECT id, COUNT(*) AS cnt
FROM public.approvals
WHERE deleted_at IS NULL
GROUP BY id
HAVING COUNT(*) > 1;
```

```sql
-- Also check: any existing document_approvals rows that already have a legacy_approval_id
-- (would conflict with backfill INSERT ON CONFLICT)
-- PASS condition: count = 0
SELECT legacy_approval_id, COUNT(*) AS cnt
FROM documentation.document_approvals
WHERE legacy_approval_id IS NOT NULL
GROUP BY legacy_approval_id
HAVING COUNT(*) > 1;
```

### Preflight 2: Orphan FK Mappings

Detects promoted rows whose FKs point to legacy IDs that no longer exist, or legacy rows that reference nonexistent promoted parents.

```sql
-- core.projects referencing nonexistent legacy project_execution_state
-- PASS condition: count = 0
SELECT cp.id, cp.legacy_project_info_id
FROM core.projects cp
WHERE cp.legacy_project_info_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.project_execution_state pes
    WHERE pes.project_id = cp.legacy_project_info_id AND pes.deleted_at IS NULL
  );
```

```sql
-- core.clients referencing nonexistent legacy clients
-- PASS condition: count = 0
SELECT cc.id, cc.legacy_id
FROM core.clients cc
WHERE cc.legacy_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.clients lc WHERE lc.id = cc.legacy_id);
```

```sql
-- documentation.documents referencing nonexistent legacy deliverables
-- PASS condition: count = 0
SELECT doc.id, doc.legacy_deliverable_id
FROM documentation.documents doc
WHERE doc.legacy_deliverable_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.deliverables d WHERE d.id = doc.legacy_deliverable_id);
```

```sql
-- finance lines referencing nonexistent legacy rows
-- PASS condition: both counts = 0
SELECT 'cost_lines' AS source, COUNT(*) AS orphan_count
FROM finance.cost_lines cl
WHERE cl.legacy_program_expense_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.program_expense pe WHERE pe.id = cl.legacy_program_expense_id)
UNION ALL
SELECT 'revenue_lines', COUNT(*)
FROM finance.revenue_lines rl
WHERE rl.legacy_program_inflow_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.program_inflows pi WHERE pi.id = rl.legacy_program_inflow_id);
```

### Preflight 3: Unparseable Finance Dates

Detects TEXT date fields that will fail `::DATE` casting during the typed-date backfill.

```sql
-- Cost lines with unparseable invoice_date
-- PASS condition: count = 0 (or all listed values are known and acceptable as NULL post-cast)
SELECT cl.id, cl.invoice_date, cl.approved_date, cl.paid_date
FROM finance.cost_lines cl
WHERE (cl.invoice_date IS NOT NULL AND cl.invoice_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (cl.approved_date IS NOT NULL AND cl.approved_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (cl.paid_date IS NOT NULL AND cl.paid_date !~ '^\d{4}-\d{2}-\d{2}');
```

```sql
-- Revenue lines with unparseable dates
-- PASS condition: count = 0 (or all listed values are known and acceptable as NULL post-cast)
SELECT rl.id, rl.invoice_date, rl.expected_payment_date, rl.paid_date
FROM finance.revenue_lines rl
WHERE (rl.invoice_date IS NOT NULL AND rl.invoice_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (rl.expected_payment_date IS NOT NULL AND rl.expected_payment_date !~ '^\d{4}-\d{2}-\d{2}')
   OR (rl.paid_date IS NOT NULL AND rl.paid_date !~ '^\d{4}-\d{2}-\d{2}');
```

### Preflight 4: Party Canonicalization Collisions

Detects counterparties whose canonical names would collide in `core.parties` after case-normalization.

```sql
-- PASS condition: count = 0
SELECT LOWER(TRIM(name_canonical)) AS normalized_name, COUNT(*) AS cnt,
       ARRAY_AGG(id ORDER BY id) AS conflicting_ids
FROM public.counterparties
WHERE deleted_at IS NULL AND is_active = true
GROUP BY LOWER(TRIM(name_canonical))
HAVING COUNT(*) > 1;
```

```sql
-- Also: counterparties whose canonical name matches a client name (party type collision)
-- PASS condition: count = 0 (or reviewed and accepted as distinct parties)
SELECT cp.id AS counterparty_id, cp.name_canonical, lc.id AS client_id, lc.name AS client_name
FROM public.counterparties cp
JOIN public.clients lc ON LOWER(TRIM(cp.name_canonical)) = LOWER(TRIM(lc.name))
WHERE cp.deleted_at IS NULL AND cp.is_active = true;
```

### Preflight 5: Unresolved Project FK Mappings

Detects legacy rows that reference project IDs with no corresponding `core.projects` entry — these would produce NULL `project_id` in backfilled promoted rows.

```sql
-- Approvals referencing projects not in core.projects
-- PASS condition: count = 0
SELECT a.id, a.project_id
FROM public.approvals a
WHERE a.deleted_at IS NULL
  AND a.project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.projects cp WHERE cp.legacy_project_info_id = a.project_id
  );
```

```sql
-- Deliverable files whose parent deliverable's project has no core.projects entry
-- PASS condition: count = 0
SELECT df.id, d.project_id
FROM public.deliverable_files df
JOIN public.deliverables d ON d.id = df.deliverable_id
WHERE NOT EXISTS (
  SELECT 1 FROM core.projects cp WHERE cp.legacy_project_info_id = d.project_id
);
```

### Preflight 6: Existing Promoted Rows That Collide With Backfill Assumptions

Detects pre-existing data in promoted tables that the backfill scripts assume are empty or append-only.

```sql
-- document_approvals already populated with non-null legacy_approval_id
-- (Would be skipped by ON CONFLICT, but may indicate a partial prior run)
-- INFO: If count > 0, verify these are from a prior clean backfill, not stale partial data
SELECT COUNT(*) AS existing_legacy_mapped_approvals
FROM documentation.document_approvals
WHERE legacy_approval_id IS NOT NULL;
```

```sql
-- document_versions already have SharePoint fields populated
-- (Would be skipped by WHERE site_id IS NULL, but may indicate partial prior run)
-- INFO: If count > 0, verify these are from a prior clean backfill
SELECT COUNT(*) AS existing_sharepoint_enriched_versions
FROM documentation.document_versions
WHERE legacy_deliverable_file_id IS NOT NULL AND site_id IS NOT NULL;
```

```sql
-- core.parties already has rows
-- INFO: If count > 0, this is a new table — any existing rows indicate a prior run
SELECT COUNT(*) AS existing_party_rows FROM core.parties;
```

```sql
-- finance lines already have fiscal_period_id populated
-- INFO: If count > 0, verify prior backfill was clean
SELECT
  'cost_lines' AS source, COUNT(*) AS already_derived
FROM finance.cost_lines WHERE fiscal_period_id IS NOT NULL
UNION ALL
SELECT
  'revenue_lines', COUNT(*)
FROM finance.revenue_lines WHERE fiscal_period_id IS NOT NULL;
```

### Preflight 7: Orphan Legacy Files (Evidence Parity)

Detects `deliverable_files` rows that were NOT flattened into `document_versions` during the foundation migration — these would be invisible to the evidence parity check.

```sql
-- PASS condition: count = 0
-- FAIL condition: these files exist in legacy but have no promoted representation
SELECT df.id, df.deliverable_id, df.file_name
FROM public.deliverable_files df
WHERE NOT EXISTS (
  SELECT 1 FROM documentation.document_versions dv
  WHERE dv.legacy_deliverable_file_id = df.id
);
```

### Preflight Summary Gate

| Check | Pass condition | Severity |
|---|---|---|
| PF-1: Duplicate approval lineage | 0 duplicate IDs | **HARD STOP** |
| PF-2: Orphan FK mappings | 0 orphans across all 4 queries | **HARD STOP** |
| PF-3: Unparseable finance dates | 0 unparseable rows (or documented exceptions) | **SOFT STOP** (can proceed if exceptions are logged) |
| PF-4: Party canonicalization collisions | 0 collisions | **HARD STOP** |
| PF-5: Unresolved project FK mappings | 0 unresolved | **HARD STOP** |
| PF-6: Existing promoted rows | Counts documented and verified | **INFO** (review required, not blocking) |
| PF-7: Orphan legacy files | 0 orphan files | **HARD STOP** |

---

## Cross-Cutting Summary

### Migration Execution Order

All migrations are independent and can run in any order, but the recommended sequence is:

| Order | Migration | New objects | Risk | Scope |
|---|---|---|---|---|
| 1 | `20260402_lifecycle_parity_columns.sql` | 6 columns on `core.projects` | Minimal | Original |
| 2 | `20260402_approval_type_support.sql` | 11 columns on `documentation.document_approvals` | Minimal | Original |
| 3 | `20260402_client_contact_fields.sql` | 6 columns on `core.clients` | Minimal | Original |
| 4 | `20260402_party_abstraction.sql` | 1 new table `core.parties` + 2 indexes | Minimal | Original |
| 5 | `20260402_finance_period_derivation.sql` | 12 columns on 2 tables + 1 new table `finance.fiscal_periods` + 3 indexes | Low | Original |
| 6 | `20260402_evidence_link_parity.sql` | 5 columns on `document_versions` + 1 partial index | Low | Original |
| 7 | `20260402_stale_item_tracking.sql` | 6 columns across tables + 1 new table `internal.sync_watermarks` + 1 index | Minimal | Original |
| 8 | `20260402_state_history_tables.sql` | 4 new tables + 5 indexes | Minimal | Extension |

**Scope note:** Migrations 1–7 resolve Phase 1A provisional metrics (original Phase 1B scope). Migration 8 is an approved Phase 1B extension for full audit trail preservation. It is additive-only and can be rolled back independently.

**Total new objects:** 46 columns, 7 new tables, 13 indexes.  
**Total legacy objects modified:** 0.  
**Total existing promoted columns modified:** 0.

### Backfill Execution Order

Backfills must run after all 8 migrations. Order matters for FK resolution:

| Order | Backfill file | Depends on |
|---|---|---|
| 1 | `20260402_backfill_01_fiscal_periods.sql` | No FK deps |
| 2 | `20260402_backfill_02_client_contacts.sql` | No FK deps |
| 3 | `20260402_backfill_03_parties.sql` | No FK deps |
| 4 | `20260402_backfill_04_lifecycle_columns.sql` | No FK deps |
| 5 | `20260402_backfill_05_approval_lineage.sql` | `core.projects` existing (backfill 04) |
| 6 | `20260402_backfill_06_evidence_sharepoint.sql` | `document_versions` rows from foundation |
| 7 | `20260402_backfill_07_finance_typed_dates.sql` | `finance.fiscal_periods` (backfill 01) |
| 8 | `20260402_backfill_08_state_history.sql` | ALL prior backfills (snapshots current state) |

### Provisional-to-Resolved Mapping

| # | Domain | Provisional metric | Blocker | Fully resolved after |
|---|---|---|---|---|
| 1 | lifecycle_gates | `current_stage_code` / `gate_status` missing | Blocker 1 | Migration 1 + backfill |
| 2 | approvals | `stale_items_over_15m` hardcoded | Blocker 6 | Migration 7 (measured zero until bridge writes) |
| 3 | approvals | Per-type distribution unavailable | Blocker 2 | Migration 2 + backfill |
| 4 | finance | Per-project-month breakdown unavailable | Blocker 4 | Migration 5 + backfill |
| 5 | deliverables | `evidence_link_completeness` is proxy | Blocker 5 | Migration 6 + backfill |
| 6 | party_contacts | `contact_retrieval_match` is proxy | Blocker 3 | Migration 3 + backfill |
| 7 | party_contacts | Counterparty resolution incomplete | Blocker 3 | Migration 4 + backfill |

**Status after all migrations + backfills:**
- **6 of 7 provisional metrics become fully measurable** — schema and data exist to perform real field-level comparisons with no proxies.
- **1 metric (stale_items_over_15m) becomes infrastructure-resolved** — the `last_synced_at` column and `sync_watermarks` table provide the measurement machinery, but the metric will report measured-zero until bridge writes are enabled in Phase 2. This is *structurally correct* (the measurement is real, not hardcoded), but the metric cannot detect actual staleness until writes flow through the promoted path.
- **No provisional metrics require proxies or hardcoded values after Phase 1B.** The distinction is between "fully exercised" (6 metrics) and "fully instrumented, awaiting activation" (1 metric).

### Cross-Cutting Rules (Non-Negotiable)

These rules apply to ALL migrations, backfills, reconciliation queries, and any future code that touches promoted schema data.

#### Rule 1: One Current Row Per Project (Latest-Row Selection)

Where the target concept is a current-state record (not an event log or transaction), only one row per project is allowed. Any migration, backfill, or query that derives a "current" row per project MUST use a deterministic latest-row rule:

```sql
ROW_NUMBER() OVER (
  PARTITION BY project_id
  ORDER BY updated_at DESC NULLS LAST,
           created_at DESC NULLS LAST,
           id DESC
) = 1
```

- **Applies to:** `project_execution_state` (lifecycle backfill), and any future current-state source.
- **Does NOT apply to:** Transaction/event records (approvals, cost_lines, revenue_lines) — these are individual records, not snapshots.
- **Does NOT apply to:** Tables where the FK join key is already UNIQUE (e.g., `core.projects.legacy_project_info_id` is UNIQUE, so joins through it are inherently 1:1).
- **DISTINCT is NOT an acceptable substitute.** DISTINCT hides row multiplication silently. Use explicit ROW_NUMBER() ranking.
- **Full history is preserved.** All rows from legacy sources are stored in history tables (`core.project_state_history`, `documentation.approval_state_history`, `finance.cost_line_history`, `finance.revenue_line_history`). The latest row per entity is marked `is_current = true`. Reconciliation and summaries use only `is_current = true` rows. Full history is available for audit.
- **Preflight check PF-8b** detects ambiguous rankings (rows tied on all tiebreaker columns). PF-8a reports (INFO) the count of projects with multiple historical rows for visibility.

#### Rule 2: Opening Balance Separation

Opening balances must be handled explicitly. They must never be mixed into normal transactional movement totals.

- **Classification:** Opening balance rows are detected via text-pattern matching on `program_expense.row_type` and `program_inflows.milestone_name`. This is heuristic and must be reviewed manually before each backfill run.
- **Schema columns:** `is_opening_balance BOOLEAN NOT NULL DEFAULT false` and `legacy_row_type TEXT` exist on both `finance.cost_lines` and `finance.revenue_lines`.
- **Fiscal period exclusion:** Rows where `is_opening_balance = true` are excluded from `fiscal_period_id` derivation. They retain `fiscal_period_id = NULL`.
- **Reconciliation separation:** Any aggregate parity check MUST separate:
  - Opening balance (where `is_opening_balance = true`)
  - Period movement (where `is_opening_balance = false AND fiscal_period_id IS NOT NULL`)
  - Closing balance (opening balance + period movement)
- **Audit trail:** Backfill 07 produces a read-only audit report (SELECT) of all rows classified as opening balance. Operator MUST review before proceeding.
- **Preflight checks:** PF-9a/PF-9b (SOFT STOP) require manual review of all detected opening balance rows. PF-9c/PF-9d (HARD STOP) reject multiple opening balances per project.
- **Ambiguous rows:** Rows not matched by the heuristic patterns are treated as normal transactions. If they are actually opening balances, they will be silently miscounted as movement. The preflight detail reports exist to catch these.

#### Rule 3: Inflation Prevention

All inflation checks must cover both:
- **Row-count inflation** — promoted row count must not exceed legacy row count per project
- **Amount inflation** — promoted amount total must not exceed legacy amount total per project

At both levels:
- **Per-project** — PF-11a through PF-11d
- **Portfolio/aggregate** — PF-11e and PF-11f

### Preflight Severity Summary (Updated)

| Check | Pass condition | Severity |
|---|---|---|
| PF-1: Duplicate approval lineage | 0 duplicate IDs | **HARD STOP** |
| PF-2: Orphan FK mappings | 0 orphans across all 4 queries | **HARD STOP** |
| PF-3: Unparseable finance dates | 0 unparseable rows (or documented exceptions) | **SOFT STOP** |
| PF-4: Party canonicalization collisions | 0 collisions | **HARD STOP** |
| PF-5: Unresolved project FK mappings | 0 unresolved | **HARD STOP** |
| PF-6: Existing promoted rows | Counts documented and verified | **INFO** |
| PF-7: Orphan legacy files | 0 orphan files | **HARD STOP** |
| PF-8a: Multiple project_execution_state rows | Count documented | **INFO** |
| PF-8b: Ambiguous current-state ranking | 0 tied rankings | **HARD STOP** |
| PF-9a: Opening balance cost lines detected | Review and sign off | **SOFT STOP** |
| PF-9b: Opening balance revenue lines detected | Review and sign off | **SOFT STOP** |
| PF-9c: Multiple OB cost lines per project | 0 | **HARD STOP** |
| PF-9d: Multiple OB revenue lines per project | 0 | **HARD STOP** |
| PF-10a: Duplicate legacy cost line IDs | 0 | **HARD STOP** |
| PF-10b: Duplicate legacy revenue line IDs | 0 | **HARD STOP** |
| PF-10c: Ambiguous project names | 0 | **HARD STOP** |
| PF-11a: Per-project cost amount inflation | 0 projects >$0.50 delta | **HARD STOP** |
| PF-11b: Per-project cost row count inflation | 0 projects inflated | **HARD STOP** |
| PF-11c: Per-project revenue amount inflation | 0 projects >$0.50 delta | **HARD STOP** |
| PF-11d: Per-project revenue row count inflation | 0 projects inflated | **HARD STOP** |
| PF-11e: Portfolio cost aggregate inflation | Delta ≤$0.50 | **HARD STOP** |
| PF-11f: Portfolio revenue aggregate inflation | Delta ≤$0.50 | **HARD STOP** |

### Phase 2 Bridge Write Prerequisites

Before enabling ANY bridge write behavior, ALL of the following must be true:

1. All 8 migrations applied successfully
2. All 8 backfills completed with zero errors
3. All HARD STOP preflight checks pass; all SOFT STOP checks reviewed and signed off
4. Phase 1A reconciliation endpoint (`/api/admin/reconciliation/phase-1a?compare=1`) returns `outcome: "pass"` for all 6 domains with NO provisional notes
5. `internal.sync_watermarks` table populated with baseline readings
6. Rollback migrations tested in staging environment
7. Feature flag `migration_bridge_*_write_v1` flags created (default OFF) for each domain
8. Monitoring alert configured for `stale_items_over_15m > 0` on any domain
