import { describe, expect, it } from "vitest";

describe("JWT secret policy", () => {
  it("refuses to generate JWT without JWT_SECRET", async () => {
    const originalSecret = process.env.JWT_SECRET;
    const originalEnv = process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "development";

    const { generateToken } = await import("../../../server/jwt");
    expect(() => generateToken({ userId: 1, email: "u@example.com", name: "U", role: "admin" })).toThrow(
      /JWT_SECRET must be set/i,
    );

    if (originalSecret) process.env.JWT_SECRET = originalSecret;
    else delete process.env.JWT_SECRET;
    process.env.NODE_ENV = originalEnv;
  });
});
