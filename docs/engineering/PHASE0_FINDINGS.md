# Engineering function (delivery scope) — Phase 0 findings & implementation plan

**Date:** 2026-06-22 · **Author:** Claude Code (Opus) · **Status:** Phase 0 — research only, no production code.
**Mission:** ship the Engineering function (delivery scope) — **Home · Task Manager · Document Manager** — for engineering-discipline work from financial close onward, replacing ClickUp for engineers.

> Read with `CLAUDE.md`, `docs/AGENT_GUARDRAILS.md` (esp. § 3/§ 3B FREEZE, § 5A HARD refusals, § 6 schema/migrations, § 4A Hold-is-a-status).
> Every claim below is cited to `file:line`. Where a line range is approximate it is marked `~`.

---

## 0. Headline conclusions (read this first)

1. **Engineering tasks already are `work_items`** with `workstream='ENG'`. No new task table is needed. The delivery catalog should be a **shared constant + Zod validation on the existing `work_items.taskTypeTag` text column** — not a new pg enum. (`shared/schema/tasks.ts:147`, `:222`)
2. **There is already a single status-transition chokepoint with a Done-gate** — `assertTaskWorkflowTransition()` in `server/lib/task-workflow-guard.ts:95`, called from the engineering routes. The "no Done without a linked document" rule should be **added as one new branch in that one function**, exactly mirroring the existing "no Complete without a deliverable" rule. (`server/lib/task-workflow-guard.ts:117`)
3. **Phase is read-only and already canonical** — `shared/phases.ts` is the single source. A project's current phase lives on `project_execution_state.phase` / `.currentStageCode` (`shared/schema/projects.ts:241`, `:318`). **There is no `projectStageFinancialCloseTracks` table** — financial close is the stage `S03_SIGNATURE_FINANCIAL_CLOSE` (`shared/schema/stage-lifecycle.ts:29`, `shared/phases.ts:55`).
4. **The Document Manager already exists** as a SharePoint-backed, metadata-only surface (`managed_documents` + `folder_taxonomy` + `project_folders` + `project_document_links`) with components, repository, routes, approvals, readiness rollups, and mock connectors. The engineering Document Manager is a **scoped re-use of this**, not a new build. No file bodies are stored anywhere (verified). (`shared/schema/documents.ts:8`, `:128`, `:401`, `:477`, `:175`)
5. **Seam handoffs should reuse `work_items`** (controlled `taskTypeTag`, an `OWNER` assignment, a due date, a `notifications` row, and a `work_item_dependencies` back-link) rather than a new table. Lighter, and aligned with § 4 "reuse canonical workflow tables".
6. **Two design-source files referenced by the prompt are NOT in the repo:** `docs/engineering/ENG_UX_SPEC.md` and `docs/engineering/ENG_WIREFRAMES.html`. This is a blocker for pixel-accurate UI in Phases 1–3 — see § 9 (Open decisions).

---

## 1. Task model — CONFIRMED

Engineering tasks are rows in **`work_items`** (`shared/schema/tasks.ts:147`). The legacy `operational_tasks` table was dropped; its data lives in `work_items` (`:39`).

| Field | Location | Notes |
|---|---|---|
| `workstream` (enum) | `tasks.ts:142`, `:151` | `work_item_workstream` = `PD, ENG, QUALITY, PM, FINANCE, PERSONAL, GOVERNANCE, HANDOVER`. Engineering = **`ENG`** (NOTE: the enum uses `ENG`, while the older `TASK_WORKSTREAMS` constant at `:22` uses `"Engineering"` — the **enum is canonical** for work_items). |
| `taskTypeTag` (text) | `tasks.ts:222` | Free text today — this is where the **delivery catalog** lands. Also mirrored on `work_item_pm.taskTypeTag` (`:315`). |
| `engineeringTicketId` (int) | `tasks.ts:227` | FK to `engineering_tickets` (renamed from `pd_ticket_id`, migration 0025). Indexed (`:280`, `:285`). |
| `linkedDeliverableId` (int) | `tasks.ts:218` | Existing link to `deliverables`. **Not** a managed-document link. |
| `status` (text) | `tasks.ts:156` | Default `not_started`. Canonical set = `TASK_STATUSES` (`tasks.ts:15`). |
| `approvalRequired` (bool) | `tasks.ts:216` | Drives approval-flow gate. |
| `holdReason` / `blockedType` / `blockerReason` | `tasks.ts:214`, `:215`, `:223` | Hold/Blocked metadata (status, not stage — § 4A). |

