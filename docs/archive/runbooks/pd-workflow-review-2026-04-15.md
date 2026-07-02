# PD Workflow Review & Safe Separation Fixes (2026-04-15)

Status: live review. Safe fixes implemented on branch
`claude/improve-pipedrive-integration-2cllX`. No existing handover,
project linkage, Pipedrive sync, or client records were touched.

Scope is limited to the **commercial opportunity → PD work queue →
project spine → PD→PM handover** chain. Compliance and HSE (which only
begin after PD hands over to PM) are explicitly out of scope.

---

## 1. Proven current-state flow

Verified by direct inspection of the following files:

- `shared/schema/projects.ts` — `clients` (19-43), `opportunities` (74-111),
  `projectInfo` (105-140), `pdTickets` (500-541), `projectPdPmHandover`
  (1139-1180), `projectHandoverGates` (1107-1135).
- `server/departments/opportunities-routes.ts` — opportunity CRUD.
- `server/pd-routes.ts` — PD ticket CRUD + task spawning.
- `server/handover-routes.ts` + `server/departments/handover-routes.ts`
  — handover packs, checklist items, gate approval.
- `server/services/pipedrive-sync-service.ts` — read-only Pipedrive → opportunities sync.
- `client/src/pages/opportunities.tsx`, `pd-tickets.tsx`,
  `pd-ticket-create.tsx`, `pd-pm-handover-v2.tsx`, `pm-handover-review.tsx`.

The current flow, as proven by code:

1. **CRM opportunity.** Lives in Pipedrive. The sync engine does
   `GET /deals` and upserts into `opportunities` keyed on `pipedrive_deal_id`.
2. **Internal opportunity.** Also lives in the `opportunities` table, created
   by `POST /api/opportunities` from the in-app form. Before this change set,
   there was no way to tell the two apart — they shared one table with no
   origin flag.
3. **PD ticket.** `pd_tickets` is the PD work queue. A ticket **requires** a
   `project_id` to be created (`server/pd-routes.ts:404-406`), and has no
   link back to the commercial opportunity. Each ticket holds its own
   `estimatedProjectValue`, `sizeKwp`, `fundingType`, etc.
4. **Project (`project_info`).** This is the spine. Created early — from
   Excel import (`server/smart-import-routes.ts:1763`), template application
   (`server/template-routes.ts:763`), lifecycle promotion
   (`server/lifecycle-routes.ts:1537`), or manual form. `opportunity_id` is a
   nullable FK and is not required on create.
5. **PD→PM handover.** A separate table `project_pd_pm_handover` (1:1 with
   `project_info`) with its own status state machine
   (`DRAFT → SUBMITTED → ACCEPTED / REJECTED`) and sign-off timestamps.
   `project_handover_gates` records per-gate approval and
   `project_handover_history` is the audit trail.

Pipedrive sync writes **only** to `opportunities` and `clients`. It does not
touch `pd_tickets`, `project_info`, or any handover table.

---

## 2. Current-state map (text diagram)

```
                 ┌──────────────────────┐
                 │  Pipedrive CRM       │   source of truth for deals
                 │  (external)          │
                 └───────────┬──────────┘
                             │  read-only sync
                             ▼
 ┌──────────────────┐   ┌─────────────────────┐
 │ clients          │◀──│ opportunities       │   commercial pipeline
 │ (pipedrive_org_id│   │ (pipedrive_deal_id, │
 │  or internal)    │   │  source = pipedrive │
 └────────┬─────────┘   │            | internal)
          │             └──────┬──────────────┘
          │                    │
          │                    │  opportunity_id (nullable)
          │                    ▼
          │           ┌──────────────────────┐
          │           │ project_info         │   project spine
          └──────────▶│ (created via Excel,  │
                      │  template, lifecycle │
                      │  promotion, or form) │
                      └────────┬─────────────┘
                               │
                               │  project_id (required on create)
                               │  opportunity_id (NEW: nullable)
                               ▼
                      ┌──────────────────────┐
                      │ pd_tickets           │   PD work queue
                      │ (Cost Proposal,      │
                      │  Site Assessment,…)  │
                      └────────┬─────────────┘
                               │
                               │  PD work finishes
                               ▼
                      ┌──────────────────────┐
                      │ project_pd_pm_       │   handover readiness
                      │ handover (1:1 with   │   (authoritative)
                      │ project_info)        │
                      │ + handover_gates     │
                      │ + handover_history   │
                      └──────────────────────┘
```

