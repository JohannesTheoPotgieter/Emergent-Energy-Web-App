# PD Permissions & Accountability Review (2026-04-15)

Status: implemented on branch
`claude/improve-pipedrive-integration-2cllX`. Changes align route
guards with their real resource type, remove redundant double-gates,
add missing entity-level guards on unprotected GET routes, and
consolidate divergent local role lists. No role loses existing access.
One role (`KEY_ACCOUNTS_MANAGER`) gains the ability to create/edit
opportunities — intentional because they own the commercial pipeline.

---

## 1. Current permission map (before this change)

Authoritative source: `shared/schema/users.ts` `ENTITY_PERMISSION_DEFAULTS`
array + DB `role_permissions.entity_permissions` JSON override.

Resolution chain (`shared/permission-resolver.ts:118-155`):
1. DB override (`entityPermissions[entity][action]`) → explicit boolean.
2. Fallback to `ENTITY_PERMISSION_DEFAULTS` → role in `${action}_roles`.

### Entity → route map (PD area only)

| Entity         | Route                               | Method | Guard present? |
| -------------- | ----------------------------------- | ------ | -------------- |
| `pd_dashboard` | `/api/pd/dashboard`                 | GET    | NO (auth only) |
| `pd_dashboard` | `/api/pd/pipeline`                  | GET    | NO (auth only) |
| `pd_dashboard` | `/api/pd/reports`                   | GET    | NO (auth only) |
| `pd_tickets`   | `/api/pd/tickets`                   | GET    | NO (auth only) |
| `pd_tickets`   | `/api/pd/tickets/:id`               | GET    | NO (auth only) |
| `pd_tickets`   | `/api/pd/tickets/:id/task-templates` | GET   | NO (auth only) |
| `pd_tickets`   | `/api/pd/tickets`                   | POST   | YES            |
| `pd_tickets`   | `/api/pd/tickets/:id`               | PATCH  | YES            |
| `pd_tickets`   | `/api/pd/tickets/:id/spawn-tasks`   | POST   | YES            |
| `pd_tickets`   | `/api/pd/tickets/:id/engineering-tasks` | POST | YES          |
| `pd_clients`   | `/api/pd/clients`                   | GET    | NO (auth only) |
| `pd_clients`   | `/api/pd/clients/project-counts`    | GET    | NO (auth only) |
| `pd_clients`   | `/api/pd/clients`                   | POST   | YES            |
| `pd_clients`   | `/api/pd/clients/:id`               | PATCH  | YES            |
| **pd_dashboard** | `/api/opportunities`              | GET    | YES (mismatch) |
| **pd_dashboard** | `/api/opportunities/:id`          | GET    | YES (mismatch) |
| **pd_tickets** | `/api/opportunities`                | POST   | YES (mismatch) |
| **pd_tickets** | `/api/opportunities/:id`            | PATCH  | YES (mismatch) |
| **pd_tickets** | `/api/opportunities/:id`            | DELETE | YES (mismatch) |
| `handover`     | `/api/handover/*`                   | *      | YES            |

### Role → PD entity matrix (before)

| Role                 | pd_dashboard | pd_tickets | pd_clients | handover | opportunities |
| -------------------- | :---: | :---: | :---: | :---: | :---: |
| COO_ADMIN            | V/C/E | V/C/E | V/C/E | V/C/E/A | (via pd_tickets) |
| CEO_ADMIN            | V/C/E | V/C/E | V/C/E | V/C/E/A | (via pd_tickets) |
| CCO                  | V     | V/C/E | V/C/E | V       | (via pd_tickets) |
| PROGRAM_MANAGER      | V     | V     | -     | V/C/E/A | (via pd_dashboard) |
| KEY_ACCOUNTS_MANAGER | V     | V     | V/C/E | V       | **none** |
| PROJECT_DEVELOPER    | V     | V/C/E | V/C/E | V/C/E   | (via pd_tickets) |
| PROJECT_MANAGER_SITE | -     | -     | -     | V       | - |
| CFO                  | -     | -     | -     | -       | - |

*V=view, C=create, E=edit, A=approve. "via pd_tickets" means the route
used that entity for the check even though the resource is an opportunity.*

---

## 2. Mismatches found

### 2a. Object/entity mismatch

