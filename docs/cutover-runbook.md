# Cutover Release Gate — Operator Runbook

This runbook covers running the reconciliation pack against a production-like dataset to produce a GO / NO-GO release-gate verdict.

## Prerequisites

| Requirement | How to verify |
|-------------|---------------|
| Node.js 18+ | `node --version` |
| `tsx` available | `npx tsx --version` |
| Database access | `DATABASE_URL` env var set and reachable |
| Read-only replica preferred | Use a replica to avoid load on primary |
| Migrations applied | All `migrations/` SQL files have been run |
| Bridge retry queue drained | Check `/api/admin/bridge-health` or run `SELECT count(*) FROM internal.bridge_sync_failures WHERE resolved_at IS NULL` |

## Step 1: Environment Setup

```bash
# Option A: Direct connection string
export DATABASE_URL="postgresql://user:pass@host:5432/emergent_energy?sslmode=require"

# Option B: If using .env file
cp .env.production .env   # ensure DATABASE_URL is set

# Verify connectivity
npx tsx -e "import {db} from './db'; import {sql} from 'drizzle-orm'; db.execute(sql.raw('SELECT 1')).then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```

## Step 2: Pre-flight Checks

Before running the full pack, verify the environment is in a stable state:

```bash
# Check for unresolved bridge failures (should be 0 for clean run)
npx tsx -e "
import {db} from './db'; import {sql} from 'drizzle-orm';
const r = await db.execute(sql.raw(\"SELECT count(*) AS cnt FROM internal.bridge_sync_failures WHERE resolved_at IS NULL\"));
console.log('Unresolved bridge failures:', (r as any).rows?.[0]?.cnt ?? r[0]?.cnt);
"

# Trigger bridge retry queue to clear any pending retries
curl -X POST http://localhost:3000/api/admin/bridge-retry

# Check bridge health endpoint
curl http://localhost:3000/api/admin/bridge-health | jq .
```

## Step 3: Run the Release Gate

### Option A: Release Gate Script (recommended)

```bash
# Interactive mode — full report to terminal, files saved to ./reports/
npx tsx scripts/release-gate.ts

# CI mode — JSON to stdout, files saved to ./reports/
npx tsx scripts/release-gate.ts --ci > report.json

# Custom output directory
npx tsx scripts/release-gate.ts --out-dir /tmp/reconciliation-reports
```

**Output files produced:**
- `reports/reconciliation-YYYY-MM-DDTHH-MM-SS.json` — Full machine-readable report
- `reports/reconciliation-YYYY-MM-DDTHH-MM-SS.txt` — Full human-readable report
- `reports/release-gate-YYYY-MM-DDTHH-MM-SS.summary.txt` — Stakeholder summary with GO/NO-GO

### Option B: Reconciliation Pack CLI (lower level)

```bash
# JSON to stdout, text to stderr
npx tsx scripts/reconciliation-pack.ts

# JSON only
npx tsx scripts/reconciliation-pack.ts --json > report.json

# Text only
npx tsx scripts/reconciliation-pack.ts --text

# Save JSON to file
npx tsx scripts/reconciliation-pack.ts --out report.json
```

## Step 4: Interpret Results

### Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | **GO** — All HARD_FAIL checks passed | Safe to proceed with cutover |
| 1 | **NO-GO** — One or more HARD_FAIL checks failed | Fix issues, re-run |
| 2 | **ERROR** — Runner or connectivity failure | Fix environment, re-run |

### Verdict Interpretation

| Verdict | Warnings | Action |
|---------|----------|--------|
| GO, 0 warnings | None | Perfect parity. Proceed. |
| GO, N warnings | Present | Parity achieved for critical data. Review warnings, do not block. |
| NO-GO | Any | Fix all HARD_FAIL items. See report for specifics. |

## Step 5: Triage Failures

### HARD_FAIL checks (must fix before cutover)

