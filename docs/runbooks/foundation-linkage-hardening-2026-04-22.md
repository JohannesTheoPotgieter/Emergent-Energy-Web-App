# Foundation Linkage Hardening — 2026-04-22 (Task #34)

This runbook covers the live-data spine hardening that hardened the
chain `opportunities → project_info → pd_tickets → work_items` against
orphan rows, hidden soft-deleted records, and the long-standing
"0 of 0 tasks" display bug on PD tickets.

## 1. Background

The four core spine tables (`opportunities`, `project_info`,
`pd_tickets`, `work_items`) all carry a `deleted_at` soft-delete column
and have FK constraints between adjacent levels — except for two gaps
that this task closed:

* `work_items.pd_ticket_id` was a bare `integer` with no FK at all,
  meaning a deleted PD ticket could leave `work_items` rows pointing at
  a non-existent ID.
* `pd_tickets.deleted_at` did not exist, so the `pd_tickets` table was
  the only spine table that hard-deleted rather than soft-deleting and
  could not participate in cascade-display.

A read path in `getProjectDevelopmentWorkspace` had additionally been
hardcoded to `Promise.resolve([])` for `pdTicketTaskRows`, which made
every PD ticket card render "0 of 0 tasks" even after spawn.

Audit-time inventory of the live DB at task start:

| Anomaly | Count |
|---|---|
| `pd_tickets` with neither `opportunity_id` nor `project_id` | 11 |
| `work_items.pd_ticket_id` pointing at a missing/deleted ticket | 0 |
| `pd_tickets.project_id` pointing at a soft-deleted project | 0 |
| `project_info` rows with zero PD tickets | 99 |
| `work_items` rows with `pd_ticket_id IS NOT NULL` | 1 |

## 2. Schema changes (migration `0019_foundation_linkage_hardening.sql`)

Hand-authored, idempotent, additive. Applied via
`psql "$DATABASE_URL" -f migrations/0019_foundation_linkage_hardening.sql`.

* Adds `pd_tickets.deleted_at timestamp NULL` and a partial index
  `idx_pd_tickets_deleted_at WHERE deleted_at IS NULL`.
* Quarantines orphan `work_items.pd_ticket_id` pointers to NULL
  (the `work_items` rows themselves are preserved). RAISE NOTICE
  prints the count of cleared rows for the operator.
* Adds the missing FK
  `work_items_pd_ticket_id_fkey FOREIGN KEY (pd_ticket_id) REFERENCES pd_tickets(id) ON DELETE SET NULL`.
* Adds a partial index `idx_work_items_pd_ticket_id WHERE pd_ticket_id IS NOT NULL`.

The migration is wrapped in `BEGIN/COMMIT` and uses `IF NOT EXISTS`
guards everywhere; re-running it is a no-op.

PKs remain `serial` — no migration to UUIDs.

## 3. Code changes

### 3.1 Drizzle schema mirrors

* `shared/schema/projects.ts` — `pdTickets` gains `deletedAt: timestamp("deleted_at")`,
  excluded from `insertPdTicketSchema`.
* `shared/schema/tasks.ts` — `workItems` gains a partial index
  declaration matching the migration. The FK itself stays
  hand-managed in the migration (drizzle does not emit FKs for
  integer columns lacking `references()`).

### 3.2 Workspace service (`server/services/project-development-workspace-service.ts`)

* `pdTicketTaskRows` is now an actual SQL aggregation over
  `work_items` grouped by `pd_ticket_id` (using the same set of
  "completed" statuses recognised by `isCompletedStatus()`). PD
  ticket cards in the workspace now show real task counts.
* The `pdTickets` query in `getProjectDevelopmentWorkspace` filters
  out soft-deleted rows.

### 3.3 Cascade-display filters

Every read path that surfaces `pd_tickets` to a user gets an
`isNull(pdTickets.deletedAt)` guard:

* `server/repositories/opportunities-repository.ts` — 9 queries
  (engineering-ticket summaries/counts, drawer ticket list, shadow
  re-select, intake ticket list, intake stats, same-phase dup count,
  shadow update lookup).
* `server/pd-routes.ts` — 11 queries (list, detail, dup guard,
  PATCH lookup, DELETE lookup, templates, spawn-tasks, engineering-
  tasks, dashboard counts, pipeline, reports).
* `server/departments/opportunities-routes.ts` — 1 query (resolve-
  mapping shadow lookup).
* `server/departments/fye-revenue-tracking-routes.ts` — 1 query
  (province fallback map).

For two read paths the cascade also extends to `project_info.deleted_at`
(via `or(isNull(pdTickets.projectId), isNull(projectInfo.deletedAt))`) so
tickets attached to a soft-deleted project disappear from the PD list
and pipeline views.

### 3.4 Soft-delete on `DELETE /api/pd/tickets/:id`

