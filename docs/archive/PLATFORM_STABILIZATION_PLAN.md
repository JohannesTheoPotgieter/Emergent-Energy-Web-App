# Platform Stabilization Plan

## Version: 1.0 | Date: 2026-03-06

## Objective
Stabilize the Emergent Energy Dashboard to release-worthy state across 7 workstreams, producing hardened role/permission controls, comprehensive audit logging, canonical task consistency, admin recovery tooling, and shared platform services.

## Workstreams

### WS-1: Role & Permission Framework Hardening
- **Goal**: Ensure every route enforces correct RBAC; no over-permissive access
- **Deliverables**: ENTITY_PERMISSION_DEFAULTS reviewed for 13+ roles × 30+ entities; admin-only enforcement on all admin routes; audit logging for role/permission changes
- **Status**: COMPLETE — 50+ entity permissions configured in shared/schema.ts; requireAdmin middleware on all admin-only routes; logAuditFromReq added to all 7 mutating endpoints in role-management.ts

### WS-2: Admin Control Center Consolidation
- **Goal**: Single admin landing page for system monitoring and control
- **Deliverables**: `/admin/control-center` page with system health, import stats, integration status, feature flags, quick links, system enums, and dangerous actions with confirmation dialogs
- **Status**: COMPLETE — server/admin-control-routes.ts (8 endpoints), client/src/pages/admin-control-center.tsx, registered in sidebar and App.tsx

### WS-3: Transactional Logging Completeness
- **Goal**: Every important create/edit/delete action audit-logged with user attribution
- **Deliverables**: logAuditFromReq coverage across routes.ts (127+ calls), role-management.ts (7 new calls), quality-routes.ts (20 calls), engineering-routes.ts (15 calls), admin-recovery-routes.ts, handover-routes.ts, smart-import-routes.ts
- **Status**: COMPLETE — All PATCH/POST/DELETE endpoints now have audit logging; role changes, user creates, password resets, and user deletes all logged with before/after values

### WS-4: Canonical Task Engine — Server Normalization
- **Goal**: No raw legacy status values stored or returned by any task API
- **Deliverables**: normalizeStatus applied to all task write paths; canonical statuses (todo, in_progress, blocked, review, complete, cancelled) enforced at storage layer
- **Status**: COMPLETE — Normalization on operational task create/update, mytool task create/update, planning task create, baseline promotion, admin recovery PATCH; recurring task creation uses canonical "todo" instead of "planned"

### WS-5: Canonical Task Engine — Frontend Consistency
- **Goal**: All task views show consistent canonical status labels
- **Deliverables**: My Work board uses 5-column layout; engineering tasks use domain-specific status model (TO DO, IN PROGRESS, COMPLETE) with canonical mapping via fromEngineering()
- **Status**: COMPLETE — My Work board: 5 canonical columns; Engineering tasks: domain-specific status model preserved (correctly mapped to canonical in My Work via canonical-task-engine.ts)

### WS-6: Admin Recovery Hardening
- **Goal**: Admin can correct any operational mistake through UI without database access
- **Deliverables**: Task Recovery (search/edit all task types), Import Recovery (view runs/errors), Project Recovery (edit project fields), Deleted Items (restore soft-deleted items), confirmation dialogs on all destructive actions
- **Status**: COMPLETE — AlertDialog confirmation on task edits and item restores; status normalization on recovery PATCH; 11 correction scenarios covered (status, title, project, assignee, due date, priority, description, workstream, project linkage, task type, viewer)

### WS-7: Shared Platform Service Cleanup
- **Goal**: Consistent error handling, validation, loading states, and UI patterns
- **Deliverables**: ApiError class with typed error codes; task-validation.ts applied to creation endpoints; EnergyLoader on 6+ pages; SearchableSelect on revenue-tracker; global error handler middleware
- **Status**: COMPLETE — Standardized error responses, loading states, validation across app

## Timeline
- All 7 workstreams completed in a single stabilization session
- 8 documentation deliverables produced

## Risk Assessment
- **Low**: All changes are additive (no schema changes, no data migration)
- **Medium**: Some legacy status values may exist in database from pre-normalization imports (mitigated by normalizeStatus on all read paths)
