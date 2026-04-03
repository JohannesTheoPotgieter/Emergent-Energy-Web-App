# Slice C.2: Create core.work_items_clean

> **Status:** Implemented  
> **Predecessor:** C.1 (work_packages), Phase A (parties), Phase B (project_instances)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.work_items_clean`** — narrow 17-column work item spine. Domain-specific fields remain in existing extension tables (`work_item_pm`, `work_item_engineering`, `work_item_scheduling`).

---

## Why This Is the Right Next Slice

1. **Replaces 75+ column monolith.** Current `work_items` is overloaded with personal tasks, engineering, scheduling, and domain-specific fields. The clean spine has only the essential columns.
2. **Adds work_package_id FK.** Links work items to their work package (from C.1) for structured grouping.
3. **Adds assigned_to_party_id.** Replaces `owner_user_id` with a party-model reference (Phase A).

---

## Target Change for This Slice Only

### Schema: 17 columns

```sql
core.work_items_clean (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_work_item_id   INTEGER UNIQUE NOT NULL,
  work_package_id       BIGINT REFERENCES core.work_packages(id),
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  assigned_to_party_id  BIGINT REFERENCES core.parties(id),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'Not Started',
  priority              TEXT,
  start_date            DATE,
  end_date              DATE,
  percent_complete      REAL DEFAULT 0,
  is_milestone          BOOLEAN DEFAULT false,
  parent_id             BIGINT REFERENCES core.work_items_clean(id),
  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
)
```

### Backfill (2 passes)

1. **Pass 1:** Insert all non-deleted work items with resolved FKs (work_package_id, project_instance_id, assigned_to_party_id). `parent_id` left NULL.
2. **Pass 2:** Update `parent_id` by mapping legacy `work_items.parent_id` → `work_items_clean.legacy_work_item_id`.

---

## Scope In / Out

**In:** DDL, 2-pass backfill, rollback, indexes, safety warnings, idempotency, tests, slice doc  
**Out:** No Drizzle ORM, no app code, no extension table modifications, personal tasks included (they just have NULL work_package_id and project_instance_id)

---

## Definition of Done

1. DDL + backfill + rollback migration files exist
2. Schema validation tests pass
3. No app code changes, no regressions
