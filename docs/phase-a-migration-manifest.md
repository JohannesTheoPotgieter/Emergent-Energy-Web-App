# Phase A Migration Manifest

> **Purpose:** Defines the exact execution order for all Phase A migration files.  
> **Ordering rule:** Files use `20260403_aNN_` prefix so alphabetical sort = dependency order.  
> **Runner:** The project runs migrations alphabetically by filename (see `server/bootstrap/startup-orchestrator.ts`).

---

## Execution Order (forward migrations)

| Seq | File | Phase | Depends On | Creates/Modifies |
|-----|------|-------|------------|------------------|
| a01 | `20260403_a01_expand_parties_add_party_kind.sql` | A.2 | `core.parties` (exists from 20260402) | Adds `party_kind`, `legal_name`, `legacy_user_id` columns to `core.parties` |
| a02 | `20260403_a02_backfill_parties_users.sql` | A.2 | a01 | Sets `party_kind='organisation'` on existing rows; inserts users as `party_kind='person'` |
| a03 | `20260403_a03_create_departments_role_definitions.sql` | A.1 | `core` schema | Creates `core.departments` (6 rows) + `core.role_definitions` (16 rows) |
| a04 | `20260403_a04_create_user_accounts.sql` | A.3 | a01+a02 (parties with users) | Creates `core.user_accounts` with FK to `core.parties` |
| a05 | `20260403_a05_backfill_user_accounts.sql` | A.3 | a04 | Backfills `core.user_accounts` from `public.users` via `core.parties.legacy_user_id` |
| a06 | `20260403_a06_create_microsoft_identities.sql` | A.3b | a04 (user_accounts) | Creates `core.microsoft_identities` with FK to `core.user_accounts` |
| a07 | `20260403_a07_backfill_microsoft_identities.sql` | A.3b | a05+a06 | Backfills from `public.users.microsoft_id` + `ms_accounts` |
| a08 | `20260403_a08_create_role_assignments.sql` | A.4 | a04 (user_accounts) + a03 (role_definitions + departments) | Creates `core.role_assignments` with FKs to all three tables |
| a09 | `20260403_a09_backfill_role_assignments.sql` | A.4 | a05+a08 | Backfills from `public.users.role` via `core.role_definitions.code`. Warns on unmatched roles. |

## Rollback Order (reverse of forward)

Rollbacks must be executed in **reverse sequence** to respect FK dependencies:

| Seq | File | Drops |
|-----|------|-------|
| a08 | `20260403_a08_create_role_assignments_rollback.sql` | `core.role_assignments` |
| a06 | `20260403_a06_create_microsoft_identities_rollback.sql` | `core.microsoft_identities` |
| a04 | `20260403_a04_create_user_accounts_rollback.sql` | `core.user_accounts` |
| a03 | `20260403_a03_create_departments_role_definitions_rollback.sql` | `core.role_definitions` then `core.departments` |
| a01 | `20260403_a01_expand_parties_add_party_kind_rollback.sql` | Removes user rows + drops `party_kind`, `legal_name`, `legacy_user_id` columns |

Note: a02, a05, a07, a09 are backfill-only (no separate rollback — their data is removed when the parent table is dropped).

## Dependency Graph

```
core.parties (pre-existing, 20260402)
  │
  ├── a01: ADD COLUMN party_kind, legal_name, legacy_user_id
  ├── a02: BACKFILL party_kind + insert users
  │
  ├── a03: core.departments + core.role_definitions (independent of a01/a02)
  │         │
  │         └──────────────────────┐
  │                                │
  ├── a04: core.user_accounts ─── FK → core.parties
  ├── a05: BACKFILL user_accounts
  │    │
  │    ├── a06: core.microsoft_identities ── FK → core.user_accounts
  │    ├── a07: BACKFILL microsoft_identities
  │    │
  │    └── a08: core.role_assignments ── FK → user_accounts + role_definitions + departments
  │         a09: BACKFILL role_assignments (warns on unmatched roles)
```

## Validation

A test in `qa/tests/unit/phase1b-schema-validation.test.ts` enforces that:
1. All 9 forward Phase A files exist
2. Alphabetical sort matches the exact expected order above
3. Every backfill file sorts after its corresponding DDL file
4. The role_assignments backfill includes the unmatched-role safety warning
