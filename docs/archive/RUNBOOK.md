# Smart Import & Derived KPIs Runbook

## Overview

Smart Import is the sole path for creating and updating projects. It ingests Excel tracker files, normalizes data into canonical tables, and optionally rebuilds pre-computed KPI rollups for fast dashboard performance.

## Architecture

### Smart Import Pipeline
1. **Upload** - Upload Excel tracker file via the Smart Import wizard at `/smart-import`
2. **Parse** - Extract plan tasks, revenue lines, cost lines with font color metadata
3. **Normalize** - Write to canonical tables (`normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`)
4. **Upsert project_info** - Create new project or update existing project metadata
5. **Legacy sync** - Also write to legacy tables (`program_expense`, `program_inflows`, `project_plan`) for backward compatibility

### Derived KPI Tables
- `derived_project_kpis` - Pre-computed per-project financial KPIs
- `derived_portfolio_kpis` - Pre-computed portfolio-level aggregates
- `derived_rag_summary` - Pre-computed RAG status distribution
- `app_settings` - Feature flag storage

### Feature Flag
- **USE_NEW_DASHBOARD_ROLLUPS** - When enabled, the `/api/overview` endpoint reads from derived tables instead of computing KPIs on every request

### Database Spine
- `project_info` is the central table. All modules link to it via `project_id` FK.
- On startup, `backfill-project-ids.ts` populates `projectId` on `operational_tasks`, `qc_checklist`, `deliverables`, `engineering_tasks` by matching `projectName` to `project_info`.

## Data Quality

The normalizer automatically skips budget placeholder rows (rows with no amount, no dates, and no invoice number) to prevent inflating row counts with empty category headers from Excel files.

## Business Rules
- **Project Name**: Derived from Excel filename before "_Tracker" (underscores replaced with spaces)
- **COS Realised**: Invoice captured + invoice date font is black (confirmed/actual)
- **Cashflow Confirmed**: Invoice captured + PO captured + payment date font is black (confirmed)