**Assignments:** `work_item_assignments` with `work_item_assignment_role` enum `OWNER / ASSIGNEE / REVIEWER / VIEWER`, unique on (workItem,user,role) (`tasks.ts:144`, `:375`, `:383`).
**Status history:** `work_item_status_history` exists (`oldStatus,newStatus,changedBy,changedAt,reason`) (`tasks.ts:406`). **Gap:** the engineering update path does **not** currently write to it (see § 4).

**Status mapping — CONFIRMED.** `TASK_STATUSES` = `not_started, to_do, in_progress, hold, projects_assistance, needs_approval, qc_approved, provide_feedback, operational_approval, complete` (`tasks.ts:15`). `normalizeToUniversalStatus()` maps any source string → `todo|in_progress|blocked|review|complete|cancelled` (`shared/task-status.ts:32`). `isTaskComplete()`/`TASK_STATUS_META` define the "complete" semantics (`task-status.ts:147`, `:185`).

---

## 2. Delivery task catalog — PROPOSAL (needs confirm)

`taskTypeTag` is a `text` column shared across workstreams, so a **pg enum migration would be invasive and is unnecessary**. Recommendation: a **shared constant + Zod validation at the route boundary** (matches how `TASK_WORKSTREAMS`, `TASK_PRIORITIES` etc. are modelled — `tasks.ts:22`, `:28`). Additive, reversible, no migration to the column.

Proposed delivery catalog (new `shared/engineering/delivery-task-catalog.ts`):

```ts
export const ENGINEERING_DELIVERY_TASK_TYPE_TAGS = [
  "ifc_pack",              // Issued-for-construction pack
  "as_built",              // As-built drawing/doc set
  "rfi",                   // Request for information
  "substitution",          // Material/equipment substitution
  "commissioning_review",  // Commissioning / witness review
  "eng_snag",              // Engineering snag
  "handover_pack",         // Handover documentation pack
] as const;

// Seam handoff tags (see §6) — kept in the same controlled vocab:
export const ENGINEERING_SEAM_TASK_TYPE_TAGS = [
  "compliance_input",      // → Keith (SSEG/NERSA/PTI/Grid input)
  "construction_snag",     // ↔ Construction Manager
] as const;
```

**Document-output mapping (drives the Done-gate, § 4):** `ifc_pack`, `as_built`, `handover_pack`, `commissioning_review` are document-output tasks (require a linked doc to reach Done); `rfi`, `substitution`, `eng_snag` are tracked-action tasks (no doc requirement by default). Exact mapping to confirm with owner.

**Decision:** shared constant + Zod (recommended) vs pg enum → **recommend shared constant**.

---

## 3. Phase source — CONFIRMED (read-only)

- **Canonical phase list:** `shared/phases.ts:52` (`PHASES`), with helpers `phaseLabel()` (`:219`), `PHASE_BY_CODE` (`:100`), `nextPhase/prevPhase` (`:227`/`:236`), `isHandoverPhase` (`:245`). UI colour map: `client/src/lib/phase-colors.ts` (`PHASE_COLORS`, used by the current dashboard).
- **All stage codes:** `shared/schema/stage-lifecycle.ts:26` (`STAGE_CODES`), with `SEQUENTIAL_STAGE_CODES`/`ACTIVE_STAGE_CODES` (`:84`, `:94`) and deprecated-code resolution (`:64`, `:74`).
- **Financial close representation:** the stage **`S03_SIGNATURE_FINANCIAL_CLOSE`** (`stage-lifecycle.ts:29`; label "Financial Close", `phases.ts:55`). **No `projectStageFinancialCloseTracks` table exists** (grep: literal name appears only in migration meta snapshots, not as a live table). The "close happened" signals also include `project_execution_state.cpSigned` / `signedStatus` / `currentStageCode` (`projects.ts:291`, `:286`, `:318`).
- **Where a project's current phase is read:** `project_execution_state.phase` and `.currentStageCode` (`projects.ts:241`, `:318`); `project_info.projectStatus` for Hold/Closed (`projects.ts:221`). The engineering repository already merges these via `findProjectWithExecutionState()` / `mergeProjectRow()` (`server/repositories/engineering-repository.ts`).

