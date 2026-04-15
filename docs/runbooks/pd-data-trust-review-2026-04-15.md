# PD Data Trust Review & Safe Hardening (2026-04-15)

Status: implemented on branch
`claude/improve-pipedrive-integration-2cllX`. All changes are additive
or drop-in replacements. No existing column was dropped, renamed, or
NOT-NULLed. No route removed. No permission changed. No project, client,
handover, or Pipedrive-mapping data touched.

This review closes the trust gaps that are achievable without a dedup
pass on the live DB. The gaps that require dedup are documented in
section 7 as future work and are gated by the migration's NOTICE-only
check.

---

## 1. Data trust problem list (ranked by severity)

### High severity

1. **Client-id generation race.**
   Two independent code paths generated `EE-Cxxxx` ids by reading
   `SELECT MAX/COUNT` then `INSERT`:
   - `server/pd-routes.ts` — `generateClientId()` using `count()`.
   - `server/routes/clients-extracted-routes.ts` — inline
     `MAX(SUBSTRING…)` SQL.
   Two admins clicking "create client" at the same time could both
   observe the same `max_num` and race on the `clients.client_id`
   unique constraint. The loser received a 500.
2. **`opportunities.pipedrive_deal_id` not unique.**
   The sync service carries a race-recovery fallback in
   `syncSingleDeal()` precisely because the schema does not enforce
   uniqueness. Two concurrent sync runs (or a sync + a manual edit
   that creates a row) can produce duplicate opportunity rows for the
   same deal. Reporting is then unreliable.
3. **`clients.pipedrive_org_id` not unique.**
   Same problem in the client-auto-create path. The sync retries on
   conflict but can still create duplicate rows for the same org.

### Medium severity

4. **`PATCH /api/clients/:id` silently dropped fields.**
   The zod schema accepted `billingEmail`, `contactPerson`,
   `contactEmail`, `contactPhone`, `notes`, `legalEntityName` — but
   only `legalEntityName` is an actual column on `clients`. The
   others were accepted as valid JSON, dropped by drizzle, and the
   response still looked like success. Users who hit this thought
   they had updated a contact email and had not.
5. **Missing audit logs.**
   - `/api/pd/clients` POST — no audit log.
   - `/api/pd/tickets` POST / PATCH — no audit log.
   - `/api/opportunities` POST / PATCH / DELETE — no audit log.
   When a PD ticket's project link changed or an opportunity's stage
   flipped, there was no record of who did it or when.
6. **`pd_tickets.project_id` required by the API but nullable in the
   schema.**
   `server/pd-routes.ts:404` rejects the request with a 400 if
   `projectId` is missing, but the DB column accepts NULL. Any future
   code path (Excel import, backfill, ad-hoc SQL) can therefore
   insert a ticket without a project linkage and the app will accept
   it. The safe fix here is an invariant check + observability, not a
   schema-level NOT NULL (which could fail the migration on
   historical rows).
7. **`opportunityCreateSchema` had a dead `name` field.**
   Fixed in the earlier PD workflow review. Documented here for
   completeness.
8. **Three opportunity columns never populated:**
   `dealOwnerUserId`, `estimatedKwh`, `proposalIssuedDate`.
   Defined in the schema, written by nothing, read by nothing in the
   UI, silently `null` on every row. Fooled anyone grepping the
   schema into thinking they were in use.

### Low severity

9. **`project_info.projectName` partial unique is correct but the
   Excel import path does not catch conflicts early.**
   The partial unique index
   `uq_project_info_project_name_active` (from
   `20260413_soft_delete_partial_uniques.sql`) is good; the risk is
   only a 500 on rare collisions rather than duplicate data.
   Unchanged in this set.
10. **No `(project_id, project_site_name, request_type)` uniqueness
    on `pd_tickets`.**
    Two Cost Proposal tickets for the same project+site can coexist.
    Sometimes legitimate (rework), sometimes a double-click. Left
    alone — documented as future work.

---

## 2. Specific assessments requested

### Client-id generation safety — **fixed**

