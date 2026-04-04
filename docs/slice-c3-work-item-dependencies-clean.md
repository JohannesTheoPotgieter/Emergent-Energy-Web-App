# Slice C.3: Create core.work_item_dependencies_clean

> **Status:** Implemented  
> **Predecessor:** C.2 (work_items_clean)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Recommended Slice

**Create `core.work_item_dependencies_clean`** — same schema as existing `work_item_dependencies` but with FKs pointing to `core.work_items_clean` instead of the legacy `work_items` table.

---

## Why This Is the Right Next Slice

1. **Completes the clean work engine.** Dependencies must reference the clean model to maintain referential integrity in the new schema.
2. **Simple migration.** Maps legacy work_item IDs to clean IDs via `legacy_work_item_id` lookup.
3. **Preserves dep_type and lag_days.** Standard PM dependency types (FS, SS, FF, SF) and lag days carried over exactly.

---

## Target Change for This Slice Only

### Schema: 7 columns

```sql
core.work_item_dependencies_clean (
  id                BIGSERIAL PRIMARY KEY,
  predecessor_id    BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE,
  successor_id      BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE,
  dep_type          TEXT NOT NULL DEFAULT 'FS',
  lag_days          INTEGER DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
)
```

### Backfill

Maps `work_item_dependencies.predecessor_id` and `successor_id` to `work_items_clean.id` via `legacy_work_item_id`. Excludes soft-deleted dependencies.

---

## Scope In / Out

**In:** DDL, backfill, rollback, indexes, unique constraint on (predecessor, successor, dep_type), idempotency, tests, slice doc  
**Out:** No Drizzle ORM, no app code, no soft delete column (clean model uses hard delete via CASCADE)

---

## Definition of Done

1. DDL + backfill + rollback migration files exist
2. Schema validation tests pass
3. No app code changes, no regressions
