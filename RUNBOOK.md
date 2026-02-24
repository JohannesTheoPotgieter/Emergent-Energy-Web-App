# Bootstrap Import Runbook

## Overview

The Bootstrap Import system provides a bulk pipeline for ingesting Excel tracker files, normalizing data into canonical tables, and rebuilding pre-computed KPI rollups for fast dashboard performance.

## Architecture

### Pipeline Steps
1. **Discover** - Scan uploads directory for Excel files (.xlsx, .xlsm, .xls)
2. **Stage** - Parse each file and insert rows into `staging_bootstrap_projects` with hash-based deduplication
3. **Upsert** - Write normalized data into canonical tables (`normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`, `project_info`)
4. **Rebuild** - Compute derived KPI tables (`derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary`)
5. **Validate** - Run integrity checks (orphan references, duplicate hashes, row count mismatches)
6. **Report** - Generate summary with counts and quarantine details

### Key Tables
- `bootstrap_import_runs` - Import run metadata and status
- `staging_bootstrap_projects` - Per-file staging with parse status and quarantine flags
- `derived_project_kpis` - Pre-computed per-project financial KPIs
- `derived_portfolio_kpis` - Pre-computed portfolio-level aggregates
- `derived_rag_summary` - Pre-computed RAG status distribution
- `app_settings` - Feature flag storage

### Feature Flag
- **USE_NEW_DASHBOARD_ROLLUPS** - When enabled, the `/api/overview` endpoint reads from derived tables instead of computing KPIs on every request

## How to Run

### Via Admin UI
1. Navigate to Admin > Bootstrap Import (`/admin/bootstrap-import`)
2. Click **Scan Files** to discover Excel files in the uploads directory
3. Click **Run Import** to execute the full pipeline
4. Review the report for quarantined files or errors
5. Toggle the **Dashboard Rollups** switch to enable/disable the feature flag
6. Click **Rebuild KPIs** to recompute derived tables without re-importing

### Via API
All endpoints require admin authentication (Bearer token).

```bash
TOKEN="your-jwt-token"

# Scan for files
curl -X POST http://localhost:5000/api/bootstrap-import/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Run full import
curl -X POST http://localhost:5000/api/bootstrap-import/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# List all runs
curl http://localhost:5000/api/bootstrap-import/runs \
  -H "Authorization: Bearer $TOKEN"

# Get run report
curl http://localhost:5000/api/bootstrap-import/report/1 \
  -H "Authorization: Bearer $TOKEN"

# Rebuild derived tables only
curl -X POST http://localhost:5000/api/bootstrap-import/rebuild-derived \
  -H "Authorization: Bearer $TOKEN"

# Check feature flag
curl http://localhost:5000/api/bootstrap-import/feature-flag \
  -H "Authorization: Bearer $TOKEN"

# Toggle feature flag
curl -X POST http://localhost:5000/api/bootstrap-import/feature-flag \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

## Safe Cutover Procedure

1. Run a bootstrap import to populate derived tables
2. Compare derived KPI values against live-computed values using the overview API
3. When satisfied, enable the feature flag via the admin UI
4. Monitor dashboard for correctness
5. If issues arise, disable the feature flag to revert to live queries instantly

## Quarantine Handling

Files that fail to parse or have data issues are quarantined (marked with `needsReview` or `parseStatus: FAILED`). Review quarantined files in the import report, fix the source Excel files, and re-run the import.

## Data Quality

The normalizer automatically skips budget placeholder rows (rows with no amount, no dates, and no invoice number) to prevent inflating row counts with empty category headers from Excel files.
