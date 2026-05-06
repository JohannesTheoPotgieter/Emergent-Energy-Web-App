# Smart Import v2 — Live Database Verification Checklist

> **Purpose:** Verify that the current production database is compatible with Smart Import v2 before pilot rollout.
> **Why this exists:** The UAT assessment was performed against code and Drizzle schema definitions only. Live database access was NOT available during the review. This checklist provides the exact queries a team member must run to confirm plug-and-play readiness.

---

## Connection Info

```
Host: ep-damp-dawn-ajbdpxyq.c-3.us-east-2.aws.neon.tech
Port: 5432
Database: neondb
User: neondb_owner
SSL: required
```

---

## Check 1: Migration Status

**What:** Confirm that `milestone_no` and `milestone_percent` columns exist on `normalized_revenue_lines`.

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'normalized_revenue_lines'
  AND column_name IN ('milestone_no', 'milestone_percent')
ORDER BY column_name;
```

**Expected result:** Two rows:
| column_name | data_type | is_nullable |
|-------------|-----------|-------------|
| milestone_no | text | YES |
| milestone_percent | numeric | YES |

**If ZERO rows returned:** Migration `20260408_add_milestone_no_to_revenue.sql` has NOT been applied. Run it:

```sql
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS milestone_no TEXT,
  ADD COLUMN IF NOT EXISTS milestone_percent NUMERIC(6,4);
```

**Pass/Fail:**
- 2 rows → PASS
- 0 rows → FAIL (migration required before deployment)

---

## Check 2: Core Table Existence

**What:** Confirm all tables required by Smart Import v2 exist.

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'work_items',
    'normalized_revenue_lines',
    'normalized_cost_lines',
    'smart_import_runs',
    'import_issues',
    'conflict_resolution_log',
    'manual_edit_flags',
    'import_logs'
  )
ORDER BY table_name;
```

**Expected:** 8 rows (all tables present).

**Pass/Fail:**
- 8 rows → PASS
- < 8 rows → FAIL (identify missing table, investigate)

---

## Check 3: work_items Schema Compatibility

**What:** Confirm key columns used by the v2 PLAN writer exist.

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'work_items'
  AND column_name IN (
    'source', 'workstream', 'wbs_code', 'sub_project_name',
    'deleted_at', 'import_run_id', 'owner_name', 'percent_complete',
    'expected_pct_complete', 'actual_start', 'actual_end',
    'actual_duration', 'phase', 'is_milestone', 'outline_number',
    'external_ref', 'source_row', 'source_sheet'
  )
ORDER BY column_name;
```

**Expected:** 18 columns present.

**Pass/Fail:**
- 18 → PASS
- < 18 → FAIL (list missing columns)

---

## Check 4: normalized_cost_lines Schema Compatibility

**What:** Confirm key columns used by the v2 EXPENDITURE writer exist.

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'normalized_cost_lines'
  AND column_name IN (
    'effective_from', 'effective_to', 'snapshot_run_id',
    'no_revenue_linked', 'admin_date_override', 'cos_realised',
    'cashflow_confirmed', 'invoice_date_confirmed', 'paid_date_confirmed',
    'cost_category', 'counterparty_name', 'description',
    'invoice_number', 'sub_project_name'
  )
ORDER BY column_name;
```

**Expected:** 14 columns present.

**Pass/Fail:**
- 14 → PASS
- < 14 → FAIL (list missing columns)

---

## Check 5: Duplicate Revenue Business Keys

**What:** Detect revenue milestone names that would collide under v2 row matching. The v2 matcher keys on `projectId + subProjectName + milestoneName`. If two active rows share the same key, the second will incorrectly match the same DB row as the first.

```sql
SELECT
  project_id,
  sub_project_name,
  LOWER(TRIM(milestone_name)) AS norm_name,
  COUNT(*) AS dup_count
FROM normalized_revenue_lines
WHERE effective_to IS NULL
  AND milestone_name IS NOT NULL
  AND TRIM(milestone_name) != ''
GROUP BY project_id, sub_project_name, LOWER(TRIM(milestone_name))
HAVING COUNT(*) > 1
ORDER BY dup_count DESC;
```

