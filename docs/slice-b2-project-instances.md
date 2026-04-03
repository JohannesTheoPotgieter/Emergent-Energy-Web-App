# Slice B.2: Create core.project_instances (Narrow Spine)

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase B.1 (project_types)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.project_instances`** — the narrow project spine containing only identity, status, and key FK columns. Backfill from `core.projects` + `project_execution_state`. No user assignment columns (those go to `project_party_links` in B.4).

---

## Why This Is the Right Next Slice

1. **Central entity for Phase B.** All subsequent B slices reference `project_instances`: B.3 (project_info_v2), B.4 (project_party_links), B.5 (project_phase_history).
2. **Separates spine from execution state.** The current `core.projects` (17 cols) mixes identity with operational state. `project_instances` holds only the stable identity columns.
3. **Includes `project_type_id` FK.** B.1 created `core.project_types`. This table can now reference it (nullable for existing projects without a type).

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `core.projects` | `migrations/20260314_multischema_foundation_prod.sql:53-71` | Live. 17 columns. INTEGER PK. Has `client_id`, `pm_user_id`, `pd_user_id`, `phase`, `rag_status`, etc. |
| `project_execution_state` | `shared/schema/projects.ts:128-227` | Live. 62 columns. Has planned dates, role assignments, execution gates. |
| `core.parties` (with clients) | `migrations/20260402_party_abstraction.sql` | Live. Has `legacy_client_id` for resolving `client_party_id`. |
| `core.project_types` | `migrations/20260403_b01_create_project_types.sql` | Live (B.1). 6 types. |
| `core.project_instances` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### Schema: 12 columns

```sql
core.project_instances (
  id                  BIGSERIAL PRIMARY KEY,
  legacy_project_id   INTEGER UNIQUE NOT NULL,   -- maps to core.projects.id
  project_code        TEXT,
  project_name        TEXT NOT NULL,
  project_type_id     INTEGER FK → core.project_types (nullable),
  client_party_id     BIGINT FK → core.parties (nullable),
  status              TEXT NOT NULL DEFAULT 'active',
  current_phase       TEXT,                       -- text for now; FK to phase_definitions in B.5
  planned_start_date  DATE,
  planned_end_date    DATE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
)
```

### Backfill mapping

| project_instances column | Source |
|---|---|
| `legacy_project_id` | `core.projects.id` |
| `project_code` | `core.projects.project_code` |
| `project_name` | `core.projects.project_name` |
| `project_type_id` | NULL (no type data on legacy projects) |
| `client_party_id` | `core.parties.id` via `legacy_client_id = core.projects.client_id` |
| `status` | Derived: 'archived' if `archived_status='archived'`, 'blocked' if `execution_gate_status='blocked'`, else 'active' |
| `current_phase` | `core.projects.phase` |
| `planned_start_date` | `project_execution_state.construction_start_date` |
| `planned_end_date` | `project_execution_state.client_handover_date` |

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.project_instances`
- [x] SQL backfill migration: from `core.projects` + `project_execution_state` + `core.parties`
- [x] SQL rollback migration: `DROP TABLE IF EXISTS core.project_instances`
- [x] Indexes: `project_code`, `project_type_id`, `client_party_id`, `status`, `current_phase`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT (legacy_project_id) DO NOTHING`
- [x] Schema validation tests
- [x] Slice doc

---

## Scope Out

- **No `pm_user_id` / `pd_user_id` columns** — user assignments go to `project_party_links` (B.4)
- **No `rag_status` / `execution_gate_*` columns** — execution detail stays in `project_execution_state`
- **No `current_phase_definition_id` FK** — `phase_definitions` doesn't exist until B.5; `current_phase` is plain text
- **No Drizzle ORM schema**
- **No app code, routes, or feature flag changes**
- **No modification to `core.projects`** — it remains as-is

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `client_id` on `core.projects` has no matching `core.parties.legacy_client_id` row | Low | Low | `LEFT JOIN` — unmatched projects get `client_party_id = NULL`. |
| `project_execution_state` row missing for some projects | Low | Low | `LEFT JOIN` — dates default to NULL. |
| `project_type_id` stays NULL permanently | Expected initially | Low | Frontend assigns types over time. B.3 doesn't require it. |

---

## Validation

### Post-migration checks

```sql
-- PM-1: Row count matches core.projects
SELECT COUNT(*) FROM core.project_instances;
-- Expected: matches SELECT COUNT(*) FROM core.projects

-- PM-2: Every legacy_project_id maps to core.projects
SELECT COUNT(*) FROM core.project_instances pi
LEFT JOIN core.projects p ON pi.legacy_project_id = p.id
WHERE p.id IS NULL;
-- Expected: 0

-- PM-3: client_party_id resolves where client_id existed
SELECT COUNT(*) FROM core.project_instances pi
JOIN core.projects p ON pi.legacy_project_id = p.id
WHERE p.client_id IS NOT NULL AND pi.client_party_id IS NULL;
-- Expected: 0 (all non-null client_ids resolved to party)

-- PM-4: No duplicate legacy_project_id
SELECT legacy_project_id, COUNT(*) FROM core.project_instances
GROUP BY legacy_project_id HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.project_instances;
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