| Check Name | Domain | What It Means | How to Fix |
|------------|--------|---------------|------------|
| `projects_row_parity` | projects | Legacy rows missing from core.projects | Re-run project backfill migration |
| `clients_row_parity` | clients | Legacy rows missing from core.clients | Re-run client backfill |
| `users_row_parity` | users | Legacy rows missing from core.user_accounts | Re-run user backfill |
| `cost_lines_row_parity` | finance | Active cost lines missing from finance.cost_lines | Re-run cost line backfill |
| `revenue_lines_row_parity` | finance | Active revenue lines missing | Re-run revenue line backfill |
| `change_requests_row_parity` | finance | CRs missing from finance.finance_records | Re-run CR bridge sync |
| `cost_lines_broken_legacy_fk` | finance | Promoted rows reference deleted legacy rows | Investigate data corruption |
| `revenue_lines_broken_legacy_fk` | finance | Promoted rows reference deleted legacy rows | Investigate data corruption |
| `cost_lines_amount_parity` | finance | SUM(amount_ex_vat) differs | Check for rounding, duplicates, or missed rows |
| `revenue_lines_amount_parity` | finance | SUM(amount_ex_vat) differs | Check for rounding, duplicates, or missed rows |
| `change_requests_amount_parity` | finance | VO cost_impact SUM differs | Check CR sync logic |
| `opening_balance_cost_count` | finance | Opening balance cost line count differs | Re-run OB backfill |
| `opening_balance_revenue_count` | finance | Opening balance revenue line count differs | Re-run OB backfill |
| `opening_balance_cost_amount` | finance | Opening balance cost SUM differs | Check OB amount migration |
| `opening_balance_revenue_amount` | finance | Opening balance revenue SUM differs | Check OB amount migration |
| `bridge_failures_unresolved` | bridge | Unresolved sync failures exist | Run retry queue, then manually investigate |
| `unresolved_projects` | projects | Lost projects (not in promoted, not in failure log) | Manual investigation required |
| `unresolved_cost_lines` | finance | Lost cost lines | Manual investigation required |
| `unresolved_revenue_lines` | finance | Lost revenue lines | Manual investigation required |
| `unresolved_users` | users | Lost users | Manual investigation required |

### WARNING checks (investigate but do not block)

| Check Name | What It Means |
|------------|---------------|
| `*_field_drift` | Key fields differ between legacy and promoted (name, phase, etc.) |
| `*_null_legacy_fk` | Promoted rows missing legacy FK back-reference |
| `projects_null_client_fk` | Promoted project missing client_id that legacy has |
| `work_items_*` | Work item linkage or count discrepancies |
| `sync_watermarks_stale` | Sync watermarks >1 hour behind |
| `finance_project_*_drift` | Per-project count or amount mismatches |
| `opening_balance_cost_in_records` | OB cost lines not properly flagged in finance_records |

## Step 6: After Fixing Issues

```bash
# Re-run the release gate after fixes
npx tsx scripts/release-gate.ts

# Compare reports
diff reports/reconciliation-*.txt  # compare old vs new
```

## Step 7: Archive the Report

After a successful GO verdict, archive the report for audit trail:

```bash
# The release-gate script saves timestamped files automatically
ls -la reports/

# Copy to permanent storage if needed
cp reports/release-gate-*.summary.txt /path/to/audit-archive/
cp reports/reconciliation-*.json /path/to/audit-archive/
```

## What Still Needs a Human / Operator

This tooling is fully automated **except** for:

1. **Database access** — An operator must provide `DATABASE_URL` pointing to a production snapshot or read replica. This environment does not have database access.
2. **Bridge retry queue drain** — Trigger the retry queue and wait for it to complete before running the pack for accurate results.
3. **Interpretation of WARNING checks** — Warnings require domain knowledge to decide if they are acceptable for your deployment.
4. **Fixing HARD_FAIL issues** — Each failure requires investigation; the report provides sample IDs and details to guide triage.
5. **Signing off on the GO verdict** — A human must review the summary report and approve cutover.

## Quick Reference

```bash
# One-liner: run release gate and check exit code
npx tsx scripts/release-gate.ts --ci > report.json && echo "GO" || echo "NO-GO (exit $?)"
```
