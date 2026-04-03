# Slice B.3: Create core.project_info + core.project_info_parameter_values

> **Status:** Implemented  
> **Predecessor:** Phase B.2 (project_instances), B.1 (project_types + parameter_definitions)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.project_info`** (link table: one row per project instance, linking to project_type) and **`core.project_info_parameter_values`** (EAV value store for per-project parameter values, referencing definitions from B.1).

---

## Why This Is the Right Next Slice

1. **Bridges project_instances to project_types.** `project_info` provides the 1:1 link between a project instance and its type, while `project_info_parameter_values` stores actual parameter values defined in B.1's `project_type_parameter_definitions`.
2. **Pure EAV pattern.** No fixed technical columns — all project attributes go through the EAV pattern. Frontend manages parameter definitions (B.1), and this table stores values per project.
3. **Replaces legacy `public.project_info`.** The new `core.project_info` is a clean-slate design. The legacy table remains untouched.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `public.project_info` | Legacy | Live. Mixed columns. Not modified. |
| `core.project_instances` | `migrations/20260403_b02_create_project_instances.sql` | Live (B.2). Has `project_type_id` FK. |
| `core.project_types` | `migrations/20260403_b01_create_project_types.sql` | Live (B.1). 6 types. |
| `core.project_type_parameter_definitions` | `migrations/20260403_b01_create_project_types.sql` | Live (B.1). Empty, frontend-managed. |
| `core.project_info` | -- | **Does not exist.** |
| `core.project_info_parameter_values` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### 1. CREATE TABLE: `core.project_info`

```sql
CREATE TABLE IF NOT EXISTS core.project_info (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL UNIQUE REFERENCES core.project_instances(id),
  project_type_id       INTEGER REFERENCES core.project_types(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 2. CREATE TABLE: `core.project_info_parameter_values`

```sql
CREATE TABLE IF NOT EXISTS core.project_info_parameter_values (
  id                      BIGSERIAL PRIMARY KEY,
  project_info_id         BIGINT NOT NULL REFERENCES core.project_info(id),
  parameter_definition_id INTEGER NOT NULL REFERENCES core.project_type_parameter_definitions(id),
  value_text              TEXT,
  value_number            NUMERIC,
  value_boolean           BOOLEAN,
  value_date              DATE,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_info_id, parameter_definition_id)
);
```

### 3. Backfill

One `core.project_info` row per `core.project_instances` row, copying `project_type_id`. Parameter values left empty (populated once admins define parameters via frontend).

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.project_info` + `CREATE TABLE core.project_info_parameter_values`
- [x] SQL backfill migration: one project_info row per project_instance
- [x] SQL rollback migration: `DROP TABLE` both (parameter_values first due to FK)
- [x] Indexes: `project_type_id`, `project_info_id`, `parameter_definition_id`
- [x] Composite unique constraint: `(project_info_id, parameter_definition_id)`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT (project_instance_id) DO NOTHING` on backfill
- [x] Schema validation tests (static file-read pattern)
- [x] Slice doc

---

## Scope Out

- **No parameter value seed data** — parameter_values starts empty; populated via frontend
- **No Drizzle ORM schema**
- **No app code, routes, or frontend changes**
- **No feature flag changes**
- **No modification to legacy `public.project_info`** — it remains as-is

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `project_type_id` stays NULL for many projects | Expected initially | Low | Frontend assigns types over time. EAV values are optional. |
| Parameter definitions not yet created in B.1 | Expected | Low | `parameter_values` starts empty. Values added once frontend defines parameters. |

---

## Validation

### Post-migration checks

```sql
-- PM-1: Row count matches project_instances
SELECT COUNT(*) FROM core.project_info;
-- Expected: matches SELECT COUNT(*) FROM core.project_instances

-- PM-2: Every project_instance has a project_info row
SELECT COUNT(*) FROM core.project_instances pi
LEFT JOIN core.project_info pinfo ON pinfo.project_instance_id = pi.id
WHERE pinfo.id IS NULL;
-- Expected: 0

-- PM-3: parameter_values table exists but is empty
SELECT COUNT(*) FROM core.project_info_parameter_values;
-- Expected: 0

-- PM-4: No duplicate project_instance_id
SELECT project_instance_id, COUNT(*) FROM core.project_info
GROUP BY project_instance_id HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.project_info_parameter_values;
DROP TABLE IF EXISTS core.project_info;
COMMIT;
```

---

## Definition of Done

1. **DDL migration file** exists, is valid, and wrapped in `BEGIN/COMMIT`
2. **Backfill migration file** exists and populates one row per project_instance
3. **Rollback migration file** exists and drops both tables in correct FK order
4. All **post-migration checks** pass
5. **Schema validation tests** added (static file-read pattern)
6. **No app code changes**
7. **No regressions** — existing tests still pass
8. **Slice doc** written
