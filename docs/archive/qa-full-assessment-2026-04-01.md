# Full-Stack QA Assessment (Simple Version)

Date: 2026-04-01  
Scope: Frontend + API + Backend

## What we are trying to do

We want the app to be:
- **Reliable** (fewer runtime bugs)
- **Safe to change** (strong typing, cleaner structure)
- **Consistent for users** (clear loading/error/empty states)
- **CI-friendly** (typecheck/test/lint should be trusted)

This report explains what is broken now, why it matters, and what to fix first.

---

## Checks run

1. `npm run check` → **Failed**
2. `npm run lint` → **Passed with many warnings**
3. `npm run test:route-proof` → **Passed**

---

## What is wrong right now (plain English)

## 1) Most urgent issues (fix first)

### A. TypeScript check fails
- The codebase is not type-clean right now.
- Some unit tests have typing/setup problems.
- One backend service has an implicit `any` in a DB transaction callback.

**Why this matters:** if typecheck is red, regressions are easier to introduce and harder to catch early.

### B. Old “legacy routes” file is still huge and active
- `server/routes.ts` is marked as frozen but still used.
- It has `@ts-nocheck` and mixes many responsibilities in one file.

**Why this matters:** this creates a high-risk area where bugs hide and refactors are dangerous.

---

## 2) API layer problems

### A. Two API styles are active (legacy + v2)
- v2 exists, but legacy surface is still present.

**Why this matters:** behavior can drift (different validations, permissions, response shapes).

### B. Controller typing is weak in places
- Some v2 code uses `(req.user as any)` often.

**Why this matters:** auth/user-shape bugs can slip through when types are bypassed.

---

## 3) Frontend problems

### A. Large quality debt from `any` and unused code
- Lint shows many warnings (mostly explicit `any` and unused variables/imports).

**Why this matters:** harder to maintain, harder to refactor safely, harder to trust IDE/type hints.

### B. Empty/error/loading states are not consistently enforced
- Some screens handle states well, others are less explicit.

**Why this matters:** users can hit unclear or blank-looking screens in edge cases.

### C. Date rendering edge-case risk
- Dashboard event date labels (“Today/Tomorrow”) use local formatting logic.

**Why this matters:** timezone boundaries can display confusing labels for some users.

---

## Clear priority list (what to fix in order)

## P0 (do now)
1. Make `npm run check` pass (tests + backend implicit any).
2. Stop adding anything new to `server/routes.ts`.
3. Start moving high-risk legacy handlers into domain route files.

## P1 (next)
4. Add CI rule: no new `any` and no new unused vars in changed files.
5. Standardize page state pattern for all data views: **loading / error / empty / success**.

## P2 (after stabilization)
6. Replace repeated `(req.user as any)` with a typed auth helper.
7. Add contract tests to ensure legacy and v2 endpoints stay aligned during migration.

---

## 2-week action plan

## Week 1
- Fix typecheck failures.
- Normalize test typing/setup.
- Add changed-files quality gates (no new `any`, no new unused vars).
- Freeze legacy-route growth.

## Week 2
- Migrate highest-risk legacy route slices.
- Apply standard page-state handling to top-used screens.
- Add API contract tests for critical v2 areas (finance, work-items, quality).

---

## Bottom line

The system is functional, but quality debt is slowing safe delivery.  
If we complete the **P0** items first, we reduce immediate risk and make every future feature easier and safer to ship.