**Expected:** Zero rows (no duplicate keys).

**Pass/Fail:**
- 0 rows → PASS
- Any rows → HIGH RISK — these projects will have key collisions on v2 incremental import. List the project IDs. These projects should either:
  - Use v1 "Advanced view" for their imports during pilot
  - OR have their milestone names disambiguated in the tracker first

---

## Check 6: Duplicate Expenditure Business Keys (No-Invoice Fallback)

**What:** Detect cost lines that share the same fallback key (same category + counterparty + description, no invoice number). These collide under v2 matching.

```sql
SELECT
  project_id,
  sub_project_name,
  LOWER(TRIM(COALESCE(cost_category, ''))) AS cat,
  LOWER(TRIM(COALESCE(counterparty_name, ''))) AS cp,
  LOWER(TRIM(COALESCE(description, ''))) AS descr,
  COUNT(*) AS dup_count
FROM normalized_cost_lines
WHERE effective_to IS NULL
  AND (invoice_number IS NULL OR TRIM(invoice_number) = '')
  AND (COALESCE(description, '') != '' OR COALESCE(cost_category, '') != '' OR COALESCE(counterparty_name, '') != '')
GROUP BY project_id, sub_project_name,
  LOWER(TRIM(COALESCE(cost_category, ''))),
  LOWER(TRIM(COALESCE(counterparty_name, ''))),
  LOWER(TRIM(COALESCE(description, '')))
HAVING COUNT(*) > 1
ORDER BY dup_count DESC;
```

**Expected:** Zero rows (no duplicate keys).

**Pass/Fail:**
- 0 rows → PASS
- Any rows → HIGH RISK — same as Check 5. List project IDs for pilot exclusion or v1 fallback.

---

## Check 7: Low-Confidence Plan Matching Risk

**What:** Count plan rows (work_items from smart import) that lack `wbs_code` (task number). These rely on fallback matching by task name + phase, which is LOW confidence.

```sql
SELECT
  project_id,
  COUNT(*) AS total_plan_rows,
  COUNT(*) FILTER (WHERE wbs_code IS NULL OR TRIM(wbs_code) = '') AS no_taskno_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE wbs_code IS NULL OR TRIM(wbs_code) = '') / NULLIF(COUNT(*), 0),
    1
  ) AS pct_no_taskno
FROM work_items
WHERE source = 'SMART_IMPORT'
  AND workstream = 'PM'
  AND deleted_at IS NULL
GROUP BY project_id
HAVING COUNT(*) FILTER (WHERE wbs_code IS NULL OR TRIM(wbs_code) = '') > 0
ORDER BY pct_no_taskno DESC;
```

**Expected:** Ideally zero rows, or low percentages only.

**Pass/Fail:**
- 0 rows → PASS
- Rows where pct_no_taskno < 20% → PASS (acceptable — LOW confidence warnings will be emitted)
- Rows where pct_no_taskno > 50% → MEDIUM RISK — v2 plan matching for these projects will be mostly LOW confidence. Not a blocker, but users should be warned that plan rows may be misidentified if task names are ambiguous.

---

## Check 8: Pre-v2 Revenue Rows Without milestoneNo

**What:** Count active revenue rows that have NULL `milestone_no`. This is expected for pre-v2 data and is NOT a problem (matching falls back to milestoneName).

```sql
SELECT
  COUNT(*) AS total_active_revenue,
  COUNT(*) FILTER (WHERE milestone_no IS NULL) AS null_milestone_no,
  COUNT(*) FILTER (WHERE milestone_no IS NOT NULL) AS has_milestone_no
FROM normalized_revenue_lines
WHERE effective_to IS NULL;
```

**Expected:** Mostly or all NULL (pre-v2 data). This is informational only.

**Pass/Fail:**
- Any result → PASS (this is not a blocker; just documents the current state)

---

