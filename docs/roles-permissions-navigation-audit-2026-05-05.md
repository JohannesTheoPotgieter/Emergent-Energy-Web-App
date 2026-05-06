# Roles · Permissions · Navigation — End-to-End Audit

**Date:** 2026-05-05
**Task:** #139
**Scope:** Map and reconcile every source of truth that decides what a user can see and do in Emergent Energy: company role → enabled sections → top-nav visibility → secondary-nav items → page access guard → backend permission middleware → admin "Roles & Permissions" UI.
**Out of scope:** Renaming role codes (e.g. `COO_ADMIN`, `PROJECT_MANAGER_SITE`) or section keys (`PORTFOLIO`, etc.); changing business rules; visual redesign.
**Conflict policy:** When two sources disagree, the more restrictive one wins. Drift is tracked here; behavioural changes are filed as separate follow-ups.

---

## 1. The single chain of truth

```
                 shared/schema/users.ts                    (DB role string)
                          │
                          ▼
              ROLE_VISIBLE_SECTIONS                        client/src/config/app-navigation.ts
              (CompanyRole → SectionKey[])
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        DISPLAY_TOP_NAV          TOP_SECTIONS              client/src/config/app-navigation.ts
        (7 top-nav items)        (sections + secondary)
              │                       │
              ▼                       ▼
                    buildVisibleTopSections()              app-navigation.ts
                    + canViewPath() callback
                              │
                              ▼
                    PAGE_REGISTRY                          client/src/config/page-registry.ts
                    (path → permissionEntity)
                              │
                              ▼
                    evaluatePathAccess()                   client/src/config/runtime-access.ts
                    → checkPermission(role, entity, action)
                              │
                              ▼
                    ENTITY_REGISTRY                        shared/permissions/registry.ts
                    (entity → {view,create,edit,…}_roles)
                              │
                              ▼
              requirePermission(entity, action) middleware (server/middleware/…)
                              │
                              ▼
                    Admin "Roles & Permissions" UI         /admin/roles
                    is a *view* of ENTITY_REGISTRY +
                    role_permissions.entity_permissions
```

**Ownership rules**

| Concern | Authoritative file |
|---|---|
| Role catalogue + admin role group | `shared/schema/users.ts` (`COMPANY_ROLES`, `ADMIN_ROLES`) |
| Role aliases (`admin` → `COO_ADMIN`, `COO_SUPER_ADMIN` → `COO_ADMIN`, …) | `shared/schema/users.ts` (`ROLE_PERMISSION_ALIASES`) |
| Section catalogue (`HOME`, `PORTFOLIO`, …) | `client/src/config/app-navigation.ts` (`SECTION_KEYS`) |
| Role → visible sections | `client/src/config/app-navigation.ts` (`ROLE_VISIBLE_SECTIONS`) |
| 7-item top nav model | `client/src/config/app-navigation.ts` (`DISPLAY_TOP_NAV`) |
| Section → secondary items | `client/src/config/app-navigation.ts` (`TOP_SECTIONS`) |
| Path → permission entity | `client/src/config/page-registry.ts` (`PAGE_REGISTRY`) |
| Entity → role action lists | `shared/permissions/registry.ts` (`ENTITY_REGISTRY`) |
| Runtime path-level allow/deny | `client/src/config/runtime-access.ts` (`evaluatePathAccess`) |
| Role-landing destination after login | `shared/navigation/role-landing-paths.ts` (`ROLE_LANDING_PATHS`) |
| Role landing eligibility per page | `client/src/config/page-registry.ts` (`roleLandingEligibility`) |
| Admin surface registry (Admin > * pages) | `client/src/config/admin-surfaces.ts` (`ADMIN_SURFACES`) |
| COO operational matrix (CXO sanity) | `shared/coo-operational-access-matrix.ts` |
| Frontend "is this user an exec admin?" | `client/src/lib/access-control.ts` (`isSuperAdmin`); exposed via `useAuth().isAdmin` |
| Backend permission gate | `server/middleware/*` → `checkPermission()` from `shared/schema` |

---

## 2. The approved 7-item top nav

`DISPLAY_TOP_NAV` (`client/src/config/app-navigation.ts:297`) defines exactly:

