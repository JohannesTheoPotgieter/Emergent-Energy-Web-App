# Roles & Permissions System — Design & Implementation Plan

## 1. Current-State Review

### What Currently Exists (Working)
- **14 system roles** with section-based access (COO_ADMIN through ACCOUNTANT)
- **`role_permissions` table** with sections array, canManageUsers, canManageRoles, canEditData, entityPermissions (JSONB), authorityModel (JSONB)
- **`ENTITY_PERMISSION_DEFAULTS`** — 18 entity-action matrices defining view/create/edit/approve/override/delete per role
- **Permission middleware** (`requirePermission`, `requireAuthority`) with 60s caching
- **Frontend permission hooks** (`usePermission`, `useAccessMatrix`) that fetch from `/api/auth/permissions`
- **`PermissionGate` component** for conditional rendering
- **Page registry** mapping 97 routes to permission entities
- **Admin Roles page** with entity-action permission grid, role creation/cloning, user assignment
- **Authority model** with scopes (own, department, assigned_projects, all_projects, company_admin)
- **Entity assignments** table (OWNER, ASSIGNEE, APPROVER, REVIEWER, VIEWER)
- **Role-aware UX** (landing pages, nav ordering, quick-create actions by role)
- **Legacy role mapping** (admin→COO_ADMIN, member→PROGRAM_MANAGER)

### What Works Well
1. Entity-action permission matrix design is sound and granular
2. DB-override approach (JSONB entityPermissions) allows per-role customization
3. Permission middleware pattern is clean and reusable
4. Frontend hooks provide consistent access checking
5. Page registry centralizes route-to-entity mapping
6. Admin UI exists and shows entity permissions per role
7. Authority model concept with scopes is forward-looking

### Architecture Gaps & Weaknesses

#### Critical Security Gaps
1. **~60% of API routes have NO permission checks** — only `requireAuth` (any logged-in user can access). Affected:
   - ALL task management CRUD (POST/PATCH/DELETE `/api/tasks`)
   - ALL handover routes
   - ALL meeting/standup routes
   - ALL TR register CRUD
   - ALL report endpoints (non-admin)
   - GET operations on procurement, quality, commissioning, dependencies
   - Engineering task CRUD (most operations)
2. **Frontend-only enforcement** — Many buttons/sections hidden in UI but the API endpoint is unprotected. Any user with a valid token can call unprotected endpoints directly.
3. **No field-level enforcement** on backend — `canEditData: false` is only a UI hint, not enforced on PUT/PATCH endpoints.

#### Structural Weaknesses
4. **Hardcoded role checks scattered** — `requireAdminOrQm`, `requireExecRole`, `requireAdmin`, `requireManager` are inline role checks duplicated across route files instead of using the permission system.
5. **Section-level access is coarse** — `sections` array controls sidebar visibility but has no deeper meaning (no page/tab/widget granularity within a section).
6. **No user-specific overrides** — Permissions are role-only. Cannot give a specific user extra or restricted access.
7. **No audit trail for permission changes** — Role edits are not logged to audit_events.
8. **Entity permission defaults are hardcoded in schema.ts** — ~900 lines of role arrays that are hard to maintain and impossible for admins to understand at a glance.
9. **`ENTITY_PERMISSION_DEFAULTS` and `entityPermissions` JSONB have different structures** — The defaults use `{entity, view_roles[]}` while JSONB overrides use `{entity: {action: boolean}}`. Merge logic is fragile.
10. **Permission cache invalidation is weak** — 60s TTL means permission changes take up to 60s to propagate. No event-driven invalidation on role update.

#### Missing Capabilities
11. **No section/tab-level permissions** — Cannot control visibility of specific tabs or sections within a page.
12. **No widget/card-level permissions** — Cannot hide specific KPI cards or dashboard widgets.
13. **No field-level visibility/edit control** — Cannot make certain fields read-only or hidden per role.
14. **No workflow/stage-specific permissions** — Stage gate transitions check role inline, not via permission model.
15. **No approval authority configuration** — Who can approve what is partially in entity defaults but not configurable in admin UI.
16. **No import/export permissions** — No `export` action in entity defaults (only in authority actions).
17. **No record-level permissions** — Cannot restrict access to specific projects/portfolios per user.
18. **No separation of internal vs external user permissions**.
19. **No permission dependency/inheritance** — Cannot say "edit implies view".

