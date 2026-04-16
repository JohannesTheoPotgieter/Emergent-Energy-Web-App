# Project Development Opportunities → Engineering Ticket Flow Assessment (Current State)

Date: 2026-04-16

## Scope asked
- Map current architecture for Pipedrive opportunities, PD tickets, engineering tasks/tickets, and project/client linking.
- Assess gaps against target flow:
  1) active Pipedrive opportunities only
  2) exclude lost
  3) exclude signed/won/closed
  4) create engineering ticket from each opportunity
  5) choose phase template or custom
  6) create or map client/project
  7) create project shell on first ticket if no project exists
  8) link ticket to both deal and project
  9) allow multiple tickets across phases

---

## 1) Current-state architecture map

### A. How Pipedrive data enters the app
1. **Ingestion path is batch sync into local DB, not live UI fetch.**
   - `syncPipedriveDeals()` pulls deals from Pipedrive `/v1/deals`, paginates all deals, maps them, and upserts rows into `opportunities`.
   - Pipedrive-owned fields (`stage`, `status`, `clientId`, value, dates, source) are overwritten on each sync for `source='pipedrive'` rows.
2. **Sync trigger path today is admin/manual endpoint.**
   - Admin endpoint `POST /api/admin/pipedrive/sync` runs sync and writes `pipedrive_sync_log` rows.
   - `GET /api/admin/pipedrive/status` checks token presence.
3. **Opportunities screens read the local `opportunities` table via `/api/opportunities`; they do not call Pipedrive directly.**

### B. Are deals/opportunities synced or fetched live?
- **Synced** into local `opportunities` table.
- **Fetched live from app DB** by UI (`GET /api/opportunities`).
- There is no direct browser-side Pipedrive fetch path in opportunities/PD screens.

### C. Current tables/models relevant to requested domains

#### Clients / Projects / Opportunities / Tickets
- `clients` (includes `pipedrive_org_id`).
- `opportunities`:
  - `pipedrive_deal_id`, `source` (`internal` vs `pipedrive`), `client_id`, `stage`, `status`, values, dates.
- `project_info`:
  - includes optional `opportunity_id` and `client_id` links.
- `pd_tickets`:
  - includes `project_id`, optional `opportunity_id`, optional `client_id`, request type, due date, etc.

#### Engineering ticket/task model
- No active `engineering_tasks` table (explicitly dropped/deprecated).
- Engineering work uses `work_items` with `workstream='ENG'` and optional `pd_ticket_id`.
- PD ticket endpoint can create engineering work item via `POST /api/pd/tickets/:id/engineering-tasks`.

#### Templates
- PD/phase templates:
  - `phase_template`, `phase_template_item`, `phase_template_item_history`, `phase_template_application`.
- Engineering stage templates:
  - `eng_stage_templates`, `eng_task_templates`, `eng_deliverable_templates`, plus project-stage instances.
- PD request-type task templates currently come from constant `PD_REQUEST_TYPE_TASK_TEMPLATES` (code constant, not DB-managed per-request workflow).

#### Mappings
- Client/project association is direct FK (`project_info.client_id`) + history in `project_client_history`.
- Opportunity/project association is direct FK (`project_info.opportunity_id`) + optional FK on `pd_tickets.opportunity_id`.
- No dedicated generic "opportunity→engineering-ticket mapping" table.
- Existing mapping tables in broader platform are mostly other domains (e.g., QuickBooks mappings, key date mappings).

#### Audit logs
- Cross-cutting audit table: `audit_events`.
- Permission audit: `permission_audit_log`.
- Integration run health: `integration_run_events`.
- Pipedrive run log table exists and is used by admin Pipedrive routes: `pipedrive_sync_log`.
- Template and merge governance logs exist (`phase_template_item_history`, `merge_audit_log`).

### D. Current screens/views that exist

#### Project Development
- `/pd` (PD dashboard)
- `/pd/tickets`
- `/pd/tickets/create`
- `/pd/tickets/:id`
- `/opportunities`
- `/clients`, `/clients/:clientId`
- `/project-create`

#### Engineering
- `/engineering` dashboard
- `/engineering/tasks`
- `/engineering/standup`
- engineering monthly reports and project drilldowns

#### Project/Client/Ticket integration surfaces
- PD ticket create page supports:
  - client select/create
  - project select/create
  - request type and template-derived subtasks
- Project create page supports `?opportunityId=...` conversion path and warning banners.

