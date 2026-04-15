# Pipedrive Integration — Review & Safe Fixes (2026-04-15)

Status: live review. Safe fixes implemented on branch
`claude/improve-pipedrive-integration-2cllX`. Structural fixes listed as
future work and **not** implemented in this change set.

Scope is limited to the Pipedrive → Opportunities read-only sync path.
No PD, handover, project, or client business logic was touched.

---

## 1. Proven current-state behaviour

Verified by direct inspection of these files:

- `client/src/pages/admin-pipedrive.tsx` — admin UI, manual trigger + log.
- `server/departments/pipedrive-routes.ts` — 3 endpoints (status, sync-log, sync).
- `server/services/pipedrive-sync-service.ts` — deal fetch + upsert engine.
- `shared/schema/projects.ts:19-100` — `clients`, `opportunities` tables.
- `migrations/20260349_enrich_client_entity.sql` — added `clients.pipedrive_org_id`.
- `migrations/20260351_create_opportunities_table.sql` — opportunities table.
- `migrations/20260360_pipedrive_sync.sql` — `pipedrive_sync_log` table.
- `shared/schema/integrations.ts` + `server/services/integration-health-service.ts`
  — integration health registry.

Proven facts:

- Trigger: **manual only**, admin button on `/admin/pipedrive`. No cron, no
  webhook. The integration seed metadata claims "nightly + manual" but
  `server/bootstrap/start-runtime-services.ts` does not schedule anything.
- Direction: **read-only** from Pipedrive. No `POST`/`PUT`/`DELETE` against
  the Pipedrive API anywhere in the codebase.
- Transport: `GET https://api.pipedrive.com/v1/deals?start=…&limit=100`,
  paginated with a 150 ms pause between pages.
- Matching:
  - Opportunity by `opportunities.pipedrive_deal_id = deal.id` (as text).
  - Client by `clients.pipedrive_org_id = deal.org_id.value` (as text).
  - If no client match, a new `clients` row is inserted with
    `clientId = "PD-<orgId>"`, `name = deal.org_id.name`, `status = "prospect"`.
- Error handling: per-deal try/catch, continues on error. Status classified
  as `success` / `partial` / `failure` inside the service and logged to
  `integration_run_events`.
- Health: written via `recordIntegrationRun({ name: "pipedrive", … })`.
  Healthy window = 25 h. Alerting hook wired in `integration-alert-monitor`.
- Tests: only `qa/tests/unit/integration-health-derivation.test.ts` references
  Pipedrive (seed membership check). No unit tests on the sync engine itself.

---

## 2. Integration boundary definition

- **Pipedrive** is the CRM source of truth for deals and organisations, up to
  the point of controlled internal handover to PM.
- **The app** holds a **read-only synced copy** inside the `opportunities`
  table, plus app-side fields that Pipedrive does not own.
- **SharePoint** is the document source of truth (unchanged, out of scope).
- **Write-back to Pipedrive is explicitly forbidden** in this change set.

Pipedrive-owned fields on `opportunities` (sync may overwrite on update):

| Field              | Pipedrive source         |
| ------------------ | ------------------------ |
| pipedriveDealId    | `deal.id`                |
| clientId           | `deal.org_id.value` (via `clients.pipedrive_org_id`) |
| stage              | `deal.status` → mapping table |
| status             | `deal.status`            |
| estimatedValue     | `deal.value`             |
| expectedCloseDate  | `deal.expected_close_date` |
| signedDate         | `deal.won_time`          |

App-owned fields on `opportunities` (sync must **not** overwrite):

- `notes` (was being overwritten — now fixed)
- `siteId`, `dealOwnerUserId`, `contractType`, `fundingType`
- `estimatedKwp`, `estimatedKwh`
- `proposalIssuedDate`, `handoverReadiness`, `commercialRisks`

Client auto-creation is the **only** write path from sync that creates a new
business entity row outside of `opportunities`. It targets exactly one table
(`clients`) with conservative defaults (`status: "prospect"`,
`clientId: "PD-<orgId>"`).

---

## 3. Field mapping matrix

