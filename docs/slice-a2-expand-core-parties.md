# Slice A.2: Expand core.parties Only

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase A.1 (department + role_definition) — accepted  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Next Slice

**Expand `core.parties` only** — add `party_kind` and `legal_name` columns, insert users as `party_kind='person'` rows, add `legacy_user_id` tracking column.

This is a column-expansion + backfill slice. It does **not** create `party_roles`, `contact_methods`, `user_accounts`, or any junction tables.

---

## Why This Is the Right Next Slice

1. **Strict Phase A sequencing.** The migration plan defines A.2 as "Expand core.parties to unified party model." With A.1 accepted, A.2 is next in order.
2. **Foundation for everything downstream.** Phases A.3 (`user_account`), A.4 (`role_assignment`), and all of Phase B (`project_party_link`) require every user to exist as a party row. Until users are in `core.parties`, none of those can proceed.
3. **Minimal blast radius.** The table already exists with 170 rows (167 counterparties + 3 clients). Adding columns and inserting ~25 user rows is the smallest possible step that unblocks the rest of Phase A.
4. **No read/write wiring required.** Nothing in the app reads from `core.parties` today. The `migration_bridge_party_read_v1` feature flag is `false`. This is purely a data-layer expansion.
5. **No dependency on A.1 implementation.** Although A.1 (departments + role_definitions) was accepted, expanding parties does not require a FK to `core.departments`. The party table is independent.

---

## Current Repo Reality for core.parties

### What exists today

| Artifact | Location | State |
|---|---|---|
| DDL migration | `migrations/20260402_party_abstraction.sql` | Live. Creates `core.parties` with 17 columns. |
| Backfill migration | `migrations/20260402_backfill_03_parties.sql` | Live. Inserts counterparties + clients. |
| Rollback migration | `migrations/20260402_party_abstraction_rollback.sql` | Live. `DROP TABLE core.parties`. |
| Reconciliation check | `server/services/promoted-read-compat.ts:1247-1320` | Live. Party/contact parity diagnostics (PROVISIONAL). |
| Feature flag | `shared/feature-flags.ts:220-224` | Live. `migration_bridge_party_read_v1` = `false`. |
| Unit tests | `qa/tests/unit/phase1b-schema-validation.test.ts:151-196` | Live. Column/index existence assertions. |

### Current core.parties schema

```sql
id BIGSERIAL PRIMARY KEY
legacy_counterparty_id INTEGER UNIQUE
legacy_client_id INTEGER UNIQUE
party_type TEXT NOT NULL              -- currently: 'counterparty' or 'client'
name_canonical TEXT NOT NULL
name_aliases JSONB DEFAULT '[]'
is_active BOOLEAN DEFAULT true
vat_number TEXT
registration_number TEXT
contact_person TEXT
contact_email TEXT
contact_phone TEXT
address TEXT
payment_terms TEXT
role_tags TEXT[] DEFAULT '{}'
source_table TEXT NOT NULL            -- 'public.counterparties' or 'public.clients'
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
```

### Current row counts
- ~167 counterparties (from `public.counterparties WHERE deleted_at IS NULL`)
- ~3 clients (from `public.clients`)
- **0 users** — users are not represented in `core.parties` yet

