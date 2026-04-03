# Slice B.5: Create core.phase_definitions + core.project_phase_history

> **Status:** Implemented  
> **Predecessor:** Phase B.2 (project_instances), stage_definitions (existing)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.phase_definitions`** (enriched reference table from `stage_definitions` with `phase_group` and `is_gate`) and **`core.project_phase_history`** (per-project phase progression tracking with `is_current` flag).

---

## Why This Is the Right Next Slice

1. **Completes Phase B.** This is the final slice of the Project Spine phase, adding structured phase tracking to project instances.
2. **Enriches existing stage data.** `stage_definitions` has 10 stages but no grouping or gate markers. `phase_definitions` adds `phase_group` and `is_gate` for lifecycle categorization.
3. **Enables phase-aware queries.** `project_phase_history` allows querying "which phase is this project in?" and later "how long did it spend in each phase?"

---

## Current Repo Reality

| Artifact | Location | State |
|---|---|---|
| `stage_definitions` | `migrations/20260367_stage_lifecycle_foundation.sql` | Live. 10 rows. No phase_group or is_gate. |
| `project_execution_state.phase` | `shared/schema/projects.ts:133` | Live. Text field (e.g., "Construction"). |
| `core.projects.current_stage_code` | `migrations/20260402_lifecycle_parity_columns.sql` | Live. Backfilled from PES. Matches stage codes. |
| `core.project_state_history` | `migrations/20260402_state_history_tables.sql` | Live. Full snapshots, not clean phase transitions. |
| `core.project_instances.current_phase` | `migrations/20260403_b02_create_project_instances.sql` | Live (B.2). Plain text from core.projects.phase. |
| `core.phase_definitions` | -- | **Does not exist.** |
| `core.project_phase_history` | -- | **Does not exist.** |

---

## Target Change for This Slice Only

### 1. CREATE TABLE + SEED: `core.phase_definitions`

```sql
core.phase_definitions (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  phase_group         TEXT,
  sequence_order      INTEGER NOT NULL,
  department_owner    TEXT,
  is_gate             BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
)
```

Seed data (10 rows from stage_definitions):

| code | name | phase_group | is_gate |
|---|---|---|---|
| S01_FIRST_ASSESSMENT | First Assessment | project_development | false |
| S02_DESIGN_COST_PROPOSAL | Design & Cost Proposal Build | project_development | false |
| S03_SIGNATURE_FINANCIAL_CLOSE | Signature & Financial Close | project_development | true |
| S04_PD_PM_HANDOVER | PD -> PM Handover | project_development | true |
| S05_FINANCIAL_REVIEW | Financial Review | execution | true |
| S06_CONSTRUCTION | Construction | execution | false |
| S07_COMMISSIONING | Commissioning | execution | true |
| S08_OM_HANDOVER | O&M Handover | execution | true |
| S09_CLIENT_HANDOVER | Client Handover | execution | true |
| S10_POST_HANDOVER_REVIEW | 3-Month Post-Handover Review | closeout | false |

### 2. CREATE TABLE: `core.project_phase_history`

```sql
core.project_phase_history (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  phase_definition_id   INTEGER NOT NULL REFERENCES core.phase_definitions(id),
  entered_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  exited_at             TIMESTAMP,
  is_current            BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
)
```

### 3. Backfill

Current phase only (`is_current=true`) from `core.projects.current_stage_code`. Historical transition extraction deferred — `core.project_state_history` has full snapshots, not clean phase transitions.

---

## Scope In

- [x] SQL DDL migration: `CREATE TABLE core.phase_definitions` + `CREATE TABLE core.project_phase_history`
- [x] Seed data: 10 phase definitions from stage_definitions with phase_group and is_gate
- [x] SQL backfill migration: current phase per project (is_current=true)
- [x] SQL rollback migration: `DROP TABLE` both (phase_history first due to FK)
- [x] Indexes: phase_group, sequence_order, project_instance_id, phase_definition_id, partial active index
- [x] Safety check: `RAISE WARNING` for unmatched stage codes
- [x] Idempotent: `IF NOT EXISTS` on DDL, `ON CONFLICT (code) DO NOTHING` on seed, `NOT EXISTS` on backfill
- [x] Schema validation tests
- [x] Slice doc

---

## Scope Out

- **No historical transition extraction** — `core.project_state_history` snapshots are not clean phase transitions; extraction deferred
- **No `current_phase_definition_id` FK on project_instances** — `current_phase` remains plain text; phase lookup via `project_phase_history WHERE is_current = true`
- **No Drizzle ORM schema**
- **No app code, routes, or frontend changes**
- **No modification to `stage_definitions`** — it remains as-is

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `current_stage_code` is NULL for many projects | Expected | Low | `JOIN` skips projects without a stage code. They get no phase_history row. |
| Stage code on core.projects doesn't match phase_definitions.code | Low | Low | `RAISE WARNING` safety check + `JOIN` skips unmatched. |
| Historical transitions needed later | Expected | Low | Schema supports it — just add rows with `is_current=false` and `exited_at` populated. |

---

## Validation

### Post-migration checks

```sql
-- PM-1: phase_definitions seeded with 10 rows
SELECT COUNT(*) FROM core.phase_definitions;
-- Expected: 10

-- PM-2: All codes match stage_definitions
SELECT pd.code FROM core.phase_definitions pd
LEFT JOIN stage_definitions sd ON sd.stage_code = pd.code
WHERE sd.id IS NULL;
-- Expected: 0 rows

-- PM-3: Gate stages marked correctly (6 gates)
SELECT COUNT(*) FROM core.phase_definitions WHERE is_gate = true;
-- Expected: 6

-- PM-4: Phase groups assigned
SELECT phase_group, COUNT(*) FROM core.phase_definitions GROUP BY phase_group;
-- Expected: project_development=4, execution=5, closeout=1

-- PM-5: Current phase history rows match projects with stage codes
SELECT COUNT(*) FROM core.project_phase_history WHERE is_current = true;
-- Expected: close to SELECT COUNT(*) FROM core.projects WHERE current_stage_code IS NOT NULL

-- PM-6: At most one is_current=true per project
SELECT project_instance_id, COUNT(*) FROM core.project_phase_history
WHERE is_current = true
GROUP BY project_instance_id HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

## Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS core.project_phase_history;
DROP TABLE IF EXISTS core.phase_definitions;
COMMIT;
```

---

## Definition of Done

1. DDL + seed + backfill + rollback migration files exist and are valid
2. All post-migration checks pass
3. Schema validation tests added
4. No app code changes
5. No regressions
6. Slice doc written