Both code paths now share `server/lib/client-id-generator.ts`. The
helper wraps an advisory lock (`pg_advisory_xact_lock(0x43445047)`)
around the MAX-then-INSERT so concurrent create requests serialise at
the database level. The lock is held for the lifetime of the
transaction and released automatically on commit, so there is no
application-level cleanup needed and nothing to leak if the request
throws.

The helper also uses a stricter regex filter
(`client_id ~ '^EE-C[0-9]+$'`) when computing `MAX(substring)` so
imported or Pipedrive-generated ids (`PD-<orgId>`) do not pollute the
`EE-C` sequence space.

### Opportunity linkage to client / site / project — **partially fixed**

- `clientId`, `siteId`, `dealOwnerUserId` all remain nullable. This is
  correct because Pipedrive deals can legitimately exist without an
  org, and sites are not always known at proposal time.
- `pipedriveDealId` is now a **gated** UNIQUE partial index (see
  migration section below). The gate means the constraint is only
  applied if the DB already has zero duplicates; otherwise the
  migration emits a NOTICE and skips, and the sync service's
  race-recovery code continues to absorb the risk.
- The unused columns (`dealOwnerUserId`, `estimatedKwh`,
  `proposalIssuedDate`) are now annotated `@deprecated` in the
  schema so new code is warned before writing to them.

### Ticket linkage to project — **partially fixed**

- API invariant (`projectId` required on POST) is preserved.
- The migration emits a NOTICE with the current count of
  `pd_tickets.project_id IS NULL` rows so an operator can see the
  historical debt. No NOT NULL promotion — that would fail the
  migration on any pre-existing NULL row and is unsafe without a
  repair flow.
- Audit logging is added to `POST` and `PATCH /api/pd/tickets` so
  any future change to `projectId` is captured in
  `audit_events`.

### Project linkage repair surfaces — **no new repair routes added**

- The audit found only one-way backfill routes under
  `server/departments/data-backfill-routes.ts` (notably
  `POST /api/admin/backfill/opportunities-from-pd-tickets`). None of
  them is wired as a "normal" user flow; they are admin-gated and
  invoked ad hoc.
- No new repair routes are introduced by this change set because
  repair tooling that users can drive on demand risks being used as
  a substitute for getting the create path right. If the NOTICEs
  from the migration prove that cleanup is needed, a separate PR
  should introduce an explicit, observed, admin-only repair flow.

### Hidden / unused opportunity fields — **annotated**

`dealOwnerUserId`, `estimatedKwh`, `proposalIssuedDate` are now
`@deprecated` with a pointer to the relevant runbook.
`handoverReadiness` remained annotated from the earlier PD workflow
review.

---

## 3. Safe schema / app changes

### New files

- **`server/lib/client-id-generator.ts`** — `insertClientWithGeneratedId`
  and `CLIENT_ID_CONSTANTS`. Advisory-locked transaction. The lock key
  is a stable 32-bit integer (`0x43445047`); changing it breaks
  serialisation between old and new code and must not be done lightly.
- **`migrations/20260415_pd_data_trust_uniques.sql`** — gated unique
  promotion for both Pipedrive keys + a NULL-project-id observability
  NOTICE for `pd_tickets`.
- **`migrations/20260415_pd_data_trust_uniques_rollback.sql`** —
  symmetrical rollback that restores the plain btree partial indexes.
- **`docs/runbooks/pd-data-trust-review-2026-04-15.md`** — this file.

### Edited files

- **`server/pd-routes.ts`**
  - Imports `insertClientWithGeneratedId` and `logAuditFromReq`.
  - `POST /api/pd/clients` now calls the shared generator and writes
    an audit log entry (`entityType: "client", action: "create"`).
  - The stale local `generateClientId()` helper is removed; a short
    comment points to the new shared module.
  - `POST /api/pd/tickets` now writes an audit log entry
    (`entityType: "pd_ticket", action: "create"`) carrying the key
    linkage fields (`projectId`, `opportunityId`, `clientId`,
    `requestType`, `projectSiteName`, `priority`, `status`).
  - `PATCH /api/pd/tickets/:id` now writes a diff-only audit log
    entry for every field the user actually changed.