Key points:
- The **project spine is `project_info`**. Everything downstream (tickets,
  handover, compliance, HSE) hangs off it.
- Commercial tracking (`opportunities`) and the work queue (`pd_tickets`)
  are both loosely attached to the spine — one by `opportunity_id` on
  `project_info`, the other by `project_id` on `pd_tickets`.
- **Before this change set**, PD tickets had no direct link to the
  commercial opportunity. You could only trace back via
  `pd_tickets.project_id → project_info.opportunity_id`, and the latter
  is nullable and frequently blank on imports.
- **Before this change set**, there was no way to tell a CRM-synced
  opportunity from an internal one from the row itself.

---

## 3. Workflow issues found (ranked)

1. **Two things live in one table: CRM copy and app-only pipeline.**
   `opportunities` mixed Pipedrive-synced rows and manually-created rows
   with no origin flag. Reports and UI had no way to tell which was which,
   and a PATCH could silently "own" a synced row until the next sync
   clobbered it.
2. **PD work is unlinked from commercial.** `pd_tickets` had no
   `opportunity_id`. Traceability from a PD task back to the CRM deal that
   funded it required a fragile two-hop join through `project_info`, which
   is itself loosely linked. Impossible to report "hours burned on deal
   X" or "opportunities still waiting on cost proposal".
3. **Handover readiness is double-booked.**
   `opportunities.handover_readiness` carries a seven-state enum
   (`not_ready`, `in_preparation`, `awaiting_approval`, `ready`, `submitted`,
   `accepted`, `returned`) that is a semantic duplicate of
   `project_pd_pm_handover.status`. Neither column is written from the
   code path that updates the other. Whichever one the UI or a report
   looks at first can lie.
4. **Opportunity create schema accepted dead fields.** The zod schema in
   `opportunities-routes.ts` used to declare `name: z.string()` even
   though `opportunities` has no `name` column. The field was silently
   dropped by drizzle. UI code could pass it and get a 201 back. This is
   a proof-by-footgun that the schema and the table were out of sync.
5. **Project created before the deal is real.** `project_info` can be
   inserted from Excel imports, templates, and lifecycle promotion with no
   `opportunity_id`. This is intentional today (EE tracks pipeline
   projects early), but it means a project's existence is not a truth
   signal about the deal being won. Not fixed here — structural change.
6. **`pd_tickets` required project linkage but not opportunity linkage.**
   `server/pd-routes.ts:404-406` makes `projectId` mandatory on create. A
   PD ticket therefore always points at the spine. But it still cannot
   point at the deal. This is asymmetric and hurts reporting.
7. **Handover is attached to existing project, not used to create one.**
   This is actually correct today — the handover table does not create
   `project_info`. But the UI naming and the mixed use of "opportunity
   handover readiness" + "project PD-PM handover" gives the impression
   that there are two handovers. There is only one.

---

## 4. Object-doing-another-object's-job findings

| Object      | Doing its own job? | Doing someone else's job?                                |
| ----------- | ------------------ | -------------------------------------------------------- |
| `opportunities` | Yes (commercial pipeline) | Yes — also stores a handover readiness enum that belongs to `project_pd_pm_handover`. Deprecated in this change set. |
| `pd_tickets`    | Yes (work queue)          | No — but **lacks** the opportunity link needed to do its job cleanly. Now addressed via new `opportunity_id` FK. |
| `project_info`  | Yes (project spine)       | No — but it is created too eagerly from imports/templates without an opportunity, so downstream code cannot treat its existence as "deal is real". Future work. |
| `project_pd_pm_handover` | Yes (PD→PM gate) | No. Correct single-purpose table. |

---

## 5. Minimum safe workflow corrections implemented

These changes separate the three concerns **without** changing existing
behaviour for any currently-working flow. Every change is additive.

### Change #1 — `opportunities.source` column

- Migration: `20260415_pd_workflow_separation.sql` adds
  `source text NOT NULL DEFAULT 'internal'` and backfills
  `source = 'pipedrive'` for every row that already has a
  `pipedrive_deal_id`.
- Schema: `opportunities.source` documented in `shared/schema/projects.ts`.
- Pipedrive sync service: now stamps `source: 'pipedrive'` inside the
  `crmOwnedFields` object in `syncSingleDeal()`. Every upsert from a
  Pipedrive run pins the row as CRM-owned, even if an admin flipped the
  column manually.
