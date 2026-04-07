# Data Import and Source of Truth

## Ownership model
Data ownership is intentionally split by domain:

- **Excel-mastered** domains: import governs canonical baseline.
- **App-mastered** domains: app is source of record.
- **Hybrid-governed** domains: app + import coexist with explicit governance/audit controls.

## Canonical data paths
- Project identity: `project_info`
- Cost lines: `normalized_cost_lines`
- Revenue lines: `normalized_revenue_lines`
- Shared work/tasks: `work_items`

## Smart Import principles
- Preserve lineage from import rows.
- Avoid silent destructive overrides.
- Keep conflict visibility explicit.
- Maintain compatibility for legacy consumers while canonical tables are primary.

## Data quality rules
- Exclude placeholder/empty financial rows from normalized calculations.
- Preserve financial date/confirmation semantics for COS and cashflow logic.
- Use deterministic row identifiers where required for reconciliation.
