/**
 * CSRF Exemption Configuration
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Protected methods: POST, PUT, PATCH, DELETE                             │
 * │                                                                         │
 * │ Exemption categories:                                                   │
 * │                                                                         │
 * │ 1. AUTH_BOOTSTRAP — Initial authentication routes where no session      │
 * │    exists yet. The user cannot have a CSRF token before login.          │
 * │    - /api/auth/login                                                    │
 * │    - /api/auth/microsoft                                                │
 * │    - /api/auth/exchange-code (OAuth2 code exchange after redirect)      │
 * │                                                                         │
 * │ 2. WEBHOOKS — External services POST data to our server. They cannot    │
 * │    obtain or send our CSRF cookie/header. These endpoints MUST have     │
 * │    their own authentication (signature verification, shared secrets).   │
 * │    - /api/webhooks/graph (Microsoft Graph subscription notifications)   │
 * │    - /api/webhooks/read-ai (Read.ai meeting summary webhooks)          │
 * │                                                                         │
 * │ 3. HEALTH_CHECK — Unauthenticated health/readiness probes from         │
 * │    infrastructure (load balancers, monitoring). GET-only in practice,   │
 * │    but exempted to prevent false positives if methods change.           │
 * │    - /api/health                                                        │
 * │                                                                         │
 * │ How the frontend obtains and sends the CSRF token:                      │
 * │  1. The server sets a non-httpOnly cookie `csrf-token` on every         │
 * │     response (so JavaScript can read it).                               │
 * │  2. client/src/lib/queryClient.ts reads the cookie and attaches it      │
 * │     as the `X-CSRF-Token` header on POST/PUT/PATCH/DELETE requests.     │
 * │  3. The server validates: header value must match cookie value.          │
 * │  4. Bearer-token-only requests (no session cookie) skip CSRF since      │
 * │     the browser cannot auto-attach Authorization headers.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** HTTP methods that require CSRF validation. */
export const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── Exemption definitions by category ───────────────────────────────────────

/** Routes where no session/CSRF cookie can exist yet (auth bootstrap). */
const AUTH_BOOTSTRAP_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/microsoft",
  "/api/auth/exchange-code",
]);

/** External webhook endpoints — these services cannot send our CSRF token.
 *  Each MUST have its own sender authentication (signature, shared secret). */
const WEBHOOK_PATHS = new Set([
  "/api/webhooks/graph",
  "/api/webhooks/read-ai",
]);

/** Infrastructure probes — GET-only in practice but exempted defensively. */
const HEALTH_CHECK_PATHS = new Set([
  "/api/health",
]);

// ── Matcher helper ──────────────────────────────────────────────────────────

/**
 * Returns true if the given pathname should bypass CSRF validation.
 * Uses explicit Set lookups — no wildcards, no substring matching, no regex.
 */
export function isCsrfExemptPath(pathname: string): boolean {
  return AUTH_BOOTSTRAP_PATHS.has(pathname)
    || WEBHOOK_PATHS.has(pathname)
    || HEALTH_CHECK_PATHS.has(pathname);
}

/** Returns summary counts for startup logging. */
export function getCsrfExemptSummary(): { total: number; auth: number; webhooks: number; health: number } {
  return {
    total: AUTH_BOOTSTRAP_PATHS.size + WEBHOOK_PATHS.size + HEALTH_CHECK_PATHS.size,
    auth: AUTH_BOOTSTRAP_PATHS.size,
    webhooks: WEBHOOK_PATHS.size,
    health: HEALTH_CHECK_PATHS.size,
  };
}
