# Slice A.1: Create core.departments + core.role_definitions

> **Status:** Plan — awaiting sign-off before implementation  
> **Predecessor:** None — first slice in Phase A  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.departments` and `core.role_definitions` reference tables** — seed from hardcoded constants in `shared/schema/users.ts`. These are small lookup tables with no downstream wiring.

---

## Why This Is the Right Slice

1. **Foundation for role_assignments (A.4).** `core.role_assignments` needs FK references to both `core.departments` and `core.role_definitions`. Without these tables, A.4 cannot proceed.
2. **Zero blast radius.** These are new reference tables with static seed data. No existing table is modified. No app code reads from them.
3. **Data already exists in code.** The 6 departments are defined as `DepartmentCluster` type and `ROLE_DEPARTMENT_MAP`. The 16 roles are defined as `COMPANY_ROLES`, `COMPANY_ROLE_LABELS`, and `DEFAULT_ROLE_PERMISSIONS`. Seeding is a straight mapping.

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| Department clusters | `shared/schema/users.ts:1388-1409` | Hardcoded TypeScript type + `ROLE_DEPARTMENT_MAP` constant. 6 departments. |
| Company roles | `shared/schema/users.ts:54-72` | Hardcoded `COMPANY_ROLES` array. 16 roles. |
| Role labels | `shared/schema/users.ts:75-90` | `COMPANY_ROLE_LABELS` record. |
| Role descriptions | `shared/schema/users.ts:1449-1466` | `DEFAULT_ROLE_PERMISSIONS` array with label + description per role. |
| `role_permissions` table | `shared/schema/users.ts:1276-1295` | Live. Stores permissions per role code. Not a role definition table. |
| `core.departments` | -- | **Does not exist.** |
| `core.role_definitions` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### 1. CREATE TABLE + SEED: `core.departments`

```sql
CREATE TABLE IF NOT EXISTS core.departments (
  id     SERIAL PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL
);
```

Seed data (6 rows):

| code | name |
|---|---|
| ADMIN | Exco |
| LEADERSHIP | Management |
| ENGINEERING | Engineering |
| PROJECT_DEVELOPMENT | Project Development |
| PROJECT_MANAGEMENT | Project Management |
| FINANCE | Finance |

### 2. CREATE TABLE + SEED: `core.role_definitions`

```sql
CREATE TABLE IF NOT EXISTS core.role_definitions (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  department_id INTEGER NOT NULL REFERENCES core.departments(id)
);
```

Seed data (16 rows): one per `COMPANY_ROLES` entry, with `name` from `COMPANY_ROLE_LABELS`, `description` from `DEFAULT_ROLE_PERMISSIONS`, and `department_id` resolved via `ROLE_DEPARTMENT_MAP`.

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.departments` + `CREATE TABLE core.role_definitions`
- [x] Seed data: 6 departments + 16 role definitions inserted in same migration
- [x] SQL rollback migration: `DROP TABLE` both tables (role_definitions first due to FK)
- [x] Index on `role_definitions.department_id`
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT (code) DO NOTHING` on seed
- [x] Schema validation tests (static file-read pattern)
- [x] Table comments documenting Phase A.1

---

## Scope Out

- **No Drizzle ORM schema** for `core.departments` or `core.role_definitions`
- **No app code changes** — hardcoded constants remain; reads will be wired in a future slice
- **No feature flag changes**
- **No `role_assignments` table** — that is A.4
- **No changes to `role_permissions` table** — it stores permissions, not definitions

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Role code mismatch between seed and `COMPANY_ROLES` | Very Low | Medium | Seed data is copied verbatim from `COMPANY_ROLES` and `ROLE_DEPARTMENT_MAP`. |
| Department name preferences change | Low | Low | `name` column is informational; `code` is the stable key. Name can be updated anytime. |
| Future role added to app but not to `core.role_definitions` | Expected | Low | New roles need an INSERT migration. This is the standard pattern for reference tables. |

---

## Validation

### Post-migration checks

```sql
-- PM-1: Departments exist with 6 rows
SELECT COUNT(*) FROM core.departments;
-- Expected: 6

-- PM-2: Role definitions exist with 16 rows
SELECT COUNT(*) FROM core.role_definitions;
-- Expected: 16

-- PM-3: Every role_definition has a valid department_id
SELECT COUNT(*) FROM core.role_definitions rd
LEFT JOIN core.departments d ON rd.department_id = d.id
WHERE d.id IS NULL;
-- Expected: 0

-- PM-4: Role codes match COMPANY_ROLES
SELECT rd.code FROM core.role_definitions rd
ORDER BY rd.code;
-- Expected: all 16 COMPANY_ROLES values

-- PM-5: Department codes match DepartmentCluster
SELECT d.code FROM core.departments d ORDER BY d.code;
-- Expected: ADMIN, ENGINEERING, FINANCE, LEADERSHIP, PROJECT_DEVELOPMENT, PROJECT_MANAGEMENT
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.role_definitions;
DROP TABLE IF EXISTS core.departments;
COMMIT;
```

**Rollback is safe because:**
- No app code reads from these tables
- No downstream table has a FK to them (until A.4 is implemented)
- Seed data is reproducible from hardcoded constants

---

## Definition of Done

1. **DDL + seed migration file** exists, is valid, and wrapped in `BEGIN/COMMIT`
2. **Rollback migration file** exists and drops both tables in correct FK order
3. All **post-migration checks** pass (6 departments, 16 roles, FKs valid)
4. **Schema validation tests** added (static file-read pattern)
5. **No app code changes** — zero modifications to routes, services, auth, middleware, feature flags, or Drizzle schema
6. **No regressions** — existing tests still pass
7. **Slice doc** written
