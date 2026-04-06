# Release Gate (Required Evidence)

A release is **NO-GO** unless all required checks pass.

## Required checks

1. Type and unit checks
2. Route parity test
3. Redirect chain check
4. KPI frozen dataset validation
5. Tier 0 / Tier 1 smoke checks
6. Route proof checks

## Command checklist

```bash
npm run check
npm run test -- qa/tests/unit/route-registry-parity.test.ts qa/tests/unit/redirect-chains.test.ts
npm run check:redirects
npm run validate:kpi-dataset
npm run test:route-proof
npm run test:smoke
```

## KPI frozen dataset policy

- Canonical template/schema: `qa/kpi-frozen-dataset.schema.json`
- Dataset file path: `qa/kpi-frozen-dataset.json`
- Required metadata:
  - `dataset_owner`
  - `approval_date`
  - `approval_ticket`
  - exact KPI values (no ranges)

If the dataset is missing or incomplete, release gate must fail.
