# Reconciliation Pack

The reconciliation pack validates data integrity between legacy (spreadsheet-imported) and promoted (V2 schema) data before cutover.

## Domains Covered

- **projects** — Row parity between legacy and promoted project records
- **clients** — Client FK integrity and linkage validation
- **finance** — Cost and revenue line parity (row counts and amount sums)
- **work_items** — Work item migration completeness
- **bridge** — Bridge sync failure detection and resolution status

## Severity Levels

### HARD_FAIL

A HARD_FAIL check blocks cutover. These represent data loss or corruption risks:

- `projects_row_parity` — Legacy vs promoted project count mismatch
- `cost_lines_row_parity` — Cost line count mismatch
- `revenue_lines_row_parity` — Revenue line count mismatch
- `bridge_failures_unresolved` — Unresolved bridge sync failures
- `cost_lines_broken_legacy_fk` — Broken FK references in cost lines
- `change_requests_row_parity` — Change request count mismatch
- `opening_balance_cost_count` — Opening balance cost line count mismatch
- `opening_balance_cost_amount` — Opening balance cost amount mismatch
- `unresolved_projects` — Projects lost during migration
- `unresolved_cost_lines` — Cost lines lost during migration

### WARNING

WARNING checks flag potential issues that may be acceptable with manual sign-off:

- `field_drift` — Non-critical field value differences between legacy and promoted
- `null_legacy_fk` — Null foreign keys in legacy records (may be expected for historical data)
- Per-project amount drift checks

## Usage

Run the reconciliation pack via CLI:

```bash
npx tsx scripts/reconciliation-pack.ts --json
npx tsx scripts/reconciliation-pack.ts --text
npx tsx scripts/reconciliation-pack.ts --out report.json
```

The CLI exits with code 0 on PASS and code 1 on FAIL.

## Output

The report includes version, environment, domain summaries, and individual check results with severity classifications.
