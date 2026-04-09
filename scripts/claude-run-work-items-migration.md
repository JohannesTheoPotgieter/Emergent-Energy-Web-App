# Claude Script: Run work_items View Retirement Migration

You are operating inside a Replit environment with a PostgreSQL database.
Your job is to safely execute the work_items view retirement migration and validate it.

## Context

The `public.work_items` object is currently a VIEW over `_work_items_legacy` with
broken INSTEAD OF triggers that route writes to `core.work_items` (which has an
incompatible schema). This breaks all smart import commits and task writes.

A migration script has been prepared at:
`migrations/20260409_retire_work_items_view.sql`

A rollback script exists at:
`migrations/20260409_retire_work_items_view_rollback.sql`

## CRITICAL RULES

1. **Do NOT modify any migration SQL files.** Run them as-is.
2. **Do NOT skip the preflight checks.** They determine whether it's safe to proceed.
3. **If any preflight check shows unexpected state, STOP and report.** Do not proceed.
4. **If the migration fails, do NOT retry blindly.** Report the exact error.
5. **Do NOT run the rollback unless explicitly told to.**

---

## PHASE 1: Preflight Checks (READ-ONLY)

Run each of these queries against the database. Report the results in a table.
Do NOT make any changes yet.

```sql
-- 1. What is work_items? (expect: VIEW or TABLE)
SELECT schemaname, tablename, 'TABLE' AS type FROM pg_tables WHERE tablename = 'work_items'
UNION ALL
SELECT schemaname, viewname, 'VIEW' FROM pg_views WHERE viewname = 'work_items';

-- 2. Does _work_items_legacy exist?
SELECT schemaname, tablename FROM pg_tables WHERE tablename = '_work_items_legacy';

-- 3. Does core.work_items exist?
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'core' AND tablename = 'work_items';

-- 4. View definition (only if work_items is a VIEW)
SELECT pg_get_viewdef('public.work_items'::regclass, true);

-- 5. Triggers on work_items
SELECT tgname, tgtype, proname
FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.work_items'::regclass;

-- 6. Trigger function bodies
SELECT proname, LEFT(prosrc, 200) AS body_preview
FROM pg_proc
WHERE proname IN ('_work_items_view_insert', '_work_items_view_update', '_work_items_view_delete');

-- 7. Sequences
SELECT sequencename, schemaname FROM pg_sequences
WHERE sequencename LIKE '%work_items%';

-- 8. Row count in the data table
SELECT COUNT(*) AS row_count FROM _work_items_legacy;
-- (If _work_items_legacy doesn't exist, try: SELECT COUNT(*) FROM work_items;)

-- 9. FK constraints referencing work_items or _work_items_legacy
SELECT conname, conrelid::regclass AS referencing_table, confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE confrelid IN (
  SELECT oid FROM pg_class WHERE relname IN ('work_items', '_work_items_legacy') AND relnamespace = 'public'::regnamespace
);

-- 10. Date column types on the data table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = '_work_items_legacy'
  AND column_name IN ('start_date', 'end_date', 'scheduled_date', 'baseline_start', 'baseline_end', 'actual_start', 'actual_end', 'recurrence_end_date')
ORDER BY ordinal_position;
```

### Preflight Decision Matrix

After running the queries, evaluate:

| Condition | Expected | Action if different |
|-----------|----------|-------------------|
| work_items is a VIEW | Yes | If already a TABLE, migration is a no-op (safe to run, will skip steps) |
| _work_items_legacy exists | Yes | If missing AND work_items is a TABLE, migration is already done |
| _work_items_legacy exists | Yes | If missing AND work_items is a VIEW, STOP — data source unknown |
| core.work_items exists | Maybe | Informational only — migration doesn't touch it |
| Triggers exist on work_items | Yes (if VIEW) | If no triggers, migration still safe (will just skip drop) |
| Row count > 0 | Yes | If 0, proceed but note empty table |

**If all conditions are expected or safe: proceed to Phase 2.**
**If any STOP condition is hit: report findings and wait for instructions.**

---

## PHASE 2: Run the Migration

Execute the migration script. You have two options:

### Option A: Via psql (preferred)
```bash
psql "$DATABASE_URL" -f migrations/20260409_retire_work_items_view.sql
```

### Option B: Via Node.js (if psql is unavailable)
```bash
node -e "
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('migrations/20260409_retire_work_items_view.sql', 'utf8');
pool.query(sql).then(() => {
  console.log('Migration completed successfully');
  pool.end();
}).catch(err => {
  console.error('Migration failed:', err.message);
  pool.end();
  process.exit(1);
});
"
```

### Option C: Statement-by-statement (if full file execution fails)
Split the migration at the `-- STEP N` comments and run each step individually.
Report which step fails and with what error.

---

## PHASE 3: Post-Migration Validation

Run these queries and report results:

