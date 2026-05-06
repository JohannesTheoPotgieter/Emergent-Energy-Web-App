# EE-QA-015 — File-size workstream plan

The audit flagged 48 source files above 1,500 LOC, with the worst at 7,675 LOC. Splitting them is **not** a single PR — it would create unbearable merge conflicts with every other in-flight branch. This document is the per-domain sequence to follow, ordered by ROI.

## CI ratchet

`qa/tests/unit/file-size-ratchet.test.ts` (added in Wave 6.6) prevents the cliff from getting worse:

- No baseline file may grow above its captured LOC + 50 buffer.
- No new file may land above 1,500 LOC.
- Cleanups must refresh `qa/fixtures/file-size-baseline.json` to lock the win.

The ratchet is the floor; this document is the plan for actively shrinking the baseline.

## Per-domain split sequence

Each row is one PR. Do them in order — earlier ones are higher-ROI / lower-conflict-risk than later ones.

### 1. `server/departments/finance-routes.ts` (7,675 LOC) — split into 5

Highest-priority. Split along these natural domain boundaries:

| New file | Roughly contains |
|---|---|
| `server/routes/finance-cashflow.routes.ts` | `/api/cashflow/*` and `/api/cashflow-2026/*` handlers (move existing `register-cashflow-2026-routes.ts` content here too) |
| `server/routes/finance-cos.routes.ts` | `/api/cos-tracker/*`, `/api/cos-control/*` |
| `server/routes/finance-revenue.routes.ts` | `/api/revenue-tracker/*`, `/api/inflows/*` |
| `server/routes/finance-gp.routes.ts` | `/api/gp-tracker/*` |
| `server/departments/finance-routes.ts` | (kept, but only re-exports + the small "finance-summary" cross-cutting endpoints) |

Each split file should stay under 1,500 LOC. After each split, refresh the baseline.

### 2. Client mega-pages

| File | LOC | Split shape |
|---|---|---|
| `client/src/pages/EngineeringTasksPage.tsx` | 4,869 | Lift the inline drawer + filter components into `client/src/components/engineering-tasks/`. Move the column-config + grid logic into a hook. |
| `client/src/pages/smart-import.tsx` | 4,759 | Lift the wizard steps into `client/src/components/smart-import/wizard/`. Each step is its own file. |
| `client/src/pages/projects.tsx` | 2,813 | Extract the table + filter shell from the page body. |
| `client/src/components/tabs/UnifiedPlanTab.tsx` | 2,976 | Extract the Gantt rendering into a sub-component. |

### 3. Server route mega-files

| File | LOC | Split shape |
|---|---|---|
| `server/engineering-routes.ts` | 3,684 | Split into `engineering-tickets.routes.ts`, `engineering-stages.routes.ts`, `engineering-monthly-report.routes.ts` |
| `server/smart-import-routes.ts` | 3,656 | Move the import-execution branch into `server/imports/` (already partly done). |
| `server/quality-routes.ts` | 2,692 | Split NCR vs checklist vs commissioning. |
| `server/routes/quickbooks-invoice-matches.routes.ts` | 2,558 | Extract the cascade-proposal handler into its own file. |
| `server/services/quickbooks-reconciliation-service.ts` | 2,504 | Already part-done in EE-QA-011 Wave 5; refresh after deciding what stays in the service vs the cascade-proposals service. |
| `server/lifecycle-routes.ts` | 2,406 | Split decisions vs requirements vs auto-evaluator endpoints. |
| `server/lib/import/commit-executor.ts` | 2,406 | Extract the per-table writer into one file per table family. |

### 4. Lower-priority

The remaining ~30 files between 1,500 and 2,200 LOC are not as urgent. Many will resolve naturally as their domain owners do other work. Do not actively refactor them; just don't let them grow.

## Acceptance per PR

- `npm run check`, `npm run test`, `npm run lint` (errors only) all green.
- Baseline JSON refreshed in the same PR (the ratchet test fails otherwise).
- Functional behaviour unchanged — the routes / components must register / render the same way.
- Split files keep snapshot-guard, RBAC, and audit-write parity (don't drop these in the move).

## Out of scope for any single PR

- Renaming legacy route patterns (`server/<x>-routes.ts` → `server/routes/<x>.routes.ts`).
- Changing repository layer signatures.
- Touching business logic.

These are separate workstreams.
