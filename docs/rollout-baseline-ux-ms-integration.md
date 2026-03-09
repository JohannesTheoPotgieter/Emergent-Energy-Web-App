# Rollout Baseline: UX + Microsoft Integration Foundations

## Purpose
This baseline captures current (pre-UX-change) app routing, role landing, admin/settings visibility, and Microsoft integration entry points so phased rollout work can stay additive and reversible.

## Rollout Feature Flags (foundation)
The following rollout flags are now centrally defined with safe defaults (`false`):

- `role_aware_ux`
- `contextual_ms_surfaces`
- `ms_create_action`
- `local_synced_save_flow`
- `cleaned_admin_visibility`

## Major Routes (current baseline)
Primary route catalog is sourced from `client/src/config/page-registry.ts` and route registration in `client/src/App.tsx`.

### Core business routes
- `/dashboard` (Execution Board)
- `/projects` and `/project/:projectName`
- `/cashflow`
- `/cos`
- `/revenue-tracker`
- `/gp-tracker`
- `/engineering`
- `/engineering/tasks`
- `/quality`
- `/weekly-reviews`
- `/subcontractor-dashboard`

### Role/workflow routes
- `/my-work`
- `/my-work/tasks`
- `/my-work/calendar`
- `/my-work/approvals`
- `/my-work/meetings`
- `/my-tool`
- `/my-tool/week`
- `/my-tool/backlog`
- `/command-center`
- `/pm-dashboard`
- `/pm/on-the-go`

### Admin/settings routes
- `/admin`
- `/admin/settings`
- `/admin/roles`
- `/admin/activity-log`
- `/admin/control-center`
- `/admin/import-control-tower`
- `/admin/recovery`
- `/admin/kpi-traceability`

## Current Role Landing Pages
Role-based landing pages are currently derived from `ROLE_LANDING_PAGE` in `page-registry`:

- `PROJECT_MANAGER_SITE` -> `/pm-dashboard`

Other roles currently land on `/` and are constrained by role and permission guards in `client/src/App.tsx` (`RoleGuard`).

## Current Top-Level Navigation Visibility
Top-level nav groups are currently generated in `client/src/components/layout/AppLayout.tsx` and include legacy/redesigned/unified variants.

### Legacy groups
- EXCO
- PROJECT MANAGEMENT
- ENGINEERING
- QUALITY
- FEEDBACK
- SETTINGS

### Redesigned/unified group set
- MY WORK
- PROJECT DEVELOPMENT
- ENGINEERING
- QUALITY
- PROJECT MANAGEMENT
- FINANCE
- SYSTEM

Visibility is permission-checked via `getPermissionEntityForPath` + role permissions, and some role-specific path allowlists are enforced in `RoleGuard`.

## Current Microsoft Integration Entry Points

### UI routes
- `/auth/ms-callback`
- `/collaboration`
- `/collaboration/email`
- `/collaboration/teams`
- `/teams/chats`
- `/my-work/email`
- `/my-work/teams`
- `/settings/integrations` (redirects to admin settings)
- `/admin/ms-integration` (redirects to admin settings)
- `/admin/ms-mapping` (redirects to admin settings)

### API entry points (high-level)
- `/api/auth/microsoft/enabled`
- `/api/auth/microsoft/login`
- `/api/auth/microsoft/callback`
- `/api/ms-integration/status`
- `/api/outlook/*` (events/messages/folders + email actions)
- `/api/ms-teams/*` (joined teams, chats, messages)

## Current Admin/Settings Visible Sections
Admin/system-related nav and pages currently include:

- Role/permission administration (`/admin/roles`)
- App settings (`/admin/settings`)
- Activity/audit log (`/admin/activity-log`)
- Import controls (`/smart-import`, `/admin/import-control-tower`)
- Recovery center (`/admin/recovery`)
- KPI traceability (`/admin/kpi-traceability`)
- Control center (`/admin/control-center`)

## Audit Logging Baseline
Global audit capture already uses `audit_events` with flexible `action` + JSON payload fields. This supports new rollout event categories without schema changes:

- `suggestion_presented`
- `suggestion_accepted`
- `suggestion_overridden`
- `override_reason_captured`
- `action_started`
- `action_succeeded`
- `action_failed`

Reusable helpers for these events are provided in `server/lib/audit/rollout-audit.ts`.

## Rollout Safety Notes
- Flag defaults are OFF to preserve current behavior.
- Changes are additive and reversible through app settings.
- No destructive database migrations were introduced.
- Existing business routes and role guards are unchanged.
