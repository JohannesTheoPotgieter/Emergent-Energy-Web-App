# Cutover Runbook

Step-by-step runbook for executing the data cutover from legacy to promoted schema.

## Prerequisites

Before starting the cutover:

- `DATABASE_URL` environment variable must be set and pointing to the target database
- All pending migrations must be applied
- Backup of the current database must be completed
- bridge_sync_failures table must be reviewed for unresolved entries

## Pre-flight Checks

Run the Pre-flight validation before proceeding:

1. Verify bridge_sync_failures count is zero or all failures are resolved
2. Verify all import runs are complete
3. Verify no active user sessions are modifying data

## CLI Commands

### Release Gate

```bash
npx tsx scripts/release-gate.ts
```

### Reconciliation Pack

```bash
npx tsx scripts/reconciliation-pack.ts --json
npx tsx scripts/reconciliation-pack.ts --text --out report.txt
```

## Exit Codes

| Code | Verdict | Meaning |
|------|---------|---------|
| 0 | GO | All checks passed, safe to proceed with cutover |
| 1 | NO-GO | One or more HARD_FAIL checks failed |
| 2 | ERROR | Script encountered an unexpected error |

## HARD_FAIL Checks and How to Fix

### projects_row_parity
Verifies legacy and promoted project counts match.
**How to Fix:** Run the bridge sync for missing projects. Check bridge_sync_failures for failed project syncs.

### cost_lines_row_parity
Verifies cost line counts match between legacy and promoted.
**How to Fix:** Re-run the cost line import for affected projects. Verify import_run completeness.

### revenue_lines_row_parity
Verifies revenue line counts match.
**How to Fix:** Re-run the revenue line import. Check for skipped rows in import logs.

### bridge_failures_unresolved
Checks that all bridge sync failures have been resolved.
**How to Fix:** Review each failure in bridge_sync_failures table. Re-sync or manually resolve.

### cost_lines_broken_legacy_fk
Detects broken foreign key references in cost lines.
**How to Fix:** Run the FK repair migration or manually update broken references.

### opening_balance_cost_count / opening_balance_cost_amount
Verifies opening balance integrity.
**How to Fix:** Re-import opening balances from the source spreadsheet.

## WARNING checks

WARNING checks do not block cutover but should be reviewed:

- `field_drift` — Non-critical field differences (e.g., formatting, whitespace)
- `null_legacy_fk` — Null FKs in legacy records (expected for pre-migration data)
- Per-project amount drift within tolerance

## What Still Needs a Human

The following steps cannot be automated:

- **Database access** — Production database credentials and connection verification
- **Signing off** — Finance stakeholder must review and approve the reconciliation report
- Business owner must confirm acceptable tolerance for WARNING-level drift
- Final GO/NO-GO decision after reviewing the full report

## Archive

After cutover completion:

- Save the reconciliation report to the audit trail
- Archive the release gate output with timestamp
- Record the cutover decision and approver in the audit log
