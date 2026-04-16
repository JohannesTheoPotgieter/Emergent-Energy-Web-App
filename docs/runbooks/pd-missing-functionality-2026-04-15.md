# PD Missing Functionality — Register & Implementation (2026-04-15)

Status: implemented on branch `claude/improve-pipedrive-integration-2cllX`.
Only safe quick wins were implemented. Deeper changes are listed as
future work and were not touched.

---

## 1. Missing functions register (ranked by priority)

### P1 — Opportunity → Project conversion (IMPLEMENTED)

**Before**: `project_info.opportunityId` FK existed in the schema but was
never written by any user-facing code path. No UI linked opportunities
to projects. The project creation form (`project-create.tsx`) accepted
`projectName`, `clientId`, `projectCode`, `location`, `initialPhase`
only — no `opportunityId`. Six insert paths for `project_info` existed
(manual form, Excel import, lifecycle promotion, template application,
sync, meeting). None accepted `opportunityId`.

**Fix**:
- `POST /api/projects` now accepts `opportunityId` in the body.
- If provided, validates the opportunity exists, carries `clientId`
  from the opportunity (overridable), stamps `project_info.opportunityId`,
  and logs an `"create_from_opportunity"` audit event.
- `project-create.tsx` reads `?opportunityId=X` from the URL, fetches
  the opportunity, pre-fills `clientId`, and shows a blue conversion
  banner with the opportunity's notes, value, and Pipedrive badge.
- `opportunities.tsx` now renders a `FolderPlus` "Start Project" icon
  button on each active (not won/lost) opportunity row that navigates
  to `/project-create?opportunityId=X`.

### P2 — Project creation audit trail (IMPLEMENTED)

**Before**: `POST /api/projects` had no `logAuditFromReq` call. Project
creation was invisible in the `audit_events` table.

**Fix**: Now writes an audit event with `entityType: "project"`,
`action: "create" | "create_from_opportunity"`, and carries
`projectName`, `clientId`, `opportunityId`, and `phase` in the
`changesJson`.

### P3 — Proposal readiness advisory on conversion (IMPLEMENTED — partial)

**Gap**: No validation prevented creating a project from an opportunity
that was still in `prospect` or `qualification` stage.

**Fix** (this commit):
- `POST /api/projects`: when `opportunityId` is provided and the
  opportunity is in `prospect` or `qualification` stage, the response
  includes an `_earlyStageAdvisory` string. This is a warning, not a
  block — EE sometimes starts preliminary PD work before the deal
  progresses.
- `project-create.tsx`: the conversion form renders an amber advisory
  banner when the source opportunity is in an early stage, explaining
  that projects are usually created from "proposal" stage or later.
- The success screen also renders the advisory and a CRM boundary cue
  when the source opportunity is from Pipedrive.

**Still open**: no stage advisory on PD ticket creation when
`opportunityId` is provided. Tracked as future work — lower risk
because PD tickets are work requests, not project spine creation.

### P4 — Owner/blocker visibility on opportunities (FUTURE WORK)

**Gap**: `dealOwnerUserId` is `@deprecated` (never populated). No "next
action" or "blocker" column on the opportunities list. The PD ticket
list has a `Next Action` column but opportunities do not.

**Recommendation**: Populate `dealOwnerUserId` from Pipedrive's
`deal.owner_id.email` via a user-email lookup during sync (structural
fix #2 in the Pipedrive review runbook). Add an `assignedToUserId` for
internal opportunities. Then add a "Next Action" column to the
opportunities list UI.

### P5 — Explicit CRM boundary cues on detail pages (PARTIALLY IMPLEMENTED)

**Gap**: Only the opportunities list page showed the Pipedrive/Internal
badge. Detail pages did not surface the CRM boundary.

**Fix** (this commit):
- `GET /api/pd/tickets/:id`: enriched with `opportunityInfo` (id,
  source, stage, notes, estimatedValue) when the ticket has an
  `opportunityId` linked.
- `pd-ticket-detail.tsx`: the info grid shows an "Opportunity" row
  with the source (Pipedrive / Internal), stage, and estimated value.
- `project-create.tsx` success screen: renders a Pipedrive CRM
  boundary notice when the project was created from a CRM-synced
  opportunity.

**Still open**: the project lifecycle/detail page does not show CRM
source for its linked opportunity. Lower priority — the project spine
is app-owned regardless of the opportunity's source.

### P6 — Opportunity status update on conversion (FUTURE WORK)

**Gap**: When a project is created from an opportunity via the new
conversion flow, the opportunity's `status` is not automatically
updated to `won`. The user must manually edit the opportunity stage
after creating the project.

**Recommendation**: Add an optional `markAsWon: boolean` checkbox on the
conversion banner. If checked, the server sets `opportunities.status =
'won'` and `opportunities.stage = 'won'` after creating the project.
Do NOT auto-mark — let the user decide. Some projects start before the
deal is formally won (e.g., conditional approval).

### P7 — Clean project creation trigger from PD dashboard (FUTURE WORK)

**Gap**: The PD dashboard has a "New PD Ticket" button but no "New
Project" button. To start a project, the user navigates to a separate
page via the sidebar. There is no "Start Project from Opportunity" flow
on the dashboard itself.

**Recommendation**: Add a small "Start Project" link in the Commercial
Pipeline section of the PD dashboard that navigates to
`/project-create`. Low priority because the button is already available
on each opportunity row.

---

## 2. Code changes (this commit)

### `server/template-routes.ts` (`POST /api/projects`)

- Destructures `opportunityId` from `req.body`.
- If provided: validates the opportunity exists via a DB lookup. If not
  found, returns 400. If found, carries `opp.clientId` as the fallback
  when no explicit `clientId` is passed.
- Sets `project_info.opportunityId` in the insert payload.
- Adjusts `phaseNotes` to mention the source opportunity.
- Adjusts the `project_phase_history` reason similarly.
- Calls `logAuditFromReq` with `action: "create_from_opportunity"` or
  `"create"` depending on whether an opportunity was linked.

### `client/src/pages/project-create.tsx`

- Reads `?opportunityId=X` from the URL via `useMemo` +
  `URLSearchParams`.
- Fetches the opportunity via `useQuery` to `/api/opportunities/:id`
  (enabled only when the param is present).
- Auto-fills `form.clientId` from the opportunity (once, via
  `useEffect`).
- Sends `opportunityId` in the POST body.
- Renders a blue conversion banner showing the opportunity's notes,
  value, Pipedrive badge, and a note that the client will be inherited.

### `client/src/pages/opportunities.tsx`

- Adds a `FolderPlus` icon button on each active opportunity row
  (gated on `stage !== "won" && stage !== "lost"`) that navigates to
  `/project-create?opportunityId=X`.
- Imports `useLocation` from `wouter` and `FolderPlus` from `lucide-react`.

---

## 3. Regression risks

- **Existing project creation** (no `opportunityId` param) is
  unchanged. The new code path is gated on `if (opportunityId)` and
  falls through to the existing flow when absent.
- **No auto-stage-change on opportunity.** Converting does not mutate
  the opportunity. The user's existing workflow of manually changing
  the stage is preserved.
- **Client inheritance is overridable.** The form pre-fills `clientId`
  from the opportunity but the user can change it before submitting.
- **The "Start Project" button** is hidden on won/lost opportunities
  so users do not create a second project from an already-converted
  deal.

---

End of register.
