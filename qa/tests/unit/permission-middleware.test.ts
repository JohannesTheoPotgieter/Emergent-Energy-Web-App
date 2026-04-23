import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireRole } from "../../../server/middleware/requireRole";
import { requireAuth } from "../../../server/auth-context";

type MockResponse = Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function createMockResponse(): MockResponse {
  const res = {} as MockResponse;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("permission middleware hardening", () => {
  it("rejects VIEWER role for COO_ADMIN-only endpoints", () => {
    const req = {
      isAuthenticated: () => true,
      user: { id: 123, role: "VIEWER" },
      body: { role: "COO_ADMIN" },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = requireRole(["COO_ADMIN"]);
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Insufficient role" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests in requireAuth", async () => {
    const req = {
      headers: {},
      isAuthenticated: () => false,
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "auth_required",
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed roles instead of silently passing", () => {
    const middleware = requireRole(["COO_ADMIN"]);
    const next = vi.fn() as unknown as NextFunction;

    const missingRoleReq = {
      isAuthenticated: () => true,
      user: { id: 123 },
    } as unknown as Request;
    const missingRoleRes = createMockResponse();

    middleware(missingRoleReq, missingRoleRes, next);

    expect(missingRoleRes.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();

    const malformedRoleReq = {
      isAuthenticated: () => true,
      user: { id: 456, role: "  not_a_role  " },
    } as unknown as Request;
    const malformedRoleRes = createMockResponse();

    middleware(malformedRoleReq, malformedRoleRes, next);

    expect(malformedRoleRes.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
