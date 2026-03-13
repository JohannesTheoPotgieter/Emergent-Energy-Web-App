# Release Gate Checklist (Stability Proof)

Use this checklist as the mandatory go/no-go gate for every production release.

## 1) Source-of-truth checks

- [ ] Every changed domain is mapped in `docs/architecture/source-of-truth-matrix.md`.
- [ ] No unmanaged dual-write introduced.
- [ ] Any compatibility reads are documented with owner + sunset plan.
- [ ] Reconciliation path exists for all import-to-canonical promotions.

## 2) API test gate

- [ ] `npm run test:api` executed successfully.
- [ ] Changed endpoints have request/response contract coverage.
- [ ] Error paths (4xx/5xx) validated for changed endpoints.
- [ ] Auth + permission middleware exercised in API tests.

## 3) Smoke test gate

- [ ] `npm run test:smoke` executed successfully.
- [ ] Core route navigation validated (home, projects, project detail, finance, quality, engineering, admin).
- [ ] Redirect/alias routes verified.
- [ ] Critical create/update flows complete without runtime errors.

## 4) Workflow test gate

- [ ] At least one full workflow per impacted domain recorded (example: Smart Import preview → issue resolution → commit).
- [ ] Workflow evidence stored in `docs/qa/results/latest/` using template files.
- [ ] Blocking workflow defects linked to defect log entries.

## 5) Permission checks

- [ ] Route permissions verified against role matrix for impacted routes.
- [ ] API permission checks verified for impacted endpoints.
- [ ] Unauthorized role attempts validated (expected 403/redirect/access denied).
- [ ] Admin-only actions confirmed inaccessible for non-admin roles.

## 6) Defect severity closure rules

- [ ] All `Severity 1` defects closed before release.
- [ ] All `Severity 2` defects either closed or approved with explicit rollback-safe waiver.
- [ ] `Severity 3+` defects triaged with owner + target date.
- [ ] Waivers documented in release notes and linked in QA results.

## 7) Reconciliation checks

- [ ] Canonical totals reconcile with compatibility/legacy views for impacted domains.
- [ ] Import reconciliation complete for any pending plan-edit notifications.
- [ ] KPI traceability reports reviewed for material variance.
- [ ] Audit/event logs confirm expected write paths were used.

## Exit criteria

Release is **approved** only when all boxes above are checked, evidence is archived, and sign-off includes Engineering, QA, and Domain Owner confirmation.
