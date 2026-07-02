# Build Design — Project Development Opportunities → Engineering Ticket Flow

Date: 2026-04-16
Status: **Design only (no implementation in this document)**

---

## Design goals
1. Use Pipedrive as the **source of truth** for commercial deal state.
2. Expose only **ACTIVE, actionable** opportunities in the new flow.
3. Allow controlled creation of Engineering tickets from opportunities with robust mapping, dedupe, and audit.
4. Reuse existing primitives (`opportunities`, `clients`, `project_info`, `pd_tickets`, `work_items`, templates, permission framework) and minimize risky schema churn.

---

## 1) Target workflow

### 1.1 Opportunity source and read model
- Source of data remains:
  - Pipedrive API → `syncPipedriveDeals()` → local `opportunities` table.
- New flow reads from a **new eligibility view/endpoint**, not raw `/api/opportunities`.
- Eligible rows must be `source = 'pipedrive'` and pass ACTIVE rules (below).

### 1.2 ACTIVE opportunity filter (exact rules)
Define `isEligibleForEngineering(opportunity)`:

```text
INCLUDE only if ALL are true:
1) deleted_at IS NULL
2) source = 'pipedrive'
3) status = 'active'
4) stage NOT IN ('won', 'lost', 'closed')
5) signed_date IS NULL

EXCLUDE if ANY are true:
- status IN ('won', 'lost', 'closed')
- stage IN ('won', 'lost', 'closed')
- signed_date IS NOT NULL
```

Notes:
- Rule intentionally checks both `status` and `stage` because sync and historical/manual edits can diverge.
- “signed/won/closed” is treated as terminal/non-actionable for this flow.

### 1.3 UI flow: “Create Engineering Ticket”
From `Opportunities` (new “Engineering Intake” mode):
1. User opens eligible Pipedrive opportunity.
2. Click **Create Engineering Ticket**.
3. Wizard steps:
   - Step A: Confirm opportunity snapshot (deal id, org/client, stage/status, value).
   - Step B: Client + Project mapping (3 supported paths).
   - Step C: Ticket mode (Phase Template vs Custom).
   - Step D: Dedupe warnings + confirmation.
   - Step E: Create (atomic service call).
4. Success result shows links:
   - opportunity id / pipedrive_deal_id
   - client id
   - project id
   - PD ticket id
   - engineering work item id(s)

### 1.4 Template selection logic
Two modes:
- **Phase Template mode (default):**
  - User chooses lifecycle phase (or suggested from opportunity stage mapping).
  - System resolves active `phase_template` for that phase.
  - Creates PD ticket + spawns task pack (existing spawn mechanics) and optional engineering work items.
- **Custom mode:**
  - User selects request type + manual selected tasks/custom tasks.
  - Reuses existing PD ticket template constants and custom task options.

### 1.5 Mapping flows (required combinations)

#### A) Create new client + new project
- Create client (reuse generated client code logic).
- Create project shell (minimal `project_info` + split-table sync).
- Link shell to opportunity and client.
- Create ticket linked to both.

#### B) Map to existing client + new project
- Validate selected client exists.
- Create project shell linked to existing client and opportunity.
- Create ticket linked to both.

#### C) Map to existing client + existing project
- Validate project exists and is active.
- Validate client-project consistency:
  - if project has null client: set to selected client with audit.
  - if project has different client: warn + require explicit override confirmation.
- Create ticket linked to selected existing project + opportunity.

### 1.6 Project shell creation logic
- Reuse `/api/projects` creation internals but expose a new “shell” mode through orchestration endpoint.
- Shell = normal `project_info` row with minimum required values + explicit status markers (see status section).
- Must always set:
  - `project_info.opportunity_id`
  - `project_info.client_id`
  - initial phase default (`P0_FIRST_ASSESSMENT` unless user picks another allowed initial phase)
- Trigger existing split table sync and phase history write.

### 1.7 Link model
Canonical chain:
- `opportunities.pipedrive_deal_id` (external key)
- `opportunities.id` (internal opportunity key)
- `project_info.opportunity_id` (project linkage)
- `pd_tickets.opportunity_id` + `pd_tickets.project_id` (ticket linkage)
- `work_items.pd_ticket_id` with `workstream='ENG'` (engineering execution linkage)

