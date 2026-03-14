# QA Stability Proof System

This folder defines the minimum evidence required to prove release readiness.

## Proof artifacts

- `docs/architecture/source-of-truth-matrix.md` — canonical domain ownership and migration status.
- `docs/qa/app-route-inventory.md` — route/component/permission/api/action inventory seeded from route registry.
- `docs/qa/release-gate.md` — exact release blocking policy.
- `docs/qa/templates/` — reusable templates for evidence capture.
- `docs/qa/results/latest/` — current release evidence.
- `docs/qa/results/archive/` — historical release evidence.

## Commands

```bash
npm run test
npm run test:api
npm run test:smoke
npm run test:routes
npm run test:workflows
npm run qa:report
npm run reconciliation:report
npm run release:gate
```

## Standard release flow

1. Update source-of-truth matrix for changed domains.
2. Update route inventory when routes/components/permissions change.
3. Run test suites and collect logs.
4. Capture evidence in `docs/qa/results/latest/` using templates.
5. Run reconciliation + release gate.
6. Archive release evidence into `docs/qa/results/archive/<release-tag>/`.

## Evidence integrity rules

- Never record a pass without executable evidence.
- Keep links durable and stored in-repo where possible.
- Treat open P0/P1 defects and missing critical-page role validation as blockers.