The previous handler hard-deleted the `pd_ticket` and CASCADE-deleted
every `work_item` linked to it (along with `expense_task_links`,
`intake_tasks`, `project_eng_tasks`, `documents`,
`qc_item_instances`, `_deliverables_legacy`, `task_activity_log`).
That destroyed historical data on a single misclick. The handler now:

1. Looks up the ticket with `isNull(deletedAt)` (idempotent re-DELETE
   now correctly 404s).
2. Marks `pd_tickets.deleted_at` and every linked
   `work_items.deleted_at` with a single timestamp inside one
   transaction.
3. Logs an audit event of type `pd_ticket / delete / softDeleted: true`
   listing the cascade work_item IDs.

The new FK on `work_items.pd_ticket_id` is `ON DELETE SET NULL`, so an
out-of-band hard-delete of a PD ticket (admin sweep) can never silently
orphan a work_item: the pointer is cleared instead of leaving a dangling
ID.

### 3.5 Linkage audit logging

`logAuditFromReq` is invoked for:

* `pd_ticket / delete` — captures the soft-delete + cascade work_item IDs.
* `pd_ticket / update` — already wired (existing).
* `workspace_rollup / view` — every read of the org-wide rollup
  records `{ projectCount, spineGapCount, cascadeAnomalyCount }` so we
  can reconstruct, from the audit log alone, when a spine anomaly first
  appeared or healed.

### 3.6 Org-wide workspace rollup ("Meeting view")

* `getProjectDevelopmentWorkspaceRollup()` in the workspace service
  returns one `WorkspaceRollupRow` per active project with PD-ticket,
  work_item, and RAID counts plus a `spineGap` flag (project has
  work_items but zero PD tickets).
* `GET /api/project-development/workspace/rollup` (gated by
  `pd_dashboard / view`) returns the rollup with org-wide totals and
  emits the `workspace_rollup / view` audit row.
* `client/src/pages/pd-dashboard.tsx` renders a "Meeting view" section
  driven by this endpoint with a per-project table and totals.

## 4. Operational verification

After deploying, verify with:

```sql
-- 1. New schema elements exist
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'pd_tickets' AND column_name = 'deleted_at';
SELECT constraint_name FROM information_schema.table_constraints
 WHERE table_name = 'work_items' AND constraint_name = 'work_items_pd_ticket_id_fkey';

-- 2. No orphan work_items.pd_ticket_id remain
SELECT COUNT(*) FROM work_items wi
  LEFT JOIN pd_tickets pt ON pt.id = wi.pd_ticket_id
 WHERE wi.pd_ticket_id IS NOT NULL AND pt.id IS NULL;
-- expected: 0

-- 3. No active PD ticket points at a soft-deleted project
SELECT COUNT(*) FROM pd_tickets pt
  JOIN project_info pi ON pi.id = pt.project_id
 WHERE pt.deleted_at IS NULL AND pi.deleted_at IS NOT NULL;
-- expected: 0
```

Then exercise:

* `GET /api/project-development/workspace/rollup` — should return 200
  with `totals.spineGap` and `totals.cascadeAnomalies` matching the
  SQL above.
* The PD workspace UI for any project that has spawned tasks — the
  PD ticket cards should show real `taskCompleted / taskTotal`,
  not `0 / 0`.

## 5. Rollback

The migration is purely additive and the soft-delete column is
nullable, so a code rollback can run against the new schema without
issue. To undo the schema:

```sql
BEGIN;
DROP INDEX IF EXISTS idx_work_items_pd_ticket_id;
ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_pd_ticket_id_fkey;
DROP INDEX IF EXISTS idx_pd_tickets_deleted_at;
ALTER TABLE pd_tickets DROP COLUMN IF EXISTS deleted_at;
COMMIT;
```

This is destructive of the new soft-delete tombstones. A safer rollback
is to keep the schema and revert only the application code.

## 6. Known limitations / future work

* The DELETE handler still relies on the central
  `requirePermission('pd_tickets', 'edit')` check; there is no
  separate "restore from soft-delete" endpoint. Recovery today is a
  manual `UPDATE pd_tickets SET deleted_at = NULL WHERE id = ?`.
* `cascadeAnomalies` in the rollup is currently always 0 (the read
  paths now filter cascade anomalies out before they are surfaced);
  the field is preserved as the contract for a future job that
  surfaces the count even when cascade-display is hiding the rows.
* The 11 historical orphan PD tickets (no opp, no project) are not
  modified by this work — they are intentionally preserved as
  historical records and remain hidden from the active read paths
  by the existing project/opportunity filters.

## 7. Cross-references