No new join table required for v1 if all links above are enforced transactionally.

### 1.8 Duplicate warning rules
Warn (not block) when:
1. Existing active PD ticket(s) for same `opportunity_id` and same `request_type` within open statuses.
2. Existing project already linked to same `opportunity_id` (already present behavior, keep).
3. Similar project name match score above threshold.

Block when:
1. Exact duplicate idempotency key replay in create window.
2. Same opportunity + same phase + same request type already created in previous N minutes via this flow (hard dedupe guard).

### 1.9 Audit logging requirements
Must log `audit_events` entries for:
1. Opportunity eligibility evaluated (snapshot of status/stage/signed/source).
2. Mapping action selected (which of 3 mapping paths).
3. Client creation or client/project remap with before/after.
4. Project shell creation (or existing project attachment).
5. Ticket creation (with opportunity/project/client linkage ids).
6. Engineering work items spawned.
7. Duplicate warning acknowledgements and override confirmations.

Also include correlation id per flow run across all audit rows.

### 1.10 Permission rules
Use existing entity-action model; add one explicit action gate for conversion endpoint.

Recommended ability matrix:
- **PROJECT_DEVELOPER**
  - View eligible opportunities ✅
  - Create engineering ticket from opportunity ✅
  - Create new client/project shell ✅ (within flow)
- **ENGINEERING (ENGINEER / ENGINEERING_MANAGER)**
  - View eligible opportunities: Manager ✅, Engineer optional read-only
  - Create from opportunity: Engineering Manager ✅, Engineer ❌ by default
  - Edit spawned engineering work items: per existing `eng_tasks` permissions
- **ADMIN (COO_ADMIN / CEO_ADMIN)**
  - Full create/override/audit visibility ✅
- **COO (COO_ADMIN)**
  - Full access + override confirmations + governance views ✅

---

## 2) Target data model changes

## 2.1 Minimal-change approach (recommended)
No mandatory new core tables for v1.

Additions:
1. `pd_tickets`:
   - `origin` (enum/text): `manual`, `opportunity_conversion`
   - `phase_context` (text): selected phase/template context
   - `dedupe_key` (text, nullable, indexed)
2. `project_info`:
   - `project_shell_status` (text enum suggested below)
   - `origin` (text): `manual`, `opportunity_shell`
3. Optional index set:
   - `pd_tickets(opportunity_id, project_id, request_type, status)`
   - partial unique or functional dedupe index if policy finalized

## 2.2 Suggested status enums
### Project shell statuses
- `shell_draft`
- `shell_active`
- `shell_promoted`
- `shell_archived`

### Engineering ticket statuses (PD ticket for this flow)
- `Draft`
- `Mapped`
- `Ready for Engineering`
- `In Progress`
- `Blocked`
- `Completed`
- `Cancelled`

(Reuse existing statuses where possible; only add if current status set cannot express readiness stage.)

---

## 3) Target API/service changes

### 3.1 New endpoints
1. `GET /api/opportunities/eligible-for-engineering`
   - server-side ACTIVE filter applied
   - supports pagination/search/sort
2. `POST /api/opportunities/:id/create-engineering-ticket`
   - single orchestrator command endpoint
   - takes mapping mode + template/custom payload

### 3.2 Orchestrator service (new)
`OpportunityEngineeringTicketService.createFromOpportunity(input, actor)`

Responsibilities (single transaction):
1. Lock + load opportunity.
2. Validate eligibility (ACTIVE rules).
3. Resolve mapping path (A/B/C).
4. Create/update client/project as needed.
5. Create PD ticket with opportunity+project linkage.
6. Spawn engineering work item(s) according to selected mode.
7. Write audit trail + return summary object.

### 3.3 Reuse existing services/routes
- Reuse existing client id generator and client creation behavior.
- Reuse existing project creation internals (`project_info` + split sync + phase history).
- Reuse existing PD task spawn logic and engineering task creation paths where feasible.
- Reuse existing permission middleware and role matrix.

### 3.4 Idempotency and concurrency
- Require `Idempotency-Key` header for conversion endpoint.
- Persist key + result hash for replay-safe response.
- Guard against concurrent conversions on same opportunity with row-level lock or advisory lock.

---

## 4) Target UI changes

