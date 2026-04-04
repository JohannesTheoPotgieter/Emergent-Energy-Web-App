# Slice C.1: Create core.work_packages

> **Status:** Implemented  
> **Predecessor:** Phase B (project_instances, phase_definitions, parties)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.work_packages`** — groups work items by project + workstream. One row per unique `(project_instance_id, workstream)` combination. Personal tasks excluded.

---

## Why This Is the Right Next Slice

1. **Foundation for clean work items.** `work_items_clean` (C.2) needs `work_package_id` FK. Work packages must exist first.
2. **Normalizes the workstream concept.** Currently workstream is just an enum column on `work_items`. Making it a first-class entity enables metadata, ownership, and phase association.
3. **Low complexity.** Derived from a simple GROUP BY on existing data.

---

## Target Change for This Slice Only

### Schema: 10 columns

```sql
core.work_packages (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  phase_definition_id   INTEGER REFERENCES core.phase_definitions(id),
  workstream            TEXT NOT NULL,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  owner_party_id        BIGINT REFERENCES core.parties(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_instance_id, workstream)
)
```

### Backfill

One row per unique `(project_id, workstream)` from `work_items` where `project_id IS NOT NULL` and `workstream <> 'PERSONAL'`.

---

## Scope In / Out

**In:** DDL, backfill, rollback, indexes, idempotency, tests, slice doc  
**Out:** No Drizzle ORM, no app code, no phase_definition_id mapping (set via frontend), no owner_party_id mapping (set via frontend)

---

## Definition of Done

1. DDL + backfill + rollback migration files exist
2. Schema validation tests pass
3. No app code changes, no regressions
