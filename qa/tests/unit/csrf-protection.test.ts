import { describe, expect, it, vi, beforeEach } from "vitest";
import { isCsrfExemptPath, CSRF_PROTECTED_METHODS, getCsrfExemptSummary } from "../../../server/middleware/csrf-config";
import { csrfProtection } from "../../../server/middleware/csrf";

// Mock Response
function mockRes() {
  const res: any = {
    cookie: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

// Mock Request
function mockReq(overrides: Partial<{ method: string; path: string; headers: Record<string, string> }> = {}) {
  return {
    method: overrides.method ?? "GET",
    path: overrides.path ?? "/api/test",
    headers: overrides.headers ?? {},
  } as any;
}

describe("CSRF configuration", () => {
  it("CSRF_PROTECTED_METHODS includes all state-changing HTTP methods", () => {
    expect(CSRF_PROTECTED_METHODS.has("POST")).toBe(true);
    expect(CSRF_PROTECTED_METHODS.has("PUT")).toBe(true);
    expect(CSRF_PROTECTED_METHODS.has("PATCH")).toBe(true);
    expect(CSRF_PROTECTED_METHODS.has("DELETE")).toBe(true);
  });

  it("GET and HEAD are NOT protected", () => {
    expect(CSRF_PROTECTED_METHODS.has("GET")).toBe(false);
    expect(CSRF_PROTECTED_METHODS.has("HEAD")).toBe(false);
  });

  // ── Exempt path matcher ──

  it("auth bootstrap paths are exempt", () => {
    expect(isCsrfExemptPath("/api/auth/login")).toBe(true);
    expect(isCsrfExemptPath("/api/auth/microsoft")).toBe(true);
    expect(isCsrfExemptPath("/api/auth/exchange-code")).toBe(true);
  });

  it("webhook paths are exempt", () => {
    expect(isCsrfExemptPath("/api/webhooks/graph")).toBe(true);
    expect(isCsrfExemptPath("/api/webhooks/read-ai")).toBe(true);
  });

  it("health check path is exempt", () => {
    expect(isCsrfExemptPath("/api/health")).toBe(true);
  });

  it("regular API paths are NOT exempt", () => {
    expect(isCsrfExemptPath("/api/projects")).toBe(false);
    expect(isCsrfExemptPath("/api/settings")).toBe(false);
    expect(isCsrfExemptPath("/api/work-items")).toBe(false);
    expect(isCsrfExemptPath("/api/smart-import/upload")).toBe(false);
  });

  it("substring tricks do not bypass matcher", () => {
    // Not a simple contains() check
    expect(isCsrfExemptPath("/api/webhooks/graph/evil")).toBe(false);
    expect(isCsrfExemptPath("/api/auth/login/extra")).toBe(false);
    expect(isCsrfExemptPath("/api/health/extra")).toBe(false);
  });

  it("getCsrfExemptSummary returns correct counts", () => {
    const summary = getCsrfExemptSummary();
    expect(summary.total).toBe(6); // 3 auth + 2 webhooks + 1 health
    expect(summary.auth).toBe(3);
    expect(summary.webhooks).toBe(2);
    expect(summary.health).toBe(1);
  });
});

describe("CSRF middleware behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET requests are not blocked (pass through)", () => {
    const req = mockReq({ method: "GET", path: "/api/projects" });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("POST to a protected route without CSRF token returns 403", () => {
    const req = mockReq({
      method: "POST",
      path: "/api/settings",
      headers: { cookie: "connect.sid=abc123" },
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid or missing CSRF token" });
  });

  it("PATCH to a protected route without CSRF token returns 403", () => {
    const req = mockReq({
      method: "PATCH",
      path: "/api/projects/1/update",
      headers: { cookie: "connect.sid=abc123" },
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("POST to a webhook route without CSRF token is allowed", () => {
    const req = mockReq({
      method: "POST",
      path: "/api/webhooks/graph",
      headers: {},
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("POST to read-ai webhook without CSRF token is allowed", () => {
    const req = mockReq({
      method: "POST",
      path: "/api/webhooks/read-ai",
      headers: {},
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("POST to auth login without CSRF token is allowed (auth bootstrap)", () => {
    const req = mockReq({
      method: "POST",
      path: "/api/auth/login",
      headers: {},
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("POST with valid CSRF token passes through", () => {
    const token = "abc123def456";
    const req = mockReq({
      method: "POST",
      path: "/api/settings",
      headers: {
        cookie: `csrf-token=${token}; connect.sid=session123`,
        "x-csrf-token": token,
      },
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("Bearer-only requests bypass CSRF validation", () => {
    const req = mockReq({
      method: "POST",
      path: "/api/v2/projects",
      headers: {
        authorization: "Bearer some-jwt-token",
        // No session cookie, no CSRF token
      },
    });
    const res = mockRes();
    const next = vi.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
