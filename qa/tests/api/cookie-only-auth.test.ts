/**
 * A3 closeout — Browser auth cookie-only contract test.
 *
 * Audit finding: browser auth was split between an httpOnly session cookie
 * and a localStorage-stored bearer token. We migrated browser users to
 * cookie-only auth (the bearer is retained for machine-to-machine clients).
 *
 * This test asserts the cookie path is sufficient on its own — i.e., a
 * client that sends ONLY the session cookie (no Authorization header) can
 * still authenticate against the protected `/api/auth/me` endpoint.
 *
 * If this test starts failing, browser users will be silently logged out
 * because the frontend no longer writes the bearer token to localStorage.
 *
 * Related:
 *   - client/src/lib/api.ts (setAuthToken, getAuthToken)
 *   - client/src/hooks/use-auth.tsx (eager localStorage cleanup)
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
  options: { body?: unknown; cookie?: string; token?: string } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

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
    // Empty / non-JSON body — leave data as null.
  }

  return {
    status: res.status,
    data,
    cookie: getCookieHeader(res.headers),
  };
}

describe("A3 — browser auth cookie-only contract", () => {
  let sessionCookie: string | null = null;

  beforeAll(async () => {
    const loginRes = await apiRequest<{ token?: string; user?: { id: number; email: string } }>(
      "POST",
      "/api/auth/login",
      { body: { username: "johannes", password: "2023" } },
    );

    expect(loginRes.status, JSON.stringify(loginRes.data)).toBe(200);
    expect(loginRes.cookie, "login must set a session cookie").toBeTruthy();
    sessionCookie = loginRes.cookie;
  });

  it("authenticates against /api/auth/me with the session cookie alone (no Bearer)", async () => {
    expect(sessionCookie).toBeTruthy();

    const res = await apiRequest<{ user: { id: number; email: string; role: string } }>(
      "GET",
      "/api/auth/me",
      { cookie: sessionCookie! },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data?.user, "user payload should be returned").toBeTruthy();
    expect(res.data?.user?.email).toBeTruthy();
  });

  it("rejects /api/auth/me when no cookie and no Bearer are sent", async () => {
    const res = await apiRequest("GET", "/api/auth/me");
    // 401 is correct; some routes redirect with 302 — we accept both
    // unauthenticated outcomes but never a 200.
    expect([401, 302, 403]).toContain(res.status);
  });

  it("logs out via cookie-only and the cookie is invalidated", async () => {
    expect(sessionCookie).toBeTruthy();

    const logoutRes = await apiRequest("POST", "/api/auth/logout", {
      cookie: sessionCookie!,
    });
    expect([200, 204]).toContain(logoutRes.status);

    // Subsequent /api/auth/me with the now-invalidated cookie must NOT
    // return a user payload.
    const meRes = await apiRequest<{ user?: unknown }>("GET", "/api/auth/me", {
      cookie: sessionCookie!,
    });
    expect([401, 302, 403]).toContain(meRes.status);
  });
});
