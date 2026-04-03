# Phase B Migration Manifest

> **Phase:** B — Project Spine  
> **Status:** Schema DDL + backfill complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 16 (10 forward + 5 rollback + 1 FK fix with rollback)

---

## Execution Order (alphabetical sort = dependency order)

| # | File | Slice | Purpose |
|---|---|---|---|
| 1 | `20260403_b01_create_project_types.sql` | B.1 | Create `core.project_types` (6 seeds) + `core.project_type_parameter_definitions` (empty, frontend-managed) |
| 2 | `20260403_b02_create_project_instances.sql` | B.2 | Create `core.project_instances` narrow spine (12 columns) |
| 3 | `20260403_b03_backfill_project_instances.sql` | B.2 | Backfill from `core.projects` + `project_execution_state` |
| 4 | `20260403_b04_create_project_info.sql` | B.3 | Create `core.project_info` (1:1 link) + `core.project_info_parameter_values` (EAV) |
| 5 | `20260403_b05_backfill_project_info.sql` | B.3 | Backfill one `project_info` row per `project_instance` |
| 6 | `20260403_b06_create_project_party_links.sql` | B.4 | Create `core.project_party_links` junction table |
| 7 | `20260403_b07_backfill_project_party_links.sql` | B.4 | Backfill 9 roles (client, pm, pd + 6 execution-state roles) |
| 8 | `20260403_b08_create_phase_definitions.sql` | B.5 | Create `core.phase_definitions` (10 seeds) + `core.project_phase_history` |
| 9 | `20260403_b09_backfill_project_phase_history.sql` | B.5 | Backfill current phase per project (`is_current=true`) |
| 10 | `20260403_b10_add_phase_definition_fk_to_project_instances.sql` | B.5 fix | Add `current_phase_definition_id` FK + backfill |

---

## Dependency Graph

```
b01 (project_types + param_defs)
 ├── b02 (project_instances) ← depends on b01 for project_type_id FK
 │    ├── b03 (backfill project_instances) ← depends on b02
 │    ├── b04 (project_info + param_values) ← depends on b02 for project_instance_id FK
 │    │    └── b05 (backfill project_info) ← depends on b04
 │    ├── b06 (project_party_links) ← depends on b02 for project_instance_id FK
 │    │    └── b07 (backfill project_party_links) ← depends on b06
 │    ├── b08 (phase_definitions + phase_history) ← depends on b02 for project_instance_id FK
 │    │    └── b09 (backfill project_phase_history) ← depends on b08
 │    └── b10 (add phase_definition FK to project_instances) ← depends on b08
```

---

## Rollback Files (reverse order)

| # | File | Drops |
|---|---|---|
| 1 | `20260403_b10_add_phase_definition_fk_to_project_instances_rollback.sql` | Column + index |
| 2 | `20260403_b08_create_phase_definitions_rollback.sql` | `project_phase_history` → `phase_definitions` |
| 3 | `20260403_b06_create_project_party_links_rollback.sql` | `project_party_links` |
| 4 | `20260403_b04_create_project_info_rollback.sql` | `project_info_parameter_values` → `project_info` |
| 5 | `20260403_b02_create_project_instances_rollback.sql` | `project_instances` |
| 6 | `20260403_b01_create_project_types_rollback.sql` | `project_type_parameter_definitions` → `project_types` |

---

## New Tables Created

| Table | Rows (est.) | Type |
|---|---|---|
| `core.project_types` | 6 | Reference (seeded) |
| `core.project_type_parameter_definitions` | 0 | Reference (frontend-managed) |
| `core.project_instances` | ~100 | Spine |
| `core.project_info` | ~100 | Link (1:1 with project_instances) |
| `core.project_info_parameter_values` | 0 | EAV (frontend-populated) |
| `core.project_party_links` | ~500 | Junction (9 role types) |
| `core.phase_definitions` | 10 | Reference (seeded from stage_definitions) |
| `core.project_phase_history` | ~100 | History (current phase only) |

---

## Safety Checks

| File | Check |
|---|---|
| `b07` | `RAISE WARNING` for unresolvable `pm_user_id`, `pd_user_id`, `client_id` |
| `b09` | `RAISE WARNING` for unmatched `current_stage_code` in `phase_definitions` |

---

## Deferred Work

- **Historical phase transitions:** `project_phase_history` only has current phase. Full extraction from `core.project_state_history` deferred.
- **`entity_assignments` backfill to `project_party_links`:** Deferred to Phase C/D.
- **Parameter definitions seed data:** `project_type_parameter_definitions` and `project_info_parameter_values` start empty. Populated via frontend admin UI.
