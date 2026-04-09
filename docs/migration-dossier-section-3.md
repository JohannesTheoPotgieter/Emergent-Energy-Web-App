# Migration Dossier — Section 3 (API, Route, and Workflow Behavior Map)

## Completed scope

Section 3 from the chunked plan: map API/route behavior and identify compatibility-sensitive runtime paths (especially projectName vs projectId routing, staged lifecycle APIs, and role-aware access wiring).

---

## 1) Runtime route orchestration and layering

### Backend registration layering
Route registration is compositional and grouped, not centralized in one file:
- Global group orchestrator: `server/routes/register-all-routes.ts`
- Group registrars:
  - core: `server/routes/register-core-routes.ts`
  - project/workflow: `server/routes/register-project-routes.ts`
  - department routes: `server/routes/register-department-routes.ts`
  - integration/import: `server/routes/register-integration-routes.ts`
  - support/shared ops: `server/routes/register-support-routes.ts`
  - admin/recovery/migration ops: `server/routes/register-admin-routes.ts`

**Behavioral implication**
- Same conceptual domain can be registered from multiple groups (e.g., approvals and handover paths appear in multiple registrars), so cutover must account for overlapping route ownership.

---

## 2) Frontend route contract behavior

### Canonical route registry + compatibility redirects
- Frontend route metadata and permission mapping are driven by:
  - `client/src/config/page-registry.ts` (`PAGE_REGISTRY`, `LEGACY_REDIRECTS`, `getPermissionEntityForPath`)
- Actual route rendering is wired through `client/src/App.tsx` using Wouter and lazy page imports.

### Legacy compatibility still active
Observed compatibility constructs:
- Legacy redirects (`/dashboard`, `/revenue`, `/my-tool/*`, `/exceptions`, `/project-lifecycle`, `/command-center`, `/sseg`)
- Route aliases (`type: "alias"`) for collaboration/legacy pages
- Legacy project detail URI contract still present: `/project/:projectName`

**Behavioral implication**
- UI uses explicit backward-compatible URLs and aliases; removing these before replacement mapping would break bookmarks/deep links and in-app navigation shortcuts.

---

## 3) Project identity contract split (high-risk)

### ID-based V2 API path (newer)
- Hooks in `client/src/hooks/use-project-v2.ts` call:
  - `/api/v2/projects/:projectId`
  - `/api/v2/projects/:projectId/finance`
  - `/api/v2/projects/:projectId/plan`
  - `/api/v2/projects/:projectId/quality`
  - `/api/v2/projects/:projectId/engineering`

### Name-based path (legacy-compatible, still active)
- UI routes and API calls still depend heavily on `projectName`:
  - frontend route `/project/:projectName`
  - many pages navigate via encoded project name
  - legacy backend endpoints in `server/routes.ts` include name-based APIs (e.g., health-summary, project-plan, program-expenses, expense-task-links, override endpoints, user-project-folder by project name)

**Behavioral implication**
- `projectName` compatibility bridge is still a live contract, not only historical data residue.
- A forced projectId-only cutover would break existing page flows and admin/finance utility paths.

---

## 4) Stage/lifecycle/gates workflow wiring

### Lifecycle API family (projectId-centric)
- `client/src/hooks/use-stage-lifecycle.ts` and `client/src/hooks/use-stage-data.ts` are tightly coupled to endpoints under:
  - `/api/projects/:projectId/stages/*`
  - `/api/projects/:projectId/stage-data/:stageCode`
  - `/api/projects/:projectId/charter`

### Gates and approvals aggregation views
- `client/src/hooks/use-gates.ts` uses `/api/gates/*` pipeline/blocked/ready/exceptions/handovers/updates routes.
- `client/src/hooks/use-approvals.ts` uses unified `/api/approvals` and `/api/approvals/count` plus action endpoint.

**Behavioral implication**
- UI already uses an aggregate “workspace” model (gates/approvals), but backend data sources remain multi-table and mixed legacy/new. This is a bridge zone requiring dual-read safety.

---

## 5) Role-aware behavior and authorization model in runtime

### Client-side role/nav gating
- `client/src/App.tsx` includes role-specific allowed-path arrays (EPM/PM/QM/HSE/SSEG route guards).
- `client/src/config/page-registry.ts` maps route path → permission entity and section mapping.

### Server-side auth/permission guard patterns
- Route modules use combinations of `jwtAuth`, `requireAuth`, `requirePermission`, and role-specific guards.
- Auth/session/JWT resolution is centralized in `server/auth-context.ts` + `server/jwt.ts`, with security middleware in bootstrap.

**Behavioral implication**
- Authorization logic is split across frontend navigation filters and backend middleware enforcement.
- Changing role names/section keys/entities out of order risks both hidden routes and 403 regressions.

---

## 6) Route/API compatibility map (Section 3 snapshot)

| Current contract | Current consumers | Migration posture |
|---|---|---|
| `/project/:projectName` UI route | many pages + deep links | Keep as compatibility route; add projectId alias gradually |
| `/api/v2/projects/:projectId/*` | v2 hooks and modern tabs | Expand as canonical read model |
| `/api/projects/:projectId/stages*` and stage-data/charter | lifecycle/stage workspace hooks | Treat as canonical for stage lifecycle rollout |
| `/api/gates/*` + `/api/approvals*` | gates + approvals dashboards | Keep aggregate APIs stable while backend model is normalized |
| `/api/*:projectName` legacy endpoints in `server/routes.ts` | finance/import/utility pages | Maintain bridge until all consumers switch to projectId + mapped resources |
| `LEGACY_REDIRECTS` and alias pages | browser history/bookmarks/in-app links | Keep until telemetry proves zero traffic |

---

## 7) Section 3 risks discovered now

1. **Dual-identity drift risk:** projectName and projectId paths can diverge if mapping is incomplete.
2. **Split ownership risk:** route registration across multiple groups can create inconsistent behavior during partial cutovers.
3. **Authorization mismatch risk:** frontend path visibility and backend permission checks may desynchronize during role/section migration.
4. **Workspace aggregation risk:** gates/approvals surfaces can silently degrade if one underlying source table changes semantics.

---

## Section 3 feedback

- Completed scope: API/route behavior map and compatibility contract inventory.
- Artifacts inspected: route registrar groups, core/project/department/integration/support/admin route registrars, App routing, page registry, project/stage/gates/approval hooks.
- Key findings: active dual identity contracts, active legacy redirects, aggregate workspace APIs over multi-model backend, split auth enforcement layers.
- Risks identified now: route breakage, auth regression, and projectName compatibility regressions if cutover order is wrong.
- Blockers/ambiguities: precise table-level authority per endpoint still requires endpoint-to-query tracing for highest-risk modules.
- Recommendation before proceeding: Section 4 should codify current→target table/field/route/UI mapping with explicit classification labels.
- Ready for next section: **Yes**.