- **`server/routes/clients-extracted-routes.ts`**
  - Imports `insertClientWithGeneratedId`.
  - `POST /api/clients` now calls the shared generator; the local
    race-prone SQL is removed.
  - `PATCH /api/clients/:id` gets a new `clientUpdateSchema` that
    exactly matches the real columns (`name`, `legalEntityName`,
    `tradingName`, `clientType`, `billingEntity`,
    `primaryContactName`, `primaryContactEmail`,
    `primaryContactPhone`, `secondaryContactName`,
    `secondaryContactEmail`, `industry`, `status`). Marked `.strict()`
    so unknown fields return a 400 instead of being silently dropped.
- **`server/departments/opportunities-routes.ts`**
  - Imports `logAuditFromReq`.
  - POST writes an audit log entry with the origin flag and key
    linkage fields.
  - PATCH writes a diff-only entry; when the update touches a
    CRM-owned field on a `source = 'pipedrive'` row, the action is
    `"update_crm_field_on_synced_row"` instead of `"update"` so the
    history is searchable.
  - DELETE (soft) writes a `"soft_delete"` entry.
- **`shared/schema/projects.ts`**
  - `opportunities.dealOwnerUserId`, `estimatedKwh`,
    `proposalIssuedDate` are marked `@deprecated` with a pointer to
    this runbook. No drizzle runtime effect; TS tooling surfaces the
    tag.

### Things deliberately NOT changed

- `pd_tickets.project_id` stays nullable. A NOT NULL migration is
  blocked on the operator confirming zero NULL rows (see the NOTICE
  the migration emits).
- `opportunities.handoverReadiness` stays in place as previously
  deprecated. No UI reads or writes it today.
- No new admin "repair" routes.
- No dedup scripts. Operators must dedup manually (see section 7) and
  then re-run the unique-promotion migration.

---

## 4. Migrations

`migrations/20260415_pd_data_trust_uniques.sql`:

1. Drops `ix_opportunities_pipedrive_deal_id` and re-creates it as
   `uq_opportunities_pipedrive_deal_id` (UNIQUE, partial, `WHERE
   pipedrive_deal_id IS NOT NULL`). Skipped with a NOTICE if any
   duplicate `pipedrive_deal_id` group exists.
2. Drops `ix_clients_pipedrive_org_id` and re-creates it as
   `uq_clients_pipedrive_org_id` (UNIQUE, partial). Skipped with a
   NOTICE if any duplicate `pipedrive_org_id` group exists.
3. Emits a NOTICE with the current `pd_tickets.project_id IS NULL`
   count.

`migrations/20260415_pd_data_trust_uniques_rollback.sql`:

- Drops the UNIQUE indexes and re-creates the plain btree partial
  indexes so the rollback state matches the baseline from
  `20260415_pipedrive_sync_indexes.sql`.

---

## 5. Rollback considerations

- Rolling back is safe: the rollback migration restores the plain
  partial indexes and deletes the UNIQUE ones. Any row that was
  rejected by the unique constraint during the forward migration
  window never existed, so there is no data to restore.
- Rolling back the **server code changes** is also safe: the shared
  client-id generator is a strict upgrade over both of the previous
  paths, so reverting reintroduces the race. The audit log and
  strict-clients-schema changes can be reverted with no data impact
  because audit log inserts are `try/catch`-wrapped and never block
  the main request.
- The `@deprecated` JSDoc tags are documentation-only; reverting
  them has no runtime effect.

---

## 6. Revalidation checklist

1. **Client-id collision smoke test**
   - [ ] In two browser tabs, as an admin, press "Create client" at
         the same moment against `POST /api/pd/clients` with
         distinct names. Both should return 201 with sequential
         `EE-C` ids and no 500.
   - [ ] Same test against `POST /api/clients` (the extracted route).
   - [ ] Do one mixed test: one tab hits `/api/pd/clients` and the
         other hits `/api/clients` simultaneously. Both should
         succeed with sequential ids.
2. **Clients PATCH**
   - [ ] Send `PATCH /api/clients/:id` with `primaryContactEmail`
         set. The update persists and the audit_events row has the
         new value in `changesJson`.
   - [ ] Send `PATCH /api/clients/:id` with `billingEmail` (the old
         bogus field). Response is `400 Validation failed` with
         details. Nothing is written.
