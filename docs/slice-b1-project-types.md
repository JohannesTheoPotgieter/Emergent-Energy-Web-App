# Slice B.1: Create core.project_types + core.project_type_parameter_definitions

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** Phase A complete  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.project_types` reference table** (seeded with 6 types) and **`core.project_type_parameter_definitions`** (empty, frontend-managed via admin UI). This is the first slice of Phase B (Project Spine).

---

## Why This Is the Right Next Slice

1. **First Phase B dependency.** `project_instances` (B.2) and `project_info_v2` (B.3) both need `project_type_id` as a FK. Without this table, B.2 and B.3 cannot proceed.
2. **No project type column exists today.** The nearest equivalent is `contract_type` on opportunities (PPA, EPC, lease, hybrid), which is a different concept. Technology type (Grid tied, BESS, etc.) is not modeled anywhere.
3. **Parameter definitions are frontend-managed.** Instead of hardcoding ~50 parameters, the table is empty at creation. Admins define parameters per project type via the frontend, making the system self-service and adaptable.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| Project type concept | -- | Not modeled. No column, table, or enum for technology type. |
| `contract_type` on opportunities | `shared/schema/projects.ts` | Different concept (PPA/EPC/lease, not technology type). |
| `charter_system_type` on project_charters | `shared/schema/stage-data.ts` | Stage 4 charter field. Text, not normalized. |
| `core.project_types` | -- | **Does not exist.** |
| `core.project_type_parameter_definitions` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### 1. CREATE TABLE + SEED: `core.project_types`

```sql
CREATE TABLE IF NOT EXISTS core.project_types (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Seed data (6 rows):

| code | name |
|---|---|
| GRID_TIED | Grid Tied |
| BESS | BESS |
| HYBRID | Hybrid |
| WATER | Water |
| AD_HOC | Ad Hoc |
| OTHER | Other |

### 2. CREATE TABLE (empty): `core.project_type_parameter_definitions`

```sql
CREATE TABLE IF NOT EXISTS core.project_type_parameter_definitions (
  id              SERIAL PRIMARY KEY,
  project_type_id INTEGER NOT NULL REFERENCES core.project_types(id),
  parameter_code  TEXT NOT NULL,
  label           TEXT NOT NULL,
  data_type       TEXT NOT NULL,        -- 'text', 'number', 'boolean', 'date', 'select'
  unit            TEXT,                 -- 'kWp', 'ZAR', 'kWh', etc.
  is_required     BOOLEAN NOT NULL DEFAULT false,
  default_value   TEXT,
  select_options  JSONB,               -- for data_type='select': ["PPA","EPC","lease"]
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_type_id, parameter_code)
);
```

The `UNIQUE (project_type_id, parameter_code)` constraint prevents duplicate parameter codes within a project type.

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.project_types` + `CREATE TABLE core.project_type_parameter_definitions`
- [x] Seed data: 6 project types
- [x] SQL rollback migration: `DROP TABLE` both (parameter_definitions first due to FK)
- [x] Indexes: `project_type_id`, partial active index
- [x] Composite unique constraint: `(project_type_id, parameter_code)`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT (code) DO NOTHING` on seed
- [x] Schema validation tests (static file-read pattern)
- [x] Slice doc

---

## Scope Out

- **No parameter seed data** — parameter_definitions starts empty; managed via frontend
- **No Drizzle ORM schema**
- **No app code, routes, or frontend changes**
- **No feature flag changes**
- **No `project_type_id` column on existing project tables** — that comes in B.2/B.3

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Project type codes change in future | Low | Low | `code` is the stable key; `name` is display-only and updatable. New types can be INSERTed. |
| Parameter definitions need to be pre-populated before B.3 | Expected | Low | Frontend admin can create definitions before B.3 goes live. B.3 backfill can also work without parameter values (they're optional). |

---

## Validation

### Post-migration checks

```sql
-- PM-1: project_types seeded with 6 rows
SELECT COUNT(*) FROM core.project_types;
-- Expected: 6

-- PM-2: All type codes present
SELECT code FROM core.project_types ORDER BY code;
-- Expected: AD_HOC, BESS, GRID_TIED, HYBRID, OTHER, WATER

-- PM-3: parameter_definitions table exists but is empty
SELECT COUNT(*) FROM core.project_type_parameter_definitions;
-- Expected: 0

-- PM-4: Composite unique constraint works
-- (would be tested by attempting a duplicate insert)
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.project_type_parameter_definitions;
DROP TABLE IF EXISTS core.project_types;
COMMIT;
```

---

## Definition of Done

1. **DDL + seed migration file** exists, is valid, and wrapped in `BEGIN/COMMIT`
2. **Rollback migration file** exists and drops both tables in correct FK order
3. All **post-migration checks** pass (6 types, empty parameter_definitions)
4. **Schema validation tests** added (static file-read pattern)
5. **No app code changes**
6. **No regressions** — existing tests still pass
7. **Slice doc** written
