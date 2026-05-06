import { describe, it, expect } from "vitest";
import { ApiError, sendError } from "../../../server/lib/api-error";

function mockRes() {
  const result: { statusCode?: number; body?: any } = {};
  return {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: any) {
      result.body = payload;
      return this;
    },
    result,
  };
}

describe("api-error payload shape", () => {
  it("returns standardized shape for ApiError", () => {
    const res = mockRes();
    sendError(res as any, new ApiError(403, "FORBIDDEN", "No access", { route: "x" }, "Contact admin"));

    expect(res.result.statusCode).toBe(403);
    expect(res.result.body).toEqual(
      expect.objectContaining({
        error: "FORBIDDEN",
        code: "FORBIDDEN",
        type: "FORBIDDEN",
        message: "No access",
        details: { route: "x" },
        nextAction: "Contact admin",
      }),
    );
  });
});