### E. Is there already a "project shell" concept?
- **Not as a distinct model/table named project shell.**
- Current implementation creates a full `project_info` row (plus split-table sync) when creating a new project.
- In practice, this can function as a lightweight shell if minimal fields are provided, but there is no explicit shell lifecycle/state object.

### F. Is there duplicate detection or mapping logic now?
- Yes, but partial and distributed:
  1. **Project name duplicate block** on `/api/projects` create (hard block if exact existing project name).
  2. **Similar-name warning** via `/api/projects/similar-names` (heuristic warning).
  3. **Opportunity conversion warning** if creating another project from same opportunity (warn, don’t block).
  4. **Client duplicate checks** in PD client create/update.
  5. **No hard uniqueness constraint observed for one-ticket-per-opportunity** or one-opportunity-per-ticket; multiple tickets can reference same opportunity.

### G. Permissions/roles that currently control PD/Engineering/Admin/COO
- Permission model is entity/action based (`requirePermission(...)` + shared defaults).
- Relevant entities include: `pd_tickets`, `pd_dashboard`, `pd_clients`, `opportunities`, `project_creation`, `engineering`, `eng_tasks`, `admin`, `admin_roles`.
- Role defaults show:
  - PD roles include `PROJECT_DEVELOPER`, `KEY_ACCOUNTS_MANAGER`, `CCO`, admins.
  - Engineering roles include `ENGINEERING_MANAGER`, `ENGINEER` with engineering-focused scopes.
  - `COO_ADMIN` / `CEO_ADMIN` are broad-access admin roles.

### H. Current logic likely to conflict with the target flow
1. **PD ticket create requires existing project linkage (`projectId`) and due date.**
   - Target wants first-ticket project shell creation if no project exists.
2. **Opportunities API returns all non-deleted rows unless caller filters stage.**
   - Target wants active Pipedrive-only and explicit exclusion of lost/won/closed/signed.
3. **Opportunities page permission entity mismatch risk in UI config** (`/opportunities` route tagged with `pd_dashboard` while backend route enforces `opportunities` permission).
4. **Pipedrive sync maps won/lost into local stages/status and keeps them in table; UI currently allows broad viewing/filtering.**
5. **Engineering ticket creation is tied to PD ticket detail action today, not automatic per opportunity.**
6. **Template choice in PD ticket flow is request-type constant templates, not phase-template-or-custom tied to opportunity lifecycle.**

---

## 2) Gap analysis against target flow

### Target: Show active Pipedrive opportunities only
- **Current:** `/api/opportunities` includes both internal and pipedrive rows and all statuses unless caller-side filters.
- **Gap:** Need server-side canonical filter preset for the new flow (source + status/stage constraints).

### Target: Exclude lost; exclude signed/won/closed
- **Current:** Won/lost exist in opportunities and are visible; signed info is stored on opportunity; no dedicated “flow list” endpoint that excludes these statuses.
- **Gap:** Need deterministic eligibility rule and endpoint/query contract.

### Target: Create engineering ticket from each opportunity
- **Current:** Engineering work item creation is manual from PD ticket; no auto-materialization from opportunity list.
- **Gap:** Need orchestration that guarantees 1+ engineering ticket(s) per eligible opportunity and prevents accidental duplicates.

### Target: choose phase template or custom
- **Current:** Project create auto-applies active phase template by phase; PD ticket create uses request-type template constants; no opportunity-driven “phase-template-or-custom” chooser in this flow.
- **Gap:** Need UI + API contract to choose template mode at ticket creation from opportunity.

### Target: create or map client/project
- **Current:** Both are supported separately in PD ticket create and project create/conversion.
- **Gap:** Need this to be first-class in opportunity→engineering ticket wizard, with clear conflict handling.

### Target: create project shell on first ticket if no project exists
- **Current:** Ticket creation requires pre-existing project ID; project creation is separate/manual.
- **Gap:** Introduce conditional inline project creation in the same flow, and define what a “shell” means technically.

### Target: link ticket to both deal and project
- **Current:** `pd_tickets` already supports both `opportunity_id` and `project_id`; `work_items` supports `pd_ticket_id`.
- **Gap:** Enforce linkage consistently for this new flow and expose in UI/read models.

### Target: allow multiple tickets across phases
- **Current:** Data model already allows multiple tickets per opportunity/project; no strict uniqueness blocking.
- **Gap:** Need governance rules for intentional multi-phase ticketing (naming, dedupe, state progression).