## 2. Recommended Target Permission Model

### Core Concepts
```
Role → has many → Permission Grants
Permission Grant = { entity, action, scope?, allowed }

User → has one → Role (primary)
User → has many → User Permission Overrides (optional)

Entity = module/page/section/widget/field identifier
Action = view | create | edit | delete | approve | override | assign | reassign | export | import | manage_settings | close_complete
Scope = own | department | assigned_projects | all_projects | company_admin
```

### Permission Resolution Order
1. Check user-specific overrides (if any) → explicit allow/deny wins
2. Check role's `entityPermissions` JSONB (DB-customized) → if set, use it
3. Fall back to `ENTITY_PERMISSION_DEFAULTS` (code defaults)
4. If entity not found in any layer → deny by default

### Action Hierarchy (implied permissions)
- `edit` implies `view`
- `create` implies `view`
- `delete` implies `view`
- `approve` implies `view`
- `override` implies `approve` implies `view`
- `manage_settings` implies `view`
- `export` implies `view`
- `import` implies `view`

## 3. Recommended Data Model Changes

### New Table: `user_permission_overrides`
```sql
CREATE TABLE user_permission_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  scope TEXT,
  granted_by INTEGER REFERENCES users(id),
  reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, entity, action)
);
```

### New Table: `permission_audit_log`
```sql
CREATE TABLE permission_audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL, -- role_updated, role_created, user_override_added, user_role_changed
  target_role TEXT,
  target_user_id INTEGER,
  changed_by_user_id INTEGER REFERENCES users(id),
  changed_by_role TEXT,
  change_detail JSONB NOT NULL, -- { field, old_value, new_value }
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Modifications to `role_permissions`
- Add `permission_version INTEGER DEFAULT 1` — tracks changes for cache invalidation
- Authority model JSONB remains but gets properly typed and validated

### No changes to existing tables/columns — fully additive

## 4. Recommended Backend Enforcement Model

### Phase 1: Close Security Gaps (HIGH PRIORITY)
Add `requirePermission()` middleware to ALL unprotected CRUD routes:

| Route Group | Entity | Current Protection | Needed |
|---|---|---|---|
| Task management | `task_management` | requireAuth only | requirePermission |
| Handover routes | `projects` | requireAuth only | requirePermission |
| Meeting/standup | `meetings` | requireAuth only | requirePermission |
| TR register | `tr_register` | requireAuth + role check | requirePermission |
| Reports | `projects`/`financials` | requireAuth only | requirePermission |
| Quality GET | `quality` | requireAuth only | requirePermission("quality","view") |
| Procurement GET | `procurement` | requireAuth only | requirePermission("procurement","view") |
| Commissioning GET | `projects` | requireAuth only | requirePermission("projects","view") |
| Engineering CRUD | `engineering` | requireAuth only | requirePermission |
| Work items GET | `work_items` | requireAuth only | requirePermission |

### Phase 1: Replace Hardcoded Role Checks
Convert inline checks like `requireAdminOrQm`, `requireExecRole`, `requireManager` to use `requirePermission` with appropriate entity/action pairs.

### Phase 1: User-Override Support in Middleware
Extend `evaluatePermissionForRequest()` to check `user_permission_overrides` table before role defaults.

### Phase 2 (Future)
- Field-level enforcement on PATCH endpoints
- Record-level scoping (project/portfolio filters)
- Workflow stage transition permissions

## 5. Recommended Frontend Rendering/Access Model

### Phase 1: Leverage Existing Infrastructure
The existing `PermissionGate`, `usePermission`, and `useAccessMatrix` hooks are solid. Extend them:

1. **Add `useUserPermissions()` hook** that also loads user-specific overrides
2. **Extend `PermissionGate` with scope support**: `<PermissionGate entity="financials" action="view" scope="assigned_projects">`
3. **Add section/tab permission entities** — e.g., `pd_finance_tab`, `project_quality_section`
4. **Add widget permission entities** — e.g., `cockpit_revenue_card`, `cockpit_cashflow_card`
5. **Wrap action buttons** in `PermissionGate` consistently across all pages

### Phase 1: Admin Roles UX Improvements
- Add permission audit log viewer
- Add user-override management
- Add "effective permissions" view (what can user X actually do?)
- Show permission inheritance (edit→view implied)
- Group permissions by module with expand/collapse
- Add search/filter in permission grid

## 6. Migration Approach (Safe)

### Step 1: Database migrations (additive only)
- Create `user_permission_overrides` table
- Create `permission_audit_log` table
- Add `permission_version` column to `role_permissions`
- All existing data untouched

### Step 2: Backend enforcement (additive only)
- Add `requirePermission` to unprotected routes
- Keep existing `requireAuth` — just add permission check after it
- Existing roles' permissions in `ENTITY_PERMISSION_DEFAULTS` ensure current users keep their access
- New entities added to defaults with generous initial access (matching current behavior)

### Step 3: Replace hardcoded role checks
- Convert `requireAdminOrQm` → `requirePermission('quality', action)`
- Convert `requireExecRole` → `requirePermission('lifecycle', action)`
- Map each inline check to the correct entity/action

### Step 4: Frontend enhancement
- Add PermissionGate to unguarded action buttons
- Add new permission entities for sections/tabs/widgets
- Extend admin UI

### Backward Compatibility
- All existing roles keep exact same access
- All existing users keep their roles
- Default permissions match current hardcoded behavior
- New middleware falls through to existing defaults
- No data migration needed — purely additive

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| New permission checks lock out existing users | HIGH | Default permissions match current access exactly |
| Permission cache stale after role change | MEDIUM | Add cache version check + manual invalidation |
| Breaking change to `/api/auth/permissions` response | HIGH | Keep existing shape, add new fields only |
| Admin UI changes confuse current admins | LOW | Additive tabs, no existing UI removed |
| Migration fails on production DB | LOW | All DDL is additive (CREATE TABLE, ADD COLUMN) |
| Performance from permission override lookups | LOW | Cache user overrides with role permissions |

## 8. Files to Change

### New Files
- `migrations/YYYYMMDD_permission_overrides_audit.sql` — new tables
- `server/permission-audit.ts` — audit logging utility

### Modified Files (Backend)
- `shared/schema.ts` — new table definitions, new entities in PermissionEntity type, extended defaults
- `shared/permission-resolver.ts` — user override resolution
- `server/permission-middleware.ts` — user override support, cache versioning
- `server/role-management.ts` — audit logging on role changes, user override CRUD endpoints
- `server/task-management-routes.ts` — add requirePermission
- `server/handover-routes.ts` — add requirePermission
- `server/meeting-routes.ts` — add requirePermission
- `server/standup-routes.ts` — add requirePermission
- `server/tr-register-routes.ts` — add requirePermission
- `server/report-routes.ts` — add requirePermission
- `server/quality-routes.ts` — add requirePermission to unprotected GET routes
- `server/procurement-routes.ts` — add requirePermission to GET routes
- `server/commissioning-routes.ts` — add requirePermission to GET routes
- `server/engineering-routes.ts` — add requirePermission to unprotected routes
- `server/dependency-routes.ts` — add requirePermission to GET routes
- `server/lifecycle-routes.ts` — replace inline role checks
- `server/bootstrap/startup-orchestrator.ts` — add new table creation
- `server/db.ts` — SQLite schema for new tables

### Modified Files (Frontend)
- `client/src/hooks/use-permissions.ts` — user override support
- `client/src/hooks/use-access-matrix.ts` — user override support
- `client/src/pages/admin-roles.tsx` — audit log tab, user overrides, improved UX
- `client/src/pages/admin-roles.utils.ts` — new utility types

## 9. What Should Still Be Improved Later (Phase 2)

1. **Field-level permissions** — define editable/visible fields per entity per role
2. **Record-level scoping** — restrict users to specific projects/portfolios
3. **Workflow stage transition permissions** — who can move projects between stages
4. **Approval chain configuration** — multi-step approval workflows
5. **Permission templates** — pre-built permission sets for common role types
6. **Bulk permission management** — change permissions for multiple roles at once
7. **Permission impact analysis** — "what would change if I modify this permission?"
8. **External user/counterparty permissions** — separate permission model for external access
9. **Time-based permissions** — auto-expire temporary elevated access
10. **Permission delegation** — allow managers to temporarily delegate their authority