1. **Opportunity routes guarded by `pd_tickets`.**
   `POST/PATCH/DELETE /api/opportunities` used `requirePermission("pd_tickets", …)`.
   Creating an opportunity is a commercial pipeline action, not a PD work-queue
   action. The mismatch meant that `KEY_ACCOUNTS_MANAGER` (who owns accounts)
   could not create opportunities because they lack `pd_tickets:create`.
2. **Opportunity GET guarded by `pd_dashboard`.**
   `GET /api/opportunities` used `pd_dashboard:view`. Less wrong because "view
   the PD overview" is a reasonable proxy, but still semantically incorrect.

### 2b. Missing entity-level guards

Six GET routes had `requireAuth` only — no entity permission check at all.
Any authenticated user could read PD data regardless of their role.

### 2c. Redundant double-gating

`requirePermission('pd_clients', 'create')` was followed by `isPdRole(role)`;
`requirePermission('pd_tickets', 'create')` was followed by
`canCreatePdTicket(role)`. The hardcoded helpers disagreed with the DB defaults:
`canCreatePdTicket` excluded CCO, but `pd_tickets.create_roles` included CCO.
A CCO user would pass the central check and then be blocked by the local helper
with a confusing 403.

### 2d. Divergent local role lists in the handover page

`pd-pm-handover-v2.tsx` declared its own `PD_ROLES` and `PM_REVIEW_ROLES`
arrays with "admin" (not a real company role) and without
`KEY_ACCOUNTS_MANAGER`. These duplicated and diverged from the canonical lists
in `shared/roles/pd-roles.ts`.

---

## 3. Exact code changes

### `shared/schema/users.ts`
- Added `'opportunities'` to the `PermissionEntity` union type (line ~252).
- Added a new `opportunities` entry to `ENTITY_PERMISSION_DEFAULTS`:
  - view: COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER
  - create/edit: COO_ADMIN, CEO_ADMIN, CCO, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER
  - approve: COO_ADMIN, CEO_ADMIN, CCO
  - override/delete: COO_ADMIN, CEO_ADMIN

### `server/departments/opportunities-routes.ts`
- GET guards: `pd_dashboard:view` → `opportunities:view`.
- POST guard: `pd_tickets:create` → `opportunities:create`.
- PATCH guard: `pd_tickets:edit` → `opportunities:edit`.
- DELETE guard: `pd_tickets:delete` → `opportunities:delete`.

### `server/pd-routes.ts`
- Added `requirePermission('pd_clients', 'view')` to GET `/api/pd/clients`.
- Added `requirePermission('pd_clients', 'view')` to GET `/api/pd/clients/project-counts`.
- Added `requirePermission('pd_tickets', 'view')` to GET `/api/pd/tickets` (list) and `/api/pd/tickets/:id` (detail) and `/api/pd/tickets/:id/task-templates`.
- Added `requirePermission('pd_dashboard', 'view')` to GET `/api/pd/dashboard`, `/api/pd/pipeline`, `/api/pd/reports`.
- Removed `isPdRole(role)` double-gate from POST and PATCH `/api/pd/clients`.
- Removed `canCreatePdTicket(role)` double-gate from POST `/api/pd/tickets`, POST `/api/pd/tickets/:id/spawn-tasks`, POST `/api/pd/tickets/:id/engineering-tasks`.
- Removed dead imports of `isPdRole` and `canCreatePdTicket`.

### `client/src/pages/pd-pm-handover-v2.tsx`
- Removed local `PD_ROLES` and `PM_REVIEW_ROLES` constant declarations.
- Imported `isPdRole` (as `sharedIsPdRole`) and `canReviewHandover` (as `sharedIsPmRole`) from `@shared/roles/pd-roles`.
- Local `isPdRole()` / `isPmRole()` wrappers now delegate to the shared helpers.

### `docs/runbooks/pd-permissions-review-2026-04-15.md`
- This file.

---

## 4. Role-by-role access matrix (after)

| Role | pd_dashboard | pd_tickets | pd_clients | handover | **opportunities** |
| ---- | :---: | :---: | :---: | :---: | :---: |
| COO_ADMIN | V/C/E | V/C/E | V/C/E | V/C/E/A | **V/C/E/D** |
| CEO_ADMIN | V/C/E | V/C/E | V/C/E | V/C/E/A | **V/C/E/D** |
| CCO | V | V/C/E | V/C/E | V | **V/C/E** |
| PROGRAM_MANAGER | V | V | - | V/C/E/A | **V** |
| PROGRAM_FINANCE_MANAGER | - | - | - | V | **V** |
| KEY_ACCOUNTS_MANAGER | V | V | V/C/E | V | **V/C/E** (new) |
| PROJECT_DEVELOPER | V | V/C/E | V/C/E | V/C/E | **V/C/E** |
| PROJECT_MANAGER_SITE | - | - | - | V | - |
| CFO | - | - | - | - | **V** (new) |