| # | Label | Path | Required section(s) |
|---|---|---|---|
| 1 | Home | `/` | (always visible) |
| 2 | Projects | `/execution-board` | any of PORTFOLIO, PROJECT_DEVELOPMENT, PROJECT_DELIVERY |
| 3 | Gates | `/gates` | any of PORTFOLIO, PROJECT_DELIVERY, QUALITY, HSE; AND `canViewPath('/gates')` |
| 4 | Finance | `/cashflow` | FINANCE |
| 5 | Departments | `/engineering` | any of ENGINEERING, QUALITY, HSE |
| 6 | Reports | `/reports/center` | REPORTS |
| 7 | Admin | `/settings` | ADMIN |

This list is enforced by the unit test in `qa/tests/unit/nav-cleanup-validation.test.ts` ("DISPLAY_TOP_NAV exactly defines 7 items …"). Any change to the top nav requires updating both the config and the test.

---

## 3. Role × top-nav visibility matrix

Derived directly from `ROLE_VISIBLE_SECTIONS` × the requirements above. ✓ = visible (assuming `canViewPath('/gates')` returns true for that role).

| Role | Home | Projects | Gates | Finance | Departments | Reports | Admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| COO_ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CEO_ADMIN | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| CCO | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| KEY_ACCOUNTS_MANAGER | ✓ | ✓ | ✓ | ✓ | – | – | – |
| PROGRAM_MANAGER | ✓ | ✓ | ✓ | ✓ | ✓ (Q+HSE) | ✓ | – |
| PROGRAM_FINANCE_MANAGER | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| PROJECT_MANAGER_SITE | ✓ | ✓ | ✓ | ✓ | ✓ (Q+HSE) | ✓ | – |
| CONSTRUCTION_MANAGER | ✓ | ✓ | ✓ | ✓ | ✓ (Q+HSE) | ✓ | – |
| ENGINEERING_MANAGER | ✓ | ✓ | ✓ | – | ✓ (E+Q) | ✓ | – |
| QUALITY_MANAGER | ✓ | ✓ | ✓ | – | ✓ (Q) | ✓ | – |
| HSE_MANAGER | ✓ | ✓ | ✓ | – | ✓ (HSE) | ✓ | – |
| SSEG_MANAGER | ✓ | ✓ | ✓ | – | ✓ (E+Q+HSE) | – | – |
| CFO | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| ACCOUNTANT | ✓ | – | – | ✓ | – | – | – |
| ENGINEER | ✓ | – | ✓ | – | ✓ (E+Q) | – | – |
| PROJECT_DEVELOPER | ✓ | ✓ | – | ✓ | – | – | – |

(*Departments brackets show which sub-groups — Engineering, Quality, HSE — are filtered in for that role by `buildVisibleTopSections`.*)

**Admin gating.** Admin (`/settings`, `/admin/*`) requires the `ADMIN` section, which is granted only to `COO_ADMIN` and `CEO_ADMIN` in `ROLE_VISIBLE_SECTIONS`. This matches `ADMIN_ROLES = ['COO_ADMIN', 'CEO_ADMIN']` in `shared/schema/users.ts` and is what `useAuth().isAdmin` (via `isSuperAdmin`) evaluates to. The matrix has a single, consistent answer to "who is an admin?".

---

## 4. Drift findings & resolutions

### 4.1 Hardcoded role literals in client pages — FIXED

Three call sites bypassed the helper chain by string-comparing roles directly. All replaced.

