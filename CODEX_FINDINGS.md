# CODEX Findings

- [Fixed] `server/middleware/requireRole.ts` previously trusted `req.user.role` directly without role normalization, which could cause inconsistent allow/deny behavior across role aliases/casing and make policy enforcement brittle. Hardened by normalizing both allowed roles and the authenticated user's role before checking access.
- [Verified] `requireAuth` in `server/auth-context.ts` returns HTTP 401 with `auth_required` payload for unauthenticated requests.
- [Verified] Permission role checks are derived from authenticated request context (`req.user` / effective user), not from request body fields.
