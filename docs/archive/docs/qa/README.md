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
npm run check
npm run test
npm run test:api
npm run test:smoke
npm run test:routes
npm run test:workflows
npm run qa:report
npm run reconciliation:report
npm run release:gate
npm run qa:full-proof
```

`test:api`, `test:smoke`, and `test:workflows` now self-bootstrap the app server through `script/run-with-app.ts`, so engineers/CI no longer need to manually start localhost:5000 before those packs run.

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


## Deterministic environment bootstrap

1. Copy `.env.test.example` to `.env.test` (or export those variables in CI).
2. Ensure dependencies are installed: `npm ci`.
3. Install Playwright Chromium once per machine/runner: `npx playwright install chromium`.
4. Run full release proof: `npm run qa:full-proof`.

`qa:full-proof` executes the required release command chain in deterministic order and regenerates QA/reconciliation/release-gate evidence artifacts.