```sql
-- V1. Confirm work_items is now a BASE TABLE
SELECT table_type FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'work_items';
-- EXPECT: 'BASE TABLE'

-- V2. Confirm _work_items_legacy no longer exists
SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_work_items_legacy';
-- EXPECT: 0 rows

-- V3. Confirm no orphaned trigger functions
SELECT proname FROM pg_proc WHERE proname LIKE '_work_items_view_%';
-- EXPECT: 0 rows

-- V4. Confirm no INSTEAD OF triggers
SELECT tgname FROM pg_trigger t
WHERE t.tgrelid = 'public.work_items'::regclass AND tgtype & 64 = 64;
-- EXPECT: 0 rows (bit 64 = INSTEAD OF)

-- V5. Confirm row count preserved
SELECT COUNT(*) AS row_count FROM work_items;
-- EXPECT: same as preflight count

-- V6. Confirm sequence works
SELECT nextval('work_items_id_seq');
-- EXPECT: a number > max(id)

-- V7. Confirm date columns are DATE type (not TEXT)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'work_items'
  AND column_name IN ('start_date', 'end_date', 'scheduled_date', 'baseline_start')
ORDER BY ordinal_position;
-- EXPECT: 'date' for all

-- V8. Confirm FK constraints still work
SELECT conname, conrelid::regclass AS child_table
FROM pg_constraint
WHERE confrelid = 'public.work_items'::regclass
ORDER BY conname;
-- EXPECT: multiple rows (work_item_tags, task_time_entries, etc.)

-- V9. Test INSERT works
INSERT INTO work_items (title, status, workstream, source, created_by)
VALUES ('__migration_test__', 'Not Started', 'PM', 'SYSTEM', 1)
RETURNING id;
-- EXPECT: returns an id

-- V10. Test UPDATE works
UPDATE work_items SET title = '__migration_test_updated__'
WHERE title = '__migration_test__'
RETURNING id;
-- EXPECT: returns same id

-- V11. Clean up test row
DELETE FROM work_items WHERE title = '__migration_test_updated__';

-- V12. Confirm ORM-expected columns exist
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'work_items'
  AND column_name IN (
    'bucket', 'pinned_today', 'pinned_week', 'source_email_id',
    'next_step', 'definition_of_done', 'completion_note',
    'hold_reason', 'blocked_type', 'approval_required',
    'tracking_rag', 'task_type_tag', 'blocker_reason', 'pd_ticket_id'
  )
ORDER BY column_name;
-- EXPECT: all 14 columns present
```

### Validation Decision

| Check | Pass? | Action if fail |
|-------|-------|----------------|
| V1: BASE TABLE | Must pass | STOP — migration did not complete |
| V2: _work_items_legacy gone | Must pass | Rename may have failed |
| V3-V4: No triggers | Must pass | Orphaned objects remain |
| V5: Row count matches | Must pass | DATA LOSS — run rollback immediately |
| V6: Sequence works | Must pass | Fix sequence manually |
| V7: DATE types | Should pass | Non-blocking; startup will handle |
| V8: FKs intact | Must pass | FK repointing needed |
| V9-V11: CRUD works | Must pass | Core functionality broken |
| V12: ORM columns | Should pass | Startup DDL will add missing ones |

---

## PHASE 4: Application Smoke Test

After migration validation passes, restart the application and verify:

```bash
# 1. Restart the server (Ctrl+C the running process, then)
npm run dev
# or whatever the project's start command is

# 2. Watch startup logs for:
#    - NO "work_items is a VIEW or missing" messages
#    - NO "skipping work_item_tags/task_time_entries creation" messages
#    - YES "[DB] work_items base table exists" or similar
#    - YES "[DB] work_items engineering columns verified"
```

Then test these flows in the UI (or via curl):

1. **Smart Import**: Upload a project file → preview → commit
   - Must succeed without "relation core.work_items does not exist" error
2. **Task Create**: Create a new task from the task management UI
3. **Task Edit**: Edit an existing task's status or title
4. **Task Soft-Delete**: Delete a task (should set deleted_at, not hard delete)

Report the results of each test.

---

## PHASE 5: Rollback (ONLY IF INSTRUCTED)

If validation fails and you're told to rollback:

```bash
psql "$DATABASE_URL" -f migrations/20260409_retire_work_items_view_rollback.sql
```

This will:
- Rename `work_items` back to `_work_items_legacy`
- Create a `SELECT *` VIEW named `work_items`
- Fix sequence ownership

**WARNING**: The rollback does NOT recreate the INSTEAD OF triggers (they were
broken anyway). Writes to work_items will fail after rollback until triggers
are manually restored or a different fix is applied.

---

## Report Template

After completing all phases, report using this format:

```
## Migration Execution Report

### Environment
- Replit project: [name]
- Database: PostgreSQL [version]
- Timestamp: [ISO timestamp]

### Preflight Results
| Check | Result | Expected | Status |
|-------|--------|----------|--------|
| work_items type | VIEW/TABLE | VIEW | OK/UNEXPECTED |
| _work_items_legacy | exists/missing | exists | OK/UNEXPECTED |
| ... | ... | ... | ... |

### Migration Execution
- Method: psql / node / statement-by-statement
- Result: SUCCESS / FAILED at step N
- Error (if any): [exact error message]

### Post-Migration Validation
| Check | Result | Status |
|-------|--------|--------|
| V1: BASE TABLE | yes/no | PASS/FAIL |
| V2: legacy gone | yes/no | PASS/FAIL |
| ... | ... | ... |

### Application Smoke Test
| Test | Result |
|------|--------|
| Server startup | clean / errors |
| Smart import | pass / fail |
| Task create | pass / fail |
| Task edit | pass / fail |
| Task delete | pass / fail |

### Final Status: [MIGRATION SUCCESSFUL / NEEDS ROLLBACK / NEEDS INVESTIGATION]
```
