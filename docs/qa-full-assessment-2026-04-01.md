# Full-Stack QA Assessment (Frontend + API + Backend)

Date: 2026-04-01
Scope: static review + typecheck/lint/test signal

## What I ran

- `npm run check` (TypeScript compile check)
- `npm run lint` (ESLint)
- `npm run test:route-proof` (route smoke tests)

## Executive summary

The codebase is feature-rich but currently has significant quality debt concentrated in type safety, legacy routing, and test typing consistency. Primary production risk areas are:

1. **Type-check failures in QA/unit test code + one backend service typing failure** (blocks strict CI confidence).
2. **A very large legacy route file still active with `@ts-nocheck` and broad responsibility overlap**.
3. **High warning volume from lint (~11k warnings), mostly `any` and unused symbols, reducing signal-to-noise and maintainability.**
4. **Frontend consistency and empty-state UX appears uneven across pages/components, with inconsistent use of explicit empty/error fallback patterns.**

---

## Findings by layer

## 1) Backend / service layer

### 1.1 Strict typing break in transactional service code
- `npm run check` reports an implicit `any` in a DB transaction callback (`tx`) in `financial-review-service`.
- Risk: reduced type guarantees in critical approval workflow logic and easier regression introduction.
- Fix:
  - explicitly type `tx` with the Drizzle transaction type used in this project.
  - enable a lint/type gate for service files changed in PRs.

### 1.2 Legacy monolith route file still active
- `server/routes.ts` is marked frozen but still compiled and used, and currently has `// @ts-nocheck`.
- File carries large, mixed concerns (auth, upload, calculations, workflow, imports, etc.), and includes at least one no-op placeholder (`refreshDependentTaskStates`).
- Risk: hidden runtime defects, hard reviewability, and unsafe refactors.
- Fix:
  - split by bounded context and retire `server/routes.ts` via migration checklist.
  - fail CI on new additions to legacy route file.
  - remove `@ts-nocheck` incrementally by module extraction.

### 1.3 Error/logging hygiene
- Global and middleware code logs heavily to console in runtime paths.
- Risk: noisy logs, potential PII leakage in stack traces/message content, reduced observability quality.
- Fix:
  - route all runtime logs through structured logger abstraction with redaction.
  - make stack traces conditional and centrally controlled in production.

---

## 2) API layer

### 2.1 Versioning split (v2 + legacy) increases behavioral drift risk
- API v2 routes/controllers are in place, but legacy route surface remains registered via legacy register function.
- Risk: duplicated behavior, inconsistent permission checks/response shapes over time.
- Fix:
  - publish endpoint parity matrix (legacy → v2).
  - add contract tests on response schemas for both layers during migration.
  - hard stop new endpoint additions in legacy path.

### 2.2 Controller typing uses frequent `(req.user as any)`
- v2 controller frequently accesses `req.user` through `as any` casts.
- Risk: subtle auth/permission bugs if user object shape changes.
- Fix:
  - define and enforce a shared typed auth principal interface.
  - create helper `getAuthenticatedUser(req)` with runtime guard + typed return.

---

## 3) Frontend layer

### 3.1 Type safety and maintainability debt
- Lint output shows extensive `@typescript-eslint/no-explicit-any` and unused-variable warnings across pages/components.
- Risk: brittle UI behavior, hard-to-track runtime errors, reduced IDE/refactor reliability.
- Fix:
  - enforce “no new `any`” per changed file.
  - prioritize high-traffic screens for type cleanup.
  - remove dead imports/unused state as part of each feature PR.

### 3.2 Empty/error/loading state consistency
- Some components/pages implement explicit skeleton/empty state patterns, but coverage is inconsistent across the large page surface.
- Risk: blank/unclear UI in edge cases and degraded user trust.
- Fix:
  - standardize a page-state pattern (`loading`, `error`, `empty`, `success`) and apply per route.
  - add a QA checklist item requiring each data-bound view to prove all 4 states.

### 3.3 Date/time display risk in UI
- Dashboard event rendering constructs dates via string concatenation and locale formatting logic.
- Risk: timezone edge-case confusion around “Today/Tomorrow” labels.
- Fix:
  - normalize server timestamps and client timezone handling with a single date utility.
  - add unit tests around boundary times and locale assumptions.

---

## 4) Test & CI health

### 4.1 Type-check currently fails on test files
- Missing test globals import/setup in at least one test file and several test typing issues.
- Risk: CI gate instability and lower trust in tests.
- Fix:
  - standardize test environment typing (`vitest` globals or explicit imports project-wide).
  - add small codemod/lint rule to enforce test style consistency.

### 4.2 Positive signal: route proof smoke test is green
- `test:route-proof` passes, indicating core route registration integrity for tested cases.
- Action:
  - expand this suite to include API v2 critical workflow paths.

---

## Prioritized backlog (fix first)

1. **P0**: Resolve `npm run check` failures (service implicit any + failing unit test typing).
2. **P0**: Block further growth of legacy `server/routes.ts`; migrate highest-risk handlers first.
3. **P1**: Introduce “no new `any`” and “no new unused vars” CI guard for changed files.
4. **P1**: Standardize frontend state handling for every data-driven page (loading/error/empty/success).
5. **P2**: Replace controller `req.user as any` with typed auth principal helper.
6. **P2**: Add API schema contract tests for legacy/v2 parity until cutover complete.

---

## Suggested QA implementation plan (2 weeks)

### Week 1
- Stabilize type-check and tests.
- Add changed-files lint/type quality gates.
- Freeze legacy route additions.

### Week 2
- Migrate top-risk legacy route slices.
- Roll out standardized page-state wrappers on top 10 routes by usage.
- Add API v2 contract checks for finance/work-items/quality endpoints.

