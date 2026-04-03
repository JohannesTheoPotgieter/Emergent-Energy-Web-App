# Slice A.4: Create core.role_assignments

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase A.1 (departments + role_definitions), A.3 (user_accounts)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.role_assignments` junction table** — links `core.user_accounts` to `core.role_definitions` and `core.departments`. Supports multiple active roles per user. Backfills from `public.users.role`. This is the final slice in Phase A.

---

## Why This Is the Right Next Slice

1. **Completes Phase A.** The migration plan defines A.4 as the last foundation slice. With A.1 (departments + role_definitions), A.2 (parties), A.3 (user_accounts), and A.3b (microsoft_identities) done, this is the final piece.
2. **All prerequisites exist.** `core.user_accounts` provides `user_account_id`, `core.role_definitions` provides `role_definition_id`, `core.departments` provides `department_id`.
3. **Replaces flat text with structured relationship.** The current `users.role` is a plain text field. `role_assignments` makes the relationship queryable, temporal, and supports multiple concurrent roles.
4. **Unblocks Phase B.** `project_party_link` (B.4) benefits from structured role information to assign project roles.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `public.users.role` | `shared/schema/users.ts:24` | Live. TEXT, NOT NULL, default 'member'. Contains role codes like 'COO_ADMIN'. |
| `core.user_accounts` | `migrations/20260403_create_user_accounts.sql` | Live (A.3). Has `legacy_user_id` mapping to `users.id`. |
| `core.role_definitions` | `migrations/20260403_create_departments_role_definitions.sql` | Live (A.1). 16 rows, `code` matches `COMPANY_ROLES`. |
| `core.departments` | `migrations/20260403_create_departments_role_definitions.sql` | Live (A.1). 6 rows. |
| `core.role_assignments` | -- | **Does not exist.** |
| `ROLE_DEPARTMENT_MAP` | `shared/schema/users.ts:1392-1409` | Hardcoded. Maps role code to department code. Equivalent relationship is now in `role_definitions.department_id`. |

---

## Target Change for This Slice Only

### 1. CREATE TABLE: `core.role_assignments`

```sql
CREATE TABLE IF NOT EXISTS core.role_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  user_account_id     BIGINT NOT NULL REFERENCES core.user_accounts(id),
  role_definition_id  INTEGER NOT NULL REFERENCES core.role_definitions(id),
  department_id       INTEGER NOT NULL REFERENCES core.departments(id),
  start_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date            DATE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Key design decisions:
- **No UNIQUE on `user_account_id`** — multiple active roles per user allowed
- `department_id` — denormalized from `role_definitions.department_id` for direct querying ("all users in Engineering")
- `start_date` / `end_date` — temporal support. `end_date IS NULL` means currently active.
- Partial index on `(user_account_id) WHERE end_date IS NULL` for fast active-role lookups

### 2. Backfill from `public.users.role`

```sql
INSERT INTO core.role_assignments (user_account_id, role_definition_id, department_id, start_date)
SELECT
  ua.id,
  rd.id,
  rd.department_id,
  COALESCE(u.created_at::date, CURRENT_DATE)
FROM public.users u
JOIN core.user_accounts ua ON ua.legacy_user_id = u.id
JOIN core.role_definitions rd ON rd.code = u.role
WHERE NOT EXISTS (
  SELECT 1 FROM core.role_assignments ra
  WHERE ra.user_account_id = ua.id
    AND ra.role_definition_id = rd.id
    AND ra.end_date IS NULL
);
```

### 3. Indexes