## Check 9: Baseline Import Readiness

**What:** Check which projects have prior COMMITTED smart import runs (will get INCREMENTAL mode) vs which have never been imported (will get BASELINE mode).

```sql
SELECT
  pi.id AS project_id,
  pi.project_name,
  COUNT(sir.id) AS committed_runs,
  MAX(sir.committed_at) AS last_committed
FROM project_info pi
LEFT JOIN smart_import_runs sir
  ON sir.project_id = pi.id AND sir.status = 'COMMITTED'
GROUP BY pi.id, pi.project_name
ORDER BY committed_runs DESC;
```

**Expected:** Informational — no pass/fail. This shows which projects will be BASELINE vs INCREMENTAL on first v2 import.

**Important note:** For projects with prior COMMITTED runs, the v2 conflict engine uses `summaryJson.normalization` from the last committed run as the baseline. If `summaryJson` is NULL or malformed on old runs, 3-way merge will gracefully degrade (treats current DB as baseline).

---

## Check 10: summaryJson Integrity on Last Committed Runs

**What:** Verify that the last committed run for each project has valid `summaryJson` with normalization data. This is used as the baseline for 3-way merge.

```sql
SELECT
  sir.project_id,
  sir.id AS run_id,
  sir.committed_at,
  CASE
    WHEN sir.summary_json IS NULL THEN 'NULL'
    WHEN sir.summary_json::text = '{}' THEN 'EMPTY'
    WHEN sir.summary_json->'normalization' IS NULL THEN 'NO_NORMALIZATION'
    ELSE 'OK'
  END AS baseline_status
FROM smart_import_runs sir
WHERE sir.status = 'COMMITTED'
  AND sir.committed_at = (
    SELECT MAX(s2.committed_at)
    FROM smart_import_runs s2
    WHERE s2.project_id = sir.project_id AND s2.status = 'COMMITTED'
  )
ORDER BY sir.project_id;
```

**Expected:** All rows show `OK`.

**Pass/Fail:**
- All OK → PASS
- Any NULL or NO_NORMALIZATION → MEDIUM RISK — 3-way merge for those projects will not have a true baseline. The conflict engine will treat current DB state as both baseline and current, meaning: upload-only changes auto-apply, app-only changes auto-preserve, but true conflicts may not be detected on the first v2 import. This self-corrects after one full v2 import cycle.

---

## Decision Matrix

| Check | Result | Verdict |
|-------|--------|---------|
| 1 (migration) | PASS | Continue |
| 1 (migration) | FAIL | STOP — apply migration first |
| 2 (tables) | PASS | Continue |
| 2 (tables) | FAIL | STOP — investigate missing tables |
| 3 (work_items cols) | PASS | Continue |
| 3 (work_items cols) | FAIL | STOP — schema drift, investigate |
| 4 (cost_lines cols) | PASS | Continue |
| 4 (cost_lines cols) | FAIL | STOP — schema drift, investigate |
| 5 (dup revenue keys) | PASS | Continue |
| 5 (dup revenue keys) | FAIL | Exclude affected projects from pilot |
| 6 (dup cost keys) | PASS | Continue |
| 6 (dup cost keys) | FAIL | Exclude affected projects from pilot |
| 7 (plan no-taskno) | PASS | Continue |
| 7 (plan no-taskno) | FAIL (>50%) | Warn users, not a blocker |
| 8 (null milestoneNo) | Any | Continue (informational) |
| 9 (baseline readiness) | Any | Continue (informational) |
| 10 (summaryJson) | PASS | Continue |
| 10 (summaryJson) | FAIL | Note affected projects — first v2 import self-corrects |

### Final Verdict Rules

- **If checks 1-4 all PASS, and checks 5-6 show 0 duplicates:** → **YES — plug and play**
- **If checks 1-4 all PASS, but checks 5-6 show some duplicates:** → **YES WITH CONDITIONS** (exclude affected projects from pilot)
- **If any of checks 1-4 FAIL:** → **NO** (fix schema/migration first)
