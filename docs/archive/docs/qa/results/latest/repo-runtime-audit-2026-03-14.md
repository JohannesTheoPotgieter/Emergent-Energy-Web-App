# Repository Runtime Audit — 2026-03-14

## Scope
Repository-level trust audit focused on routing/page registry integrity, role and permission enforcement, startup/runtime boot risks, source-of-truth drift, release-gate trustworthiness, QA gaps, and high-risk operational workflows.

## Key findings

1. **Release gate is currently blocked by missing executable evidence, despite prior PASS-style summary artifacts.**
   - `qa/release-gate.ts` requires role audit entries for critical routes and a reconciliation evidence file; both are mandatory checks. 
   - `docs/qa/results/latest/role-permission-audit.md`, `workflow-evidence-log.md`, and `route-coverage-matrix.md` are still template/pending state.

2. **Route and permission source-of-truth are not aligned for admin-moved pages.**
   - Smart Import and Excel Updates were moved under `/admin/*` in the page registry with legacy redirects.
   - App-level `RoleGuard` denies all `/admin*` paths for non-superadmins, even when entity permission defaults grant access to non-admin operational roles.

3. **Route-proof and workflow pass signals can hide functional gaps.**
   - `qa/utils/route-proof.ts` proves only static source markers (regex over TSX source), not rendered behavior or API success.
   - `script/test-routes.ts` never fails when route inventory drifts; it prints TODOs and exits success.

4. **Permission enforcement is duplicated across multiple layers with mixed role vocabularies.**
   - Runtime checks mix `requirePermission(...)`, route-local role checks (`isPdRole`, `canCreatePdTicket`), and custom admin role lists (`smart-import-routes`).
   - Aliasing (`admin` -> `COO_ADMIN`) is done in middleware but route-local checks still include raw `admin` strings, increasing drift risk.

5. **Startup boot path is high-risk due to broad side effects during process start.**
   - `server/index.ts` runs large sets of schema mutations, seeders, backfills, and service starts in one boot sequence controlled by multiple flags.
   - This couples availability to migration/backfill stability and makes startup failures harder to isolate.

6. **Authentication and runtime assumptions are strict and can hard-fail deployment start.**
   - `SESSION_SECRET` is mandatory in all environments by env guard.
   - Several workflow/API tests assume a live server at `http://localhost:5000` with seeded users and known passwords.

7. **Quick-action and route registry drift risk remains visible.**
   - Shared quick actions still reference routes not represented as routable entries in page registry (`/admin/approvals`, `/engineering/inbox`), creating dead-link risk.

8. **Source-of-truth migration is documented as in-flight, but operationally still dual-write/compatibility-heavy.**
   - Canonical boundaries declare work-items-first, but compatibility mirroring and legacy table writes remain active.
   - This increases reconciliation burden and drift probability under partial failures.