*V=view, C=create, E=edit, D=delete, A=approve.*

Changes vs previous state:
- **KEY_ACCOUNTS_MANAGER**: gains explicit opportunities:view/create/edit (previously had none; the piggyback on pd_tickets excluded them).
- **CFO, PROGRAM_FINANCE_MANAGER**: gain opportunities:view (previously excluded; now included because they have a commercial reporting need).
- **CCO**: no change in effective access. Formerly piggy-backed on pd_tickets:create; now has explicit opportunities:create. Also: the CCO is no longer blocked by `canCreatePdTicket` when creating PD tickets (the hardcoded check excluded CCO; the DB default includes them).
- **All other roles**: unchanged.

---

## 5. Regression risks by role

| Role | Risk | Mitigation |
| ---- | ---- | ---------- |
| COO_ADMIN / CEO_ADMIN | None. All entity permissions default to full access for admin roles. | — |
| CCO | **Gains** PD ticket create on the API side (was blocked by hardcoded `canCreatePdTicket`; central permission always allowed). No loss. | Verify CCO can now create PD tickets without a 403. |
| PROGRAM_MANAGER | **May lose** access to PD ticket list if the DB `role_permissions` row does not have `pd_tickets:view=true` and the default allows it. | The default `pd_tickets.view_roles` includes PROGRAM_MANAGER, so this is safe as a fallback. |
| KEY_ACCOUNTS_MANAGER | **Gains** opportunities:create/edit. Previously excluded because the route used `pd_tickets:create` which they did not have. | Intentional expansion. Verify KAM can create opportunities. |
| PROJECT_DEVELOPER | No change in effective access. | — |
| PROJECT_MANAGER_SITE | No change. Still has handover:view only; no PD or opportunity access. | — |
| CFO / PROGRAM_FINANCE_MANAGER | **Gain** opportunities:view. Previously excluded from reading the pipeline. | Intentional expansion for commercial reporting. Verify they can load `/opportunities` without 403. |
| Roles without PD access (ENGINEER, ACCOUNTANT, etc.) | **May lose** ability to call GET `/api/pd/tickets` or GET `/api/pd/dashboard` — previously these had no entity guard (auth-only). Now guarded by `pd_tickets:view` / `pd_dashboard:view`. | The default `view_roles` do not include ENGINEER or ACCOUNTANT. If these roles previously relied on the unguarded GET to see ticket data, they will now get 403. This is **correct** — they should not have had access. If any role legitimately needs ticket data, add them to `pd_tickets.view_roles`. |

---

## 6. Untouched (intentional)

- **`handover.approve_roles` does not include `PROJECT_MANAGER_SITE`.**
  The handover page allows PM review via a local `isPmRole` check that
  includes PM_SITE in the shared `PM_REVIEW_ROLES` array. The central
  `handover.approve_roles` default only has [COO_ADMIN, CEO_ADMIN,
  PROGRAM_MANAGER]. Fixing this requires adding PM_SITE to approve_roles,
  which is a business-rule decision. Documented as future work.
- **Client-side `usePermission()` not added to opportunities, clients, or PD
  ticket pages.** The server guards are now correct; adding client-side
  checks would improve UX (hide buttons the user cannot use) but is not a
  security fix. Tracked as follow-up.
- **The `canViewAllTickets` helper in pd-routes.ts is NOT removed.** It is
  used for row-level filtering ("see all tickets vs only mine"), which is
  business logic, not access control. Kept deliberately.
- **`pd-ticket-detail.tsx` and `pd-ticket-create.tsx` hardcode
  `u.role === "ENGINEER" || u.role === "PROJECT_DEVELOPER"` for the
  designer-assignment user picker.** This is a presentation filter (which
  users appear in a dropdown), not an access gate. Kept.
- **`shared/roles/pd-roles.ts` helpers (`isPdRole`, `canCreatePdTicket`,
  etc.) are NOT deleted.** They are still imported by the handover page and
  by the `canViewAllTickets` row-level filter. Removing them entirely
  requires migrating all remaining callers to `usePermission` first.

---

End of review.