### What does NOT exist yet
- No `party_kind` column (the target architecture's primary discriminator)
- No `legal_name` column
- No `legacy_user_id` column
- No user rows in `core.parties`
- No Drizzle ORM schema definition for `core.parties` (only legacy `counterparties` in `shared/schema/finance.ts:397`)
- No `party_roles` junction table
- No `contact_methods` table

### Source table: public.users (25 rows)

```
id, username, email, password, name, role, department, microsoft_id, created_at, deleted_at
```

Key fields for party insertion: `id` (→ `legacy_user_id`), `name` (→ `name_canonical`), `email` (→ `contact_email`).

---

## Target Change for This Slice Only

### 1. ALTER TABLE: Add three columns to `core.parties`

```sql
ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS party_kind TEXT;
ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER UNIQUE;
```

### 2. Backfill existing rows

```sql
-- Set party_kind for existing rows based on party_type
UPDATE core.parties SET party_kind = 'organisation' WHERE party_kind IS NULL;
```

### 3. Insert users as person-kind parties

```sql
INSERT INTO core.parties (
  legacy_user_id, party_type, party_kind, name_canonical,
  contact_email, is_active, source_table
)
SELECT
  u.id, 'user', 'person', u.name,
  u.email, (u.deleted_at IS NULL), 'public.users'
FROM public.users u
ON CONFLICT (legacy_user_id) DO NOTHING;
```

### 4. Add index on party_kind

```sql
CREATE INDEX IF NOT EXISTS idx_parties_party_kind ON core.parties (party_kind);
```

---

## Scope In

- [x] SQL migration: `ALTER TABLE core.parties ADD COLUMN party_kind TEXT`
- [x] SQL migration: `ALTER TABLE core.parties ADD COLUMN legal_name TEXT`
- [x] SQL migration: `ALTER TABLE core.parties ADD COLUMN legacy_user_id INTEGER UNIQUE`
- [x] SQL migration: `CREATE INDEX idx_parties_party_kind`
- [x] Backfill: `UPDATE` existing rows → `party_kind = 'organisation'`
- [x] Backfill: `INSERT` users as `party_kind = 'person'` rows
- [x] Rollback migration: `DROP COLUMN` for all three new columns + drop index
- [x] Schema validation test: assert new columns exist, index exists, user rows present
- [x] Idempotent: `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` on all DDL and DML

---

## Scope Out

- **No `party_roles` table** — deferred to a later A.2 sub-slice or A.3
- **No `contact_methods` table** — deferred; inline contact fields remain on parties for now
- **No Drizzle ORM schema** for `core.parties` — the app doesn't read from this table yet; schema definition will come when reads are wired
- **No feature flag changes** — `migration_bridge_party_read_v1` stays `false`
- **No read/write wiring** — no app code changes, no route changes
- **No compatibility layer changes** — `promoted-read-compat.ts` stays as-is
- **No `party_type` → `party_kind` rename** — both columns coexist; `party_type` retains legacy semantics ('counterparty', 'client'), `party_kind` adds target semantics ('person', 'organisation')
- **No `NOT NULL` constraint on `party_kind`** yet — column is nullable during transition; will be tightened in a future slice after all rows are confirmed populated

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `legacy_user_id` collides with an existing `id` value in parties table | Very Low | Medium | `UNIQUE` constraint on `legacy_user_id`; separate column from `id` (BIGSERIAL). User IDs are small integers (1-25), party IDs are bigserial and already past 170. |
| Backfill `UPDATE` accidentally nullifies `party_kind` for rows that already have it on re-run | Low | Low | `WHERE party_kind IS NULL` guard on the UPDATE. |
| `name_canonical` from `users.name` has blanks or duplicates | Low | Low | Users table has `NOT NULL` on `name`. Duplicates are acceptable — `name_canonical` is not unique. |
| Rollback drops columns but leaves stale test expectations | Low | Low | Rollback migration is explicit. Tests assert column existence, so a rollback + re-run of tests would naturally fail and surface the state. |

---

## Validation

### Pre-flight checks (run before migration)

```sql
-- PF-1: Confirm core.parties exists
SELECT COUNT(*) FROM core.parties;
-- Expected: ~170

-- PF-2: Confirm party_kind column does NOT exist yet
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'parties' AND column_name = 'party_kind';
-- Expected: 0 rows

-- PF-3: Confirm no user IDs collide with existing legacy IDs
SELECT u.id FROM public.users u
JOIN core.parties p ON p.legacy_counterparty_id = u.id OR p.legacy_client_id = u.id;
-- Expected: 0 rows (no collision)
```

### Post-migration checks

```sql
-- PM-1: party_kind populated for all rows
SELECT COUNT(*) AS total, COUNT(party_kind) AS with_kind FROM core.parties;
-- Expected: total = with_kind

-- PM-2: User rows inserted
SELECT COUNT(*) FROM core.parties WHERE party_kind = 'person';
-- Expected: matches SELECT COUNT(*) FROM public.users

-- PM-3: Organisation rows unchanged
SELECT COUNT(*) FROM core.parties WHERE party_kind = 'organisation';
-- Expected: ~170 (original counterparty + client count)

-- PM-4: No duplicate legacy_user_id
SELECT legacy_user_id, COUNT(*) FROM core.parties
WHERE legacy_user_id IS NOT NULL GROUP BY legacy_user_id HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- PM-5: Total row count
SELECT COUNT(*) FROM core.parties;
-- Expected: ~195 (170 orgs + 25 users)
```

---

## Rollback

Single rollback migration reverses all changes:

```sql
BEGIN;
-- Remove user rows first (they depend on legacy_user_id column)
DELETE FROM core.parties WHERE source_table = 'public.users';

-- Drop new columns
ALTER TABLE core.parties DROP COLUMN IF EXISTS party_kind;
ALTER TABLE core.parties DROP COLUMN IF EXISTS legal_name;
ALTER TABLE core.parties DROP COLUMN IF EXISTS legacy_user_id;

-- Drop new index
DROP INDEX IF EXISTS core.idx_parties_party_kind;
COMMIT;
```

**Rollback is safe because:**
- No app code reads from `core.parties`
- No feature flag is enabled
- No downstream table has FK to `party_kind`, `legal_name`, or `legacy_user_id`
- Existing 170 rows are untouched (only the new columns are dropped)

---

## Definition of Done

1. **Migration file** `migrations/YYYYMMDD_expand_parties_add_party_kind.sql` exists and is syntactically valid
2. **Rollback file** `migrations/YYYYMMDD_expand_parties_add_party_kind_rollback.sql` exists and is syntactically valid
3. **Backfill file** `migrations/YYYYMMDD_backfill_parties_users.sql` exists and is idempotent
4. All **pre-flight checks** pass (core.parties exists, party_kind doesn't exist yet, no ID collisions)
5. All **post-migration checks** pass (party_kind populated, user rows present, counts match)
6. **Schema validation test** updated to assert: `party_kind`, `legal_name`, `legacy_user_id` columns exist; `idx_parties_party_kind` index exists; user-sourced rows have `party_kind = 'person'`
7. **Rollback tested**: rollback migration runs cleanly, post-rollback state matches pre-migration state
8. **No app code changes** — zero modifications to server routes, services, feature flags, or Drizzle schema
9. **No regressions** — existing `phase1b-schema-validation.test.ts` party tests still pass
10. **Migration plan doc** updated with A.2 status

---

## Claude Code Implementation Prompt

```
Implement slice A.2: expand core.parties with party_kind, legal_name, and user backfill.

Context:
- core.parties already exists (migrations/20260402_party_abstraction.sql) with ~170 rows
  (167 counterparties + 3 clients). No app code reads from it. Feature flag
  migration_bridge_party_read_v1 is false.
- The target architecture (docs/target-architecture-migration-plan.md, Phase A.2)
  requires users to exist in core.parties as party_kind='person'.
- This is additive only. No read/write wiring. No Drizzle schema. No feature flag changes.

Constraints:
- Do NOT create party_roles, contact_methods, or any junction tables.
- Do NOT modify any app code, routes, services, or feature flags.
- Do NOT add a Drizzle ORM schema definition for core.parties.
- Do NOT make party_kind NOT NULL — leave it nullable for now.
- All SQL must be idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
- Follow the exact file naming pattern: migrations/YYYYMMDD_description.sql
  Use date 20260403.

Files to create:

1. migrations/20260403_expand_parties_add_party_kind.sql
   BEGIN;
   ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS party_kind TEXT;
   ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legal_name TEXT;
   ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER UNIQUE;
   CREATE INDEX IF NOT EXISTS idx_parties_party_kind ON core.parties (party_kind);
   COMMENT ON TABLE core.parties IS 'Unified party abstraction. Phase A.2: expanded with party_kind (person/organisation) and user backfill.';
   COMMIT;

2. migrations/20260403_backfill_parties_users.sql
   BEGIN;
   -- Backfill party_kind for existing org rows
   UPDATE core.parties SET party_kind = 'organisation' WHERE party_kind IS NULL;
   -- Insert users as person parties
   INSERT INTO core.parties (
     legacy_user_id, party_type, party_kind, name_canonical,
     contact_email, is_active, source_table
   )
   SELECT
     u.id, 'user', 'person', u.name,
     u.email, (u.deleted_at IS NULL), 'public.users'
   FROM public.users u
   ON CONFLICT (legacy_user_id) DO NOTHING;
   COMMIT;

3. migrations/20260403_expand_parties_add_party_kind_rollback.sql
   BEGIN;
   DELETE FROM core.parties WHERE source_table = 'public.users';
   ALTER TABLE core.parties DROP COLUMN IF EXISTS party_kind;
   ALTER TABLE core.parties DROP COLUMN IF EXISTS legal_name;
   ALTER TABLE core.parties DROP COLUMN IF EXISTS legacy_user_id;
   DROP INDEX IF EXISTS core.idx_parties_party_kind;
   COMMENT ON TABLE core.parties IS 'Unified party abstraction. Phase 1B foundation only — no write paths depend on this table yet.';
   COMMIT;

4. Update qa/tests/unit/phase1b-schema-validation.test.ts
   In the "Party abstraction" describe block, add tests:
   - "has party_kind column" — assert column exists via SQL query
   - "has legal_name column" — assert column exists
   - "has legacy_user_id column" — assert column exists
   - "has idx_parties_party_kind index" — assert index exists
   - "contains user-sourced rows with party_kind person" — assert
     SELECT COUNT(*) FROM core.parties WHERE party_kind = 'person' > 0
   - "all rows have party_kind populated" — assert
     SELECT COUNT(*) FROM core.parties WHERE party_kind IS NULL = 0

Validation:
After creating all files, run the pre-flight and post-migration check queries
from docs/slice-a2-expand-core-parties.md to confirm correctness.

Do NOT push. Commit with message:
"feat: expand core.parties with party_kind column and user backfill (Phase A.2)"
```
