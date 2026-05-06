import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["NODE_ENV", "DB_MODE", "DATABASE_URL", "JWT_SECRET"] as const;
const originalEnv: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    if (key in values) {
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("strict runtime config validation", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("fails in production when DATABASE_URL is missing", async () => {
    setEnv({ NODE_ENV: "production", DATABASE_URL: undefined });
    const { resolveDbConfig } = await import("../../../server/db-config");
    expect(() => resolveDbConfig()).toThrow(/DATABASE_URL is required in production\/staging/);
  });

  it("fails in staging when DB_MODE=sqlite to prevent unsafe fallback", async () => {
    setEnv({ NODE_ENV: "staging", DB_MODE: "sqlite", DATABASE_URL: "postgres://example" });
    const { resolveDbConfig } = await import("../../../server/db-config");
    expect(() => resolveDbConfig()).toThrow(/Unsafe DB_MODE=sqlite/);
  });

  it("fails in strict runtime when JWT_SECRET is missing", async () => {
    setEnv({ NODE_ENV: "production", JWT_SECRET: undefined });
    const { generateToken } = await import("../../../server/jwt");
    expect(() =>
      generateToken({
        userId: 1,
        email: "strict@example.com",
        name: "Strict Runtime",
        role: "admin",
      }),
    ).toThrow(/JWT_SECRET must be set/);
  });
});