- `POST /api/opportunities`: forces `source: 'internal'` on every manual
  create. The zod schema accepts `source` only as the literal `'internal'`,
  so an API caller cannot pretend to mint a CRM row.
- `PATCH /api/opportunities/:id`: strips `source` and `pipedriveDealId`
  from the update payload before writing. Also returns a `_warning`
  string when a CRM-owned field is edited on a Pipedrive-sourced row, so
  the UI can surface "this will be overwritten on the next sync".

Impact: unambiguous origin per row. Downstream code and reports can
filter pipeline / dashboards / conflict warnings by `source`.

### Change #2 — `pd_tickets.opportunity_id` column

- Migration: adds `opportunity_id integer REFERENCES opportunities(id) ON DELETE SET NULL`
  and `ix_pd_tickets_opportunity_id` (partial, not null).
- Schema: `pdTickets.opportunityId` added with a JSDoc explaining that
  it is nullable on purpose.
- `POST /api/pd/tickets`: accepts `opportunityId` in the body. Existing
  required fields (`projectId`, `projectSiteName`, `requestType`,
  `dueDate`) are unchanged.
- `PATCH /api/pd/tickets/:id`: `opportunityId` added to the allowed-fields
  list.

Impact: traceability from PD work back to the triggering deal becomes a
single join. Existing tickets are unaffected because the column is
nullable.

### Change #3 — Deprecate `opportunities.handover_readiness`

- `shared/schema/projects.ts`: column annotated with a JSDoc
  `@deprecated` tag pointing at `project_pd_pm_handover.status` as the
  authoritative source.
- Column is **not** dropped. The migration keeps existing values intact
  and logs the number of rows with a non-default value as a NOTICE, so
  operators can size the cleanup.
- No UI changes in this set. The opportunity form does not write to
  `handover_readiness` today, so no regression risk.

Impact: future readers get a compile-time warning. A follow-up PR can
add a read-through in any component still binding on this field.

### Change #4 — Opportunity create schema cleanup

- Dropped the dead `name` field that was accepted but had no column
  behind it.
- Added the obviously-missing fields that the `opportunities` table does
  have: `siteId`, `status`, `estimatedKwh`, `signedDate`,
  `commercialRisks`. These are all optional; the existing UI already
  omits them so this is purely additive.

Impact: API surface matches the schema. No silent drops.

---

## 6. Exact code changes

- `migrations/20260415_pd_workflow_separation.sql` (new): additive
  `source` column on opportunities, backfill, `pd_tickets.opportunity_id`,
  index, and observability NOTICEs.
- `migrations/20260415_pd_workflow_separation_rollback.sql` (new):
  symmetrical rollback.
- `shared/schema/projects.ts`:
  - `opportunities.source` column + JSDoc.
  - `opportunities.handoverReadiness` JSDoc `@deprecated` tag.
  - `pdTickets.opportunityId` column + JSDoc.
- `server/services/pipedrive-sync-service.ts`: `crmOwnedFields` now
  includes `source: "pipedrive"` so every sync upsert pins the origin.
- `server/departments/opportunities-routes.ts`:
  - Rewritten `opportunityCreateSchema`: dropped `name`, added
    `siteId`, `status`, `estimatedKwh`, `signedDate`, `commercialRisks`,
    and a restricted `source: z.literal("internal")`.
  - `POST` forces `source: "internal"` regardless of input.
  - `PATCH` strips `source` and `pipedriveDealId` from the payload,
    loads the existing row, and returns a `_warning` when the update
    touches CRM-owned fields on a Pipedrive-sourced row.
- `server/pd-routes.ts`:
  - `POST /api/pd/tickets` reads `opportunityId` from the body and
    writes it on insert.
  - `PATCH /api/pd/tickets/:id` adds `opportunityId` to `allowedFields`.

No routes were removed. No existing field was renamed or deleted. No
existing business rule was changed. The only behaviour change on
previously-passing calls is:
1. `POST /api/opportunities` no longer accepts a `name` field (it was
   already being silently dropped, so this is a fidelity fix not a
   break).
2. `PATCH /api/opportunities/:id` returns a row with an optional
   `_warning` property when editing a CRM-owned field on a synced row.
   Existing clients that ignore unknown JSON fields are unaffected.

---

## 7. Regression risks

- **Pipedrive sync upsert cost.** The sync service now writes one extra
  column (`source`) per row. Negligible overhead, but the write touches
  every row.
