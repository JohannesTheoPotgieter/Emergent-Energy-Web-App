# Production-Safe Technical Debt Reduction Plan (2026-04-14)

## Scope and safety posture
- No schema/table/column drops, renames, resets, or truncations in this plan.
- Additive and reversible sequencing only.
- Route contracts are preserved unless an explicit compatibility shim is introduced.

## Findings
1. **Route registration is spread across layered shells**, with bridge-era overlap between extracted registry and legacy shell (`register-all-routes.ts` → `route-registry.ts` + `routes.ts`).
2. **Finance routes are a monolith** (`server/departments/finance-routes.ts`, 5,281 LOC).
3. **EXCO routes are tightly coupled** (`server/departments/exco-routes.ts`, 1,778 LOC).
4. **Storage remains a god-class** (`server/storage.ts`, 1,763 LOC).
5. **A stale route shell exists** (`server/routes/index.ts`) that is currently not used by startup orchestration.
6. **Dev/prod drift script exists but requires a live DATABASE_URL** (`npm run drift:report` failed in this environment due to missing env).

## Debt map (blast radius)
| Target | Current state | Blast radius | Why |
|---|---|---:|---|
| Duplicate handler registrations | Known historical duplicates; current risk in bridge shells | High | Can silently shadow behavior in production |
| finance-routes monolith | 5k+ LOC mixed concerns | High | Touches financial realization rules and critical APIs |
| exco-routes coupling | 1.7k LOC, cross-domain logic | Medium-High | Reporting + board workflows, many consumer endpoints |
| storage.ts god class | 1.7k LOC broad access paths | High | Shared dependency across most departments/services |
| Bridge-era compatibility layers | Legacy + extracted route shells coexist | Medium | Necessary for migration but increases ambiguity |
| Stale aliases/old route shells | `server/routes/index.ts` appears stale | Medium | Confuses ownership and can hide unregistered features |

## Canonical ownership (initial)
- `/api/program-expenses*` → `server/departments/finance-routes.ts`.
- EXCO dashboard/reporting endpoints → `server/departments/exco-routes.ts`.
- Department route bootstrap ownership → `server/routes/register-department-routes.ts`.

## Proposed decomposition sequence (no big-bang)
1. **Guard + observability first (safe island)**
   - Add route-group idempotency guard to block accidental duplicate registrations.
   - Add targeted tests for duplicate-blocking behavior.
2. **Finance monolith extraction by vertical slices**
   - Extract read-only report endpoints first into `server/departments/finance/` submodules.
   - Keep old exports and mount order; move handlers behind compatibility wrappers.
3. **EXCO extraction by responsibility**
   - Split KPI read APIs from write/update paths.
4. **storage.ts decomposition**
   - Introduce repository interfaces per domain (finance/exco/project).
   - Migrate call-sites incrementally while retaining `storage` facade.
5. **Bridge-layer sunset**
   - Remove stale shells only after route smoke + parity tests pass and compatibility shims are in place.

## Safe tonight vs later
### Safe tonight
- Add idempotent route registration guard for critical department groups.
- Add unit tests proving duplicate registration prevention behavior.
- Document ownership + blast radius.

### Needs approval
- Moving live finance/exco handlers into new files (even with shims).
- Activating currently stale/unused route shells or removing them.
- Any route contract change, permission model change, or mutation-path rewrite.

### Later structural cleanup
- Full finance and exco modularization.
- storage.ts repository split.
- Decommission bridge-era files after parity window.

## Regression test plan
1. Unit: guard behavior (single-owner dedupe + cross-owner non-collision).
2. Existing route uniqueness checks (program-expenses) must remain green.
3. Route order regression (department registration must remain before legacy shell).
4. Route smoke/API contract tests in CI before bridge-layer cleanup.

## Sunset plan for transitional layers and stale flags
1. Mark stale route shells with explicit owner + deprecation date.
2. Add usage telemetry/logging during startup registration.
3. Define 2-release sunset window for each compatibility shim.
4. Remove shim only when:
   - no references remain,
   - route parity tests pass,
   - rollback path documented.
