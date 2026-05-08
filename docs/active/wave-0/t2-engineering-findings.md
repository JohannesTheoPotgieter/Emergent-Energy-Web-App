# T2 Engineering Trust Audit — findings

**Date:** 2026-05-08
**Scope:** Read-only audit per IMPLEMENTATION_PLAN_V3 § 3.x.
**Inputs read:** ~24 files (cap 35). Anchored against `docs/AGENT_GUARDRAILS.md`
§ 2A (Six Rules), § 3.7 (planned-vs-actual), § 4 (architectural spine), § 5
(security), § 9 (Smart Import known-bug-prevention) and the engineering
sections of `docs/operating-model/playbook-v2.0.md` (§ 4.1 deliverables,
Stage 4 Planning).
**Posture:** Document only. No code changes, no migrations.

> Defect triage column on every finding row:
> `fix-now` = engineering data integrity / runtime crash today,
> `fix-soon` = surface degraded but flow survives,
> `defer` = cosmetic / doc-only / coverage gap / future build.

---

## T2.1 — Engineering tickets data quality

Anchor: `engineering_tickets` (renamed from `pd_tickets` in migrations
0024 + 0025 + 0026, see `shared/schema/projects.ts:684-769`). The
playbook calls these "engineering tickets" carrying a request from PD
to Engineering during Stage 2 Cost Proposal & Design.