### 4.1 Opportunities page enhancements
- Add toggle/tab: **All Opportunities** vs **Engineering Intake (Eligible)**.
- Eligible mode calls new endpoint only.
- Row shows badges: Pipedrive, Active, Signed?, Existing project link, Existing ticket count.

### 4.2 Create Engineering Ticket wizard
- Step 1: Opportunity snapshot (read-only)
- Step 2: Mapping choice (A/B/C)
- Step 3: Template mode
  - Phase Template: phase + template preview
  - Custom: request type + selected/custom tasks
- Step 4: Dedupe warnings
- Step 5: Confirm + create

### 4.3 Success and traceability UX
- Success drawer with all linked ids and direct navigation links:
  - opportunity detail
  - project detail
  - PD ticket detail
  - engineering tasks board filtered by `pd_ticket_id`

---

## 5) Validation rules

### 5.1 Opportunity-level validation
- Must be Pipedrive source.
- Must pass ACTIVE rules.
- Must not be deleted.

### 5.2 Mapping validation
- Mapping path must be one of A/B/C.
- Existing IDs must exist and be active.
- Client/project mismatch requires explicit user confirmation and elevated permission if policy demands.

### 5.3 Ticket/template validation
- Must choose either `phase_template` or `custom`, not both.
- Template mode requires valid phase (and active template availability).
- Custom mode requires request type and at least one task or explicit “no tasks” confirmation.

### 5.4 Dedupe validation
- Hard block duplicate idempotency replay.
- Hard block policy-defined near-duplicate (same opportunity+phase+type within cooldown window).
- Non-blocking warnings for historical similar tickets.

### 5.5 Audit validation
- If any creation/update succeeds but audit write fails: treat as failed transaction (all-or-nothing for this endpoint).

---

## 6) Acceptance criteria

### Functional
1. Eligible list shows only Pipedrive ACTIVE opportunities.
2. Won/lost/closed/signed opportunities never appear in eligible list.
3. User can create Engineering ticket via all 3 mapping paths.
4. First-ticket path can create project shell when project does not exist.
5. Created ticket is linked to both opportunity and project.
6. Engineering work item(s) are linked back to created ticket.
7. Multiple tickets across phases are supported.

### Governance
8. Duplicate warning appears in qualifying scenarios.
9. Hard dedupe blocks exact duplicate conversion attempts.
10. Full audit trail exists with correlation id and mapping decisions.

### Permissions
11. Project Developer can execute flow.
12. Engineering Manager can execute flow (per policy).
13. Engineer access follows policy (read-only or blocked create).
14. Admin/COO can execute and override where configured.

### Non-functional
15. Endpoint is idempotent and concurrency-safe.
16. Existing manual PD ticket and project creation flows remain unchanged.

---

## 7) Phased implementation plan (lowest-risk order)

### Phase 0 — Contracts and flags
- Finalize eligibility rule constants and duplicate policy.
- Add feature flag: `opportunity_eng_ticket_flow_v1`.

### Phase 1 — Read path first (safe)
- Build `eligible-for-engineering` endpoint + tests.
- Add read-only UI intake mode with no create actions.

### Phase 2 — Service skeleton + dry-run
- Implement orchestrator service with dry-run validation mode.
- Return warnings and planned actions without writes.

### Phase 3 — Write path with minimal schema additions
- Add required nullable columns/indexes.
- Enable real create command behind flag for Admin/COO only.

### Phase 4 — Expand role access
- Roll out to Project Developer + Engineering Manager.
- Monitor duplicates, failures, and audit coverage.

### Phase 5 — Hardening
- Add dashboard metrics (conversion success, dedupe blocks, mapping mix).
- Refine UX copy and warning thresholds.
- Decide whether v2 needs dedicated mapping table.

---

## Reuse vs new build summary

### Reuse
- Pipedrive sync ingestion and local opportunities table
- Permission middleware and role matrix
- Client/project creation primitives
- PD ticket + engineering work item creation primitives
- Template infrastructure and audit infrastructure

### New build
- Eligibility endpoint and canonical ACTIVE rule function
- Conversion orchestrator endpoint/service
- Wizard UX for mapping + template mode
- Idempotency + dedupe controls specific to conversion flow
- Additional status/origin metadata on tickets/projects (minimal schema extension)
