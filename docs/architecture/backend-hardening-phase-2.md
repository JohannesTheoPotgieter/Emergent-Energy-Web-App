# Backend hardening phase 2

## Execution plan
- Move auth routes out of monolithic `server/routes.ts` into a dedicated route module.
- Extract operational/writeback/mytool persistence concerns from `server/storage.ts` into a repository.
- Tighten security middleware defaults (request body limits, auth throttling, headers).
- Make environment status reflect effective runtime behavior via runtime mutation policy.
- Strengthen type-check coverage by including critical backend monolith files in `tsconfig.check.json`.

## Boot behavior after this pass
- Normal boot is read-mostly by default.
- Runtime startup mutations now require explicit runtime maintenance enablement (`ENABLE_RUNTIME_MAINTENANCE=true` or startup maintenance mode), not just individual schema flags.
- `/api/environment/status` now reports effective runtime mutation state (`runtimeMutationsActive`, `runtimeMaintenanceEnabled`, and runtime migration status).

## What still remains risky
- `server/index.ts` still contains a large amount of legacy startup mutation logic; it is now more tightly gated but not fully moved to standalone maintenance scripts.
- Large legacy route and storage surfaces still exist; this pass introduces high-value extraction but does not complete full decomposition.
- In-memory auth rate limiting remains process-local and should be replaced with shared-store enforcement for multi-instance deployments.

## Extracted boundaries in this pass
- Auth endpoints moved to `server/routes/auth-routes.ts`.
- Work-management persistence moved to `server/repositories/work-management-repository.ts` with `IStorage` compatibility maintained via delegation.

## Follow-up migration path
1. Move remaining startup DDL/backfill blocks from `server/index.ts` to `scripts/maintenance/*` and invoke them only from explicit jobs.
2. Continue splitting route domains out of `server/routes.ts`.
3. Continue extracting `server/storage.ts` domains (project finance/imports/work-items).
4. Replace in-memory auth limiter with redis/postgres-backed centralized throttling.
