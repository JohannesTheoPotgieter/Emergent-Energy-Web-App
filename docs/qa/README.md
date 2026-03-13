# QA Stability Proof System

This folder is the repeatable framework for proving release stability.

## What is included

1. `docs/architecture/source-of-truth-matrix.md`
   - Declares canonical data ownership and migration status by domain.
2. `docs/qa/app-route-inventory.md`
   - Route/view/action inventory used by smoke and permission testing.
3. `docs/qa/release-gate.md`
   - Mandatory release checklist and defect closure rules.
4. `docs/qa/templates/`
   - Standard templates for defect logging, route coverage, workflow evidence, and role audits.
5. `docs/qa/results/latest/` and `docs/qa/results/archive/`
   - Storage for current-cycle and historical QA evidence.

## How to use this in each release

1. Update source-of-truth matrix for any changed domain.
2. Update route inventory when routes/components/permissions change.
3. Run QA scripts (`test`, `test:api`, `test:smoke`, `test:routes`, `qa:report`).
4. Store evidence using templates under `docs/qa/results/latest/`.
5. Complete the release gate checklist before sign-off.
6. Move finalized evidence to `docs/qa/results/archive/<release-tag>/`.

## Ground rules

- Never mark checks as passed without executed evidence.
- Keep evidence links durable (files/paths in-repo when possible).
- Treat unresolved severity 1 defects as release blockers.
