# Canonical Runtime Boundaries (Active Paths)

## Purpose
This note defines the active runtime source-of-truth boundaries to reduce mixed legacy + canonical behavior in the same request flow.

Scope for this phase: trustability hardening only (no destructive migration, no table drops, no contract break).

## Domain decisions (active runtime)

| Domain | Canonical write source | Legacy tolerated temporarily | Notes |
|---|---|---|---|
| Startup/runtime config | `server/startup-modes.ts` computed startup modes from env flags | None (raw env values are inputs only) | Runtime decisions must consume `getStartupModes()` output rather than recomputing ad-hoc flag combinations. |
| Sessions/auth | Postgres `session` store via `connect-pg-simple` + Passport session in `server/index.ts` | JWT bearer fallback in specific routes, in-memory/session fallback only for non-postgres runtime | Session table is canonical for server-side auth session state. Avoid duplicating auth truth in domain tables. |
| Work items / planning tasks | `work_items` table | `operational_tasks` as read/mirror adapter | Active planning write flows must write `work_items` first; legacy task table updates are best-effort mirror only. |
| Project/core routing paths | `project_info` | Legacy project snapshots/read models | Routes should resolve project identity from `project_info.id` / `project_info.project_name` and avoid split write-master behavior. |

## Frontend route boundary decisions

| Surface | Canonical route(s) | Legacy compatibility retained | Notes |
|---|---|---|---|
| Project List placement | `/projects` under Project Management navigation | None found in active runtime | `client/src/config/app-navigation.ts` and `client/src/config/page-registry.ts` are the active navigation sources. |
| Finance trackers | `/cashflow`, `/cos`, `/revenue-tracker`, `/gp-tracker` | `/cashflow-forecast`, `/cos-control`, `/revenue` redirect to canonical routes | Legacy bookmarks remain supported, but new links and walkthroughs should target canonical finance routes only. |
| Microsoft admin settings | `/admin/settings` | `/settings/integrations`, `/admin/ms-integration`, `/admin/ms-mapping` redirect to `/admin/settings` | Keep runtime Microsoft APIs intact while collapsing duplicate admin UI entry points. |

## Banned mixed-write patterns

1. **Same flow writing legacy first, canonical second** for task-like entities.
2. **Unlinked dual writes** where canonical and legacy rows are both written without explicit adapter intent.
3. **Route-level recomputation of startup effective modes** from raw env in multiple places.

## Guardrails added in this phase

- Added explicit canonical boundary helpers in `server/canonical-boundaries.ts` for task mirror behavior.
- Planning task create/update/delete path now treats `work_items` as canonical write-master and uses controlled best-effort legacy mirroring.
- Added comments/TODO-friendly boundary intent in runtime code where mixed flows were previously implicit.

## Remaining mixed-source patterns (later phases)

- Routes that still update `operational_tasks` directly (e.g., engineering/task module paths) without canonical-first handoff.
- Recovery/admin flows that may independently touch `work_items` and `operational_tasks` and need shared adapters.
- Read-side query merges in reporting views (`project_plan` + normalized/canonical tables) that are still needed for backward-compatible API outputs.
