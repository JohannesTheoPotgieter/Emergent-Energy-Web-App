# Slice A.3: Create core.user_accounts Only

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase A.2 (expand core.parties) — accepted  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Next Slice

**Create `core.user_accounts` table only** — a new table in the `core` schema that bridges `public.users` (legacy auth) to `core.parties` (unified identity). Backfill one row per user. No `microsoft_identities`, no `role_assignments`, no app wiring.

---

## Why This Is the Right Next Slice

1. **Strict Phase A sequencing.** The roadmap defines A.3 as "Create user_account + microsoft_identity." With A.2 accepted, A.3 is next in order. We narrow to `user_accounts` only, deferring `microsoft_identities` to a sub-slice.
2. **Direct dependency chain satisfied.** A.3 requires users to exist as party rows in `core.parties` — A.2 delivered exactly that (`party_kind='person'`, `legacy_user_id` tracking). The FK `user_accounts.party_id -> core.parties.id` is now resolvable.
3. **Unlocks A.4 and Phase B.** `role_assignments` (A.4) needs `user_account_id`. `project_party_link` (B.4) needs user_account->party linkage to replace inline `pm_user_id`/`pd_user_id`. Without `user_accounts`, both are blocked.
4. **Minimal blast radius.** ~25 rows. One new table. No existing table modified. No columns added to existing tables. No app code reads from `core.user_accounts`.
5. **Separating `microsoft_identities` is safer.** MS identity extraction touches OAuth flows conceptually and has its own backfill logic (`users.microsoft_id` -> separate table). Keeping it out of this slice means this slice is purely structural with zero auth-adjacency risk.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `public.users` table | `shared/schema/users.ts:18-29` | Live. ~25 rows. Columns: `id, username, email, password, name, role, department, microsoft_id, created_at, deleted_at`. |
| `core.parties` (with users) | `migrations/20260403_backfill_parties_users.sql` | Live. ~195 rows. Users backfilled as `party_kind='person'` with `legacy_user_id = users.id`. |
| `core.user_accounts` | -- | **Does not exist.** No migration, no Drizzle schema, no references in app code. |
| Auth system | `server/auth-context.ts`, `server/routes/auth-routes.ts`, `server/jwt.ts` | Custom JWT + session auth. Resolves user from `public.users` by `id`. No reference to any `core.*` table. |
| Feature flag | `shared/feature-flags.ts:220-224` | `migration_bridge_party_read_v1 = false`. No user_account flag exists. |

---

## Target Change for This Slice Only

### 1. CREATE TABLE: `core.user_accounts`

```sql
CREATE TABLE IF NOT EXISTS core.user_accounts (
  id             BIGSERIAL PRIMARY KEY,
  party_id       BIGINT NOT NULL REFERENCES core.parties(id),
  legacy_user_id INTEGER UNIQUE NOT NULL,
  email          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  last_login_at  TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Key design decisions:
- `party_id` — FK to `core.parties`. Resolved via `core.parties.legacy_user_id = public.users.id`.
- `legacy_user_id` — preserves the `public.users.id` for traceability. `UNIQUE NOT NULL` because every user_account must map to exactly one legacy user during migration.
- `email` — denormalized from `users.email` for fast lookup.
- `status` — `'active'` or `'inactive'`. Derived from `users.deleted_at IS NULL`.
- No `password` column — auth stays in `public.users`.

### 2. Backfill from `public.users` via `core.parties`

```sql
INSERT INTO core.user_accounts (party_id, legacy_user_id, email, status, created_at)
SELECT
  p.id,
  u.id,
  u.email,
  CASE WHEN u.deleted_at IS NULL THEN 'active' ELSE 'inactive' END,
  u.created_at
FROM public.users u
JOIN core.parties p ON p.legacy_user_id = u.id
ON CONFLICT (legacy_user_id) DO NOTHING;
```

### 3. Add indexes

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_party_id ON core.user_accounts (party_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON core.user_accounts (email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON core.user_accounts (status);
```

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.user_accounts` with columns above
- [x] SQL backfill migration: `INSERT INTO core.user_accounts ... FROM public.users JOIN core.parties`
- [x] SQL rollback migration: `DROP TABLE IF EXISTS core.user_accounts`
- [x] Indexes: `party_id` (unique), `email`, `status`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT DO NOTHING` on backfill
- [x] Schema validation tests: static file-read assertions matching existing pattern
- [x] Table comment documenting Phase A.3

---

## Scope Out

