# KPI Frozen Dataset Process (Release Evidence)

## Canonical evidence files

- Dataset template: `qa/kpi-frozen-dataset.template.json`
- Required dataset for release: `qa/kpi-frozen-dataset.json`
- Validator command: `npm run validate:kpi-dataset`

## Required metadata contract

`qa/kpi-frozen-dataset.json` must include:

- `dataset_owner` (business owner name or role)
- `approval_date` (`YYYY-MM-DD`)
- `approval_ticket` (approval document/ticket reference)
- `kpis.planned_outcome_vs_budget_pct` (exact number)
- `kpis.actual_cos_realised` (exact number)

No ranges or placeholders are allowed in approved release evidence.

## Ownership

- Business owner: Finance + PMO sign-off owner (must be filled in `dataset_owner`)
- Technical enforcement owner: QA / Release

## Failure behavior

If the dataset file is missing or any required field is missing/invalid:

- `npm run validate:kpi-dataset` fails.
- `npm run release:gate` fails.
- Release decision is **NO-GO**.
