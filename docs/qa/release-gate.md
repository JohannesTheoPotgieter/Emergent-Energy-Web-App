# Release Gate (Canonical)

A release is **NO-GO** unless every REQUIRED check passes.

## Required machine checks

1. **Type check** — `npm run check`
2. **Route parity test** — `vitest run -c qa/vitest.config.ts qa/tests/unit/route-registry-parity.test.ts`
3. **Redirect chain check** — `npm run check:redirects`
4. **Route proof test** — `npm run test:route-proof`
5. **KPI frozen dataset validation** — `npm run validate:kpi-dataset`
6. **Smoke tests** — `npm run test:smoke`
7. **Workflow tests** — `npm run test:workflows`
8. **Reconciliation status evidence** — `qa/reports/reconciliation-status.json` (`npm run reconciliation:report`)
9. **Critical route role validation evidence** — `qa/reports/role-permission-audit.md` (manual evidence; see table)

## Optional checks (manual signoff when warning)

1. **Critical defects register** — `docs/archive/FINAL_DEFECT_REGISTER.md`
   - This is optional by default.
   - If `REQUIRE_CRITICAL_DEFECT_FILE=true`, it becomes REQUIRED.

## Evidence input table

| evidence                  | required           | producer command/process                                                                                 | output path                                                                                       | owner                  | fail behavior                                                   |
| ------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| Reconciliation status     | yes                | `npm run reconciliation:report`                                                                          | `qa/reports/reconciliation-status.json`                                                           | QA / Release           | Release gate fails if missing/invalid/non-pass.                 |
| Role permission audit     | yes                | Manual audit against critical routes (copy template and record PASS rows)                                | `qa/reports/role-permission-audit.md` (start from `qa/role-permission-audit.template.md`) | QA / Security reviewer | Release gate fails if missing or any critical route lacks PASS. |
| KPI frozen dataset        | yes                | Business owner fills `qa/kpi-frozen-dataset.json` from template, then run `npm run validate:kpi-dataset` | `qa/kpi-frozen-dataset.json`                                                                      | Business owner + QA    | Release gate fails if file/fields missing or invalid.           |
| Critical defects register | optional (default) | Manual defect triage update                                                                              | `docs/archive/FINAL_DEFECT_REGISTER.md`                                                           | QA / Release           | Warning by default; fail if env flag requires file.             |

## Release command checklist

```bash
npm run check
vitest run -c qa/vitest.config.ts qa/tests/unit/route-registry-parity.test.ts
npm run check:redirects
npm run test:route-proof
npm run validate:kpi-dataset
npm run test:smoke
npm run test:workflows
npm run reconciliation:report
npm run release:gate
```

## External dependencies (not auto-generated in this repo)

1. Business-approved KPI values and ticket reference in `qa/kpi-frozen-dataset.json`.
2. Manual role-permission audit evidence in `qa/reports/role-permission-audit.md`.