**Post-financial-close (delivery) stages** the engineering surfaces operate on:

| In delivery scope (display read-only) | Out of scope (pre-close) |
|---|---|
| `S03_SIGNATURE_FINANCIAL_CLOSE` (boundary) | `S01_FIRST_ASSESSMENT` |
| `S04_PLANNING` | `S02_DESIGN_COST_PROPOSAL` |
| `S06_CONSTRUCTION` | |
| `S07_COMMISSIONING` | |
| `S08_OM_HANDOVER`, `S09_CLIENT_HANDOVER`, `S10_POST_HANDOVER_REVIEW`, `S9B_COMPLIANCE_HANDOVER` | |

Engineering **never writes** phase. It renders `phaseLabel(code)` as a read-only chip. (Guardrail: Six Rule #4; § 4A — phase changes are owner-authorised elsewhere.)

> **Distinction to hold:** the *project lifecycle phase* (`shared/phases.ts`) is read-only and separate from **engineering's own stage-template framework** (`eng_stage_templates` — First Assessment / Cost Proposal / IFC Planning / Construction Support / Handover Pack, seeded by `server/seed-eng-templates.ts`). Phase 4 switches off the two pre-close *engineering templates*, not the lifecycle stages.

---

## 4. Document↔task link & the Done-gate — CONFIRMED chokepoint + proposed link

**Single chokepoint (already exists):** `assertTaskWorkflowTransition(context, requestedStatus, source)` — `server/lib/task-workflow-guard.ts:95`. Today it enforces:
- "Complete blocked until deliverable sent" when `deliverableRequired` (`:117`).
- approval-flow ordering (`:121`, `:128`).

Context is built by `buildTaskWorkflowContext()` (`:33`) and `buildTaskWorkflowContextsForIds()` (bulk, `:64`). The guard is invoked from `server/engineering-routes.ts` (status update, bulk update, send-for-approval, send-deliverable) — confirmed by grep. This is the **one place** to extend.

**Plan for the Done-gate:** extend `TaskWorkflowContext` with `documentLinkRequired` + `documentLinked`, populate them in `buildTaskWorkflowContext*`, and add a single branch: if `documentLinkRequired && movingToComplete && !documentLinked` → throw `TaskWorkflowGuardError`. `documentLinkRequired` derives from the catalog mapping in § 2 (document-output tags). This keeps the gate at exactly one chokepoint and is unit-testable in `qa/tests/`.

**Document↔task link shape (proposal).** Today the only task→doc link is `work_items.linkedDeliverableId` → `deliverables` (legacy, `tasks.ts:218`) — that is **not** a SharePoint managed document. The Document Manager's own surface is `managed_documents` / `project_document_links` (`documents.ts:128`, `:175`); there is **no** `work_item`↔`managed_documents` join yet.

Recommendation — a thin additive join table (supports many-to-many: a task can output several docs; a doc can satisfy several tasks):

```ts
// shared/schema/tasks.ts (or a new shared/schema/engineering-links.ts)
work_item_document_links {
  id, workItemId → work_items.id (cascade),
  managedDocumentId → managed_documents.id (set null),
  projectDocumentLinkId → project_document_links.id (set null),  // either/both
  linkRole text default 'output',   // 'output' | 'evidence' | 'reference'
  createdByUserId, createdAt
  // unique(workItemId, managedDocumentId)
}
```

Rationale vs. adding a column to `work_items`: avoids touching the wide core table, models the real many-to-many, and is trivially reversible. The Done-gate's `documentLinked` = "≥1 row in `work_item_document_links` for this task". Surfaced both ways (task drawer ↔ document drawer).

---

## 5. Document Manager surface — CONFIRMED (re-use, metadata-only)

**Schema (all metadata + Graph refs only — no bodies; verified `documents.ts:8`):**
- `managed_documents` (`documents.ts:128`): `driveId`/`driveItemId` (`:144`/`:145`), `name`/`path` (`:146`/`:148`), `parentFolderId`→`project_folders` (`:143`), `state` enum draft/in_review/approved/superseded/archived (`:153`), unique on (driveId,driveItemId) (`:159`).
- `folder_taxonomy` (`documents.ts:401`): `internalKey`/`displayName` (`:404`/`:406`), `parentKey` self-FK (`:413`), `lifecycleMode` (`:415`), `stageCode`→`stage_definitions` (`:421`), `disciplines[]` validated against `LIFECYCLE_DEPARTMENTS` (`:429`, `:443`).
- `project_folders` (`documents.ts:477`): `taxonomyKey` (`:480`), `driveId`/`itemId`/`webUrl` (`:482`/`:483`/`:490`), provisioning audit (`:492`).
- `project_document_links` (`documents.ts:175`): `domain` enum engineering/quality (`:179`), `documentType`/`discipline`/`revision`, `status`/`reviewStatus` enums (`:183`/`:184`), SharePoint refs (`:198`–`:201`), `syncConfidence` enum high/medium/low/stale/broken (`:204`), `dueDate`/owners/approvals (`:188`–`:195`).
- `document_revisions` (`:227`, SharePoint version id `:233`), `document_locks` (checkout mirror, `:256`), `document_comments` (`:273`), `document_activity` (audit, `:309`), `document_approval_requirements` (admin rules, `:520`).
- **No body/bytes column anywhere** — confirmed. § 5A HARD rule respected.

**Folder taxonomy seed:** `server/seed-folder-taxonomy.ts` — full-lifecycle tree includes `01_financial_close`, `02_project_management`, **`03_engineering`**, `07_construction`, `09_commissioning`, `10_handover`, etc.; pre-construction tree includes `pre_first_assessment`, `pre_cost_proposal`. `03_Engineering` discipline = `ENGINEERING`.

**Components (client/src/components/documents/):** `DocumentDetailDrawer`, `ManagedDocumentApprovalQueue`, `RootSelector`, `FolderFiles`, `FileListTable`, `ProjectReadinessCard`, `PortfolioReadinessTile`, `DisciplinePanel`, `ProjectSharepointConnectionCard`, `SharePointErrorAlert`, orchestrated by `ProjectDocumentsView`. Existing pages: `pages/documents.tsx`, `pages/project-documents.tsx`, `pages/admin-document-management.tsx`, and `pages/engineering/documents` (current `/engineering/documents` route).

**Repository/routes/services:** `server/repositories/managed-documents-repository.ts`; routes `document-management.routes.ts`, `managed-document-approvals.routes.ts`, `document-readiness.routes.ts`, `document-management-admin.routes.ts`; services `managed-document-approvals-service.ts`, `document-readiness-service.ts`, `sharepoint-document-service.ts`. Approvals reuse the canonical `approvals` engine with `approvalType='managed_document'` (`documents.ts:371`). Mock connectors: `server/mocks/ms-graph-fixtures.ts` (project + company trees) — lets a fresh clone browse without tenant tokens.

---

## 6. Seam handoffs — PROPOSAL (lighter option, reuse work_items)

A seam handoff = "a tracked item with owner + due + notification". Two seams: **compliance-input → Keith (SSEG)** and **snag-triage ↔ Construction Manager**.

**Recommended (lighter) shape — reuse canonical tables, no new entity:**
- A `work_items` row, `workstream='ENG'`, `taskTypeTag` ∈ `compliance_input | construction_snag` (§ 2).
- `work_item_assignments` `OWNER` = the seam recipient (Keith / CM).
- `endDate`/`dueDate` set on creation.
- A `notifications` row to the owner via the existing `createNotification()` emitter (`server/engineering-routes.ts:292`; table `shared/schema/collaboration.ts:30`, with 5-min throttle).
- `work_item_status_history` row written on creation/transition (close the existing gap).
- **Back-link to the originating task** via `work_item_dependencies` (predecessor=origin task, successor=seam item, `source='MANUAL'`) — `tasks.ts:389`. No new column on `work_items`.

This satisfies "tracked item with owner + due + notification + audit" using only canonical tables (§ 4). A dedicated `eng_seam_handoffs` table is the heavier alternative and is **not** recommended.

---

## 7. Rename & nav — exact edits (CONFIRMED entries)

**`client/src/config/page-registry.ts`** (current engineering entries, NavGroup `ENGINEERING`):

| id | path | label (now) | iconKey | permissionEntity | component key |
|---|---|---|---|---|---|
| `engineering` | `/engineering` | "Engineering" | `Wrench` | `engineering` | `EngineeringDashboardPage` |
| `engineeringTasks` | `/engineering/tasks` | "Engineering Task Board" | `ListTodo` | `eng_tasks` | `EngineeringTasksPage` |
| `engineeringDocuments` | `/engineering/documents` | "Engineering Document Management" | `FolderTree` | `engineering` | `EngineeringDocumentsPage` |
| `engineeringStandup` | `/engineering/standup` | "Engineering Standup" | `Users` | `standups` | `EngineeringStandupPage` |
| `engineeringAudit` | `/engineering/audit` | "Engineering Audit Log" | `Activity` | `admin` | `EngineeringAuditPage` (hidden) |
| alias `/standups` → `/engineering/standup` | | | | | |

Planned edits:
1. **Rename** `engineering` → label **"Home"**, `iconKey: "Home"`. Keep `path: "/engineering"` stable (no redirect needed). (Phase 1)
2. **Keep** `engineeringTasks` (relabel "Task Manager") and `engineeringDocuments` (relabel "Document Manager"). (Phases 2/3)
3. **Remove** `engineeringStandup` entry **and** the `/standups` alias. (Phase 4)
4. **Leave** `engineeringAudit` (hidden) untouched.
5. `client/src/config/route-components.ts`: no structural change for the rename (component keys stay). When the Home page is rebuilt it remains `EngineeringDashboardPage` (or a new `EngineeringHomePage` key — confirm during Phase 1). New routes (if any sub-pages need their own path) registered here + in `page-registry.ts`.

**Standup files to retire (Phase 4):** `client/src/pages/engineering/standup/*`; flag `standup_system` (`shared/feature-flags.ts:33`, default **true**) → consider flipping false or removing the nav entry. **Drawing Register** is a *project tab* (`client/src/components/tabs/DrawingRegisterTab.tsx`), not in engineering nav — Phase 4 removes it from the engineering project context only; underlying `drawings` table left intact/unrouted. **No Transmittal Register component exists** (nothing to remove).

---

## 8. Backend routes & RBAC — CONFIRMED

- **Legacy domain file:** `server/engineering-routes.ts` (~4,170 lines) hosts `/api/eng/tasks*`, `/api/deliverables*`, gated by `requirePermission("eng_tasks"|"deliverables", action)` + per-row `requireEngTaskOwnership` (for `scope:'own'` roles like ENGINEER). Bodies validated by Zod (`engTaskCreateSchema` etc.); field denylist via `stripServerFields()`. Per § 4/route-conventions, **extend this existing file** for engineering-task work (it's the existing domain), or add a new `server/routes/engineering-tasks.routes.ts` if a clean split is preferred — decide in Phase 2.
- **New-route pattern:** `export function registerXRoutes(app)` → import + call in `server/routes/index.ts`. Repository-layer DB access only (`server/repositories/engineering-repository.ts`, `managed-documents-repository.ts`).
- **Status write path:** `updateEngineeringWorkItem()` in `server/work-items-adapter.ts` is the DB write; the workflow **guard** (`task-workflow-guard.ts`) is the policy chokepoint invoked before it. (Note: `work-items-adapter.ts` is flagged "retired/read-only" in § 8.2 of guardrails for the *adapter/backfill* pattern — confirm in Phase 2 whether the status write should move into a repository function. **Number-of-DB-writes-preserving** refactor only.)
- **Permission entities (canonical `shared/permissions/registry.ts`):** `engineering`, `eng_tasks`, `eng_stages`, `engineering_documents` exist; `PermissionEntity` union in `shared/schema/users.ts:283` lists all. RBAC roles from `COMPANY_ROLES` (`users.ts:101`, 16 roles). Engineering view/edit roles derived via `ENG_VIEW_ROLES`/`ENG_EDIT_ROLES` (`users.ts:175`, `:178`). Default section access: ENGINEER/ENGINEERING_MANAGER/SSEG_MANAGER see `ENGINEERING` (`users.ts:571`–`:572`, `:590`, `:619`, `:623`); PM/COO read per `DEFAULT_ROLE_PERMISSIONS`.

---

## 9. Decisions — LOCKED 2026-06-22 (owner)

1. **Design sources — build from textual spec.** `ENG_UX_SPEC.md` / `ENG_WIREFRAMES.html` are absent; owner authorised building Phases 1–3 from this prompt's textual spec + the existing shadcn/emerald component patterns. Global DoD "UI matches wireframes" is read as "matches the textual spec + house components". ✅ RESOLVED
2. **Rollout flag — YES.** Add `engineering_delivery_v2` to `shared/feature-flags.ts` (`FEATURE_FLAG_KEYS` + `ROLLOUT_FEATURE_FLAGS`, default **false**); gate the restructured nav/IA behind it; flip on in Phase 5. ✅ RESOLVED
3. **Task catalog — accepted as proposed (§ 2).** Delivery: `ifc_pack, as_built, rfi, substitution, commissioning_review, eng_snag, handover_pack`. Seam: `compliance_input, construction_snag`. Document-output tags (require a linked doc to reach Done): `ifc_pack, as_built, handover_pack, commissioning_review`. ✅ RESOLVED
4. **Branch — `claude/elegant-ride-q0zskl` (single branch, all phases).** Not per-phase branches. ✅ RESOLVED
5. **Status-history gap** — engineering status changes don't write `work_item_status_history` today. Closing this is **in scope** for the Phase 2 Done-gate/seam work (Phase 2 tests assert "status-history written"). ✅ IN SCOPE

---

## 10. File-level implementation plan (Phases 1–4)

### Phase 1 — Home (rename + scope) · branch per § 9.4
- **Edit** `client/src/config/page-registry.ts` — rename `engineering` → label "Home", `iconKey:"Home"`; (relabel tasks/docs).
- **Edit/Rebuild** `client/src/pages/engineering-dashboard.tsx` (current `EngineeringDashboardPage`) → Home: Overview metric cards (Active projects · Open tasks · Due this week · Overdue), **Needs-you strip** (open seam handoffs + sign-offs), **Portfolio "where are we"** table (read-only phase chip via `phaseLabel`), **My work today**; sub-pages My work, Exceptions & alerts; **Project snapshot** drill. Reuse `PageShell`, `SectionHeader`, metric cards, `PHASE_COLORS`, status helpers (`shared/task-status.ts`).
- **Backend:** read-only aggregation endpoints (reuse `/api/platform/*` where possible; add `server/routes/engineering-home.routes.ts` only if needed). Repository-layer reads via `engineering-repository.ts`.
- **Tests (`qa/tests/`):** dashboard data shape; phase rendered read-only; needs-you aggregation.

### Phase 2 — Task Manager (catalog + Done-gate + seams)
- **Schema (additive + migration):** new `shared/engineering/delivery-task-catalog.ts` (constant + Zod); new `work_item_document_links` table in `shared/schema/*.ts`; `npm run db:generate -- --name=work_item_document_links`. Commit `migrations/*.sql` + `meta`.
- **Backend:** extend `server/engineering-routes.ts` (or new `engineering-tasks.routes.ts`): create/bulk-create with catalog Zod validation; status-transition path; **extend `server/lib/task-workflow-guard.ts`** with `documentLinkRequired`/`documentLinked` Done-gate branch; seam-handoff create (work_items + OWNER assignment + due + `createNotification` + dependency back-link + status-history). New repository functions for document-link CRUD + seam create.
- **Frontend:** `client/src/pages/EngineeringTasksPage.tsx` + `engineering/*` (table/kanban, filters via `useEngineeringTaskFilters`, workload strip, bulk actions): add **doc-link column**; sub-pages My queue / By project / Calendar; **drawer** gets linked-document card + Done-gate banner (Mark done disabled until a doc is linked) + Seam handoff block; create/bulk-create dialogs (no FA/CP). **Remove Standup** usage from Task Manager.
- **Tests:** catalog validation; **Done-gate rejection without linked document**; bulk create; seam creates tracked item + notification; status-history written.

### Phase 3 — Document Manager (on SharePoint)
- **Frontend:** `/engineering/documents` Explorer (`RootSelector` → `folder_taxonomy` tree → `FileListTable`) with columns name · SharePoint version · workflow state · checkout · sync confidence; `DocumentDetailDrawer` (Open/edit in SharePoint; Detail/Versions/Comments/Approvals/Activity); sub-pages Approval queue (`ManagedDocumentApprovalQueue`), Readiness (`ProjectReadinessCard`/`PortfolioReadinessTile`), By discipline (`DisciplinePanel` 03_Engineering), SharePoint health (`ProjectSharepointConnectionCard`/`SharePointErrorAlert`). Surface the task↔doc link both ways (powers the Done-gate).
- **Backend:** reuse existing managed-document routes/services; add only the task-link surfacing endpoints (reads/writes `work_item_document_links`). Metadata + Graph refs only.
- **Tests:** explorer load; **metadata-only assertion (no bytes persisted)**; approval transition; readiness rollup; task-link round-trip.

### Phase 4 — Decommission out-of-scope
- **Switch off** First Assessment + Cost Proposal **engineering** stage templates (`server/seed-eng-templates.ts` / templates admin) — keep IFC Planning / Construction Support / Handover Pack active.
- **Remove** Standup route/page + `/standups` alias from engineering nav (`page-registry.ts`); retire `pages/engineering/standup/*`; consider `standup_system` flag.
- **Remove** Drawing Register (+ any transmittal usage) from the engineering project context (`DrawingRegisterTab` usage) — tables left intact/unrouted unless owner says delete.
- Fix dead links; update tests referencing removed surfaces.

### Phase 5 — Hardening & release
- Full gate (`check` → `db:check` → `test` → `test:api` → `build`), then `test:smoke` + `release:gate`; `db:verify-schema` green; RBAC matrix check; empty/loading/error/permission states on every screen; flip `engineering_delivery_v2` if gated; update `docs/engineering/` + `replit.md`/`CLAUDE.md` pointers if IA changed.

---

## 11. Guardrail compliance check for this plan

- **Finance FREEZE (§ 3/§ 3B):** no finance path, schema, route, formula touched. ✅
- **Schema→migration (§ 6):** only additive changes (`work_item_document_links`; shared constant); committed migration; no barrel edits; no `db:push`-only. ✅
- **Documents (§ 5A HARD):** metadata + Graph refs only; reuse `managed_documents`/`folder_taxonomy`/`project_folders`/`project_document_links`; never store bodies; do not extend deprecated `controlled_documents`/`project_sharepoint_roots`. ✅
- **Routes (§ 4 / route-conventions):** new routes in `server/routes/*.routes.ts`, registered in `index.ts`; repository-layer DB access; `ApiError`; Zod `validateBody`. ✅
- **RBAC (§ 5):** `COMPANY_ROLES` from `users.ts`; `requireRole`/`requirePermission`; entities `engineering`/`eng_tasks`. ✅
- **Hold/Blocked (§ 4A):** status + required reason via `HoldReasonDialog`; no new branch stage codes. ✅
- **Phase read-only (Six Rule #4):** engineering never writes phase. ✅
- **TypeScript (§ 8):** no `any`/`@ts-ignore`; tests in `qa/tests/`. ✅
