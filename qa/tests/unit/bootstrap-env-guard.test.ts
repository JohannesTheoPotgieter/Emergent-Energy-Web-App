import { describe, expect, it } from "vitest";
import { enforceRuntimeEnvironmentGuards } from "../../../server/bootstrap/env-guard";

describe("enforceRuntimeEnvironmentGuards", () => {
  it("throws in strict runtime without SESSION_SECRET", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSessionSecret = process.env.SESSION_SECRET;

    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;

    expect(() => enforceRuntimeEnvironmentGuards()).toThrow(/SESSION_SECRET must be set/i);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSessionSecret) process.env.SESSION_SECRET = originalSessionSecret;
    else delete process.env.SESSION_SECRET;
  });

  it("returns session secret when present", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSessionSecret = process.env.SESSION_SECRET;

    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "local-dev-secret";

    const result = enforceRuntimeEnvironmentGuards();
    expect(result.sessionSecret).toBe("local-dev-secret");
    expect(result.isStrictRuntime).toBe(false);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSessionSecret) process.env.SESSION_SECRET = originalSessionSecret;
    else delete process.env.SESSION_SECRET;
  });
});