- **Backfill during migration.** The `UPDATE opportunities SET source =
  'pipedrive'` ran over the full table once. On EE's current row counts
  (low thousands) this is instantaneous, but on a materially larger
  environment it may hold a row-level lock briefly.
- **`opportunityCreateSchema` tightening.** The `name` field is no
  longer accepted. If any live client is sending `name`, it will now
  get a 400 on create. The in-app opportunities UI
  (`client/src/pages/opportunities.tsx:147-157`) does **not** send
  `name`, so the current UI is unaffected. Any script or integration
  that sends `name` should be fixed to stop doing so — the field was
  never being stored.
- **`PATCH /api/opportunities` payload changes.** Now enforces that
  `source` and `pipedriveDealId` cannot be mutated from outside the
  sync engine. A client that was previously flipping those fields (if
  any) will silently have them ignored. No 4xx is raised because the
  existing code path does not validate the shape strictly.
- **New `opportunityId` on pd_tickets.** Nullable and defaulted to NULL.
  Existing inserts that do not mention `opportunityId` still succeed.
- **`handoverReadiness` deprecation.** No runtime behaviour change. The
  JSDoc flag surfaces in TS tooling but does not throw or warn at
  runtime. Any code that still writes to this column keeps working.

---

## 8. Tests to add (proposed — not implemented here)

Listed in the order a QA writer should attack them. None of these were
added in this change set because this review is deliberately narrow.

1. **`opportunities source stamping`** (unit, drizzle-backed):
   - Manual POST defaults to `internal`.
   - Pipedrive sync service writes `pipedrive` on create.
   - Pipedrive sync service re-stamps `pipedrive` on update even if the
     row currently says `internal`.
   - PATCH cannot change `source`.
2. **`pd_tickets opportunity linkage`** (integration):
   - Create a ticket with `opportunityId` and verify the returned row
     reflects it.
   - Create a ticket without `opportunityId` and verify the column is
     NULL.
   - Delete the opportunity and verify the ticket's `opportunity_id`
     flips to NULL (`ON DELETE SET NULL`).
   - PATCH updates `opportunityId` correctly.
3. **`CRM field overwrite warning`** (unit, API):
   - PATCH a CRM-owned field on a `source = 'pipedrive'` row and assert
     the response contains the `_warning` string.
   - PATCH an app-only field (e.g. `notes`) on the same row and assert
     no warning is returned.
   - PATCH any field on a `source = 'internal'` row and assert no
     warning is returned.
4. **`opportunities create schema`** (unit):
   - POST with the dead `name` field returns 400 and does not insert.
   - POST with the current UI body shape still returns 201.
5. **`handover authoritative source`** (unit):
   - Assert that `project_pd_pm_handover.status` is what the handover
     gate code reads; `opportunities.handover_readiness` is never
     consulted.

---

## 9. Untouched risky areas (intentional)

These were **not** changed in this set because they each need broader
sign-off and would be a rewrite rather than a separation fix.

- **`project_info` creation timing.** Projects can still be created
  before a deal is won, from Excel/template/lifecycle paths. Formalising
  "a project is only created once an opportunity is won" is a
  significant business-rule change with broad impact on imports and
  reporting.
- **`pd_tickets.project_id` being mandatory.** The required-project
  check in `pd-routes.ts:404-406` is untouched. Making it optional would
  let tickets exist standing alone, which weakens the spine.
- **`handover_readiness` column drop.** Left in place. Dropping it is a
  schema migration with UI and report fallout and needs its own PR.
- **Commercial field duplication.** `opportunities.estimatedValue`,
  `pd_tickets.estimatedProjectValue`, `project_info.contractValue` all
  still exist independently. Unifying them is a structural redesign.
- **Opportunity → project promotion flow.** There is no controlled
  "promote opportunity to project" action today. Projects are created
  out-of-band and then optionally linked. Building a formal promotion
  action is the right long-term fix and was out of scope.
- **Currency on `estimatedValue`.** Still dropped by the Pipedrive sync.
  Tracked in the Pipedrive review runbook, not here.
- **UI surfaces.** The opportunities, PD tickets, and handover pages were
  not changed. A "synced from Pipedrive" badge on the opportunities list
  and a "link to opportunity" picker on the PD ticket form are both
  straightforward follow-ups now that the backend supports them — but
  they are UX changes and need design sign-off.
- **Unit and integration tests.** No tests were added or modified. The
  test list above is the suggested follow-up.

---

End of review.





