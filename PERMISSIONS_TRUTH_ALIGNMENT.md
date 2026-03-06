# Permissions Truth Alignment

## Date: 2026-03-06
## System: Emergent Energy Dashboard v1

---

## 1. Permission Model Layers

### Layer 1: Authentication
- **Mechanism**: Passport.js local strategy + Microsoft 365 SSO via MSAL
- **Enforcement**: All API routes behind `requireAuth` middleware
- **Status**: Fully enforced

### Layer 2: Role-Based Access (Admin)
- **Mechanism**: `requireAdmin` middleware checks `company_role` against admin role list
- **Enforcement**: Backend — admin endpoints reject non-admin users with 403
- **Status**: Fully enforced on all admin routes (control center, recovery, KPI traceability, import control tower, role management, activity log, database migration)

### Layer 3: Navigation Access (Sections)
- **Mechanism**: `role_permissions.sections` array per role
- **Enforcement**: Frontend sidebar rendering + route guard via `usePermission` hook
- **Status**: Fully enforced — toggling a section off removes the sidebar link AND blocks the route

### Layer 4: Entity Permissions (Granular)
- **Mechanism**: `role_permissions.entity_permissions` JSONB per role
- **Actions**: View, Edit, Approve, Override, Delete per entity
- **Enforcement**: Frontend UI visibility via `usePermission` hook. Backend enforcement exists for admin-only endpoints; entity-level backend enforcement is partial.
- **Status**: UI-level enforcement. Backend admin checks are solid. Entity-level backend enforcement is not comprehensive for all action types.

### Layer 5: Ownership Scoping
- **Mechanism**: Application logic (assignment checks, PM matching, viewer roles)
- **Enforcement**: Query-level — My Work fetches user-scoped data; project assignment links PM to projects
- **Status**: Implemented via application logic, not configurable via Roles & Permissions UI
- **Transparency**: Honesty notice added to Permissions UI explaining this scope

## 2. What the Permissions UI Shows vs Reality

| UI Element | What It Shows | What Actually Happens |
|---|---|---|
| Section toggle (On/Off) | Controls sidebar visibility | Fully enforced — hides sidebar link AND blocks route |
| Entity View permission | Controls "can see this feature" | UI-level: hides/shows components. Not enforced at API level for most read endpoints |
| Entity Edit permission | Controls "can edit" | UI-level: hides/shows edit buttons. Not enforced at API level for non-admin routes |
| Entity Approve permission | Controls "can approve" | UI-level: hides/shows approve actions |
| Entity Override permission | Controls "can override" | UI-level: hides/shows override actions |
| Entity Delete permission | Controls "can delete" | UI-level: hides/shows delete buttons. Soft delete endpoints don't check entity permissions |

## 3. Honesty Notice (Added)

A new "Permission Scope" notice has been added to the Roles & Permissions admin page explaining:
1. Navigation access is fully enforced
2. Entity permissions control UI visibility (most enforced at UI level only)
3. Row-level/project-level ownership scoping is handled by assignment logic, not configurable here

## 4. Recommendations for Future

1. Add backend middleware that checks entity permissions before write operations
2. Implement ownership scoping as a configurable feature (e.g., "PM can only edit their assigned projects")
3. Add audit logging for permission-denied attempts
4. Consider read-level enforcement for sensitive data entities
