# Reconciliation Pack

Comprehensive verification that the promoted schema matches legacy data after backfill. Produces machine-readable JSON and human-readable text output with pass/fail thresholds.

## Quick Start

```bash
# Full report (text to stderr, JSON to stdout)
npx tsx scripts/reconciliation-pack.ts

# JSON only
npx tsx scripts/reconciliation-pack.ts --json

# Human-readable text only
npx tsx scripts/reconciliation-pack.ts --text

# Save JSON to file
npx tsx scripts/reconciliation-pack.ts --out report.json

# CI pipeline usage (exits 0=pass, 1=fail, 2=error)
npx tsx scripts/reconciliation-pack.ts --json > reconciliation-report.json
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed (warnings are OK) |
| 1 | One or more HARD_FAIL checks failed |
| 2 | Runner error (DB connection, etc.) |

## Domains Covered

| Domain | What's Checked |
|--------|---------------|
| **projects** | Row parity (project_info ↔ core.projects), field drift (name, phase), null client FK |
| **clients** | Row parity (clients ↔ core.clients), name drift |
| **users** | Row parity (users ↔ core.user_accounts) |
| **finance** | Cost/revenue line row parity, null/broken legacy FKs, SUM(amount_ex_vat) comparisons, change request parity, per-project count drift |
| **work_items** | Orphaned legacy references, work items without project, PM plan task parity |
| **bridge** | Unresolved bridge_sync_failures, failures by domain, stale sync watermarks |

## Check Categories

| Category | Description |
|----------|-------------|
| `row_parity` | Source row count vs migrated row count |
| `field_drift` | Key field values differ between legacy and promoted |
| `fk_integrity` | Null or broken foreign key references after backfill |
| `finance_amounts` | SUM comparisons of financial amounts (legacy vs promoted) |
| `bridge_health` | Unresolved sync failures and stale watermarks |
| `unresolved` | Skipped or unprocessed rows |

## Severity Levels

### HARD_FAIL

These must be resolved before cutover. The overall result is FAIL if any HARD_FAIL check fails.

| Check | Condition |
|-------|-----------|
| `projects_row_parity` | Legacy project_info rows missing from core.projects |
| `clients_row_parity` | Legacy clients missing from core.clients |
| `users_row_parity` | Legacy users missing from core.user_accounts |
| `cost_lines_row_parity` | Active cost lines missing from finance.cost_lines |
| `revenue_lines_row_parity` | Active revenue lines missing from finance.revenue_lines |
| `change_requests_row_parity` | Change requests missing from finance.finance_records |
| `cost_lines_broken_legacy_fk` | finance.cost_lines references non-existent legacy rows |
| `revenue_lines_broken_legacy_fk` | finance.revenue_lines references non-existent legacy rows |
| `cost_lines_amount_parity` | SUM(amount_ex_vat) differs between legacy and promoted cost lines |
| `revenue_lines_amount_parity` | SUM(amount_ex_vat) differs between legacy and promoted revenue lines |
| `bridge_failures_unresolved` | Unresolved entries in internal.bridge_sync_failures |
| `opening_balance_cost_count` | Opening-balance cost line count differs |
| `opening_balance_revenue_count` | Opening-balance revenue line count differs |
| `opening_balance_cost_amount` | Opening-balance cost SUM(amount_ex_vat) differs |
| `opening_balance_revenue_amount` | Opening-balance revenue SUM(amount_ex_vat) differs |
| `unresolved_projects` | Legacy projects missing from promoted with no tracked sync failure |
| `unresolved_cost_lines` | Active cost lines missing from promoted with no tracked sync failure |
| `unresolved_revenue_lines` | Active revenue lines missing from promoted with no tracked sync failure |
| `unresolved_users` | Users missing from promoted with no tracked sync failure |

### WARNING

Tolerable for cutover but should be investigated. Do not block deployment.

| Check | Condition |
|-------|-----------|
| `projects_field_drift` | project_name or phase differ |
| `clients_field_drift` | client name differs |
| `projects_null_client_fk` | Promoted project missing client_id that legacy has |
| `cost_lines_null_legacy_fk` | finance.cost_lines rows with NULL legacy FK |
| `revenue_lines_null_legacy_fk` | finance.revenue_lines rows with NULL legacy FK |
| `work_items_orphaned_legacy_refs` | work_items reference deleted legacy tasks |
| `work_items_no_project` | Non-personal work items without project_id |
| `work_items_pm_task_parity` | PM plan task count mismatch |
| `finance_project_cost_count_drift` | Per-project cost line count mismatch |
| `finance_project_revenue_count_drift` | Per-project revenue line count mismatch |
| `sync_watermarks_stale` | Sync watermarks >1 hour behind |
| `opening_balance_cost_in_records` | Opening-balance cost lines missing or unflagged in finance_records |
| `finance_project_cost_amount_drift` | Per-project cost amount SUM mismatch |
| `finance_project_revenue_amount_drift` | Per-project revenue amount SUM mismatch |

### INFO

Informational only. Never triggers a failure.

| Check | Condition |
|-------|-----------|
| `bridge_failures_by_domain` | Breakdown of unresolved failures by domain |

## JSON Report Schema

```json
{
  "overall": "PASS | FAIL",
  "timestamp": "ISO 8601",
  "version": "1.0.0",
  "environment": "development | production | staging",
  "hardFailCount": 0,
  "warningCount": 2,
  "checks": [
    {
      "name": "projects_row_parity",
      "domain": "projects",
      "category": "row_parity",
      "severity": "HARD_FAIL",
      "status": "PASS | FAIL | WARN | SKIP",
      "legacyCount": 150,
      "promotedCount": 150,
      "delta": 0,
      "detail": "OK",
      "sampleIds": []
    }
  ],
  "domainSummaries": [
    {
      "domain": "projects",
      "totalChecks": 3,
      "passed": 3,
      "failed": 0,
      "warned": 0,
      "skipped": 0,
      "status": "PASS"
    }
  ],
  "summary": "All 22 checks passed (2 warnings)"
}
```

## Interpreting Results

1. **PASS with 0 warnings**: Perfect parity. Safe to cutover.
2. **PASS with warnings**: Parity achieved for critical data. Investigate warnings but do not block.
3. **FAIL**: One or more HARD_FAIL checks failed. Fix before cutover.
4. **SKIP**: Query error (usually means the promoted table doesn't exist yet). Not counted as failure.

## Integration with Existing Infrastructure

This pack complements existing reconciliation tools:

| Tool | Scope | When to Use |
|------|-------|-------------|
| **reconciliation-pack** (this) | Full-spectrum pre-cutover validation | Before any cutover decision |
| `reconciliation-runner.ts` | Continuous 15-min parity checks | Runtime monitoring |
| `migration-verify.ts` | PM task migration specifics | After smart-import runs |
| `promoted-read-compat.ts` | Domain rollout readiness views | Read-path cutover decisions |
| `work-item-reconciliation.ts` | Per-project work item deep-dive | Debugging specific project mismatches |

## Files

| File | Role |
|------|------|
| `server/services/reconciliation-pack.ts` | Core logic, types, and formatter |
| `scripts/reconciliation-pack.ts` | CLI runner (npx tsx entry point) |
| `qa/tests/unit/reconciliation-pack-validation.test.ts` | Structural validation tests |
| `docs/reconciliation-pack.md` | This documentation |
