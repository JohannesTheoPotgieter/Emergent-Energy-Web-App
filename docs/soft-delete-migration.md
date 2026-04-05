# Soft Delete Migration

Migration from `is_active` boolean columns to `deleted_at` timestamp columns for soft delete support.

## Tables with isActive

The following 17 tables currently use `is_active` boolean columns:

1. `project_execution_state` — **This PR** (primary migration target)
2. `project_info` — Uses `deleted_at` (already migrated)
3. `counterparties` — Supplier/vendor soft delete
4. `users` — User deactivation
5. `qc_template` — Quality checklist template soft delete
6. `qc_checklist` — Quality checklist instance soft delete
7. `procurement_items` — Procurement item soft delete
8. `work_items` — Task soft delete
9. `deliverables` — Deliverable soft delete
10. `approvals` — Approval record soft delete
11. `standup_schedules` — Standup schedule soft delete
12. `payment_requests` — Payment request soft delete
13. `change_requests` — Change request soft delete
14. `subcontractors` — Subcontractor soft delete
15. `handover_packs` — Handover pack soft delete
16. `sites` — Site soft delete
17. `opportunities` — Opportunity soft delete

## Migration Strategy

### Phase 1: project_execution_state (**This PR**)

- Add `deleted_at` timestamp column
- Migrate all queries from `WHERE is_active = true` to `WHERE deleted_at IS NULL`
- Mark `is_active` as @deprecated in schema
- Keep dual-write during transition

### Phase 2: Remaining Tables

- Apply same pattern to remaining 16 tables
- Each table migrated in its own PR for isolation
- Rollback SQL provided for each migration

## Query Migration Pattern

Before:
```sql
SELECT * FROM project_execution_state WHERE is_active = true
```

After:
```sql
SELECT * FROM project_execution_state WHERE deleted_at IS NULL
```
