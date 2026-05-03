/**
 * B4 (audit closeout) — COS recognition requires linked invoice evidence.
 *
 * Business rule (from the plain-English breakdown):
 *   "B4. COS should be recognized with invoice linked to it (evidence)"
 *
 * And the follow-up: option (b) — admin override with reason is allowed,
 * restricted to COO / CFO / PFM / CEO, and every override must be
 * recorded in the audit trail.
 *
 * Enforcement layers:
 *   1. POST /api/cos-tracker/toggle-realised/:id (normal path)
 *        - Requires a non-empty, non-placeholder invoice number
 *        - Requires an invoice date
 *        - Gated to requireAdmin (COO_ADMIN, CEO_ADMIN)
 *        - Every flip is audit-logged as cos.realised_with_invoice
 *   2. POST /api/cos-tracker/override-status/:id (override path)
 *        - Requires a non-empty `reason` in the body
 *        - Gated to requireCosOverrideRole (COO_ADMIN, CEO_ADMIN, CFO,
 *          PROGRAM_FINANCE_MANAGER)
 *        - Every override is audit-logged as cos.override_applied
 *
 * This test file asserts the public contract of both endpoints by:
 *   - hitting them with malformed requests and verifying the error shape,
 *   - hitting them with a non-existent id to isolate the validation path
 *     from the DB-write path.
 *
 * The test skips the happy-path insertion flow because it needs a valid
 * normalized_cost_line row, which requires a live project and import
 * run — that's covered by the release gate.
 */

import { beforeAll, describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

type ApiResponse<T = unknown> = {
  status: number;
  data: T;
  cookie: string | null;
};

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

function getCookieHeader(headers: Headers): string | null {
  const withSetCookie = headers as HeadersWithSetCookie;
  const setCookieHeaders =
    typeof withSetCookie.getSetCookie === "function"
      ? withSetCookie.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];
  const cookies = setCookieHeaders.map((v) => v.split(";")[0]).filter(Boolean);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

async function apiRequest<T = unknown>(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) {
    headers.Cookie = options.cookie;
    const csrfMatch = options.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
    if (csrfMatch) headers["X-CSRF-Token"] = decodeURIComponent(csrfMatch[1]);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  let data: T = null as T;
  try {
    data = (await res.json()) as T;
  } catch {
    // empty / non-JSON body — leave as null
  }

  return { status: res.status, data, cookie: getCookieHeader(res.headers) };
}

async function login(username: string, password: string): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { body: { username, password } });
  expect(res.status, `login for ${username} should succeed`).toBe(200);
  expect(res.cookie, `login for ${username} should set a cookie`).toBeTruthy();
  return res.cookie!;
}

describe("B4 — COS recognition requires linked invoice evidence", () => {
  let adminCookie = "";
  let restrictedCookie = "";

  beforeAll(async () => {
    // COO_ADMIN — passes requireAdmin AND requireCosOverrideRole.
    adminCookie = await login("johannes", "2023");
    // PROJECT_MANAGER_SITE — should be rejected by both gates.
    restrictedCookie = await login("opsmanager31", "2035");
  });

  it("POST /api/cos-tracker/toggle-realised rejects missing `realised` boolean with 400", async () => {
    const res = await apiRequest<{ error: string }>(
      "PATCH",
      "/api/cos-tracker/toggle-realised/999999999",
      { body: {}, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toMatch(/realised \(boolean\) required/);
  });

  it("POST /api/cos-tracker/toggle-realised rejects non-admin callers with 403", async () => {
    const res = await apiRequest<{ error: string }>(
      "PATCH",
      "/api/cos-tracker/toggle-realised/999999999",
      { body: { realised: true }, cookie: restrictedCookie },
    );
    expect(res.status).toBe(403);
    // Task #101 — requireAdmin now delegates to
    // requirePermission('admin','edit'), which returns the canonical
    // `forbidden` error code instead of the legacy `admin_required`.
    expect(res.data?.error).toBe("forbidden");
  });

  it("POST /api/cos-tracker/toggle-realised returns 404 for a non-existent expense id", async () => {
    const res = await apiRequest<{ error: string }>(
      "PATCH",
      "/api/cos-tracker/toggle-realised/999999999",
      { body: { realised: true }, cookie: adminCookie },
    );
    // 404 proves the validation passed (we got to the find-expense step)
    // and the placeholder / missing-invoice checks fire only on a real row.
    expect([404]).toContain(res.status);
    expect(res.data?.error).toMatch(/not found/i);
  });

  it("POST /api/cos-tracker/override-status rejects missing reason when setting an override with 400 and missing_override_reason", async () => {
    const res = await apiRequest<{ error: string; message?: string }>(
      "PATCH",
      "/api/cos-tracker/override-status/999999999",
      { body: { cosStatus: "COS Realised" }, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toBe("missing_override_reason");
    expect(res.data?.message).toMatch(/reason is required/i);
  });

  it("POST /api/cos-tracker/override-status accepts null cosStatus without a reason (clearing the override)", async () => {
    const res = await apiRequest<{ error: string }>(
      "PATCH",
      "/api/cos-tracker/override-status/999999999",
      { body: { cosStatus: null }, cookie: adminCookie },
    );
    // Null clear path: body validation passes, then the DB find fails → 404.
    // Either 404 (no row) or 200 (hypothetical row) is acceptable here — the
    // important assertion is that we did NOT get the missing_override_reason
    // 400 that the previous test hit.
    expect([200, 404]).toContain(res.status);
    if (res.status === 400) {
      // Belt-and-braces: if it DID return 400, it must not be the reason error.
      expect(res.data?.error).not.toBe("missing_override_reason");
    }
  });

  it("POST /api/cos-tracker/override-status rejects invalid cosStatus values", async () => {
    const res = await apiRequest<{ error: string }>(
      "PATCH",
      "/api/cos-tracker/override-status/999999999",
      { body: { cosStatus: "frobnicate", reason: "x" }, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toMatch(/cosStatus must be/);
  });

  it("POST /api/cos-tracker/override-status rejects non-eligible roles with 403", async () => {
    const res = await apiRequest<{ error: string; eligibleRoles?: string[] }>(
      "PATCH",
      "/api/cos-tracker/override-status/999999999",
      {
        body: { cosStatus: "COS Realised", reason: "trying override as non-admin" },
        cookie: restrictedCookie,
      },
    );
    expect(res.status).toBe(403);
    // Must return the widened role error (not plain admin_required).
    expect(res.data?.error).toBe("forbidden");
    expect(Array.isArray(res.data?.eligibleRoles)).toBe(true);
    for (const role of ["COO_ADMIN", "CEO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER"]) {
      expect(res.data?.eligibleRoles).toContain(role);
    }
  });
});
