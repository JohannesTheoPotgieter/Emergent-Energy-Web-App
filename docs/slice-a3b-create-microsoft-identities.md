# Slice A.3b: Create core.microsoft_identities Only

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase A.3 (create core.user_accounts) — accepted  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Next Slice

**Create `core.microsoft_identities` table only** — extracts `public.users.microsoft_id` into a dedicated identity table linked to `core.user_accounts`. Backfills from `public.users` + `ms_accounts`. No app wiring, no OAuth flow changes.

---

## Why This Is the Right Next Slice

1. **Completes the roadmap's A.3 scope.** The migration plan defines A.3 as "Create user_account + microsoft_identity." A.3 delivered user_accounts; this finishes the pair.
2. **Prerequisite satisfied.** `core.user_accounts` exists with `legacy_user_id`, so we can resolve `microsoft_identities.user_account_id` via the join chain.
3. **Separates identity from session.** The existing `ms_accounts` table stores tokens and sync state. `microsoft_identities` stores the immutable identity link (Graph object ID, tenant, email). Different concerns, different tables.
4. **Minimal blast radius.** Only users with `microsoft_id IS NOT NULL` get a row. One new table, no existing tables modified.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `public.users.microsoft_id` | `shared/schema/users.ts:26` | Live. TEXT, UNIQUE, nullable. Microsoft Graph object ID. |
| `ms_accounts` table | `shared/schema/collaboration.ts:685-697` | Live. Has `tenant_id`, `ms_user_id`, `email`, plus token fields. |
| `core.user_accounts` | `migrations/20260403_create_user_accounts.sql` | Live (A.3). Has `legacy_user_id` mapping to `users.id`. |
| `core.microsoft_identities` | -- | **Does not exist.** |
| OAuth callback | `server/routes/auth-routes.ts:274-338` | Writes `microsoft_id` to `public.users`. No reference to `core.*`. |
| Tenant ID | `.replit` env / `server/microsoft-auth.ts:5` | Single tenant: `d6319480-d61b-4f33-adac-b7bc740c2fad`. |

---

## Target Change for This Slice Only

### 1. CREATE TABLE: `core.microsoft_identities`

```sql
CREATE TABLE IF NOT EXISTS core.microsoft_identities (
  id                BIGSERIAL PRIMARY KEY,
  user_account_id   BIGINT NOT NULL UNIQUE REFERENCES core.user_accounts(id),
  microsoft_user_id TEXT NOT NULL UNIQUE,
  tenant_id         TEXT NOT NULL,
  email             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Key design decisions:
- `user_account_id` UNIQUE — 1:1 with user_accounts (one MS identity per account)
- `microsoft_user_id` UNIQUE — the MS Graph object ID, must be globally unique
- `tenant_id` NOT NULL — sourced from `ms_accounts` or env var fallback
- `email` nullable — MS email may differ from `users.email`; nullable for edge cases

### 2. Backfill

```sql
INSERT INTO core.microsoft_identities (user_account_id, microsoft_user_id, tenant_id, email)
SELECT
  ua.id,
  u.microsoft_id,
  COALESCE(ms.tenant_id, 'd6319480-d61b-4f33-adac-b7bc740c2fad'),
  COALESCE(ms.email, u.email)
FROM public.users u
JOIN core.user_accounts ua ON ua.legacy_user_id = u.id
LEFT JOIN ms_accounts ms ON ms.user_id = u.id AND ms.status = 'active'
WHERE u.microsoft_id IS NOT NULL AND u.microsoft_id <> ''
ON CONFLICT (user_account_id) DO NOTHING;
```

### 3. Index

```sql
CREATE INDEX IF NOT EXISTS idx_microsoft_identities_tenant_id
  ON core.microsoft_identities (tenant_id);