* Spec: `.local/tasks/task-34.md`
* Migration: `migrations/0019_foundation_linkage_hardening.sql`
* Service: `server/services/project-development-workspace-service.ts`
* Route: `server/routes/project-development-workspace-rollup.routes.ts`
* Tests: `qa/tests/integration/foundation-linkage-cascades.test.ts`,
  `qa/tests/integration/workspace-rollup.test.ts`
* Schema discipline: `qa/tests/unit/db-push-uses-drizzle.test.ts`

## 8. Audit log queries

```sql
-- Soft-delete of pd_tickets in the last 7 days
SELECT entity_id, changes_json, created_at
  FROM audit_log
 WHERE entity_type = 'pd_ticket'
   AND action = 'delete'
   AND created_at > NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;

-- Workspace rollup views
SELECT user_id, changes_json, created_at
  FROM audit_log
 WHERE entity_type = 'workspace_rollup'
 ORDER BY created_at DESC LIMIT 50;
```

## 8.1 Follow-up migration `0020_pd_tickets_shadow_unique_softdelete_aware.sql`

The original `pd_tickets_opportunity_shadow_unique` index did not exclude
soft-deleted rows; soft-deleting a shadow ticket and re-creating one for
the same opportunity would collide. Migration 0020 drops and re-creates
the index with `deleted_at IS NULL` in the predicate. Hand-authored,
idempotent.

## 8.2 Rollup payload contract (extended)

`GET /api/project-development/workspace/rollup` now returns the full
payload required by the spec — totals, per-project rows, and orphan/risk
**lists**:

* `lists.projectsWithoutTickets` — active projects with no live PD tickets
* `lists.ticketsWithoutValidLinkage` — live PD tickets with neither a
  `project_id` nor an `opportunity_id`
* `lists.workItemsWithInvalidLinkage` — live work_items pointing at a
  missing or soft-deleted PD ticket (drives `totals.cascadeAnomalies`)
* `lists.ticketsDueThisWeek` — live PD tickets with `due_date` in the next 7 days
* `lists.tasksDueThisWeek` — live work_items with `end_date` in the next 7 days

Filter inputs: `asOf`, `statusFilter` (`open` | `overdue`), `phaseFilter`,
`ownerFilter`, `departmentFilter`. All filters are recorded in the audit
log alongside the view event.

## 8.3 Test coverage

* `qa/tests/integration/foundation-linkage-cascades.test.ts` — soft-deleted PD
  tickets do not appear in `/api/pd/tickets`; rollup shape; cascadeAnomalies = 0;
  auth required; `pdTicketTaskRows` aggregation regression.
* `qa/tests/api/workspace-rollup.test.ts` — full payload contract, role
  gating, filter inputs, idempotency, and `cascadeAnomalies` derivation.
* Wired into `qa/release-gate.ts` as "Foundation linkage cascades (Task #34)".

## 9. Sign-off

* Schema migration applied and idempotent: confirmed.
* All read paths cascade-display soft-deleted rows: confirmed (see §3.3).
* Workspace `pdTicketTaskRows` returns real counts: confirmed.
* Rollup endpoint live and audit-logged: confirmed.
* Meeting view UI live in PD dashboard: confirmed.

## Vocabulary update — 2026-04-23 (task #56, phase 1)

The user-facing term **"PD ticket"** has been retired. Tickets surface
as either **Engineering tickets** or **Quality tickets** depending on
their `request_type`:

* `request_type ∈ ENGINEERING_REQUEST_TYPES` (see
  `shared/roles/pd-roles.ts`) → **Engineering ticket**
* anything else → **Quality ticket**

Helper: `getTicketKind(ticket)` in `shared/lib/ticket-kind.ts`.

This is **phase 1 — vocabulary only**. The underlying table is still
named `pd_tickets` and `work_items.pd_ticket_id` is unchanged. The
following Phase 2 changes are explicitly out of scope and tracked
separately:

* Renaming the `pd_tickets` table or `work_items.pd_ticket_id` FK.
* Splitting `pd_tickets` into two physical tables.
* Removing the lazy-shadow ticket creation in
  `opportunities-repository.ts`.

### API payload aliases (additive, non-breaking)

`GET /api/project-development/workspace/rollup` now returns the same
data under both the old and new keys for one release:

* `totals.openPdTickets` (old) **and** `totals.openEngineeringTickets`
  (new) — same number.
* `totals.overduePdTickets` (old) **and**
  `totals.overdueEngineeringTickets` (new) — same number.
* Each row in `rows[]` includes both `pdTickets` (old) and
  `engineeringTickets` (new), pointing at the same `{ open, overdue }`
  block.

Old keys remain so Excel/Power BI consumers don't break. They will be
removed in a follow-up release once consumers have switched.

### UI nav rename

* Sidebar / breadcrumb section "Project Development" → **Engineering
  & Quality**.