| Check | Result | File:line | Verdict | Triage |
|---|---|---|---|---|
| FK to `project_info.id` (Six Rule #1) | Present but **nullable** — `projectId: integer("project_id").references(() => projectInfo.id)` (no `.notNull()`). Compensated by an alternative `opportunityId` FK and the unique index gates on `projectId IS NOT NULL`. So a ticket can exist tied to an `opportunity` and zero `project_info`. | `shared/schema/projects.ts:693, 701, 763-765` | Soft per Six Rule #1 — opportunity-only tickets pre-date the project record by design (PD intake → first deal in pipeline). Document the carve-out. | defer |
| Status enum aligns with engineers' vocab | Canonical set is `TASK_STATUSES` re-exported as `ENGINEERING_TICKET_STATUSES` (`shared/engineering-ticket-status.ts:4`); column is plain `text` with default `'to_do'`, NOT a `pgEnum`. Legacy values (`Draft`, `In Progress`, `On Hold`, `Cancelled`) are folded to canonical via `normalizeEngineeringTicketStatus` and `LEGACY_TO_CANONICAL` (`shared/engineering-ticket-status.ts:17-47`). SQL synonym lists at lines 95-111 keep raw queries resilient. | `shared/schema/projects.ts:706-710`, `shared/engineering-ticket-status.ts:1-114` | PASS — text column + normalizer is defensible (cheaper than a hard enum migration); the canonical predicate is single-sourced. | — |
| Audit row per state transition | The legacy ticket-update endpoints (`server/pd-routes.ts`, `server/engineering-routes.ts`, `server/departments/opportunities-routes.ts`) use the **legacy `logAuditFromReq`** helper from `server/audit-logger.ts`. The Plan v3 § 2.3 `recordAudit` wave landed in 8 services — only `stage-lifecycle-service`, `quickbooks-cascade-proposals-service`, `pending-approvals-service`, `stage-exception-service`, `om-handover-service` are wired up. **No engineering ticket service uses `recordAudit`.** Engineering deliverable / drawing / stage state transitions log via `logAuditFromReq` (route-side), which is functional but is NOT the canonical Plan v3 § 2.3 entrypoint. | `server/services/*` (no engineering files in `recordAudit` consumers list); `server/eng-stage-routes.ts:34, 207, 231, 1010, 1182, 1266, 1274, 1311` (uses `logAuditFromReq`); `server/engineering-routes.ts:29, 477, 518, 907, 914, 932, 939, 947` | PARTIAL FAIL — Engineering is on the legacy audit path; the Plan v3 wave skipped engineering services. **This is the gap.** | fix-soon |
| Soft-delete pattern | `engineeringTickets.deletedAt` present and consistently filtered (`server/pd-routes.ts:376, 435; server/engineering-routes.ts:159, 221, 229`). However the engineering stage-template subsystem has a real bug (next row). | `shared/schema/projects.ts:755`; `server/pd-routes.ts:376` | PASS for tickets. | — |
| **Soft-delete schema-vs-code drift on stage templates** | `server/eng-stage-routes.ts:266` writes `engTaskTemplates.deletedAt = new Date()` and `deletedBy = req.user?.id`; line 326 does the same on `engDeliverableTemplates`. Neither column exists on these tables. Schema definitions at `shared/schema/engineering.ts:144-155` and `shared/schema/engineering.ts:157-168` declare only `id, stageTemplateId, title/name, description, isRequired, sequence/requiredCount, defaultOwnerRole/allowedFileTypes`. Migration `0000_baseline_20260419.sql:2022-2030, 2052-2060` confirms no `deleted_at` / `deleted_by` columns. **DELETE handler will throw at runtime** — the route is not exercised in QA today and the bug has shipped. | `server/eng-stage-routes.ts:266, 326`; `shared/schema/engineering.ts:144-168`; `migrations/0000_baseline_20260419.sql:2022-2060` | **FAIL — runtime crash on COO-only delete** | fix-now |
| `phaseAtTicketCreation` snapshot (history-by-phase rule, § 4B intent) | Not present on `engineering_tickets`. § 4B applies to comms; the playbook's "always keep history under its phase" rule is broader. | `shared/schema/projects.ts:689-755` | Defer (out of strict § 4B scope; flag for future stage-history surfacing). | defer |

**Verdict:** Engineering tickets are well-anchored; the canonical-status
helper is good. Audit-trail wiring is on the **legacy `logAuditFromReq`
path, not Plan v3 `recordAudit`** — that is the named coverage gap.
Plus a real shipped bug on the stage-template DELETE handlers.

---

## T2.2 — Engineering deliverable lifecycle

The playbook (`docs/operating-model/playbook-v2.0.md:441-463`) names
11 Planning-stage deliverables with Owner / Reviewer / Approval rows.
The audit checked: canonical surface, approval path, SharePoint linkage.

The codebase carries **three distinct deliverable surfaces**:

1. `deliverables` (legacy / programme-wide) — `shared/schema/engineering.ts:19-46`. Has Graph-shape SharePoint refs (`sharepointFolderSiteId`, `sharepointFolderDriveId`, `sharepointFolderItemId`). FK to `projectInfo.id` ✓.
2. `project_eng_deliverables` (eng-stage runtime) — `shared/schema/engineering.ts:241-268`. Carries the controlled-document lifecycle (`releasedFor` enum: `draft → under_review → approved_for_review → issued_for_construction → as_built | superseded`). Storage is `storageRef: text("storage_ref").notNull()` plus `sharepointFolderPath: text` — **path-based, NOT Graph-ref**.
3. `drawing_register` — `shared/schema/engineering.ts:316-342`. Carries `sharepointLink: text` (URL string), no Graph IDs.

| Playbook deliverable | Canonical surface today | Approval path | SharePoint linkage | Triage |
|---|---|---|---|---|
| Single Line Diagram (SLD) | `drawing_register` (discipline `electrical`) and/or `project_eng_deliverables` | Drawing-register: `for_review → for_approval → approved → ifc → as_built` (`shared/schema/engineering.ts:306-314`); IFC/as-built role-gated to engineers/COO/CONSTRUCTION_MANAGER (`server/departments/drawing-register-routes.ts:125-130`). PrEng / Senior Eng / Head of Eng distinctions from playbook are **NOT modelled in `COMPANY_ROLES`** (`shared/schema/users.ts:101-119` — 16 roles, only `ENGINEER` and `ENGINEERING_MANAGER`). | URL string only (`sharepoint_link`). No Graph ref. | fix-soon (linkage); defer (role distinction is policy/UI-driven for now) |
| Array layout drawing | Same as SLD | Same | Same | fix-soon (linkage) |
| DC / AC cable sizing calcs | `project_eng_deliverables` (eng-stage flow) | `releasedFor` lifecycle + `eng_approval_status` enum (`pending|approved|rejected`) (`shared/schema/engineering.ts:114, 270-285`). IFC issue gated by `requirePermission("deliverables","approve")` + `isEngineer || isCoo` + self-issue block (`server/eng-stage-routes.ts:771-807`). Distinct PrEng signoff field — absent. | `storage_ref` (string) + `sharepoint_folder_path` (string). No `driveId/driveItemId`. | fix-soon (linkage), fix-soon (PrEng signoff not modelled) |
| Earthing & lightning protection | `project_eng_deliverables` | Same | Same | fix-soon |
| Protection coordination study | `project_eng_deliverables` | Same | Same | fix-soon |
| Generation yield report | `project_eng_deliverables` | Per playbook, "Head of Eng" approves; today only `ENGINEERING_MANAGER` exists. Same gate as above. | Same | fix-soon |
| Structural sign-off (PrEng) | Drawing register or `project_eng_deliverables` | "Structural PrEng" role does not exist in `COMPANY_ROLES`. The signoff is captured only as `approverUserId` text-coupled to ENGINEER/ENGINEERING_MANAGER. | Same | fix-soon |
| Grid Impact Study (GIS) | No dedicated surface; would land in `project_eng_deliverables` | External-utility approval path is not modelled. | URL or path string. | defer (regulatory, future) |
| BESS controls / functional spec | `project_eng_deliverables` | Same generic eng path | Same | fix-soon |
| Construction programme | `project_info` programme + `work_items` (workstream `PM`) | Approval not modelled here — programme is signed off via Smart Import + handover. | n/a (programme is data, not document) | defer |
| HSE file | `hse.ts` corrective actions / `managed_documents` (?) | Out of engineering scope; sits in HSE workstream. | Verified separately. | defer (HSE pillar) |

**Cross-cutting issues:**

- **Three parallel deliverable tables.** `deliverables` (Graph-ref shape, `siteId/driveId/itemId`), `project_eng_deliverables` (path string + `storage_ref`), `drawing_register` (URL string). The Graph-ref pattern in `deliverables` is the only one consistent with § 4B / Six Rule #2 (SharePoint as truth, app holds Graph ref). The eng-stage runtime table at `project_eng_deliverables` is the most actively written and uses the **weakest** linkage shape. (`shared/schema/engineering.ts:62-77` shows `deliverable_files` has `siteId/driveId/fileItemId` properly — but that's the legacy file table.) `fix-soon`.
- **`releasedFor` ≠ `approvalStatus`** is a deliberate, well-documented distinction (`shared/schema/engineering.ts:208-239`). Approval alone never implies IFC; a separate role-gated action is required. PASS.
- **No PrEng / Senior Eng / Head of Eng** role rows. Playbook distinguishes these three clearly (§ 4.1 columns "Reviewer" and "Approval"). The app collapses them to `ENGINEER` + `ENGINEERING_MANAGER` + `COO_ADMIN`. This is a soft modelling gap — workflow can record the right person, but RBAC cannot enforce "only PrEng can sign Structural" today. `fix-soon` (or defer if owner is comfortable with role-as-policy).
- **No `audit_events` row on `releasedFor` transitions via `recordAudit`.** Today `logAuditFromReq` writes audit on IFC / as-built / approve / reject (`server/eng-stage-routes.ts:815-827, 872-887, 1010, 1182, 1266`). Functional; on the legacy path. Same coverage gap as T2.1.

**Verdict:** Approval path exists and is reasonable; SharePoint linkage
is **inconsistent across three tables** and the most-active eng-stage
table uses path strings instead of Graph refs. Role-as-policy is the
current model; the playbook's PrEng/Senior Eng/Head of Eng granularity
is not in `COMPANY_ROLES`.

---

## T2.3 — Eng-stage workflow refusals (cross-ref)

Grepped `server/eng-stage-routes.ts` for `throw new ApiError`, `res.status(400)`, `res.status(403)`, `res.status(409)` — 32 hits (line 74 fall-through + 31 inside handlers).

| Line | Refusal | Class | Notes |
|---|---|---|---|
| 74 | `requireEngineerOrAdmin` 403 fall-through | HARD-ish (RBAC) | Stays |
| 202, 218, 242, 264, 279, 302, 324, 1239 | `if (!isCoo) 403 "COO access required"` on stage-template create/update/delete and stage override | HARD (security) | Stays. Override on stage gate is COO-only by design — § 5 RBAC. |
| 221, 282 | 400 "Title/Name required" | SOFT validation | Refactor to Zod `validateBody` for consistency; not a refusal-softening target. |
| 365, 372, 379 | 409 "Engineering stages already generated" / "All stages already generated" idempotency guard | **SOFT (workflow)** | Refusal-softening candidate per Plan v3 § D.6. Current code blocks regeneration; should record an override + audit if COO chooses to regenerate. |
| 582 | 400 "Task requires a deliverable" | **SOFT (workflow)** | Softening candidate — same family as the handover/stage-advance refusals already softened. COO/Eng Mgr should be able to mark task complete-without-deliverable + reason + audit. |
| 593 | 400 "Deliverable for this task must be approved before completion" | **SOFT (workflow)** | Same as above. |
| 671, 898 | 400 "No file uploaded" | HARD (input validation) | Stays. |
| 709 | 400 "Status must be approved/rejected" | HARD (enum integrity) | Stays. |
| 713 | 403 "Only COO/engineers/PMs can approve" | HARD (RBAC) | Stays. |
| 720, 802-807, 979 | 403 "You cannot approve/issue your own deliverable / stage gate" (segregation of duties) | HARD (security/integrity) | Stays — playbook explicitly demands signed handovers (Six Rule #6). |
| 780-797 (issue-for-construction) — 403 role + 409 invalid_transition | HARD (controlled-document integrity) | Stays. The IFC release is safety-of-life; playbook Stage 5 Construction depends on this. |
| 803-807 | 403 "cannot issue your own uploaded deliverable" | HARD (integrity) | Stays. |
| 847-851 | 403 "Only engineers/CONSTRUCTION_MANAGER/COO can mark as-built" | HARD (RBAC) | Stays. |
| 858-863 | 409 "Cannot mark as-built from state X" | HARD (state machine) | Stays. |
| 983 | 403 "Only Quality Manager can perform QA review" | HARD (RBAC) | Stays. |
| 1244 | 400 "Override reason is mandatory" | HARD (audit integrity — required for the override to be meaningful) | Stays. |
| 1328, 1447 | 400 missing-required-field on transmittal / supersede | SOFT validation | Refactor to Zod. |
| 1457 | 409 "Deliverable already superseded" | HARD (idempotency on terminal state) | Stays. |

`server/engineering-routes.ts` shows only 2 refusals on this grep (an
EPM challenge 403 at line 152 and a project-authority 403 at line 1952)
— both HARD.

`server/departments/drawing-register-routes.ts:107, 116, 126` — invalid
status / invalid transition / IFC role-gate — all HARD.

**Verdict:** Most refusals are HARD and should stay. Three softening
candidates are clearly visible:

1. **Lines 365, 372, 379** — engineering stages already generated. Convert to "regenerate with COO override + reason".
2. **Line 582** — task requires deliverable. Add COO/Eng Mgr override path with audit.
3. **Line 593** — task deliverable must be approved before completion. Same softening.

Per the prompt, handover/stage-advance/QB refusals have already been
softened — these three are the next wave.

---

## T2.4 — Drawings register linkage

| Check | Result | File:line | Verdict | Triage |
|---|---|---|---|---|
| FK to `project_info.id` | `drawingRegister.projectId` `notNull().references(() => projectInfo.id, { onDelete: "cascade" })` | `shared/schema/engineering.ts:318` | PASS | — |
| Linkage to a deliverable | Drawings are stand-alone (no FK to `project_eng_deliverables` or `deliverables`). The link is via `eng_transmittal_items.drawingId` (`shared/schema/engineering.ts:400-411`) — a transmittal can group both. No direct deliverable↔drawing FK. | `shared/schema/engineering.ts:316-342, 400-411` | SOFT GAP — drawings carry SLD/array layout that the playbook lists as deliverables, but the data model treats drawings and `project_eng_deliverables` as separate. UI joins via transmittal or via `project_eng_deliverables.deliverableTemplateId` + drawing manual rev tracking. | fix-soon |
| Revision tracking | Two-table model: `drawingRegister.currentRevision` + history in `drawing_revisions` (`shared/schema/engineering.ts:344-355`); revision insert auto-updates current on parent (`server/departments/drawing-register-routes.ts:185-202`). PASS shape. | `shared/schema/engineering.ts:316-355`; `server/departments/drawing-register-routes.ts:185-202` | PASS | — |
| Status state machine | Explicit `DRAWING_STATUS_TRANSITIONS` with role gate on `ifc`/`as_built` (engineers/COO/CONSTRUCTION_MANAGER). Patch endpoint enforces whitelisted-fields + transition-engine + audit. | `shared/schema/engineering.ts:300-314`; `server/departments/drawing-register-routes.ts:85-168` | PASS — best-in-class refusal handling on this surface. | — |
| SharePoint storage shape | `sharepointLink: text` URL string (no `siteId/driveId/itemId`). § 4B intent ("Graph reference, not file body") is met (no bytes), but the linkage is an opaque URL — copy/paste, lifecycle changes, and tenant migrations break it. | `shared/schema/engineering.ts:328, 351` | SOFT — § 5A (HARD) is satisfied (no bytes); § 4B Six Rule #2 spirit (Graph ref) is not. | fix-soon |
| `controlled_documents` (DEPRECATED) usage | Grep `server/eng-stage-routes.ts /server/engineering-routes.ts /server/departments/drawing-register-routes.ts` — **zero references**. Engineering correctly uses `project_eng_deliverables` + `drawing_register` + `eng_transmittals`. | (no hits) | PASS — deprecated table is not extended. | — |
| `managed_documents` integration | Engineering routes do **not** read/write `managed_documents`. Drawings sit in their own register; `project_eng_deliverables` carries its own `storageRef`. The CLAUDE.md "current document-management surface" (`managed_documents` + `folder_taxonomy` + `project_folders`) is not used by engineering. | (no hits in `server/eng-stage-routes.ts /server/departments/drawing-register-routes.ts`) | SOFT inconsistency — engineering deliverables / drawings are a parallel document surface. | fix-soon (architectural — but the path-string linkage is the bigger issue first) |

**Verdict:** Drawing register itself is the strongest surface in the
engineering pillar — proper revision history, role-gated state machine,
audit per IFC/as-built, deprecated `controlled_documents` not extended.
The two soft gaps are the **opaque-URL SharePoint shape** and
**no FK to deliverable**.

---

## T2.5 — Smart Import for engineering data

Engineering data does NOT flow through Smart Import in any meaningful
sense. The split is:

- **Smart Import v2** (`server/lib/import/normalizer.ts`, `server/imports/`) — programme plan rows (work_items), revenue lines, cost lines, finance roll-ups. No engineering deliverables / drawings / approvals.
- **Engineering intake** (`server/engineering-intake-routes.ts`, `server/intake-connector.ts`) — separate SharePoint-list bidirectional sync into `intake_requests` table. COO-only, manual Pull/Push (`shared/schema/imports.ts:313-366`; `server/engineering-intake-routes.ts:25-289`).

The two pipelines do not overlap; Smart Import never writes a row in
`engineering_tickets`, `project_eng_*`, or `drawing_register`.

What Smart Import *does* touch that lands in engineering's view is the
**programme-plan rows** in `work_items` (workstream `PM` and any `ENG`
rows). For those, § 3.7 / § 9 rules apply — and that is where the C.9
violations live (T2.7 below).

| Check | Result | File:line | Verdict | Triage |
|---|---|---|---|---|
| Engineering rows go through Smart Import | No — separate pipeline. | `server/lib/import/normalizer.ts` (no engineering refs); `server/engineering-intake-routes.ts:25-289` | PASS — clean separation | — |
| § 3.7 planned-vs-actual on work_items rows that engineers consume | At the import boundary: `actualStartCol = getColIndex(mapping, "actual_start")` and `endCol = "actual_end"` are read **separately** from planned `start_date`/`end_date`. No fallback in the normalizer (`server/lib/import/normalizer.ts:776-849`). PASS at the import boundary. | `server/lib/import/normalizer.ts:776-849` | PASS at the boundary | — |
| § 3.7 on the **read** side | **VIOLATIONS** — see T2.7 (work-items-adapter substitutes `startDate` for missing `actualStart`). | (multiple) | FAIL on the read | fix-now |
| Engineering intake: line-ID stability per § 3.5 | `intake_requests` uses `spItemId` as the natural key (`server/engineering-intake-routes.ts:111`). Not hash-based the way expense/inflow lines are, but stable. | `server/engineering-intake-routes.ts:111-171`; `shared/schema/imports.ts:313-366` | PASS — different surface, different stability mechanism. | — |
| § 5A no-body rule on intake | Intake stores fields mapped via `mapSpFieldsToApp`; need to verify no body/attachment bytes. | `server/engineering-intake-routes.ts:122-160` (writes only field-mapped values) | PASS by inspection (only metadata fields written; SharePoint folder/file refs only). | — |

**Verdict:** Engineering data is on a separate intake pipeline and
respects § 3.5 / § 3.7 / § 5A at its own boundary. The § 3.7 violation
class lives downstream in `work-items-adapter` (T2.7).

---

## T2.6 — RFI / NCR loop

The playbook implies an engineering→construction RFI flow (e.g.,
"`Surprises in Planning become incidents in Construction`",
playbook line 429-430) and references NCR throughout (lines 802, 894,
quality-NCR `approvalType` in `shared/schema/collaboration.ts:131`).

| Surface | State today | Triage |
|---|---|---|
| RFI (Request For Information) — engineering→construction | **Absent.** Grep across `shared/schema/`, `server/services/`, `server/repositories/`, `server/departments/`, `server/routes/` returns zero hits for `rfi` / `RFI` as a table or service. The closest analogue is `eng_transmittals` with `purpose = 'for_review' / 'for_information'` (`shared/schema/engineering.ts:368-377`), but that is "we sent you this", not "we are asking you to clarify this". | no surface (future build) |
| NCR (Non-Conformance Report) — construction quality flag | Indirect via `qcWarning`, `qcItemInstance`, `hse.corrective_actions` (`shared/schema/quality.ts:162-194`, `shared/schema/hse.ts`). The string `'ncr'` appears as a `sourceType` enum value in `shared/schema/hse.ts:38` and `'quality_ncr'` as an `approvalType` value in `shared/schema/collaboration.ts:131`. There is **no dedicated `ncrs` / `non_conformances` table.** UI references `NCR List` at `/quality/ncrs` (`shared/schema/role-based-upgrade.ts:429`) but the route + table are absent. | rough — UI nav points to a list that does not yet have a backing surface |
| Engineering↔Construction loop linkage | Transmittals (`eng_transmittals`) carry the engineering→site delivery direction and store `recipientName / recipientOrg / recipientUserId`. The reverse direction (site sends a query / NCR back to engineering) has no linkage today. | no surface (future build) |

**Verdict:** RFI: **no surface — future build, not a defect.** NCR:
**rough — UI nav exists, no backing table.** Quality / HSE has its own
warning + corrective-action structure that overlaps with what an NCR
would carry, but a clean engineering-side NCR queue is not present.
Recommend: future Plan v3 wave to land a dedicated `ncrs` table (or
extend `qc_warning` with `ncr_type` + `routed_to_workstream`) — but
classify as **defer** for the trust audit, not a fix-now defect.

---

## T2.7 — C.9 sweep — `work_items.startDate` consumers

Hypothesis to test: any reader of `work_items.startDate` /
`work_items.endDate` that is being treated as "the actual" violates
§ 3.7 (HARD: actuals are actuals, planned dates do NOT fall back).

| File:line | Read shape | Class | Verdict | Triage |
|---|---|---|---|---|
| `server/work-items-adapter.ts:126-127` | `actualStartDate: wi.actualStart \|\| wi.startDate, actualEndDate: wi.actualEnd \|\| wi.endDate` — fallback substitutes the **planned** field into the **actual** field on the `getWorkItemsAsTasks` return shape consumed by programme tabs. | (b) reads as "the actual" | **§ 3.7 VIOLATION** — the consumer cannot tell that the actual was missing; sees planned date as actual. | fix-now |
| `server/work-items-adapter.ts:434-435` | Same `wi.actualStart \|\| wi.startDate` substitution in `getWorkItemsForOperationsView` (operational-tasks shape). | (b) reads as "the actual" | **§ 3.7 VIOLATION** — same class. | fix-now |
| `server/work-items-adapter.ts:747-748` | `actualStartDate: wi.actualStart, actualEndDate: wi.actualEnd` — **no fallback.** | (b) reads as "the actual" | OK — actual stays null when null. | — |
| `server/work-items-adapter.ts:390-393` | Drizzle select projecting both `startDate` and `actualStart` columns separately — pre-substitution shape. | (a) field projection | OK | — |
| `client/src/components/tabs/UnifiedPlanTab.tsx:1176-1177, 1201-1202, 1265-1266, 1306-1307, 2153-2158` | Repeated pattern `const s = task.actualStartDate \|\| task.startDate; const e = task.actualEndDate \|\| task.dueDate;` on the client — used for Gantt rendering, rollups, dependency calc. | (b) reads as "the actual" — used in **schedule rollups + dependency calc**, not just display. | **§ 3.7 VIOLATION** — schedule rollups and parent-end calculation will compute "actuals" from planned values when actuals are null, which will be displayed back as if it were the realised programme. | fix-now |
| `client/src/components/TaskDetailDrawer.tsx:129-130` | `match.startDate \|\| match.actualStart \|\| match.actualStartDate` — order is **planned-first**, then actual. Used as a single "date" for display in the detail drawer. | (a) display, but order is wrong (planned overrides actual when both set) | SOFT VIOLATION — when both planned and actual exist, the drawer shows planned. | fix-soon |
| `client/src/components/tabs/ExpenditureEditableTab.tsx:508` | `dueDate: t.actualEnd \|\| null` — direct, no planned-fallback. | (a) display | OK | — |
| `client/src/pages/program-plan.tsx:60-61, 200, 202` | Renders `t.actualStart` and `t.actualEnd` as **separate columns** from planned, with cell-format colouring. | (a) display, side-by-side | OK — this is the Excel-replica view, exactly per § 9.3. | — |
| `client/src/pages/projects.tsx:410-429` | Edit-in-place inputs bind to `actualStart` / `actualEnd` directly. | (a) write-side | OK | — |
| `server/standup-routes.ts:1040, 1060, 1083, 1103` | `endDate: workItems.endDate` — used to display "due date". | (a) display | OK (planned end is the public due-date). | — |
| `server/lifecycle-routes.ts:560, 1139` | `wi.end_date AS "dueDate"` | (a) display ("dueDate") | OK | — |
| `server/admin-control-routes.ts:744`; `server/pm-routes.ts:239-276, 382-390`; `server/pm-on-the-go-routes.ts:304-308`; `server/gamification-routes.ts:149-150, 191-192, 588`; `server/services/task-reminder-dispatcher.ts:169-170`; `server/services/project-development-workspace-service.ts:1027`; `server/repositories/opportunities-repository.ts:572, 660`; `server/departments/priority-strategic-routes.ts:1372-1384`; `server/departments/opportunities-routes.ts:654-930`; `server/departments/project-routes.ts:710` | All use `end_date` / `endDate` for **overdue detection** (`wi.end_date::date < CURRENT_DATE`) or **sort by due date**. | (a) "current effective date" — overdue is computed against planned end-date by design (a task is overdue when it has not been completed by its **planned** end). | OK — this is the correct semantic for overdue. | — |
| `server/services/gate-auto-evaluator-service.ts:226, 397` | Reads `drawingRegister` rows for evidence; not work-items dates. | n/a | OK | — |
| `server/services/task-cascade-service.ts:67-68` | Selects both `startDate` and `endDate` for cascading dependent task dates. | (a) — operates on planned dates by design (cascade reschedules planned). | OK | — |
| `server/services/project-development-workspace-service.ts:1027` | `COUNT(*) FILTER (WHERE endDate IS NOT NULL AND endDate < today AND status NOT IN ('completed', ...))` — overdue count. | (a) — overdue against planned end | OK | — |
| `server/ms-sync-routes.ts:701, 741-742, 1000-1001, 1081-1082` | MS Project ↔ work_items sync. Reads/writes both `start_date` / `end_date` (planned) and pairs with `actual_start_date` / `actual_end_date` separately. | (a) — paired round-trip to MS Project, both fields present. | OK | — |
| `server/work-items-backfill.ts:76-77, 210, 301, 325` | Backfill: `COALESCE(npt.start_date, npt.actual_start_date)` and similar. **Substitutes actual into planned position.** | (b) — but in the opposite direction (uses actual as fallback for planned during backfill from legacy task tables). | SOFT — § 3.7 is symmetric ("planned does not fall back into actuals"); this is "actual falls back into planned". The legacy file is the work-items writable-view migration; backfill is one-time. Documented as deprecated in CLAUDE.md (`do not extend server/work-items-backfill.ts`). | defer |
| `client/src/pages/excel-vs-app-project.tsx:104` | `DATE_FIELDS = new Set(["startDate","endDate","actualStart","actualEnd",...])` — diff classifier set. | (a) drift classifier | OK — Excel-vs-app diff respects all four. | — |

**C.9 verdict — total violations found: 4 distinct read sites (3
classifications, but one — UnifiedPlanTab — has 5 line ranges with the
identical `actualStartDate || startDate` pattern):**

1. `server/work-items-adapter.ts:126-127` — `getWorkItemsAsTasks` return shape. **fix-now**
2. `server/work-items-adapter.ts:434-435` — operations view. **fix-now**
3. `client/src/components/tabs/UnifiedPlanTab.tsx:1176-1177, 1201-1202, 1265-1266, 1306-1307, 2153-2158` — 5 hits in the Gantt + rollup + parent-end calc. **fix-now**
4. `client/src/components/TaskDetailDrawer.tsx:129-130` — display drawer reverses precedence (planned wins over actual). **fix-soon**

**Recipe for class-(b) fixes:** read `actualStart` + `actualEnd`
directly; if null, expose null to the UI and let the consumer render
"actual not yet known" / "—". Do NOT substitute the planned field. The
existing pattern at `server/work-items-adapter.ts:747-748` is the
correct reference.

The line at `server/work-items-adapter.ts:128` (`actualDuration ||
duration`) is the same class for the duration field — fold into the
same fix.

---

## Summary (8 bullets)

1. **Top defect — runtime crash on stage-template DELETE.** `server/eng-stage-routes.ts:266` and `:326` write `engTaskTemplates.deletedAt` / `engDeliverableTemplates.deletedAt` — **columns that do not exist** in `shared/schema/engineering.ts:144-168` and are absent from `migrations/0000_baseline_20260419.sql:2022-2060`. COO-only soft-delete on stage templates will throw at runtime today. fix-now.

2. **Top defect — § 3.7 violations on work_items date reads.** `server/work-items-adapter.ts:126-127` and `:434-435` substitute the planned `startDate`/`endDate` into the `actualStartDate`/`actualEndDate` response shape. The same pattern repeats 5 times in `client/src/components/tabs/UnifiedPlanTab.tsx` (Gantt, rollups, parent-end calc). The same field substitution silently shifts project state — exactly the failure mode § 3.7 calls out. fix-now.

3. **Top quick win — refusal-softening, three sites in `eng-stage-routes.ts`.** Lines 365/372/379 (engineering stages already generated), 582 (task requires deliverable), 593 (deliverable must be approved before completion). All three are workflow rules, not security/integrity rules — should accept a COO/Engineering-Manager override + reason + audit. Same family as the handover/stage-advance/QB refusals already softened (Plan v3 § D.6).

4. **Surprise — three parallel deliverable surfaces with three different SharePoint linkage shapes.** `deliverables` (Graph ref `siteId/driveId/itemId`), `project_eng_deliverables` (`storageRef` + `sharepointFolderPath` strings), `drawing_register` (`sharepointLink` URL). The most-actively-written table (`project_eng_deliverables`) uses the weakest shape. Six Rule #2 / § 4B intent ("Graph ref, not file body") is satisfied at the no-bytes level but not at the structured-ref level.

5. **C.9 verdict — 4 distinct violation sites (8+ line ranges).** The class-(b) cases are concentrated in `work-items-adapter.ts` (server) and `UnifiedPlanTab.tsx` (client Gantt/rollup). Recipe: read `actualStart`/`actualEnd` directly; expose null to the UI; never substitute. Reference for the correct pattern: `server/work-items-adapter.ts:747-748`.

6. **Engineering audit-events coverage gap — YES.** Engineering services (`engineering-routes.ts`, `eng-stage-routes.ts`, `engineering-intake-routes.ts`, `departments/drawing-register-routes.ts`) all use the **legacy `logAuditFromReq`** helper. The Plan v3 § 2.3 wave wired `recordAudit` into 5 services (`stage-lifecycle-service`, `quickbooks-cascade-proposals-service`, `pending-approvals-service`, `stage-exception-service`, `om-handover-service`) — none in engineering. Engineering ticket / deliverable / drawing / stage-gate state transitions are auditable today, but on the legacy path. Files to migrate next: `server/eng-stage-routes.ts`, `server/engineering-routes.ts`, `server/engineering-intake-routes.ts`, `server/departments/drawing-register-routes.ts`.

7. **Phase D.G refusals to soften next** (in priority order): (a) `eng-stage-routes.ts:582-593` — task-requires-deliverable / deliverable-must-be-approved (most-hit by engineers in iteration); (b) `eng-stage-routes.ts:365-379` — stages-already-generated idempotency block (real friction in re-import scenarios); (c) `drawing-register-routes.ts:115-122` — invalid-transition on drawing status (currently HARD; could be SOFT for COO with reason + audit when a project genuinely backs up a step). Items in T2.3's HARD column should stay.

8. **One-off oddities flagged:**
   - **`COMPANY_ROLES` only has 16 entries** (`shared/schema/users.ts:101-119`) — matches CLAUDE.md's "16 roles as of 2026-05-07". Playbook deliverable matrix (`docs/operating-model/playbook-v2.0.md:447-460`) calls out PrEng, Senior Eng, Structural PrEng, Head of Eng — none modelled. Today the app collapses to `ENGINEER` + `ENGINEERING_MANAGER` + `COO_ADMIN`.
   - **NCR has UI nav (`/quality/ncrs`) but no table** (`shared/schema/role-based-upgrade.ts:429`). Either the nav is premature or the table is missing.
   - **RFI is absent** as a surface; `eng_transmittals` is one-direction (we sent X to Y), no return-channel for clarification queries.
   - **`engineering_tickets.status` is `text`, not `pgEnum`** (`shared/schema/projects.ts:710`) — but `eng_stage_status` / `eng_task_instance_status` / `eng_approval_status` (lines 112-114 of engineering schema) ARE pgEnums. Inconsistency; the text + normalizer pattern is functional but means a schema-level enum migration is still pending.
   - **`engStageTemplates.isActive` carries a TODO comment "migrate to deletedAt pattern"** (`shared/schema/engineering.ts:135`). This is the same family as the schema-vs-code drift in finding T2.1 — half-migrated soft-delete pattern.
   - **`work-items-adapter.ts` is documented as legacy/retired** (CLAUDE.md "do not extend `server/work-items-adapter.ts` or `server/work-items-backfill.ts`") yet the C.9 violations in finding T2.7 live inside it. The fix path is "edit-once-then-stop" — mark the function deprecated, route callers to a new helper that respects § 3.7.

---

*End of file. ~24 source files read; cap was 35. Read-only audit. No
code, schema, or migrations were changed. No commits, no pushes.*
