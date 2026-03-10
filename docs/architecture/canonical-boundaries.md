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

## Hardening done in this pass
- Startup guardrails made explicit: runtime schema mutation now additionally requires schema-repair mode even if migration flag is set.
- Bootstrapping responsibilities split into dedicated bootstrap modules (env guard, session, auth, security middleware, request observability, error handling).
- Users persistence slice extracted from monolithic storage into `UsersRepository`, with compatibility facade retained.

## Recommended next migration-safe steps
1. Move remaining startup DDL/backfill logic into explicit maintenance scripts in `scripts/` and keep boot read-mostly.
2. Incrementally extract storage domains (`work-items`, `procurement`, `finance`, `audit`) behind stable `IStorage` facade methods.
3. Reduce `server/routes.ts` surface by route-domain module boundaries and per-domain validation schemas.
4. Add integration tests for startup modes in postgres-backed CI to validate mutation gating behavior.
