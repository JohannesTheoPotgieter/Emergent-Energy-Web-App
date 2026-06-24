# Engineering function — legacy removal & spine rebuild plan

**Date:** 2026-06-22 · **Owner-approved scope (2026-06-22):** rebuild the Engineering function (delivery scope) **greenfield on the canonical spine**, **retire the legacy *engineering* surfaces at cutover**, and **leave the cross-domain adapter and all finance code untouched.**

Companion to `PHASE0_FINDINGS.md` (research) and the Live-Ready nav change already shipped (Engineering enabled, ring-fenced to its Home page, placed between Execution and Finance).

---

## 1. Principle

The app's spine is the project (`project_info`). Engineering work is `work_items`. The new Engineering function writes the spine **directly through the repository layer** — it does **not** bolt onto retired plumbing. As each new surface goes live behind the Live-Ready ring fence, the matching legacy surface is retired so nothing is ever served twice.

## 2. The correct foundation & spine (build ON these)

- `project_info` → `work_items` (direct Drizzle writes via `server/repositories/`) → `work_item_assignments` (OWNER/ASSIGNEE/REVIEWER/VIEWER) → `work_item_status_history`
- `approvals` engine · `deliverables` · `audit_events` · `notifications`
- Documents: `managed_documents` + `folder_taxonomy` + `project_folders` + `project_document_links` (already on the spine; deprecated `controlled_documents`/`project_sharepoint_roots` were dropped in migration `0086`)
- Phase: read-only from `shared/phases.ts` (`phaseLabel`, `PHASE_BY_CODE`); current phase read from `project_execution_state.phase`/`.currentStageCode`
- Conventions: `server/routes/engineering-*.routes.ts` (dot pattern) registered in `server/routes/index.ts`; Zod `validateBody`; `ApiError`; `requireRole`/`requirePermission`; `permissionEntity: "engineering" | "eng_tasks"`

## 3. Legacy inventory & disposition

| Legacy surface | Disposition | Cutover note |
|---|---|---|
| `server/engineering-routes.ts` (`/api/eng/*`, hyphen-convention, 4,170 lines) | **Replace** with `server/routes/engineering-*.routes.ts` on the repository layer | Registered in `server/routes/register-core-routes.ts:8`; tracked in `server/platform/route-ownership.ts`; client calls `/api/eng/*`. Migrate endpoint-by-endpoint, repoint the client, then delete. **Note:** if it also hosts shared `/api/deliverables`, split those out before deleting. |
| `client/src/pages/engineering-dashboard.tsx` (old dashboard) | **Replace** with `EngineeringHomePage` on the spine | Swap `/engineering` `routeComponentKey`, then delete the file. |
| `client/src/pages/engineering/standup/*` + `standup_system` flag | **Remove** from engineering nav (already out of the ring fence) | Already unreachable under the ring fence; delete files + nav refs in Phase 4. |
| `client/src/components/tabs/DrawingRegisterTab.tsx` (+ any transmittal usage) | **Remove** from the engineering context | Underlying `drawings` table left intact/unrouted unless owner says delete. |
| `engineering-audit.tsx` (`/engineering/audit`, hidden, SYSTEM) | **Keep** (hidden) | Audit log; not part of delivery UI. |
| `eng-stage-routes.ts` + `seed-eng-templates.ts` (FA/CP stage templates) | **Switch off** FA + Cost Proposal templates; keep IFC Planning / Construction Support / Handover Pack | Phase 4. `eng-stage-routes.ts` imports the adapter — migrate its reads to repositories only if needed for delivery; otherwise leave untouched. |

### Explicitly OUT of scope (do not touch)
- `server/work-items-adapter.ts` — imported by **22 files** incl. **frozen finance** (`departments/finance-routes.ts`), PD, PM, quality, lifecycle, portfolio. The new engineering code simply **does not use it**; migrating the other domains off it is a separate owner-level effort.
- All finance computation paths (§ 3/§ 3B FREEZE).
- Other domains' legacy code.

## 4. Cutover order (so nothing is ever broken or double-served)

For every surface: **(1)** build the new spine-based backend + page behind the ring fence → **(2)** point the route/registry at the new surface → **(3)** verify (`check` + tests + build) → **(4)** delete the legacy file → **(5)** when all consumers of a legacy `/api/eng/*` endpoint are gone, remove it from `engineering-routes.ts` and `route-ownership.ts`. Add each newly-live page id to `ENABLED_ENGINEERING_PAGE_IDS` as it lands.

## 5. Phase-by-phase (file-level)

**Phase 1 — Home (spine).**
- `server/repositories/engineering-home-repository.ts` (new): reads on `work_items` + `project_info` + `project_execution_state` — metrics (active projects · open tasks · due this week · overdue), needs-you (seam handoffs + sign-offs), portfolio "where are we" (read-only phase chip), my-work-today. No snapshot tables involved.
- `server/routes/engineering-home.routes.ts` (new): GET endpoints; register in `server/routes/index.ts`; RBAC `engineering:view`; `ApiError`.
- `client/src/pages/engineering/EngineeringHomePage.tsx` (new) + hook; reuse `PageShell`, `SectionHeader`, metric cards, `PHASE_COLORS`, status helpers.
- Swap `/engineering` `routeComponentKey` → `EngineeringHomePage` (`page-registry.ts` + `route-components.ts`); delete `engineering-dashboard.tsx`.
- Tests: home aggregation shape; phase read-only; needs-you. 

**Phase 2 — Task Manager (spine).**
- Schema (additive + migration): `shared/engineering/delivery-task-catalog.ts` (constant + Zod); `work_item_document_links` table.
- `server/repositories/engineering-tasks-repository.ts` (new): list/create/bulk-create/status-transition + doc-link CRUD + seam create — direct `work_items` writes (no adapter), writes `work_item_status_history` + `audit_events`, emits `notifications`.
- `server/routes/engineering-tasks.routes.ts` (new): replaces `/api/eng/tasks*`; Done-gate enforced at the single chokepoint (`server/lib/task-workflow-guard.ts` extended with `documentLinkRequired`/`documentLinked`).
- Client Task Manager repointed to the new endpoints; doc-link column + Done-gate banner + seam block; no Standup.
- Tests: catalog validation; Done-gate rejection w/o linked doc; bulk create; seam → tracked item + notification; status-history written.

**Phase 3 — Document Manager (spine).** Reuse managed-documents (already spine); add task↔doc link surfacing both ways. Tests: explorer load; metadata-only; approval transition; readiness rollup; task-link round-trip.

**Phase 4 — Decommission.** Remove Standup + Drawing/Transmittal register from engineering; switch off FA/CP eng templates; once `/api/eng/*` has no consumers, delete the engineering-specific endpoints from `engineering-routes.ts` + update `route-ownership.ts`. Fix dead links; update tests.

**Phase 5 — Hardening & release.** Full gate (`check` → `db:check` → `test` → `test:api` → `build`) + `test:smoke` + `release:gate`; `db:verify-schema`; RBAC matrix; empty/loading/error/permission states; decide engineering role allowlist + role-aware landing; merge.

## 6. Guardrail recap
Finance FREEZE (§ 3/§ 3B) — untouched. Adapter untouched. Documents metadata-only (§ 5A). Additive migrations only, committed (§ 6). New routes registered + RBAC + Zod + `ApiError` + repository-layer. Phase read-only. No `any`/`@ts-ignore`. Tests in `qa/tests/`.
