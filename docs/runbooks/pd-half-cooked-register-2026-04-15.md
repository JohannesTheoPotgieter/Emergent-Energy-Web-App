# PD Half-Cooked Functionality Register (2026-04-15)

Status: implemented on branch
`claude/improve-pipedrive-integration-2cllX`. This register covers
every known half-cooked, stub, or misleading PD surface as of this
date. Items already contained in prior commits on this branch are
listed with their disposition. Items first contained in this commit are
marked `[NEW]`.

---

## Register

### 1. `/pd/reports` — hidden internal reporting surface

| Field | Value |
|---|---|
| Location | `client/src/pages/pd-reports.tsx`, route `/pd/reports` |
| Problem | Page was reachable via the PD dashboard "Reports" button but hidden from the sidebar (`showInSidebar: false`). No visual signal that these metrics are ungoverned. |
| Disposition | **Badged as Internal** (prior commit `c89bf7a`). MaturityBadge + subtitle. |
| Status | Contained. |

### 2. Opportunities guarded by wrong permission entity

| Field | Value |
|---|---|
| Location | `server/departments/opportunities-routes.ts` |
| Problem | All 5 opportunity routes were guarded by `pd_tickets` or `pd_dashboard` — wrong resource type. |
| Disposition | **Fixed** (prior commit `cf3d681`). New `opportunities` entity registered. |
| Status | Contained. |

### 3. PD dashboard mixed three concerns into one section

| Field | Value |
|---|---|
| Location | `client/src/pages/pd-dashboard.tsx` |
| Problem | Dashboard blended ticket pipeline and handover readiness under a single "Pipeline Summary" heading. No commercial funnel visibility. |
| Disposition | **Restructured into 3 sections** (prior commit `c89bf7a`). |
| Status | Contained. |

### 4. PD reports mixed ticket and opportunity data

| Field | Value |
|---|---|
| Location | `/api/pd/reports` handler in `server/pd-routes.ts` |
| Problem | Pipeline health metrics used `allTickets` instead of `fyTickets` (FY-filter bug). No commercial funnel section at all. |
| Disposition | **Fixed FY bug + added commercial funnel** (prior commit `3cd1e66`). |
| Status | Contained. |

### 5. `opportunities.handoverReadiness` — deprecated shadow field

| Field | Value |
|---|---|
| Location | `shared/schema/projects.ts:106` |
| Problem | Duplicated `project_pd_pm_handover.status`. Written by nothing. |
| Disposition | **@deprecated annotation** (prior commit `7a03251`). |
| Status | Contained (documentation only — column not dropped). |

### 6. `opportunities.dealOwnerUserId` / `estimatedKwh` / `proposalIssuedDate`

| Field | Value |
|---|---|
| Location | `shared/schema/projects.ts:88,94,95` |
| Problem | Schema columns never written by any code path. |
| Disposition | **@deprecated annotation** (prior commit `162e8a9`). |
| Status | Contained (documentation only). |

### 7. `pd_tickets.clickUpSynced` — dead integration stub `[NEW]`

| Field | Value |
|---|---|
| Location | `shared/schema/projects.ts:577` |
| Problem | Column was part of a ClickUp integration that was never completed. No ClickUp client, sync service, or lifecycle code exists. The column is defined, defaults to `false`, and is never read or written by any active code path. |
| Containment | **@deprecated annotation** (this commit). |
| Recommendation | Keep column for schema stability. Do not build on it. If ClickUp integration is revived, start with a fresh design. |
| Status | Contained. |

### 8. `pd_tickets.tasksSpawnedAt` — idempotency guard with no re-spawn flow `[NEW]`

| Field | Value |
|---|---|
| Location | `shared/schema/projects.ts:578`, `server/pd-routes.ts:559` |
| Problem | Once set, it permanently blocks re-spawning sub-tasks even if the spawned tasks are deleted. No admin workaround exists. |
| Containment | **Documented with JSDoc** (this commit). The column is functional and intentional but has a known UX gap. |
| Recommendation | Add a `POST /api/pd/tickets/:id/respawn-tasks` admin endpoint that clears `tasksSpawnedAt` and allows a fresh spawn. Do NOT remove the guard — it prevents double-spawning, which is worse. |
| Status | Documented; no code change to the guard itself. |