* `/pd` page title "Project Development" → **Engineering & Quality**.
* `/pd` aliases extended: `/engineering-board` and
  `/engineering-dashboard` both redirect to `/pd`. The primary path
  stays `/pd` for one release so audit URLs and bookmarks keep
  working.
* The role/department label "Project Development" (used to describe
  the *organisational department* that owns the PD workflow) is
  **kept as-is**. Only the *ticket vocabulary* and the *page section
  name* changed.

### Server route URLs

Server routes under `/api/pd/*`, `/api/pd-pm-handover/*`, and
`/api/project-development/workspace/*` are **unchanged in this phase**
to avoid the risk of 308-redirect-on-POST issues with non-GET methods.
They will be moved behind dual-mounted aliases in a follow-up.

## Phase 2 — schema-side rename (task #58, migrations 0024 + 0025)

After phase 1 (task #56) settled the user-facing vocabulary on
"Engineering tickets", the schema caught up so the codebase itself stops
using the legacy `pd_tickets` / `pd_ticket_id` symbols. Two
hand-authored, idempotent migrations land the rollout:

* `migrations/0024_engineering_tickets_view_alias.sql` — additive.
  Creates `engineering_tickets` as an auto-updatable VIEW over
  `pd_tickets`, plus a parallel `work_items.engineering_ticket_id`
  STORED generated column derived from `pd_ticket_id`. Existing reads
  and writes through the old names continue unchanged.
* `migrations/0025_engineering_tickets_physical_rename.sql` — flip.
  Drops the additive aliases, renames `pd_tickets` →
  `engineering_tickets` (table, sequence, indexes, constraints), and
  renames `work_items.pd_ticket_id` → `engineering_ticket_id` (FK from
  migration 0019 retained, renamed to
  `work_items_engineering_ticket_id_fkey`). Recreates the soft-delete
  reject trigger from migration 0021 under the new column name. The
  legacy names are republished as backwards-compat aliases (VIEW
  `pd_tickets`; STORED generated column `work_items.pd_ticket_id`),
  scheduled for removal one release later.

Drizzle was updated in lockstep:

* `shared/schema/projects.ts` exports `engineeringTickets` /
  `EngineeringTicket` / `insertEngineeringTicketSchema` and re-exports
  the old `pdTickets` / `PdTicket` / `insertPdTicketSchema` symbols as
  aliases for one release.
* `shared/schema/tasks.ts` renamed `workItems.pdTicketId` →
  `workItems.engineeringTicketId` (column `engineering_ticket_id`).
  The matching partial index follows the new name.
* All server queries that read `pdTickets.*` were switched to
  `engineeringTickets.*`. API response payload keys (`pdTickets:`,
  `pdTicketId:`) are unchanged from phase 1 — clients still see both
  the legacy and the new keys.

Release-gate parity is asserted by
`qa/tests/integration/foundation-linkage-cascades.test.ts`, which now
covers both the legacy and new table/column names and confirms every
`work_items.pd_ticket_id` value matches `engineering_ticket_id`.

## Phase 2 cleanup — drop legacy aliases (task #60, migration 0026)

After one full release on the dual-name setup from migration 0025,
production telemetry confirmed zero traffic against the legacy
`pd_tickets` / `pd_ticket_id` symbols. Migration
`0026_drop_pd_tickets_legacy_aliases.sql` (hand-authored, idempotent)
removes the remaining backwards-compat surface so future contributors
are not misled by the duplication:

* DROP VIEW `pd_tickets` (was a `SELECT * FROM engineering_tickets`).
* DROP INDEX `idx_work_items_pd_ticket_id` (partial index on the
  generated column).
* DROP COLUMN `work_items.pd_ticket_id` (STORED generated from
  `engineering_ticket_id`).
* DROP FUNCTION `work_items_reject_softdeleted_pd_ticket()` — the
  unreferenced PL/pgSQL function from migration 0021. Its trigger was
  already replaced in migration 0025 by
  `work_items_reject_softdeleted_engineering_ticket()`.

Drizzle was updated in lockstep:

* `shared/schema/projects.ts` no longer re-exports `pdTickets` /
  `PdTicket` / `insertPdTicketSchema`. The single source of truth is
  `engineeringTickets` / `EngineeringTicket` /
  `insertEngineeringTicketSchema`.
* `server/repositories/opportunities-repository.ts` switched the
  remaining `PdTicket` type imports to `EngineeringTicket`.

The Phase-2-rename alias-parity assertion in
`qa/tests/integration/foundation-linkage-cascades.test.ts` was
removed since the legacy names no longer exist; the soft-delete
write-path guard against `engineering_tickets` /
`engineering_ticket_id` continues to exercise the spine.

API response payload keys (`pdTickets:`, `pdTicketId:`) are unrelated
to this cleanup and remain in place — they belong to the Phase-1
vocabulary rollout (task #56) and are tracked separately.
