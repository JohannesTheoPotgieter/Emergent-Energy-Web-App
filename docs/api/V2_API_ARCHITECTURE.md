# API v2 Backend Architecture

## Folder structure

```txt
server/api/v2/
  controllers/
    v2-controller.ts
  policies/
    access-policy.ts
  repositories/
    project-v2-repository.ts
  routes/
    v2-routes.ts
  services/
    audit-service.ts
    project-v2-service.ts
  utils/
    http.ts
  validators/
    project-v2-validators.ts
```

## Design principles implemented
- Routes/controllers are thin and delegate data logic to services/repositories.
- New endpoints only use project-linked core/new-schema entities (`project_info`, `work_items`, `procurement_items`, `invoice_captures`, `normalized_*`, `project_eng_*`, `qc_*`).
- Request validation is Zod-based for params/query/body.
- Response envelope is consistent (`success`, `data`, `meta`, `error`).
- Structured typed errors (`ApiV2Error`) with explicit HTTP status and error codes.
- Permission checks centralized in policy guards.
- Audit write hooks for create/update/workflow transition actions.
- Pagination and reduced payload list endpoints to improve dashboard/list performance.

## Performance notes
- Removed legacy table fan-out for v2 project and dashboard endpoints.
- Added aggregate SQL read models for dashboard and finance summary.
- Added pagination defaults/max page size to bound payload size.
- Grouped fetches with `Promise.all` for project overview.
- Repository methods enforce filtered queries and sort order; avoids client-side filtering where possible.

## Legacy endpoint deprecation strategy
- Keep existing `/api/*` endpoints in place while frontend callers migrate.
- Use `docs/api/API_MIGRATION_MATRIX.md` and `docs/api/V2_API_MIGRATION_TRACKER.md` to control cutover.
- Mark old handlers as deprecated during phased migration; remove only post-approval.
