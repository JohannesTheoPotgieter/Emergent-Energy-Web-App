# Excel-vs-App diff system — Operations Runbook

**Owner:** Engineering
**Last reviewed:** 2026-04-30
**Related PR:** #760
**Related docs:**
- `docs/excel-vs-app-diff-plan.md` — design doc.
- `docs/excel-vs-app-workstream-b-impl.md` — file-by-file impl plan.
- `docs/reporting-audit-2026-04.md` — workstream A audit.

---

## What is this system?

The Excel-vs-App diff page surfaces every place the live app state has
drifted from the most recent Tracker workbook import, on a per-project
and program-level screen. Operators resolve drift by:

- **Accept Excel** — clear the manual override; the field reverts to the
  Excel value (which has been the live column all along — operators
  never actually wrote there post workstream B).
- **Keep app + reason** — record the live value as a deliberate manual
  override with the operator's reason.
- **Request approval** — file a `financial_edit_requests` row routed to
  the section's reviewers (PROGRAM_FINANCE_MANAGER + CFO for cost,
  PROGRAM_FINANCE_MANAGER + CCO for revenue, PROGRAM_MANAGER for plan).

The cell-edit invariant: tracked-field edits on the operational tabs
(cost / revenue / plan) write to `manual_overrides` JSONB on the
canonical row, never to the live column. Reporting + replica reads
return the live column unmodified (Excel-truth); operational tab reads
overlay the override on top for display.

---

## Key files

| Concern | File |
|---------|------|
| Single-source contract (tracked-field lists, RBAC, JSONB schema) | `shared/excel-vs-app/contract.ts` |
| Override write/read helpers | `server/lib/manual-overrides.ts` |
| Drift detection repo | `server/repositories/tracker-replica-repository.ts:getDriftDetail` |
| Routes | `server/routes/excel-vs-app.routes.ts` |
| Pages | `client/src/pages/excel-vs-app.tsx`, `excel-vs-app-project.tsx` |
| Backfill script | `scripts/backfill-import-snapshot.ts` |
| Bench script | `scripts/bench-excel-vs-app.ts` |
| Metrics | `server/lib/excel-vs-app-metrics.ts` (`[ExcelVsApp.metrics]` log lines) |

---

## Feature flag

`USE_MANUAL_OVERRIDES` env variable:

- `true` (default): cell-edit handlers route tracked fields to
  `manual_overrides` JSONB; read paths apply overlay.
- `false`: legacy direct-write to live column. Overlay is a no-op
  (the live column already holds whatever the operator typed).

Flipping the flag is the rollback. `manual_overrides` JSONB entries
written while ON are harmless when the flag flips OFF — the legacy
read path doesn't apply overlay so the operator sees the live column
directly. The next re-import preserves the entries (the merge engine
treats them as protected) or surfaces a v2 conflict if the workbook
moves on.

---

## Backfill rehearsal procedure (staging, before flipping prod flag)

The backfill populates `import_snapshot` JSONB on legacy rows that
predate Smart Import v2 PR2C. Without it, the diff page shows every
non-null live value on those rows as drift — the amber "Backfill
required" banner on the per-project page tells the operator when this
is the case.

### Step 1 — Dry run on staging

```bash
ssh staging
cd /path/to/repo
git fetch && git checkout claude/replica-diff-and-reporting-p3OWG
npm install
npx tsx scripts/backfill-import-snapshot.ts --dry-run --verbose
```

Expected output: per-project line with `wrote=0` (dry run) and an
`unmatched=N` count showing rows the matcher couldn't pair.
Investigate any project where `unmatched > matched/2` — likely
indicates a row-hash drift between the import engine and the matcher.

### Step 2 — Spot-check a single project

```bash
npx tsx scripts/backfill-import-snapshot.ts --project-id=<small_project> --verbose
```

Then verify in psql:

```sql
SELECT
  COUNT(*) FILTER (WHERE import_snapshot IS NULL) AS still_null,
  COUNT(*) FILTER (WHERE import_snapshot IS NOT NULL) AS populated,
  COUNT(*) AS total
FROM normalized_cost_lines
WHERE project_id = <id>
  AND effective_to IS NULL
  AND deleted_at IS NULL;
```