- **No `microsoft_identities` table** — deferred to A.3b sub-slice
- **No `role_assignments` table** — that is A.4
- **No Drizzle ORM schema** for `core.user_accounts` — the app doesn't read from it; schema comes when reads are wired
- **No app code changes** — zero modifications to auth-context, routes, JWT, middleware, or services
- **No feature flag changes** — no new flag created, no existing flag toggled
- **No FK changes on downstream tables** — no table gets a new `user_account_id` column in this slice
- **No `password` or `token_version` column** — auth credentials stay in `public.users`
- **No `username` column** — not needed; auth resolves by email or microsoft_id
- **No read/write wiring** — nothing in the app queries `core.user_accounts`

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `JOIN core.parties p ON p.legacy_user_id = u.id` yields fewer rows than expected (some users not backfilled in A.2) | Very Low | Medium | Pre-flight check: count unmatched users must be 0. |
| `party_id` UNIQUE constraint fails if a party somehow maps to two users | Very Low | Medium | A.2 backfill used `legacy_user_id UNIQUE` on parties. One party per user is guaranteed by schema. |
| Future schema drift — `email` in `user_accounts` diverges from `users.email` | Low | Low | Snapshot for migration. Bridge writes or sync trigger added when reads are wired (future slice). |
| Rollback leaves orphaned `core.parties` person rows | None | None | `core.parties` person rows were created in A.2 and are independent. |

---

## Validation

### Pre-flight checks (before migration)

```sql
-- PF-1: core.parties has person rows with legacy_user_id
SELECT COUNT(*) FROM core.parties WHERE party_kind = 'person' AND legacy_user_id IS NOT NULL;
-- Expected: matches SELECT COUNT(*) FROM public.users

-- PF-2: Every user has a corresponding party row
SELECT COUNT(*) FROM public.users u
LEFT JOIN core.parties p ON p.legacy_user_id = u.id
WHERE p.id IS NULL;
-- Expected: 0

-- PF-3: core.user_accounts does NOT exist yet
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'core' AND table_name = 'user_accounts'
);
-- Expected: false
```

### Post-migration checks

```sql
-- PM-1: Table exists with expected columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'user_accounts'
ORDER BY ordinal_position;
-- Expected: id, party_id, legacy_user_id, email, status, last_login_at, created_at, updated_at

-- PM-2: Row count matches users
SELECT COUNT(*) FROM core.user_accounts;
-- Expected: matches SELECT COUNT(*) FROM public.users

-- PM-3: Every user_account links to a valid person party
SELECT COUNT(*) FROM core.user_accounts ua
JOIN core.parties p ON ua.party_id = p.id
WHERE p.party_kind = 'person';
-- Expected: matches total user_accounts count

-- PM-4: No orphaned user_accounts (party_id resolves)
SELECT COUNT(*) FROM core.user_accounts ua
LEFT JOIN core.parties p ON ua.party_id = p.id
WHERE p.id IS NULL;
-- Expected: 0

-- PM-5: No duplicate legacy_user_id
SELECT legacy_user_id, COUNT(*) FROM core.user_accounts
GROUP BY legacy_user_id HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- PM-6: Status correctly derived
SELECT status, COUNT(*) FROM core.user_accounts GROUP BY status;
-- Expected: 'active' count matches users WHERE deleted_at IS NULL
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.user_accounts;
COMMIT;
```

**Rollback is safe because:**
- No app code reads from `core.user_accounts`
- No feature flag references it
- No downstream table has a FK to `core.user_accounts`
- `core.parties` person rows (from A.2) are unaffected
- `public.users` (legacy) is completely untouched

---

## Definition of Done

1. **DDL migration file** `migrations/20260403_create_user_accounts.sql` exists, is syntactically valid, and wrapped in `BEGIN/COMMIT`
2. **Backfill migration file** `migrations/20260403_backfill_user_accounts.sql` exists, is idempotent (`ON CONFLICT DO NOTHING`), and runs after DDL
3. **Rollback migration file** `migrations/20260403_create_user_accounts_rollback.sql` exists and drops the table cleanly
4. All **pre-flight checks** pass (every user has a party row, table doesn't exist yet)
5. All **post-migration checks** pass (row count matches, FKs resolve, no orphans, status correct)
6. **Schema validation tests** added: static file-read assertions for DDL, backfill, and rollback migrations
7. **Rollback tested**: rollback migration runs cleanly, table is gone, `core.parties` person rows remain
8. **No app code changes** — zero modifications to auth, routes, services, middleware, feature flags, or Drizzle schema
9. **No regressions** — existing schema validation tests still pass
10. **Slice doc** `docs/slice-a3-create-user-accounts.md` written