---

## 3) Required changes grouped by area

### UI
1. Add dedicated **Opportunities → Engineering Ticket intake view** (or mode) with hard server-backed filters:
   - source = pipedrive
   - active only (exclude lost/won/closed/signed per agreed rule)
2. Add **Create Engineering Ticket** action from eligible opportunity row.
3. Add guided flow steps:
   - map/create client
   - map/create project shell
   - choose phase template vs custom
   - confirm deal+project linkage
4. Surface linkage badges on ticket detail: deal id/source/status + project id/name.
5. Add explicit duplicate warnings (existing active ticket(s) for same opportunity + phase).

### Backend/API
1. New eligibility endpoint or query mode, e.g. `/api/opportunities/eligible-for-engineering`.
2. New command endpoint for opportunity-driven ticket creation, e.g. `/api/opportunities/:id/create-engineering-ticket`.
3. In one transaction:
   - validate opportunity eligibility
   - resolve/create client
   - resolve/create project shell (if needed)
   - create PD/engineering ticket(s)
   - create linked engineering work item(s)
   - audit all steps
4. Add idempotency/duplicate guard strategy (request key or uniqueness policy).
5. Keep existing manual paths functional while introducing new orchestrated path.

### Database
1. Decide if existing tables are enough (likely yes for v1):
   - `pd_tickets.opportunity_id` + `project_id`
   - `project_info.opportunity_id`
2. Optional but recommended:
   - add explicit index/constraint for common lookup (`opportunity_id`, `project_id`, `request_type`, active-state).
   - consider a dedicated lifecycle/status field to mark “ticket phase” if multiple phase tickets become core behavior.
3. If “project shell” needs explicit state, add column/table (e.g., `project_origin='opportunity_shell'` or `project_shell_status`).

### Permissions
1. Align route/page permission entity for `/opportunities` with backend `opportunities` entity to avoid access drift.
2. Define which roles can execute opportunity→engineering ticket conversion:
   - likely Project Developer, Engineering Manager, Admin/COO (policy decision).
3. Ensure engineering users who must act on converted tickets can view linked context without over-broad PD access.

### Validation / Governance
1. Canonical eligibility rule for “active” deal (single source of truth in backend).
2. Duplicate policy:
   - allow multiple tickets across phases
   - prevent accidental duplicate in same phase/status window.
3. Audit requirements:
   - log opportunity eligibility snapshot at conversion time.
   - log client/project mapping decisions and auto-created shell events.
4. Data ownership boundary:
   - continue preserving CRM-owned fields for pipedrive-sourced opportunities.

---

## 4) Recommended implementation order

1. **Policy & data contract first**
   - finalize eligibility definition and duplicate policy.
2. **Backend orchestrator + tests**
   - create conversion endpoint with transactional behavior and audit logging.
3. **UI flow (wizard) on top of new endpoint**
   - opportunity list filter + conversion wizard.
4. **Permission alignment**
   - fix `/opportunities` permission entity mismatch and validate role matrix.
5. **Governance hardening**
   - add observability dashboards, conflict metrics, and operational runbook.
6. **Progressive rollout**
   - feature-flag by role (start with COO/Admin + PD lead), then expand.

---

## 5) Risks of breaking existing logic

1. **PD ticket create assumptions**
   - existing flow enforces pre-linked project and due date; changing this globally could regress current SLA/governance checks.
2. **Opportunity sync overwrite behavior**
   - if new flow writes fields currently treated as CRM-owned, sync may overwrite unexpectedly.
3. **Permission regression risk**
   - existing mismatch between UI route gating and backend entity permission can create accidental lockout or overexposure during refactor.
4. **Duplicate project/ticket proliferation**
   - without strict idempotency and phase-aware duplicate rules, opportunity conversion can create noisy duplicates.
5. **Template coupling risk**
   - phase-template and request-type template systems are separate today; naive merge could duplicate generated work items.
6. **Reporting/KPI drift**
   - dashboards currently mix PD ticket and opportunity counts in different places; new status semantics may change KPI baselines if not coordinated.

---

## High-confidence summary
- The app already has most core primitives needed (opportunities, PD tickets, project linkage, optional opportunity linkage, engineering work items, templates, audit logs).
- Main work is orchestration + governance: a single authoritative conversion flow, strict eligibility filters, explicit dedupe/idempotency, and permission alignment.
