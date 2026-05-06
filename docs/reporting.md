# Reporting

## Purpose
Reporting provides month-scoped and operational insights for leadership and delivery teams.

## Report coverage
Canonical reporting should include:
- Programme KPI summary
- Financial summary (revenue, costs, margin)
- Project status overview
- Task and milestone progress
- Risk/issues (RAID)
- Quality and engineering status

## Data sources
Prefer canonical tables/services for reporting:
- `project_info`
- `project_execution_state`
- `work_items` (+ status history where needed)
- normalized financial lines
- derived dashboard/reporting aggregates where explicitly materialized

## Reporting principles
- Filter by explicit report month boundaries.
- Separate baseline/import-derived values from app-owned execution values where relevant.
- Keep formulas transparent (especially margin/cashflow-related KPIs).