### 9. PD dashboard empty state oversells the create flow `[NEW]`

| Field | Value |
|---|---|
| Location | `client/src/pages/pd-dashboard.tsx:427-428` |
| Problem | Empty state read "Create your first PD ticket to get started" — implies it's a one-click action, but PD tickets require a linked project, due date, and request type. User clicks "New PD Ticket" and hits a wall of required fields with no context. |
| Containment | **Relabelled** (this commit). Now reads: "PD tickets track engineering requests (cost proposals, site assessments, IFC planning, etc.) and require a linked project, due date, and request type." |
| Status | Contained. |

### 10. Admin backfill routes missing permission guards `[NEW]`

| Field | Value |
|---|---|
| Location | `server/departments/data-backfill-routes.ts:16,65,121` |
| Problem | Three admin endpoints (`GET /api/admin/backfill/status`, `POST /api/admin/backfill/sites-from-projects`, `POST /api/admin/backfill/opportunities-from-pd-tickets`) had `requireAuth` only. Any authenticated user could trigger mass data backfills or read table row counts. |
| Containment | **Added `requirePermission('admin', 'view'|'edit')`** (this commit). Status route gets `admin:view`; both POST routes get `admin:edit`. |
| Status | Contained. |

### 11. Clients dual-write feature flag — no sunset plan

| Field | Value |
|---|---|
| Location | `server/pd-routes.ts:197`, `server/routes/clients-extracted-routes.ts:71` |
| Problem | `promoted_core_clients_dual_write` flag gates optional mirrored writes to `core.clients`. The feature is intentionally non-blocking, but there is no admin UI to manage the flag and no deprecation timeline for the legacy `public.clients` table. |
| Containment | **Not changed** — intentionally out of scope for PD containment. The dual-write is a schema-migration concern, not a PD UX concern. |
| Recommendation | Add a "Feature Flags" admin surface or a sunset date in the runbook. |
| Status | Documented only. |

### 12. PD visibility config — partial coverage

| Field | Value |
|---|---|
| Location | `server/pd-routes.ts:23-52` (`getEffectiveVisibilityConfig`) |
| Problem | Per-user/per-role visibility config controls `ticketTypes` (PD vs engineering) and `scope` (all vs own) but does NOT control which request types, projects, or clients are visible. The admin surface does not document these limitations. |
| Containment | **Not changed** — the config works within its scope and does not overstate what it controls. No user-facing label says "full visibility control." |
| Recommendation | Add a tooltip or note on the admin config surface when it is eventually exposed. |
| Status | Documented only. |

### 13. `opportunities.siteId` — schema column with no workflow

| Field | Value |
|---|---|
| Location | `shared/schema/projects.ts:87` |
| Problem | The FK column exists and the zod create schema accepts it, but no UI field or sync path writes it. Opportunities are linked to clients, not sites. |
| Containment | **Not changed** — the column is correctly nullable and does no harm. It's a future-use column for when site-level opportunities make sense. |
| Recommendation | Do not deprecate — it's architecturally sound. Populate when site-level commercial tracking is built. |
| Status | Documented only. |

---

## Summary table

| # | Surface | Action taken | Risk if left untouched |
|---|---------|-------------|----------------------|
| 1 | /pd/reports | Badged Internal | Users trust ungoverned metrics |
| 2 | Opportunity permissions | Fixed entity | Wrong access control |
| 3 | PD dashboard sections | Restructured | Mixed mental models |
| 4 | PD reports FY bug | Fixed + funnel added | Stale/misleading numbers |
| 5 | handoverReadiness | @deprecated | Shadow field confuses devs |
| 6 | Unused opp columns | @deprecated | Devs build on dead schema |
| 7 | clickUpSynced | @deprecated `[NEW]` | False impression ClickUp works |
| 8 | tasksSpawnedAt | Documented `[NEW]` | Users stuck with no respawn |
| 9 | Empty state copy | Relabelled `[NEW]` | Users hit required-field wall |
| 10 | Backfill routes | Admin-guarded `[NEW]` | Any user triggers mass backfill |
| 11 | Dual-write flag | Documented | Legacy indefinitely persists |
| 12 | Visibility config | Documented | Partial but not misleading |
| 13 | siteId column | Documented | None — correct future-use |

---

End of register.