3. **PD ticket audit**
   - [ ] Create a PD ticket. Look up the new row in `audit_events`
         by `entityType='pd_ticket'` — see `requestType`, `projectId`,
         `opportunityId`, `priority`, `status`.
   - [ ] Edit the ticket's `status`. A new row appears in
         `audit_events` with only `status` and `updatedAt` under
         `changesJson.changed`.
4. **Opportunities audit**
   - [ ] Create an internal opportunity via the UI. An
         `entityType='opportunity', action='create', source='internal'`
         row appears in `audit_events`.
   - [ ] Trigger a Pipedrive sync and then manually PATCH the
         `stage` on one of the synced rows. An audit row with
         `action='update_crm_field_on_synced_row'` appears, and the
         response carries the `_warning` string as before.
5. **Migration**
   - [ ] Apply `20260415_pd_data_trust_uniques.sql`. Capture the
         NOTICE output.
   - [ ] If both UNIQUE promotions succeeded, attempt to insert two
         rows with the same `pipedrive_deal_id` into `opportunities`
         — the second must fail with a unique violation.
   - [ ] If either promotion was skipped, note the duplicate count
         and run the dedup runbook in section 7.
6. **Rollback dry-run**
   - [ ] Apply
         `20260415_pd_data_trust_uniques_rollback.sql` in a staging
         DB. The UNIQUE indexes should be gone and the plain btree
         indexes restored. Sync and opportunity routes should work
         unchanged.

---

## 7. Future work (explicit, not implemented here)

- **Dedup `opportunities.pipedrive_deal_id`.**
  For each `pipedrive_deal_id` with multiple rows, keep the newest
  and soft-delete the others. Must be scripted with an operator in
  the loop. After dedup, re-run `20260415_pd_data_trust_uniques.sql`.
- **Dedup `clients.pipedrive_org_id`.** Same shape. More dangerous
  because rows may have distinct `client_id` prefixes (`PD-…` vs
  `EE-C…`). Plan: merge into the oldest row, update FKs in
  `opportunities`, `pd_tickets`, `project_info`, then soft-delete.
- **NOT NULL on `pd_tickets.project_id`.** Gated on zero-NULL
  confirmation from the NOTICE.
- **Partial unique on
  `pd_tickets(project_id, project_site_name, request_type)`**
  where `deleted_at IS NULL`, so a double-click cannot produce two
  Cost Proposals for the same site. Needs a dedup pass first.
- **Dedicated Postgres sequence for `clients.client_id`.**
  Would replace the MAX-based generator entirely. Needs an audit of
  the existing gap-free property of the sequence.
- **Replace `opportunityCreateSchema` with `drizzle-zod`'s
  `createInsertSchema` so the zod schema cannot drift from the
  table again.**
- **Explicit repair workflow** for tickets with a NULL
  `project_id` and for opportunities that lost their `clientId`
  because the client was deleted. Needs UX design — do not ship a
  free-form "force link" button.
- **Audit log coverage on**
  `handover-routes.ts`, `lifecycle-routes.ts`, and
  `smart-import-routes.ts` write paths. Out of scope here.

---

## 8. Explicit list of untouched risky areas

- `project_info` creation paths (Excel import, template apply,
  lifecycle promotion) are unchanged. Their existing race-handling
  relies on `uq_project_info_project_name_active`, which is fine,
  but a simultaneous import + manual create can still produce a
  500.
- `project_execution_state` and `project_pd_pm_handover` creation is
  unchanged. Both are 1:1 with `project_info` already, and the
  handover-on-phase-change logic still runs.
- The Pipedrive sync engine's race-recovery fallback in
  `syncSingleDeal()` remains in place. After the UNIQUE promotion
  migration runs successfully on a given environment, that fallback
  becomes redundant, but it is intentionally left in so the code
  still works on environments where the promotion was skipped.
- No audit log entries are emitted from the Pipedrive sync itself;
  the integration-health registry still owns that coverage.
- The `clients` table still has no `deletedAt` column, so a deleted
  client can still take its `client_id` with it and block a new row
  from claiming the same id. Out of scope.

---

End of review.