```sql
CREATE INDEX idx_role_assignments_user_account_id ON core.role_assignments (user_account_id);
CREATE INDEX idx_role_assignments_role_definition_id ON core.role_assignments (role_definition_id);
CREATE INDEX idx_role_assignments_department_id ON core.role_assignments (department_id);
CREATE INDEX idx_role_assignments_active ON core.role_assignments (user_account_id) WHERE end_date IS NULL;
```

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.role_assignments` with columns above
- [x] SQL backfill migration: `INSERT ... FROM public.users JOIN core.user_accounts JOIN core.role_definitions`
- [x] SQL rollback migration: `DROP TABLE IF EXISTS core.role_assignments`
- [x] Indexes: `user_account_id`, `role_definition_id`, `department_id`, partial active index
- [x] Idempotent: `IF NOT EXISTS` on DDL, `NOT EXISTS` guard on backfill
- [x] Schema validation tests (static file-read pattern)
- [x] Table comment documenting Phase A.4
- [x] Slice doc

---

## Scope Out

- **No Drizzle ORM schema** for `core.role_assignments`
- **No app code changes** — `users.role` still used by auth, middleware, permission checks
- **No feature flag changes**
- **No bridge writes** — when `users.role` is updated, it does NOT yet sync to `role_assignments`
- **No read wiring** — nothing in the app queries `core.role_assignments`
- **No changes to `role_permissions` table** — it stores permissions, not assignments

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `users.role` value not found in `role_definitions.code` | Low | Medium | `JOIN core.role_definitions rd ON rd.code = u.role` silently skips unmatched rows. The 16 seeded codes match `COMPANY_ROLES` exactly. Users with non-standard roles (e.g. 'member' default) get no assignment row. |
| `department_id` on role_assignments diverges from `role_definitions.department_id` | Low | Low | Backfill copies `rd.department_id` directly. Future changes need to update both. Denormalization is intentional for query performance. |
| Future drift — `users.role` updated without syncing to `role_assignments` | Expected | Low | Bridge writes will be added when reads are wired (future slice). |

---

## Validation

### Pre-flight checks

```sql
-- PF-1: All prerequisite tables exist
SELECT COUNT(*) FROM core.user_accounts;
SELECT COUNT(*) FROM core.role_definitions;
SELECT COUNT(*) FROM core.departments;

-- PF-2: Every user's role code exists in role_definitions
SELECT u.id, u.role FROM public.users u
LEFT JOIN core.role_definitions rd ON rd.code = u.role
WHERE rd.id IS NULL;
-- Expected: 0 rows (or only users with non-standard roles like 'member')

-- PF-3: core.role_assignments does NOT exist yet
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'core' AND table_name = 'role_assignments'
);
-- Expected: false
```

### Post-migration checks

```sql
-- PM-1: Table exists with expected columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'role_assignments'
ORDER BY ordinal_position;
-- Expected: id, user_account_id, role_definition_id, department_id, start_date, end_date, created_at, updated_at

-- PM-2: Row count matches users with valid roles
SELECT COUNT(*) FROM core.role_assignments;
-- Expected: matches SELECT COUNT(*) FROM public.users u JOIN core.role_definitions rd ON rd.code = u.role

-- PM-3: Every assignment links to valid user_account, role_definition, and department
SELECT COUNT(*) FROM core.role_assignments ra
LEFT JOIN core.user_accounts ua ON ra.user_account_id = ua.id
LEFT JOIN core.role_definitions rd ON ra.role_definition_id = rd.id
LEFT JOIN core.departments d ON ra.department_id = d.id
WHERE ua.id IS NULL OR rd.id IS NULL OR d.id IS NULL;
-- Expected: 0

-- PM-4: All backfilled rows are active (end_date IS NULL)
SELECT COUNT(*) FROM core.role_assignments WHERE end_date IS NOT NULL;
-- Expected: 0

-- PM-5: department_id matches role_definition's department_id
SELECT COUNT(*) FROM core.role_assignments ra
JOIN core.role_definitions rd ON ra.role_definition_id = rd.id
WHERE ra.department_id <> rd.department_id;
-- Expected: 0
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.role_assignments;
COMMIT;
```

**Rollback is safe because:**
- No app code reads from `core.role_assignments`
- No downstream table has a FK to it
- `core.user_accounts`, `core.role_definitions`, and `core.departments` are unaffected
- `public.users.role` remains the live source of truth

---

## Definition of Done

1. **DDL migration file** exists, is valid, and wrapped in `BEGIN/COMMIT`
2. **Backfill migration file** exists and is idempotent (`NOT EXISTS` guard)
3. **Rollback migration file** exists and drops the table cleanly
4. All **pre-flight checks** pass
5. All **post-migration checks** pass
6. **Schema validation tests** added (static file-read pattern)
7. **No app code changes**
8. **No regressions** — existing tests still pass
9. **Slice doc** written
10. **Phase A is complete** after this slice