| Pipedrive source field     | App target field                      | Owner of truth | Editable in UI?              | Risks / notes |
| -------------------------- | ------------------------------------- | -------------- | ---------------------------- | ------------- |
| `deal.id`                  | `opportunities.pipedrive_deal_id`     | Pipedrive      | n/a (not shown)              | No UNIQUE constraint today — see problem #4. |
| `deal.title`               | `opportunities.notes` (create-only)   | App            | Yes                          | Previously overwritten on every sync (bug, now fixed — see fix #1). Seeded only on create. |
| `deal.value`               | `opportunities.estimated_value`       | Pipedrive      | Yes (but overwritten by sync)| Currency is discarded (see problem #5). |
| `deal.currency`            | — (dropped)                           | —              | —                            | **Discarded silently.** Structural fix #1. |
| `deal.status`              | `opportunities.stage`                 | Pipedrive      | Yes (overwritten)            | Open → always `qualification`. No stage_id mapping (problem #3). |
| `deal.status`              | `opportunities.status`                | Pipedrive      | Yes (overwritten)            | open→active, won→won, lost/deleted→lost. |
| `deal.expected_close_date` | `opportunities.expected_close_date`   | Pipedrive      | Yes (overwritten)            | Passed as-is, no validation. |
| `deal.won_time`            | `opportunities.signed_date`           | Pipedrive      | Yes (overwritten)            | `split(" ")[0]` — fragile on non-space separators (problem #6). |
| `deal.org_id.value`        | `clients.pipedrive_org_id`            | Pipedrive      | No                           | No UNIQUE constraint today (problem #4). |
| `deal.org_id.name`         | `clients.name` (create-only)          | App            | Yes                          | Only used on auto-create. Safe. |
| `deal.owner_id.email`      | — (dropped)                           | —              | —                            | **Parsed but never written.** Structural fix #2. |
| `deal.stage_id`            | — (dropped)                           | —              | —                            | Parsed but unused. Structural fix #3. |
| `deal.pipeline_id`         | — (dropped)                           | —              | —                            | Parsed but unused. |
| `deal.update_time`         | — (dropped)                           | —              | —                            | Missing drift signal. Structural fix #4. |

All opportunity fields are still freely editable in the UI. There is no lock
on CRM-owned fields today. See problem #9 and structural fix #5.

---

## 4. Problem list (ranked by severity)

1. **`opportunities.notes` was overwritten on every sync.** Any user-entered
   note was silently clobbered to `"Pipedrive: <deal title>"` on the next
   run. **High severity, silent data loss.** *(Fixed — see fix #1.)*
2. **Sync log status mismatch between service and route.** The service
   classifies runs as `success` / `partial` / `failure`; the route wrote
   `completed` / `failed` only, collapsing the `partial` state. The admin UI
   therefore showed a green "completed" badge on runs that had errors.
   **Medium-high, misleading observability.** *(Fixed — see fix #2.)*
3. **No concurrency guard.** Two admins clicking "Sync Now" simultaneously
   produced two in-flight runs writing to the same rows and emitting
   duplicate integration health events. **Medium, race condition.**
   *(Fixed — see fix #3.)*
4. **No UNIQUE constraint on `pipedrive_deal_id` / `pipedrive_org_id`, and
   no index at all.** The sync service acknowledges this with race-recovery
   code in `syncSingleDeal()`. Duplicate rows for the same Pipedrive key are
   possible and every lookup is a seq scan. **Medium, soft data integrity
   risk + perf.** *(Partially addressed — see fix #4. Unique constraint
   deferred to future work because it requires a dedup pass first.)*
5. **Currency silently discarded.** `deal.currency` is parsed but never
   stored. `estimated_value` has no currency context in the schema.
   **Medium, data fidelity.** *(Future work — structural fix #1.)*
6. **Stage mapping is simplistic.** `open` → always `qualification`.
   `deal.stage_id` and `deal.pipeline_id` are parsed and discarded. The
   code comment on line 50 already acknowledges this as incomplete.
   Downstream PD dashboards cannot distinguish "new inbound" from
   "negotiation" because everything sits in one bucket. **Medium, pipeline
   truth distortion.** *(Future work — structural fix #3.)*
7. **`deal.owner_id` is parsed but never written.** `deal_owner_user_id`
   column on `opportunities` exists but is never populated by sync. Ownership
   is therefore unknown on every synced opportunity. **Medium, attribution
   gap.** *(Future work — structural fix #2.)*
8. **Stale `running` sync log rows were never cleaned.** A process crash
   mid-sync left the log entry in `running` forever. **Low, visibility
   smell.** *(Fixed — see fix #3.)*
9. **No "synced from Pipedrive" UI indicator, no field locking.** Users see
   no visual distinction between a CRM-owned synced opportunity and an
   app-only one, and cannot tell which fields will be overwritten by the
   next sync. **Medium, trust gap.** *(Future work — structural fix #5.)*
10. **No drift indicator.** `deal.update_time` is not captured, so the app
    cannot show "last updated in Pipedrive at …" or detect CRM edits
    between syncs. **Low, observability gap.** *(Future work — structural
    fix #4.)*
11. **`signedDate` parsing is fragile.** `deal.won_time.split(" ")[0]`
    assumes a space separator. Pipedrive returns ISO-style `YYYY-MM-DD HH:MM:SS`
    today so this works, but a format change silently produces nulls rather
    than erroring. **Low.**
12. **Nightly schedule claim is false.** Integration seed metadata states
    `ownerProcess: "pipedrive-sync-service (nightly + manual)"` but no cron
    wiring exists. **Low, doc/metadata lie.**
13. **No unit tests on the sync engine.** Only the seed membership is
    asserted. `syncSingleDeal`, client auto-create, and error classification
    are untested. **Medium, regression risk.**

---

## 5. Safe quick fixes implemented

### Fix #1 — Stop overwriting `opportunities.notes`

File: `server/services/pipedrive-sync-service.ts` (`syncSingleDeal`).

- Introduced a `crmOwnedFields` object that contains **only** the fields
  Pipedrive owns (`pipedriveDealId`, `clientId`, `stage`, `estimatedValue`,
  `expectedCloseDate`, `signedDate`, `status`, `updatedAt`).
- On `UPDATE` the service now writes only `crmOwnedFields`, leaving `notes`
  (and every other app-owned field) untouched.
- On `INSERT` the service seeds `notes` once with `"Pipedrive: <title>"` so
  the record is still recognisable. Subsequent syncs do not re-touch it.

Impact: user-entered notes on a synced opportunity are no longer clobbered.
CRM fields still resync on every run.

### Fix #2 — Surface `partial` sync status truthfully

File: `server/departments/pipedrive-routes.ts`.

- The route now classifies the final log row as
  `completed` (no errors) / `partial` (errors but progress) / `failed`
  (no progress), matching the service-side classification.
- Admin UI (`client/src/pages/admin-pipedrive.tsx`) now renders `partial`
  with an amber badge and the error count, so a silent regression does not
  masquerade as green.
- The toast on completion now distinguishes "Sync partially completed" from
  "Sync failed" from "Sync completed".

Impact: operators can actually see when a sync was only partially
successful without expanding every log row.

### Fix #3 — Concurrency guard + stale-running sweep

File: `server/departments/pipedrive-routes.ts`.

- On each POST to `/api/admin/pipedrive/sync`, the route first sweeps any
  `pipedrive_sync_log` row that has been in `running` state for more than
  30 minutes and marks it `failed` with an explanatory error message.
  Guards against a crashed process blocking future syncs forever.
- After the sweep, the route checks for any remaining `running` rows. If one
  exists (i.e. a legitimately in-flight sync), the route refuses with HTTP
  409 `Sync already in progress` and reports the offending row id +
  start time. Prevents two overlapping syncs racing on the same rows.
- The outer try/catch now ensures the log row is updated to `failed` if the
  sync throws, so the row never leaks in `running` state during this
  request.

Impact: no more parallel syncs, no more stuck `running` rows after a crash.

### Fix #4 — Performance indexes on Pipedrive keys

File: `migrations/20260415_pipedrive_sync_indexes.sql`
(+ `..._rollback.sql`).

- Adds `ix_opportunities_pipedrive_deal_id` (partial, WHERE NOT NULL).
- Adds `ix_clients_pipedrive_org_id` (partial, WHERE NOT NULL).
- Emits `RAISE NOTICE` counts of duplicate pipedrive_deal_id /
  pipedrive_org_id groups so operators can see whether a future
  unique-index migration is safe to run.

Why non-unique today: the sync service already contains race-recovery code
because duplicate rows can happen. Slapping a UNIQUE constraint on a live
database without a dedup pass would fail the migration and leave the
integration broken. Dedup + unique is tracked under structural fix #6.

Impact: deal-by-deal lookups during a full sync drop from O(n) to O(log n),
and operators get a precise dedup signal before the next step.

### Fix #5 — Admin UI truth & visibility

File: `client/src/pages/admin-pipedrive.tsx`.

- Always-visible **Integration boundary** banner (even when configured)
  stating: "read-only", the exact list of CRM-owned fields, and the fact
  that app-owned fields are not touched.
- New **"Last Successful Sync"** tile next to "Last Sync Attempt". Admins
  can now distinguish "something is still running / last run failed" from
  "we haven't had a green sync in N days".
- New red warning card when the API is configured but there is no
  successful run on record, pointing users at the history for the failures.
- Error list now uses a safe `parseErrors` helper rather than a bare
  `JSON.parse` (which would throw for any non-JSON string and crash the
  page). Errors render as a bullet list with their count.
- Partial sync status rendered with an amber badge.

---

## 6. Structural fixes (proposed — NOT implemented)

These change the schema or the UX contract and therefore need explicit sign-off
before being merged. Do not sneak them into this change set.

1. **Store currency alongside `estimated_value`.** Add
   `opportunities.estimated_value_currency` (text, default `"ZAR"` for EE's
   domain). Persist `deal.currency` on sync. Surface on opportunity cards.
2. **Map `deal.owner_id.email` to `opportunities.deal_owner_user_id`.** Look
   up the `users` table by email; fall back to null if unknown. Log a
   warning the first time an unknown owner email is seen, so it is visible
   in the sync log.
3. **Respect Pipedrive pipeline and stage.** Add a small config table
   `pipedrive_stage_map(pipedrive_stage_id, app_stage)` and let the admin
   page edit it. Default mapping derived from the pipeline seeded once.
   Fall back to today's status-based mapping if the deal's stage_id is not
   in the table.
4. **Capture `deal.update_time` as `opportunities.pipedrive_updated_at`.**
   Show it on opportunity details ("CRM last updated 2 days ago"). Enables
   drift detection without another API round-trip.
5. **UI: "Synced from Pipedrive" badge + field-level lock indicators.**
   Render CRM-owned fields on the opportunity form as visually distinct
   (read-only-looking or with a "will be overwritten on next sync" tooltip).
   Keep them editable behind an explicit "unlink from Pipedrive" action,
   which should also null out `pipedrive_deal_id` so the next sync cannot
   re-link. This is a UX-significant change and must be reviewed.
6. **Dedup pass + UNIQUE constraints on Pipedrive keys.** Once the dup
   counts from the migration NOTICE are zero, ship a second migration
   promoting both indexes to `CREATE UNIQUE INDEX … WHERE … IS NOT NULL`.
   Remove the race-recovery fallback from `syncSingleDeal()` at the same
   time.
7. **Wire a real scheduler** (nightly or 6-hourly) so the seed metadata
   reflects reality. Hook it into `server/bootstrap/start-runtime-services.ts`
   with the existing job-queue primitives. Add a feature flag so it can be
   toggled off per environment.
8. **Unit tests** for `syncSingleDeal()`: covers client auto-create,
   duplicate client race recovery, stage mapping defaults, per-deal error
   isolation, and the create-vs-update branching that protects `notes`.

---

## 7. Exact code changes made

- `server/services/pipedrive-sync-service.ts`:
  `syncSingleDeal` now separates `crmOwnedFields` from the create-only
  `notes` seed. Updates write only CRM-owned fields.
- `server/departments/pipedrive-routes.ts`: added the stale-running sweep,
  the 409 concurrency guard, the try/catch that ensures the log row never
  leaks in `running` state, and the mapping to `partial` sync status.
- `migrations/20260415_pipedrive_sync_indexes.sql` (new): partial btree
  indexes on `opportunities.pipedrive_deal_id` and `clients.pipedrive_org_id`
  plus a NOTICE reporting current duplicate counts.
- `migrations/20260415_pipedrive_sync_indexes_rollback.sql` (new): rollback.
- `client/src/pages/admin-pipedrive.tsx`: integration-boundary banner,
  `partial` badge styling, `parseErrors` helper, last-successful-sync tile,
  no-successful-sync warning, safer error list rendering, distinguished
  toast messages for partial/failed/success.
- `docs/runbooks/pipedrive-integration-review-2026-04-15.md` (this file).

No schema migrations touch existing columns. No data migrations. No
changes to the `opportunities` or `clients` table structure.

---

## 8. Regression risks

- **Opportunity notes now persist across syncs.** If any downstream reader
  was relying on the notes field being "always `Pipedrive: <title>`", it
  will now see whatever the user typed. Search the codebase for
  `Pipedrive:` in notes-related code before assuming this is fine — I did
  not find such a reader, but this is the single riskiest behavioural
  change in this set.
- **Concurrency guard returns HTTP 409.** If any existing tooling blindly
  POSTs `/api/admin/pipedrive/sync` and treats non-2xx as fatal, it will
  now error when a sync is already running. The admin UI handles this
  through the existing `onError` toast and does not break.
- **Stale-running sweep marks old `running` rows as `failed`.** Anyone
  watching historical logs will see new `failed` rows appear for
  pre-existing crashed syncs. This is intentional — those rows were
  already dead, just invisible — but it may look like a regression on
  first sight.
- **Admin UI error list format changed.** A pre-existing sync row with a
  non-JSON `errors` string will now render as a single-item list instead
  of crashing the page. Safer, but different from before.
- **New indexes on two hot tables.** Index creation is online (no
  `CONCURRENTLY` used because migrations already run in a transaction);
  on a very large `opportunities`/`clients` table the migration could
  hold a brief lock. EE's current data volume is small enough that this
  is acceptable, but note it for larger environments.

---

## 9. Manual QA checklist

Run through these in a staging environment with
`PIPEDRIVE_API_TOKEN` set to a real token:

1. **Fresh sync**
   - [ ] Open `/admin/pipedrive`. Integration boundary banner is visible.
   - [ ] Click "Sync Now". Toast says "Sync completed" (green) with the
         deals processed / created / updated counts.
   - [ ] Sync log shows a new `completed` row, "Last Sync Attempt" and
         "Last Successful Sync" tiles both update to the same timestamp.
2. **Notes preservation (the key fix)**
   - [ ] Pick a synced opportunity in `/opportunities`. Edit `notes` to
         `"Test note — do not overwrite"`. Save.
   - [ ] Click "Sync Now" again.
   - [ ] Reload the opportunity. `notes` still says
         `"Test note — do not overwrite"`.
   - [ ] Confirm the CRM-owned fields (stage, estimated value, close date)
         still reflect the latest Pipedrive values.
3. **Partial sync rendering**
   - [ ] Temporarily break one deal (e.g. rename a required column in the
         DB, or inject a malformed value) so `syncSingleDeal` throws for
         at least one deal.
   - [ ] Click "Sync Now". Toast says "Sync partially completed"
         (destructive variant). Log row shows amber `partial` badge and
         the error count.
   - [ ] "Last Successful Sync" tile does **not** update to the partial
         run. "Last Sync Attempt" does.
   - [ ] Undo the breakage.
4. **Concurrency guard**
   - [ ] Start a sync. While it is running (tab 1), trigger another sync
         from tab 2. The second request returns HTTP 409 and a toast
         "Sync failed — Another Pipedrive sync is currently running".
5. **Stale-running cleanup**
   - [ ] Manually insert a fake row:
         `INSERT INTO pipedrive_sync_log (sync_type, started_at, status) VALUES ('manual', NOW() - INTERVAL '2 hours', 'running');`
   - [ ] Click "Sync Now". The fake row flips to `failed` with the
         abandonment message, and a fresh sync runs as normal.
6. **Admin UI edge cases**
   - [ ] With `PIPEDRIVE_API_TOKEN` unset, the banner + unconfigured
         alert still render and the sync button is disabled.
   - [ ] With a sync log row that has a non-JSON `errors` value, the page
         still renders without throwing (parseErrors fallback).
7. **Client auto-create**
   - [ ] Remove a client row that has a `pipedrive_org_id`. Run sync.
         Confirm a new `clients` row is created with `clientId = "PD-<orgId>"`,
         `status = "prospect"`, and that the opportunity is re-linked.
8. **Integration health**
   - [ ] Confirm `/api/admin/integration-health` (or wherever the health
         dashboard lives) reports Pipedrive as `healthy` after the successful
         sync, and `failing` after a forced error sync.

---

## 10. Explicit list of untouched risky areas

I deliberately did **not** change these, because each carries its own
risk and the brief was to avoid a broad rewrite:

- **Stage mapping.** `DEAL_STATUS_TO_STAGE` is untouched. All open deals
  still land in `qualification`. Fixing this requires pipeline-specific
  mapping configuration and operator approval.
- **Currency handling.** Still silently discarded. Needs a schema migration.
- **Owner mapping.** `deal.owner_id` is still parsed and dropped.
- **`opportunities` UI field locking.** Users can still freely edit
  CRM-owned fields today. A proper read-only badge + "unlink from Pipedrive"
  action is UX-significant and out of scope.
- **Nightly scheduler.** The integration still runs on manual clicks only.
- **UNIQUE constraints on `pipedrive_deal_id` / `pipedrive_org_id`.**
  Indexes only. Unique-promotion is gated on a dedup pass.
- **`pipedrive_sync_log` table design.** Kept as-is. Long term the run
  event should be recorded only in `integration_run_events` (the C1 table)
  and `pipedrive_sync_log` can be deprecated, but that is a follow-up.
- **Sync service cursor-based fetching.** Still fetches all deals on every
  run. Incremental sync using `deal.update_time` is a future optimisation.
- **Test coverage on the sync engine.** Not added in this change set — see
  structural fix #8.

---

End of review.






