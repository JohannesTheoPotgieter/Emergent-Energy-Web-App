# Phase C Migration Manifest

> **Phase:** C — Work Engine  
> **Status:** Schema DDL + backfill complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 9 (3 DDL + 3 backfill + 3 rollback)

---

## Execution Order (alphabetical sort = dependency order)

| # | File | Slice | Purpose |
|---|---|---|---|
| 1 | `20260403_c01_create_work_packages.sql` | C.1 | Create `core.work_packages` (project + workstream grouping) |
| 2 | `20260403_c02_backfill_work_packages.sql` | C.1 | Backfill from unique `(project_id, workstream)` on `work_items` |
| 3 | `20260403_c03_create_work_items_clean.sql` | C.2 | Create `core.work_items_clean` (17-column narrow spine) |
| 4 | `20260403_c04_backfill_work_items_clean.sql` | C.2 | Backfill from `work_items` with FK resolution + parent_id 2-pass |
| 5 | `20260403_c05_create_work_item_dependencies_clean.sql` | C.3 | Create `core.work_item_dependencies_clean` |
| 6 | `20260403_c06_backfill_work_item_dependencies_clean.sql` | C.3 | Backfill from `work_item_dependencies` with ID remapping |

---

## Dependency Graph

```
Phase B (project_instances, work_packages FKs)
 └── c01 (work_packages)
      ├── c02 (backfill work_packages)
      └── c03 (work_items_clean) ← depends on c01 for work_package_id FK
           ├── c04 (backfill work_items_clean) ← depends on c03
           └── c05 (work_item_dependencies_clean) ← depends on c03 for predecessor/successor FKs
                └── c06 (backfill dependencies) ← depends on c05 + c04
```

---

## Rollback Files (alphabetical sort = correct reverse FK order)

| # | File | Drops |
|---|---|---|
| 1 | `20260403_c07_create_work_item_dependencies_clean_rollback.sql` | `work_item_dependencies_clean` |
| 2 | `20260403_c08_create_work_items_clean_rollback.sql` | `work_items_clean` |
| 3 | `20260403_c09_create_work_packages_rollback.sql` | `work_packages` |

---

## New Tables Created

| Table | Rows (est.) | Type |
|---|---|---|
| `core.work_packages` | ~300 | Grouping (project × workstream) |
| `core.work_items_clean` | ~3,000 | Narrow spine (17 cols vs 75+) |
| `core.work_item_dependencies_clean` | ~500 | Junction (predecessor/successor) |

---

## Safety Checks

| File | Check |
|---|---|
| `c02` | `RAISE WARNING` for unresolvable `project_id` on work_items |
| `c04` | `RAISE WARNING` for unresolvable `project_id`, `owner_user_id`, and orphaned `parent_id` on work_items |
| `c06` | `RAISE WARNING` for orphaned dependencies (predecessor/successor not in work_items_clean) |
