# Canonical vs Legacy Boundaries (Current State)

## Canonical source-of-truth entities
- `project_info` for active project identity and lifecycle metadata.
- `work_items` for canonical cross-domain execution tracking.
- `users` + role/permission tables for identity and authorization context.
- Finance canonical monthly/normalized tables (`finance_*`, `normalized_*`) for reporting and forecasting.

## Legacy entities still in use
- Legacy project finance tables (`projects`, `expenses`, `revenues`, `tasks`) remain in runtime use through compatibility storage methods.
- Legacy task ownership/name fields continue to coexist with canonical user-id based assignment fields.
- Legacy import-related tables remain bridge inputs for canonical writeback/backfill flows.

## Bridge logic currently present
- Startup-gated backfills synchronize name-based assignment arrays to user-id arrays.
- Startup-gated schema repair paths still create/alter selected domain tables for backwards compatibility.
- Route layer still mixes canonical and legacy reads in some endpoints (particularly large `server/routes.ts`).

## Hardening done in phase 2
- Effective runtime maintenance policy now controls startup mutation behavior; schema/backfill flags alone no longer imply mutations at boot.
- `/api/environment/status` reports effective runtime mutation behavior (`runtimeMutationsActive`, `runtimeMaintenanceEnabled`) instead of raw env interpretation only.
- Auth route domain extracted from `server/routes.ts`.
- Operational/writeback/mytool persistence extracted from `server/storage.ts` into `WorkManagementRepository`.
- Security defaults tightened: smaller default JSON limit, endpoint-scoped large payload parser, stricter auth attempt limiter with expiry cleanup.
- Type-check coverage expanded to include `server/routes.ts` and `server/storage.ts` in `tsconfig.check.json`.

## Recommended next migration-safe steps
1. Move remaining startup DDL/backfill logic into explicit maintenance scripts in `scripts/` and keep boot fully read-mostly.
2. Incrementally extract additional storage domains (`work-items`, `procurement`, `finance`, `imports`) behind stable `IStorage` facade methods.
3. Reduce `server/routes.ts` surface by route-domain module boundaries and per-domain validation schemas.
4. Add integration tests for startup modes in postgres-backed CI to validate mutation gating behavior.
