# Migration Dossier — Section 1 (Repo Inventory & Architecture Surface Map)

## Completed scope

Section 1 from the chunked plan: repo-level discovery to identify where schema, routes, services, auth, import logic, frontend navigation, page routing, and state/data-fetch systems live.

---

## What I inspected

### 1) Database schema and migration surface
- `drizzle.config.ts` points Drizzle to `./shared/schema.ts` as the canonical schema entrypoint.
- `shared/schema.ts` is a barrel export that aggregates domain schema modules under `shared/schema/*.ts`.
- `shared/schema/` contains multi-domain schema files (users, projects, finance, engineering, tasks, quality, imports, stage lifecycle/data, collaboration, handover, hse, construction, soft-delete helpers, etc.).
- `migrations/*.sql` contains a large additive migration history (117 SQL files discovered).

### 2) Backend modules and route registration
- Central route orchestration is in `server/routes/register-all-routes.ts`, which composes route groups:
  - core, integration, info, project, support, department, admin, extracted registry, and legacy registerRoutes.
- The backend has a large route surface (`server/*routes.ts` + `server/routes/*.ts`; 102 route files discovered).
- Departmental and workflow route examples discovered:
  - quality routes (`server/quality-routes.ts`)
  - engineering routes (`server/engineering-routes.ts`, `server/eng-stage-routes.ts`)
  - stage lifecycle/data routes (`server/stage-lifecycle-routes.ts`, `server/stage-data-routes.ts`)
  - import routes (`server/smart-import-routes.ts`, `server/routes/imports.routes.ts`)
  - templates/project creation (`server/template-routes.ts`)

### 3) Auth, session, and permission model touchpoints
- Auth context and JWT/session resolution live in `server/auth-context.ts` and `server/jwt.ts`.
- Startup security middleware and API protections are configured in `server/bootstrap/security-middleware.ts` and `server/bootstrap/session.ts`.
- Route-level authorization pattern is broadly `jwtAuth + requireAuth + requirePermission(...)` and role guards in route files.
- Permission and visibility model artifacts exist in shared schema and frontend configuration (e.g., role permission tables and nav visibility configs).

### 4) Import, integration, and backfill paths
- Smart import implementation is a major subsystem in `server/smart-import-routes.ts` with commit/rollback and audit endpoints.
- Additional import/governance modules are in:
  - `server/lib/import/*`
  - `server/services/imports-governance-service.ts`
  - `server/repositories/imports-governance-repository.ts`
  - `server/importPipeline.ts`
- Startup/backfill orchestration exists under `server/bootstrap/*` and `server/bootstrap/backfills/*`.

### 5) Front-end navigation, pages, and route compatibility
- Client routing is in `client/src/App.tsx` using Wouter (`Switch`, `Route`, `Redirect`) with protected auth routing.
- Navigation model is currently 11 top-level sections in `client/src/config/app-navigation.ts`:
  - Home, Company, Priorities, Project Development, Project Delivery, Finance, Engineering, HSE, Quality, Reports, Admin.
- Canonical route/page metadata lives in `client/src/config/page-registry.ts`:
  - `PAGE_REGISTRY`
  - `LEGACY_REDIRECTS`
  - permission mapping (`getPermissionEntityForPath`)
  - role landing mapping (`ROLE_LANDING_PAGE`)
- Bridge layer for role/module model is in `client/src/config/module-registry.ts`.

### 6) Data-fetch and state management
- Query/cache backbone uses TanStack Query in `client/src/lib/queryClient.ts` and hooks under `client/src/hooks/*`.
- Auth state is Context-based in `client/src/hooks/use-auth.tsx`; lens context layering in `client/src/hooks/use-lens-context.tsx`.
- Core data hooks discovered for migration-sensitive areas:
  - approvals/governance/gates (`use-approvals.ts`, `use-governance.ts`, `use-gates.ts`)
  - project/stage (`use-project-v2.ts`, `use-stage-data.ts`, `use-stage-lifecycle.ts`)
  - permissions/navigation (`use-permissions.ts`, `use-access-matrix.ts`)

---

## Findings (Section 1)

1. **The app is already in a compatibility-heavy, additive migration posture** (multiple rollback SQLs, runtime compatibility extraction, route bridges, legacy redirects).
2. **Schema ownership is centralized but domain-split**: canonical Drizzle schema enters through `shared/schema.ts` while domain files are distributed across many modules.
3. **Route surface is very large and coupled** (100+ route files), making route/API regression risk high if migration is done as a big-bang cutover.
4. **Navigation is not yet aligned to the requested 8-department target**; current top nav is 11 sections and already includes transitional aliases/redirects.
5. **Auth + permissions are cross-cutting and deeply embedded** across backend middleware and frontend route/access matrices.
6. **Import and backfill flows are first-class production features** and must be protected early in migration sequencing.

---

## Dependency hotspots identified now

- **Schema compatibility hotspot:** `shared/schema.ts` + `shared/schema/*.ts` + `migrations/*.sql` + startup compatibility/backfill scripts.
- **Route aggregation hotspot:** `server/routes/register-all-routes.ts` + grouped registrars + monolithic route modules.
- **Auth/role hotspot:** `server/auth-context.ts`, `server/jwt.ts`, permission middleware, role/nav configs, user-role schema tables.
- **UI compatibility hotspot:** `client/src/config/page-registry.ts` (legacy redirects, alias routes, permission mapping), plus `client/src/App.tsx` protected route composition.
- **Import integrity hotspot:** `server/smart-import-routes.ts` and import governance service/repository modules.

---

## Risks spotted now (Section 1)

- **Early schema re-model risk:** touching canonical tables/columns before adapter layers could break route handlers and hook contracts still bound to legacy names.
- **Route-contract risk:** route aliases and legacy redirects imply active backward compatibility dependencies (bookmarks/deep links/in-app links).
- **Permission regression risk:** nav visibility and API authorization rely on coordinated role+permission mapping across client and server.
- **Importer fragility risk:** smart import commit/rollback and governance endpoints indicate operational reliance; migration order must preserve these.

---

## Open questions before Section 2

1. Which schema modules are canonical for each overlapping concept (e.g., approvals, stage evidence, work items vs legacy task structures)?
2. Which migrations indicate finalized cutovers versus temporary bridges still serving production traffic?
3. Which route groups are active vs legacy/shadow (especially duplicated route patterns)?

---

## Section 1 feedback

- Completed scope: Repo inventory and architecture surface map.
- Artifacts inspected: schema config, domain schema files, SQL migrations, route registrars/modules, auth middleware, import pipelines, frontend route/nav registry, state/data hooks.
- Key findings: additive/compatibility posture, large route surface, transitional navigation, cross-cutting permission system, critical import subsystem.
- Risks identified now: schema/route/auth/import regressions if migrated out of order.
- Blockers/ambiguities: canonical ownership of duplicated concepts and active-vs-legacy runtime paths still needs deep trace.
- Recommendation before proceeding: Start Section 2 with relationship-level entity inventory and duplicate-concept matrix, beginning with projects/stages/work/approvals/finance/users.
- Ready for next section: **Yes**.