`still_null` should be 0 (or equal to the script's `unmatched` count
from step 2's log).

### Step 3 — Full staging run

```bash
npx tsx scripts/backfill-import-snapshot.ts --verbose 2>&1 | tee backfill-$(date +%Y%m%d).log
```

Capture the timing baseline:

```bash
grep '\[backfill\] complete' backfill-*.log
# → records "wrote=N" and total elapsed time
```

For ~50 projects of Mondi-sized data (~850 rows / project), expect
the script to take 2-5 minutes total. If it takes >10 minutes,
investigate before running prod.

### Step 4 — Soak on staging

Leave the flag ON for a week. Watch the metric stream:

```bash
journalctl -u app -f | grep '\[ExcelVsApp.metrics\]'
journalctl -u app -f | grep '\[manual-overrides\]'
```

Expect:
- View events on every diff-page load (operators exploring the new
  page).
- Resolve events every time someone clicks Accept Excel / Keep app /
  Request approval.
- Cell-edit `[manual-overrides]` events whenever someone edits a cell
  on cost / revenue / plan.

### Step 5 — Prod backfill

Same as step 3 on prod. Schedule during low-write window — the
backfill takes a write lock per row briefly. The `IS NULL` guard
means a concurrent import can't conflict.

### Step 6 — Flip prod flag

```bash
# Example for systemd
sudo systemctl set-environment USE_MANUAL_OVERRIDES=true
sudo systemctl restart app
```

Watch error logs for the first hour. Roll back via:

```bash
sudo systemctl set-environment USE_MANUAL_OVERRIDES=false
sudo systemctl restart app
```

---

## Common failure modes

### Symptom: diff page shows every value as drifted, on every project

**Likely cause:** backfill never ran. The amber banner on the per-project
page should also be visible. Run `scripts/backfill-import-snapshot.ts`
on the affected env.

### Symptom: operator says their edit "disappeared" from the cost tab

**Diagnostic steps:**

1. Confirm `USE_MANUAL_OVERRIDES=true` in env (otherwise the legacy
   direct-write path was taken and we have a different bug).
2. Check the structured log for the operator's edit:
   ```
   journalctl -u app -t app | grep '\[manual-overrides\]' | grep editedBy.:<userId>
   ```
   Expect a `op:apply` line with the operator's userId, the table,
   the rowId, and the value they typed.
3. If the log line is present, the JSONB write succeeded. The
   regression is in the read overlay. Check:
   - `getCanonicalProjectCostLines` is called with `applyOverrides:
     true` (`server/departments/finance-routes.ts:getHighRiskProjectCostReadRows`).
   - `manualOverridesEnabled()` returns true.
4. If the log line is absent, the operator's request never reached
   the helper. Check the upstream handler (the override save endpoint)
   for an early return — RBAC, validation, etc.

### Symptom: diff counts are stale after a Smart Import

**Expected.** The diff page caches the response in React Query for the
duration of the page session. Click the "Refresh" affordance (browser
reload). For programmatic refresh, the resolve mutation already
invalidates `["excel-vs-app-project", projectId]` and
`["excel-vs-app-program"]`.

### Symptom: pending edit-requests panel shows requests but admins say they have nothing to act on

**Known gap.** The `financial_edit_requests` queue is filed by
several flows (cost/revenue PM-Site overrides, this diff page's
"Request approval" action) but has no first-class admin UI. The
panel on the diff page shows them read-only. Approve/reject is via
the existing server endpoints:

```bash
curl -X POST -H "Cookie: connect.sid=…" \
  https://app/api/financial-edit-requests/<id>/approve \
  -d '{"reviewComment":"approved"}'
```

Track building a dedicated UI as a follow-up.

### Symptom: backfill script fails with "no committed runs" for many projects

Some projects pre-date the import-runs table or were never imported
via Smart Import v2. The script logs them and skips. They will not
have functional drift detection until they're re-imported. Verify
with:

```sql
SELECT pi.id, pi.project_name
FROM project_info pi
LEFT JOIN smart_import_runs sir
  ON sir.project_id = pi.id AND sir.status = 'committed'
WHERE sir.id IS NULL;
```

---

## Disabling the diff page

The diff page itself isn't behind a separate flag — it's gated by
the `excel_vs_app:view` permission. To revoke access portfolio-wide:

```sql
-- Or use the admin Roles UI: untick the View checkbox on the
-- Excel-vs-App row for every role.
DELETE FROM permission_grants WHERE entity = 'excel_vs_app';
```

(More commonly: leave permissions as-is and flip
`USE_MANUAL_OVERRIDES=false` to neutralise the underlying
invariant. The diff page still loads but classifies everything as
not-drifted because the live column == operator's value.)

---

## Metrics to watch on a dashboard

From the `[ExcelVsApp.metrics]` log stream:

| Metric | Question it answers | Alert on |
|--------|--------------------|---------|
| `op=view` `unverifiedTotal` (program scope) | Is unverified drift trending up over time? | Sustained increase week-over-week |
| `op=view` `legacyRowsWithoutSnapshot` | Did backfill run successfully for new projects? | Any non-zero on a project the import engine has touched |
| `op=resolve` `count` per `action` | Are operators using the diff page? | Zero usage after launch (means they don't trust the screen) |
| `op=resolve` `actorRole` | Are the right roles resolving? | ENGINEER role appearing here (RBAC bypass) |

From `[manual-overrides]`:

| Metric | Question |
|--------|---------|
| `op=apply` count by `source` | Cell-edit volume vs import volume |
| `op=apply` `hadPrior:true` count | How often operators re-edit the same field |
| `op=clear` count | Reset-to-Excel volume (also captured by `op=resolve action=accept_excel`) |

A daily roll-up of these into the existing dashboard would catch most
regressions within 24h. Building that rollup is a Tier 3 follow-up.