```

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.microsoft_identities`
- [x] SQL backfill migration: `INSERT ... FROM public.users JOIN core.user_accounts LEFT JOIN ms_accounts`
- [x] SQL rollback migration: `DROP TABLE IF EXISTS core.microsoft_identities`
- [x] Indexes: `user_account_id` (unique, from FK), `microsoft_user_id` (unique), `tenant_id`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT DO NOTHING` on backfill
- [x] Schema validation tests: static file-read assertions
- [x] Table comment documenting Phase A.3b
- [x] Slice doc

---

## Scope Out

- **No changes to OAuth callback** — `auth-routes.ts` still writes `microsoft_id` to `public.users`
- **No changes to `ms_accounts`** — token/sync table remains independent
- **No Drizzle ORM schema** for `core.microsoft_identities`
- **No app code, auth, middleware, or feature flag changes**
- **No bridge writes** — when OAuth updates `users.microsoft_id`, it does NOT yet sync to this table
- **No `role_assignments`** — that is A.4

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users without `microsoft_id` get no row | Expected | None | Correct behavior — `WHERE microsoft_id IS NOT NULL AND <> ''` filters them out. |
| `ms_accounts` has multiple active rows per user | Low | Low | `LEFT JOIN` may duplicate; `ON CONFLICT (user_account_id) DO NOTHING` prevents double-insert. First match wins. |
| Hardcoded tenant_id fallback becomes stale | Very Low | Low | Single-tenant deployment. If tenant changes, a data fix is trivial. |
| Future drift — `users.microsoft_id` updated without syncing here | Expected | Low | Bridge writes will be added when OAuth flows are wired to the new table (future slice). |

---

## Validation

### Pre-flight checks

```sql
-- PF-1: core.user_accounts exists and has rows
SELECT COUNT(*) FROM core.user_accounts;
-- Expected: matches SELECT COUNT(*) FROM public.users

-- PF-2: Some users have microsoft_id populated
SELECT COUNT(*) FROM public.users WHERE microsoft_id IS NOT NULL AND microsoft_id <> '';
-- Expected: > 0

-- PF-3: core.microsoft_identities does NOT exist yet
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'core' AND table_name = 'microsoft_identities'
);
-- Expected: false
```

### Post-migration checks

```sql
-- PM-1: Table exists with expected columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'microsoft_identities'
ORDER BY ordinal_position;
-- Expected: id, user_account_id, microsoft_user_id, tenant_id, email, created_at, updated_at

-- PM-2: Row count matches users with microsoft_id
SELECT COUNT(*) FROM core.microsoft_identities;
-- Expected: matches SELECT COUNT(*) FROM public.users WHERE microsoft_id IS NOT NULL AND microsoft_id <> ''

-- PM-3: Every microsoft_identity links to a valid user_account
SELECT COUNT(*) FROM core.microsoft_identities mi
LEFT JOIN core.user_accounts ua ON mi.user_account_id = ua.id
WHERE ua.id IS NULL;
-- Expected: 0

-- PM-4: No duplicate microsoft_user_id
SELECT microsoft_user_id, COUNT(*) FROM core.microsoft_identities
GROUP BY microsoft_user_id HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- PM-5: All rows have non-empty tenant_id
SELECT COUNT(*) FROM core.microsoft_identities WHERE tenant_id IS NULL OR tenant_id = '';
-- Expected: 0
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.microsoft_identities;
COMMIT;
```

**Rollback is safe because:**
- No app code reads from `core.microsoft_identities`
- No downstream table has a FK to it
- `core.user_accounts` and `public.users` are unaffected
- OAuth flows are unchanged

---

## Definition of Done

1. **DDL migration file** `migrations/20260403_create_microsoft_identities.sql` exists and is valid
2. **Backfill migration file** `migrations/20260403_backfill_microsoft_identities.sql` exists and is idempotent
3. **Rollback migration file** `migrations/20260403_create_microsoft_identities_rollback.sql` exists
4. All **pre-flight checks** pass
5. All **post-migration checks** pass
6. **Schema validation tests** added (static file-read pattern)
7. **No app code changes** — zero modifications to auth, OAuth, routes, services, middleware, feature flags, or Drizzle schema
8. **No regressions** — existing tests still pass
9. **Slice doc** written
