import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { requireAuthoriserFor } from "../../../server/middleware/requireAuthoriserFor";
import { findEntityRegistry } from "../../../shared/permissions/registry";

vi.mock("../../../server/auth-context", () => ({
  getEffectiveUser: vi.fn(),
}));

import { getEffectiveUser } from "../../../server/auth-context";

const mockedGetEffectiveUser = vi.mocked(getEffectiveUser);

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  const base: Partial<Request> = {
    isAuthenticated: () => true,
    body: {},
    ...overrides,
  };
  return base as Request;
}

describe("requireAuthoriserFor", () => {
  beforeEach(() => {
    mockedGetEffectiveUser.mockReset();
  });

  it("throws on construction when entity is unknown", () => {
    expect(() =>
      requireAuthoriserFor("not_a_real_entity" as never),
    ).toThrow(/unknown entity/);
  });

  it("returns 401 when request is unauthenticated", () => {
    mockedGetEffectiveUser.mockReturnValue(null);
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ isAuthenticated: () => false });

    requireAuthoriserFor("financials")(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "auth_required" });
    expect(next).not.toHaveBeenCalled();
    expect(req.authoriser).toBeUndefined();
  });

  it("returns 403 when user role is not in override_roles", () => {
    mockedGetEffectiveUser.mockReturnValue({
      id: 7,
      email: "eng@example.com",
      name: "Eng",
      role: "ENGINEER",
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ body: { override_reason: "anything" } });

    requireAuthoriserFor("financials")(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: "forbidden",
      entity: "financials",
      reason: "role_not_in_override_roles",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when an authorised role omits the reason", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 1,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ body: {} });

    requireAuthoriserFor("financials")(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: "override_reason_required",
      entity: "financials",
      field: "override_reason",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is whitespace-only", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 1,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ body: { override_reason: "   " } });

    requireAuthoriserFor("financials")(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: "override_reason_required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and attaches req.authoriser when role + reason are valid", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 42,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({
      body: { override_reason: "  approving deferred handover per § 0A  " },
    });

    requireAuthoriserFor("financials")(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
    expect(req.authoriser).toEqual({
      entity: "financials",
      role: cooRole,
      userId: 42,
      reason: "approving deferred handover per § 0A",
    });
  });

  it("honours a custom reasonField option", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 5,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ body: { exception_note: "stage-gate skip" } });

    requireAuthoriserFor("financials", { reasonField: "exception_note" })(
      req,
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(req.authoriser?.reason).toBe("stage-gate skip");
  });

  it("returns 400 when override_reason is a non-string (array, object, number)", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 1,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();

    for (const bad of [["a", "b"], { nested: "x" }, 42, true, null]) {
      const res = makeRes();
      const req = makeReq({ body: { override_reason: bad } });
      requireAuthoriserFor("financials")(req, res as unknown as Response, next);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ error: "override_reason_required" });
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when custom reasonField is missing", () => {
    const cooRole = findEntityRegistry("financials")!.override_roles[0];
    mockedGetEffectiveUser.mockReturnValue({
      id: 5,
      email: "coo@example.com",
      name: "COO",
      role: cooRole,
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    const req = makeReq({ body: { override_reason: "wrong field" } });

    requireAuthoriserFor("financials", { reasonField: "exception_note" })(
      req,
      res as unknown as Response,
      next,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ field: "exception_note" });
    expect(next).not.toHaveBeenCalled();
  });
});
