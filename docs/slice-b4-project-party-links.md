# Slice B.4: Create core.project_party_links

> **Status:** Implemented  
> **Predecessor:** Phase A (parties + user_accounts), B.2 (project_instances)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.project_party_links`** — a junction table linking project instances to parties with typed roles. Replaces inline `client_id`, `pm_user_id`, `pd_user_id` on `core.projects` and 6 role-assignment user_id columns on `project_execution_state`.

---

## Why This Is the Right Next Slice

1. **Eliminates inline role columns.** The current `core.projects` has `client_id`, `pm_user_id`, `pd_user_id` baked into the schema. `project_execution_state` has 6 more. A junction table normalizes all of these into rows.
2. **Enables flexible role assignment.** New project roles can be added as rows without schema changes.
3. **Builds on the party model.** Phase A created `core.parties` (persons + organisations) and `core.user_accounts`. This table links those parties to projects.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `core.projects.client_id` | `shared/schema/projects.ts:67` | Live. Integer FK to clients. |
| `core.projects.pm_user_id` | `shared/schema/projects.ts:110` | Live. Integer FK to users. |
| `core.projects.pd_user_id` | `shared/schema/projects.ts:111` | Live. Integer FK to users. |
| `project_execution_state.*_user_id` | `shared/schema/projects.ts:189-193,213` | Live. 6 role-assignment columns. |
| `core.project_instances` | `migrations/20260403_b02_create_project_instances.sql` | Live (B.2). |
| `core.parties` | `migrations/20260402_party_abstraction.sql` | Live. Persons + organisations. |
| `core.user_accounts` | `migrations/20260403_a04_create_user_accounts.sql` | Live (A.3). |
| `core.project_party_links` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### Schema: 9 columns

```sql
core.project_party_links (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  party_id              BIGINT NOT NULL REFERENCES core.parties(id),
  project_role          TEXT NOT NULL,
  is_primary            BOOLEAN,
  start_date            DATE,
  end_date              DATE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_instance_id, party_id, project_role)
)
```

### Backfill mapping (9 roles)

| Source | project_role | is_primary |
|---|---|---|
| `core.projects.client_id` → `core.parties.legacy_client_id` | `'client'` | `true` |
| `core.projects.pm_user_id` → `user_accounts` → `parties` | `'pm'` | `true` |
| `core.projects.pd_user_id` → `user_accounts` → `parties` | `'pd'` | `true` |
| `project_execution_state.construction_manager_user_id` | `'construction_manager'` | `NULL` |
| `project_execution_state.quality_lead_user_id` | `'quality_lead'` | `NULL` |
| `project_execution_state.engineering_lead_user_id` | `'engineering_lead'` | `NULL` |
| `project_execution_state.program_manager_user_id` | `'program_manager'` | `NULL` |
| `project_execution_state.project_finance_user_id` | `'project_finance'` | `NULL` |
| `project_execution_state.kam_user_id` | `'key_accounts_manager'` | `NULL` |

### Deferred sources

- **`entity_assignments`** — generic polymorphic assignment system. Deferred to Phase C/D when work items and governed processes are addressed.
- **Action-tracking columns** (`phase_updated_by_user_id`, `rag_updated_by_user_id`, etc.) — these record "who did X", not ongoing role assignments. Belong in audit/history tables.

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.project_party_links`
- [x] SQL backfill migration: 9 role mappings from `core.projects` + `project_execution_state`
- [x] SQL rollback migration: `DROP TABLE IF EXISTS core.project_party_links`
- [x] Indexes: `project_instance_id`, `party_id`, `project_role`, partial active index
- [x] Composite unique constraint: `(project_instance_id, party_id, project_role)`
- [x] Safety checks: `RAISE WARNING` for unresolvable user_ids and client_ids
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT DO NOTHING` on backfill
- [x] Schema validation tests (static file-read pattern)
- [x] Slice doc

---

## Scope Out

- **No `entity_assignments` migration** — deferred to Phase C/D
- **No action-tracking columns** — `phase_updated_by`, `rag_updated_by`, etc. are audit data
- **No Drizzle ORM schema**
- **No app code, routes, or frontend changes**
- **No modification to `core.projects`** — inline columns remain as-is

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `pm_user_id` or `pd_user_id` not resolvable to party | Low | Low | `RAISE WARNING` safety check + `JOIN` skips unresolvable rows. |
| `client_id` not resolvable to party | Low | Low | `RAISE WARNING` + `JOIN` skips. `client_party_id` on `project_instances` covers same mapping. |
| Multiple `project_execution_state` rows per project | Expected | Low | `ROW_NUMBER()` with deterministic tiebreaker picks latest row. |
| Same user assigned multiple roles on same project | Expected | None | `UNIQUE (project_instance_id, party_id, project_role)` allows this — each is a separate role. |

---

## Validation

### Post-migration checks

```sql
-- PM-1: At least as many links as projects with client_id
SELECT COUNT(*) FROM core.project_party_links WHERE project_role = 'client';
-- Expected: matches SELECT COUNT(*) FROM core.projects WHERE client_id IS NOT NULL

-- PM-2: At least as many PM links as projects with pm_user_id
SELECT COUNT(*) FROM core.project_party_links WHERE project_role = 'pm';
-- Expected: close to SELECT COUNT(*) FROM core.projects WHERE pm_user_id IS NOT NULL

-- PM-3: No duplicate (project, party, role) combinations
SELECT project_instance_id, party_id, project_role, COUNT(*)
FROM core.project_party_links
GROUP BY project_instance_id, party_id, project_role
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- PM-4: All party_ids resolve to core.parties
SELECT COUNT(*) FROM core.project_party_links ppl
LEFT JOIN core.parties p ON p.id = ppl.party_id
WHERE p.id IS NULL;
-- Expected: 0

-- PM-5: Role distribution
SELECT project_role, COUNT(*) FROM core.project_party_links
GROUP BY project_role ORDER BY project_role;
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.project_party_links;
COMMIT;
```

---

## Definition of Done

1. DDL + backfill + rollback migration files exist and are valid
2. All post-migration checks pass
3. Schema validation tests added
4. No app code changes
5. No regressions
6. Slice doc written
