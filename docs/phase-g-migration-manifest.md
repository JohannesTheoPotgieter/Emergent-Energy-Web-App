# Phase G Migration Manifest

> **Phase:** G — External Resources + Activity/Audit Logs  
> **Status:** Schema DDL + backfill complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 7 (2 DDL + 3 backfill + 2 rollback)

---

## Execution Order

| # | File | Purpose |
|---|---|---|
| 1 | `20260403_g01_create_external_resources.sql` | Create `core.external_resources` + `core.resource_links` |
| 2 | `20260403_g02_backfill_external_resources.sql` | Backfill from sp_files, deliverable_files, sp_file_pointers + create links |
| 3 | `20260403_g03_create_activity_audit_logs.sql` | Create `core.activity_log` + `core.audit_log` |
| 4 | `20260403_g04_backfill_activity_log.sql` | Backfill from domain_events + deliverable_events |
| 5 | `20260403_g05_backfill_audit_log.sql` | Backfill from audit_events + audit_trail |

## Rollback

| # | File | Drops |
|---|---|---|
| 1 | `20260403_g06_rollback_activity_audit_logs.sql` | `audit_log` → `activity_log` |
| 2 | `20260403_g07_rollback_external_resources.sql` | `resource_links` → `external_resources` |

## New Tables

| Table | Rows (est.) |
|---|---|
| `core.external_resources` | ~8,000 |
| `core.resource_links` | ~10,000 |
| `core.activity_log` | ~13,000 |
| `core.audit_log` | ~70,000 |