| File | Line | Was | Now | Why |
|---|---|---|---|---|
| `client/src/pages/role-settings.tsx` | 130 | `companyRole === "COO_ADMIN" \|\| isAdmin` | `isAdmin` | `isAdmin` already covers both COO_ADMIN and CEO_ADMIN via `isSuperAdmin(user.role, localStorage.company_role)`. The literal lost CEO_ADMIN coverage in the OR branch and was redundant in the rest. |
| `client/src/pages/role-settings.tsx` | 205 | same | same | Same function repeated inside `ConnectionsSection`. |
| `client/src/pages/EngineeringTasksPage.tsx` | 1347 | `user?.role === "ENGINEER"` | `normalizeRoleForPermissions(user?.role) === "ENGINEER"` | Role-aware UX rule (engineers can't *remove* assignees, only add). Routed through the canonical role normaliser so any future alias of ENGINEER (none today) flows through. The string is still ENGINEER because this is a UX rule, not an entity permission — there is no "remove_assignee" entity action in the registry. |

Other apparent matches found by `rg` were either:
- in `shared/permissions/**` (canonical definitions — *required* literals);
- in admin pages whose audience is COO_ADMIN/CEO_ADMIN only and where the literal is the actual business rule, not a permission proxy;
- inside `isSuperAdmin` itself.

### 4.2 Sources of truth — drift checks

| Check | Status | Evidence |
|---|---|---|
| Every `CompanyRole` listed in `ROLE_VISIBLE_SECTIONS` | ✓ | TS `Record<CompanyRole, …>` makes a missing role a compile error. |
| Every `ROLE_LANDING_PATHS` value resolves to a renderable page | ✓ | Enforced by `qa/tests/unit/app-navigation-helpers.test.ts`. |
| `roleLandingEligibility` on the destination page matches `ROLE_LANDING_PATHS` | ✓ | Same test. |
| `DISPLAY_TOP_NAV` has exactly 7 items, in the approved order | ✓ | `nav-cleanup-validation.test.ts`. |
| `ADMIN` section restricted to executive admins only | ✓ | `nav-cleanup-validation.test.ts`. |
| Every PAGE_REGISTRY `permissionEntity` exists in `ENTITY_REGISTRY` | ✓ | `route-permission-coverage.test.ts`. |
| Every sidebar item with no permission entity is in `MISSING_ENTITY_ALLOWLIST` | ✓ | `validateNavigationPermissionModel()`; verified in test (4.3). |
| COO can reach every operational domain | ✓ | `coo-operational-access.test.ts` (uses `COO_OPERATIONAL_ACCESS_MATRIX`). |
| Admin surface IDs in `ADMIN_SURFACES` match real routes | ✓ | `admin-permission-alignment.test.ts`. |
| Permission snapshot served by `/api/auth/permissions` matches frontend matrix | ✓ | `permission-snapshot-no-drift.test.ts`. |
| `/admin/control-center` redirects to `/admin/roles` | ✓ | Listed in `LEGACY_REDIRECTS`; the `COO_OPERATIONAL_ACCESS_MATRIX` lists it as a discoverable path and the test treats redirects as discoverable. |

### 4.3 New test added

`qa/tests/unit/role-nav-truth-chain.test.ts` (new) asserts:
1. The role × top-nav matrix in §3 above is exactly what `buildVisibleTopSections` produces (table-driven; one expectation per cell).
2. Admin top-nav is visible **iff** `useAuth().isAdmin` would be true (i.e. role is in `ADMIN_ROLES`).
3. Every `DISPLAY_TOP_NAV` item's primary path resolves through `evaluatePathAccess` to an `entity_allow` (or matches the explicit ADMIN restriction) for at least one role that is supposed to see it.
4. `validateNavigationPermissionModel()` reports zero issues — every secondary nav item maps to a permission entity unless explicitly allow-listed.
5. No additional hardcoded role literals (`role === "ROLE_NAME"`) exist outside the canonical files.

### 4.4 Per-page × per-role policy conflicts (pre-existing, unchanged)

`audit/per-page-per-role-conflicts.md` lists 50 sidebar paths where the role's section is enabled but the entity-level rule denies the role (e.g. `/pm/on-the-go` for many non-PM roles, finance pages for `CONSTRUCTION_MANAGER`/`KEY_ACCOUNTS_MANAGER`, procurement leakage for non-finance roles). These are **policy-baseline** drift items, intentionally tracked separately from this navigation audit — a "more restrictive wins" decision (i.e. the entity rule denies, so the link is clickable-but-denied at runtime). They are out of scope for #139's nav-chain consolidation and remain on the §6 follow-up list in `audit/per-page-per-role-conflicts.md`.

---

## 5. Helpers — what to use in new code

| Need | Use | Don't use |
|---|---|---|
| "Is this user an executive admin?" | `useAuth().isAdmin` (frontend) / `ADMIN_ROLES.includes(role)` (shared) | `role === "COO_ADMIN"` literals |
| "Can this user view/edit this entity?" | `<PermissionGate entity="…" action="…">` or `usePermission(entity, action)` | role list checks |
| "Can this user navigate to this path?" | `evaluatePathAccess({ role, path, snapshot })` | reading sections directly |
| Resolve aliased roles | `normalizeRoleForPermissions(role)` | string compare |
| Backend route gate | `requirePermission(entity, action)` middleware | role-list checks in handlers |

---

## 6. Verification

- `npm run check` — passes.
- `npm test` (vitest, unit suite) — passes (existing 8 files / 82 tests **plus** the new `role-nav-truth-chain.test.ts`).
