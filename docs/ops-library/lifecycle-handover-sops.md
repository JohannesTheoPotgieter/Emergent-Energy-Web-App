# Lifecycle and Handover SOPs (Active)

## Canonical lifecycle (12 phases, 2026-04-24)
The single source of truth is `shared/phases.ts`. The model is 10 sequential
phases plus 2 terminal "branch" phases:

| # | Code | Label | Owner |
|---|------|-------|-------|
| 1 | S01_FIRST_ASSESSMENT | First Assessment | PD |
| 2 | S02_DESIGN_COST_PROPOSAL | **Cost Proposal & Design** *(renamed from "Design & Cost Proposal")* | Engineering |
| 3 | S03_SIGNATURE_FINANCIAL_CLOSE | Financial Close | PD |
| 4 | S04_PLANNING | Planning | PM |
| 5 | S06_CONSTRUCTION | Construction | PM |
| 6 | S07_COMMISSIONING | Commissioning | Engineering |
| 7 | S08_OM_HANDOVER | O&M Handover | PM |
| 8 | S09_CLIENT_HANDOVER | Client Handover | PM |
| 9 | S10_POST_HANDOVER_REVIEW | **3 Months Post HO Review** *(renamed; moved from position 10 → 9)* | PM |
| 10 | S9B_COMPLIANCE_HANDOVER | Compliance Handover *(moved from position 9 → 10)* | PM |
| — | S_HOLD | Hold *(terminal — resumable, preserves prior phase in `project_execution_state.previous_phase`)* | PM |
| — | S_DONE | Done *(terminal — closed/cancelled/completed projects)* | PM |

Migration `0030_canonical_lifecycle_phases_v2.sql` performs the rename, the
9↔10 swap, the terminal-branch insertion, and the backfill from
`project_status` (`hold` → S_HOLD, `closed` → S_DONE). Legacy labels resolve
via `PHASE_ALIASES` in `shared/phases.ts`.

## Terminal branches
- **Hold (S_HOLD)** is *resumable*. When a project moves to Hold, the
  outgoing sequential phase is stored in
  `project_execution_state.previous_phase` and the original
  `S<n>_*` instance is left intact so the project can be resumed without
  reseeding. `nextPhase(S_HOLD)` returns `null` — terminal stages do not
  advance.
- **Done (S_DONE)** is *permanent*. The project_status remains `closed`
  and the project is no longer surfaced on active boards.

### Transition handlers
The terminal-branch transitions are owned by
`server/services/stage-lifecycle-service.ts`:
- `placeProjectOnHold({ projectId, actorUserId, reason? })` — captures
  the current sequential `current_stage_code` onto `previous_phase`,
  ensures an `S_HOLD` stage instance is `IN_PROGRESS`, sets
  `project_status='hold'`, and writes a `STAGE_OVERRIDE` decision row
  for the audit trail.
- `resumeProjectFromHold({ projectId, actorUserId, reason? })` —
  restores `previous_phase` as the new `current_stage_code`, clears
  `previous_phase`, marks the `S_HOLD` instance `PROGRESSED`, sets
  `project_status='active'`, and records the resume decision. Throws
  if the project is not currently on `S_HOLD` or has no
  `previous_phase`.
- `markProjectDone({ projectId, actorUserId, reason? })` — ensures an
  `S_DONE` stage instance, sets `project_status='closed'`, and records
  the closure decision. There is no resume from `S_DONE` — closure is
  permanent.

### HTTP routes
The handlers are exposed by `server/stage-lifecycle-routes.ts`:
- `POST /api/projects/:projectId/stages/hold` — `placeProjectOnHold`
- `POST /api/projects/:projectId/stages/resume` — `resumeProjectFromHold`
- `POST /api/projects/:projectId/stages/done` — `markProjectDone`

The generic `POST /api/projects/:projectId/stages/advance-to/:stageCode`
endpoint **rejects** `S_HOLD` and `S_DONE` targets with a 400 and a
hint pointing at the dedicated endpoint above. This guarantees every
production transition into a terminal branch flows through the
preserve/consume previous_phase contract.

Round-trip behaviour is covered by:
- `qa/tests/integration/stage-lifecycle-hold-resume.test.ts` — service-level
- `qa/tests/integration/stage-lifecycle-hold-resume-routes.test.ts` — HTTP-level
- `qa/tests/integration/canonical-lifecycle-migration-backfill.test.ts` — verifies
  legacy `project_status='hold'/'closed'` rows are surfaced on `S_HOLD`/`S_DONE`
  current_stage_code after migration 0030 (steps 7d/7e).

## Stage ownership
- **Project Development (PD)** owns pre-handover initiation and readiness.
- **Project Management (PM)** owns execution after handover acceptance.
- **Compliance/HSE** begin after PD→PM handover.
- **Matriarch** owns O&M handover and downstream operation phase.

## PD → PM handover gate (minimum)
1. Required engineering and commercial pack complete.
2. Scope baseline and approvals recorded.
3. Risk register and unresolved blockers surfaced.
4. Handover signoff captured with accountable roles.

## PM → O&M (Matriarch) handover gate
1. Commissioning evidence complete and linked.
2. Safety/compliance closure status documented.
3. Asset and maintenance baseline delivered.
4. Handover acceptance recorded by Matriarch stakeholder.

## SOP guardrails
- No fake completion states; incomplete workflows must stay blocked or clearly labeled.
- Handover dates and owners are mandatory for stage progression.
- Evidence artifacts must link to source documents, not free-text claims.
- Importers must accept both legacy ("Design & Cost Proposal",
  "Post-Handover Review") and current labels — resolution lives in
  `shared/phases.ts::resolveCanonicalCode`.
