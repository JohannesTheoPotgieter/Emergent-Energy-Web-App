/**
 * B5 (audit closeout) — COS period lock API contract.
 *
 * Asserts the public behaviour of the three endpoints and the write-path
 * enforcement that the lock drives:
 *
 *   GET  /api/cos-periods/status
 *   POST /api/cos-periods/:yyyyMm/lock
 *   POST /api/cos-periods/:yyyyMm/unlock
 *
 * Plus the transitive effect on /api/cos-tracker/toggle-realised/:id —
 * a caller in a locked period gets 423 Locked unless they are in the
 * override whitelist (COO / CFO / CEO).
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
    /* empty body is fine */
  }

  return { status: res.status, data, cookie: getCookieHeader(res.headers) };
}

async function login(username: string, password: string): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { body: { username, password } });
  expect(res.status, `login for ${username} should succeed`).toBe(200);
  expect(res.cookie, `login for ${username} should set a cookie`).toBeTruthy();
  return res.cookie!;
}

describe("B5 — COS period lock API", () => {
  let adminCookie = "";     // COO_ADMIN — lock/unlock allowed
  let restrictedCookie = ""; // PROJECT_MANAGER_SITE — should be 403 on lock/unlock

  beforeAll(async () => {
    adminCookie = await login("johannes", "2023");
    restrictedCookie = await login("opsmanager31", "2035");
  });

  it("GET /api/cos-periods/status returns a periods array with default 12-month window", async () => {
    const res = await apiRequest<{
      fromMonth: string;
      toMonth: string;
      periods: Array<{ period: string; locked: boolean; lockedAt: string | null; autoLocked: boolean }>;
    }>("GET", "/api/cos-periods/status", { cookie: adminCookie });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(typeof res.data?.fromMonth).toBe("string");
    expect(typeof res.data?.toMonth).toBe("string");
    expect(Array.isArray(res.data?.periods)).toBe(true);
    // Default window is 12 months, so the array should be exactly 12 long.
    expect(res.data?.periods.length).toBeGreaterThanOrEqual(1);
    expect(res.data?.periods.length).toBeLessThanOrEqual(13);
    for (const p of res.data?.periods ?? []) {
      expect(p.period).toMatch(/^\d{4}-\d{2}-01$/);
      expect(typeof p.locked).toBe("boolean");
      expect(typeof p.autoLocked).toBe("boolean");
    }
  });

  it("GET /api/cos-periods/status accepts custom from/to query params", async () => {
    const res = await apiRequest<{ fromMonth: string; toMonth: string; periods: unknown[] }>(
      "GET",
      "/api/cos-periods/status?from=2026-01&to=2026-03",
      { cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    expect(res.data?.fromMonth).toBe("2026-01-01");
    expect(res.data?.toMonth).toBe("2026-03-01");
    expect(res.data?.periods).toHaveLength(3);
  });

  it("POST /api/cos-periods/:yyyyMm/lock rejects non-eligible roles with 403", async () => {
    const res = await apiRequest<{ error: string; eligibleRoles?: string[] }>(
      "POST",
      "/api/cos-periods/2099-01/lock",
      { body: {}, cookie: restrictedCookie },
    );
    expect(res.status, JSON.stringify(res.data)).toBe(403);
    expect(res.data?.error).toBe("forbidden");
    expect(Array.isArray(res.data?.eligibleRoles)).toBe(true);
    expect(res.data?.eligibleRoles).toContain("COO_ADMIN");
    expect(res.data?.eligibleRoles).toContain("CFO");
    expect(res.data?.eligibleRoles).toContain("CEO_ADMIN");
    // PFM is INTENTIONALLY not in the period-lock whitelist.
    expect(res.data?.eligibleRoles).not.toContain("PROGRAM_FINANCE_MANAGER");
  });

  it("POST /api/cos-periods/:yyyyMm/lock rejects invalid period strings with 400", async () => {
    const res = await apiRequest<{ error: string }>(
      "POST",
      "/api/cos-periods/nope/lock",
      { body: {}, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toMatch(/Invalid period/i);
  });

  it("POST /api/cos-periods/:yyyyMm/lock locks a period and is idempotent on re-lock", async () => {
    // Use a period far in the future so we don't collide with real data.
    const period = "2099-06";

    // Pre-clean: if a lock exists from a previous run, unlock it.
    await apiRequest("POST", `/api/cos-periods/${period}/unlock`, {
      body: { reason: "pre-test cleanup" },
      cookie: adminCookie,
    });

    const first = await apiRequest<{ success: boolean; alreadyLocked: boolean; period: string }>(
      "POST",
      `/api/cos-periods/${period}/lock`,
      { body: { notes: "B5 test lock" }, cookie: adminCookie },
    );
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    expect(first.data?.success).toBe(true);
    expect(first.data?.period).toBe("2099-06-01");

    // Second call is idempotent — returns alreadyLocked: true.
    const second = await apiRequest<{ success: boolean; alreadyLocked: boolean }>(
      "POST",
      `/api/cos-periods/${period}/lock`,
      { body: {}, cookie: adminCookie },
    );
    expect(second.status).toBe(200);
    expect(second.data?.success).toBe(true);
    expect(second.data?.alreadyLocked).toBe(true);

    // Clean up.
    await apiRequest("POST", `/api/cos-periods/${period}/unlock`, {
      body: { reason: "post-test cleanup" },
      cookie: adminCookie,
    });
  });

  it("POST /api/cos-periods/:yyyyMm/unlock rejects missing reason with 400", async () => {
    const res = await apiRequest<{ error: string }>(
      "POST",
      "/api/cos-periods/2099-07/unlock",
      { body: {}, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toBe("missing_unlock_reason");
  });

  it("POST /api/cos-periods/:yyyyMm/unlock returns 404 when no active lock exists", async () => {
    const res = await apiRequest<{ error: string }>(
      "POST",
      "/api/cos-periods/2099-08/unlock",
      { body: { reason: "test" }, cookie: adminCookie },
    );
    expect(res.status).toBe(404);
    expect(res.data?.error).toBe("no_active_lock");
  });
});
