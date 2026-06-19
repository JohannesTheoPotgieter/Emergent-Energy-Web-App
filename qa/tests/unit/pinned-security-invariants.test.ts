/**
 * Pinned security invariants from PR #739.
 *
 * Source-text level regression tests for the production-safety fixes
 * that landed via "fix: production safety (snapshot guards, RBAC,
 * webhook auth, error leaks)". These are deliberately string-level,
 * matching the convention in finance-snapshot-guards.test.ts and
 * api-error-leak-guards.test.ts: fast, no DB, catches the exact shape
 * of regression that re-introduces the original bug.
 *
 * Invariants pinned here:
 *   1. subcontractor-routes /supplier-details — bank fields gated to
 *      finance roles only, audit-logged on access.
 *   2. gates-routes — IN(...) clauses parameterised via sql.join,
 *      not built by string-quoting and sql.raw.
 *   3. meeting-routes /api/webhooks/read-ai — fail-closed in
 *      production when the shared secret env var is unset, and uses
 *      crypto.timingSafeEqual for the compare.
 *   4. ms-sync-routes /api/webhooks/graph — same shape as #3, plus
 *      reject empty/missing value:[] arrays so [].every(...) truthy
 *      behaviour can't authenticate a request.
 *   5. auth-context.clearRevokedSessionId — mirrors the in-memory
 *      clear to the revoked_sessions DB table so a cleared session
 *      doesn't get re-revoked on next process restart.
 *   6. lifecycle-routes merge handler — does not return raw err.message
 *      in the JSON body; throws ApiError instead.
 *   7. commissioning-dashboard-routes — `detail` field on 5xx
 *      responses is gated behind NODE_ENV !== "production".
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function windowAfter(haystack: string, needle: string, chars = 600): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return "";
  return haystack.slice(idx, idx + chars);
}

describe("subcontractor bank-detail RBAC — subcontractor-routes.ts", () => {
  const source = read("server/subcontractor-routes.ts");

  it("declares a live-ready allowlist for bank-detail access", () => {
    expect(
      source,
      "BANK_DETAIL_ROLES set must list the finance roles that may see decrypted bank fields",
    ).toMatch(
      /BANK_DETAIL_ROLES\s*=\s*new\s+Set\(\s*\[[^\]]*"COO_ADMIN"[^\]]*"CEO_ADMIN"[^\]]*"CFO"[^\]]*"ACCOUNTANT"[^\]]*\]\s*\)/,
    );
  });

  it("imports getEffectiveUser so the role check works for bearer + session auth", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bgetEffectiveUser\b[^}]*\}\s*from\s*["']\.\/auth-context["']/,
    );
  });

  it("supplier-details GET handler checks BANK_DETAIL_ROLES before decrypting bank fields", () => {
    const handler = windowAfter(source, "/api/subcontractor-dashboard/supplier-details/:name", 1500);
    expect(
      handler,
      "non-finance callers must see bank_account_number / bank_branch_code as null — decryptField output is gated on canSeeBankDetails",
    ).toMatch(/canSeeBankDetails\s*\?[\s\S]*decryptField/);
    expect(handler, "role check uses BANK_DETAIL_ROLES allowlist").toMatch(
      /BANK_DETAIL_ROLES\.has\(/,
    );
  });

  it("audit-logs bank-detail access (read_bank_details)", () => {
    const handler = windowAfter(source, "/api/subcontractor-dashboard/supplier-details/:name", 1500);
    expect(
      handler,
      "every successful bank-detail decrypt must emit an audit event so we can spot scraping",
    ).toMatch(/action:\s*["']read_bank_details["']/);
  });
});

describe("gates IN-clause SQL injection guard — gates-routes.ts", () => {
  const source = read("server/routes/gates-routes.ts");

  it("does not build IN(...) clauses via sql.raw + string-quoted values", () => {
    expect(
      source,
      "concatenating filter values into sql.raw is a SQL-injection sink the moment a route exposes the filter to user input — use sql.join with parameterised values",
    ).not.toMatch(/sql\.raw\(\s*statuses\s*\)/);
    expect(source).not.toMatch(/sql\.raw\(\s*codes\s*\)/);
  });

  it("uses sql.join for gateStatuses + stageCodes IN(...) lists", () => {
    expect(
      source,
      "gateStatuses + stageCodes filters must be passed via sql.join so each value is a parameter",
    ).toMatch(/sql\.join\(\s*filter\.gateStatuses\.map/);
    expect(source).toMatch(/sql\.join\(\s*filter\.stageCodes\.map/);
  });
});

describe("Read.ai webhook auth — meeting-routes.ts", () => {
  const source = read("server/meeting-routes.ts");

  it("imports timingSafeEqual from crypto", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*["']crypto["']/,
    );
  });

  it("fails closed in production when READAI_WEBHOOK_SECRET is unset", () => {
    const handler = windowAfter(source, "/api/webhooks/read-ai", 1500);
    expect(
      handler,
      "missing READAI_WEBHOOK_SECRET in production must reject (was previously fail-open — anyone could POST)",
    ).toMatch(
      /process\.env\.NODE_ENV\s*===\s*["']production["'][\s\S]*status\(\s*503\s*\)/,
    );
  });

  it("uses timingSafeEqual to compare the provided secret", () => {
    const handler = windowAfter(source, "/api/webhooks/read-ai", 1500);
    expect(
      handler,
      "string equality on secrets is timing-attack-able — use crypto.timingSafeEqual",
    ).toMatch(/timingSafeEqual\s*\(/);
  });
});

describe("MS Graph webhook auth — ms-sync-routes.ts", () => {
  const source = read("server/ms-sync-routes.ts");

  it("imports timingSafeEqual from crypto", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*["']crypto["']/,
    );
  });

  it("fails closed in production when GRAPH_WEBHOOK_CLIENT_STATE is unset", () => {
    const handler = windowAfter(source, "/api/webhooks/graph", 2000);
    expect(
      handler,
      "missing GRAPH_WEBHOOK_CLIENT_STATE in production must reject — was previously fail-open",
    ).toMatch(
      /process\.env\.NODE_ENV\s*===\s*["']production["'][\s\S]*status\(\s*503\s*\)/,
    );
  });

  it("rejects empty / missing value:[] payloads", () => {
    const handler = windowAfter(source, "/api/webhooks/graph", 2000);
    expect(
      handler,
      "[].every(...) returns true, so without an explicit empty-array reject an unauthenticated empty POST silently passes",
    ).toMatch(/Array\.isArray\(\s*notifications\s*\)[\s\S]*notifications\.length\s*===\s*0/);
  });

  it("uses timingSafeEqual for clientState compare", () => {
    const handler = windowAfter(source, "/api/webhooks/graph", 2000);
    expect(handler).toMatch(/timingSafeEqual\s*\(/);
  });

  it("does not log req.body in the [Reassign] Processing audit line", () => {
    const handler = windowAfter(source, "[Reassign] Processing", 200);
    expect(
      handler,
      "logging the full reassignment body bloats logs and risks leaking PII — keep field-level summary only",
    ).not.toMatch(/JSON\.stringify\(\s*req\.body\s*\)/);
  });
});

describe("revoked-session DB sync — auth-context.ts", () => {
  const source = read("server/auth-context.ts");

  it("clearRevokedSessionId mirrors the delete to the DB", () => {
    const fnBody = windowAfter(source, "export function clearRevokedSessionId", 600);
    expect(
      fnBody,
      "in-memory only clear lets the row in revoked_sessions outlive the clear; on next loadRevokedTokensFromDb the session gets re-revoked",
    ).toMatch(/db\.delete\(\s*revokedSessions\s*\)/);
  });

  it("imports eq so the DB delete can scope by sessionId", () => {
    expect(source).toMatch(/import\s*\{[^}]*\beq\b[^}]*\}\s*from\s*["']drizzle-orm["']/);
  });
});

describe("lifecycle merge handler error sanitisation — lifecycle-routes.ts", () => {
  const source = read("server/lifecycle-routes.ts");

  it("imports notFound from lib/api-error", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']\.\/lib\/api-error["']/,
    );
  });

  it("merge handler does not res.status(404).json({ error: err.message })", () => {
    const handler = windowAfter(source, "[lifecycle-board] POST merge error:", 600);
    expect(
      handler,
      "raw err.message in a 404 response leaks DB / Drizzle internals — throw notFound() and let the global handler format",
    ).not.toMatch(/res\.status\(\s*404\s*\)\.json\(\s*\{[^}]*err\.message/);
    expect(handler, "use thrown notFound() so the error handler sanitises").toMatch(
      /throw\s+notFound\(/,
    );
  });
});

describe("commissioning error-detail redaction — commissioning-dashboard-routes.ts", () => {
  const source = read("server/commissioning-dashboard-routes.ts");

  it("respondCommissioningError gates the detail field on NODE_ENV", () => {
    const fnBody = windowAfter(source, "function respondCommissioningError", 1200);
    expect(
      fnBody,
      "raw DB error messages must not flow to clients in prod — gate detail on NODE_ENV (matches lib/api-error.ts convention)",
    ).toMatch(/process\.env\.NODE_ENV\s*!==\s*["']production["']/);
  });
});
