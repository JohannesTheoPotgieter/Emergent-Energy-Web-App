# Release Gate Checklist (Stability Proof)

This release gate is **enforced** and must be run before every production release.

## Commands (run in order)

1. Generate reconciliation evidence (fails on reconciliation `fail`):

```bash
npm run reconciliation:report
```

2. Execute the release gate (runs required tests + evidence checks):

```bash
npm run release:gate
```

The gate writes `qa/reports/release-gate-result.json` and exits non-zero for `warning` or `fail`.

## What the gate enforces

The script `qa/release-gate.ts` blocks release when any required proof is missing or failing:

1. **API test gate**
   - Runs `npm run test:api`
   - Must pass

2. **Smoke test gate**
   - Runs `npm run test:smoke`
   - Must pass

3. **Workflow test gate**
   - Runs `npm run test:routes` by default (override with `WORKFLOW_TEST_COMMAND`)
   - Must pass

4. **Reconciliation gate**
   - Requires `qa/reports/reconciliation-status.json` (override with `RELEASE_RECONCILIATION_FILE`)
   - Uses reconciliation status (`pass` | `warning` | `fail`)
   - `warning` requires manual signoff and still blocks automatic release
   - `fail` blocks release

5. **Critical defect gate**
   - Requires `FINAL_DEFECT_REGISTER.md` by default (override with `CRITICAL_DEFECT_FILE`)
   - Blocks release if open `Critical` / `High` / `Severity 1` defects are present

## Configurable environment variables

- `WORKFLOW_TEST_COMMAND` (default: `npm run test:routes`)
- `RELEASE_RECONCILIATION_FILE` (default: `qa/reports/reconciliation-status.json`)
- `CRITICAL_DEFECT_FILE` (default: `FINAL_DEFECT_REGISTER.md`)

## Manual signoff expectations

Manual signoff is still required for:

- Any gate result that includes `warning`
- Workflow evidence quality (content review in addition to command success)
- Business owner confirmation that changed domains have updated source-of-truth mapping

## Non-negotiable rule

A release must not be marked passing when required proof is missing, warning, or failing.
