import { describe, expect, it } from "vitest";
import { evaluatePermissionForRole } from "@shared/permission-resolver";

describe("permission resolver", () => {
  it("respects explicit DB deny overrides", () => {
    const result = evaluatePermissionForRole({
      role: "COO_ADMIN",
      entity: "projects",
      action: "view",
      roleRecord: { entityPermissions: { projects: { view: false } } as any },
    });

    expect(result.allowed).toBe(false);
    expect(result.source).toBe("db_override");
  });

  it("falls back to defaults when override is missing", () => {
    const result = evaluatePermissionForRole({ role: "COO_ADMIN", entity: "projects", action: "approve" });
    expect(result.allowed).toBe(true);
    expect(result.source).toBe("default");
  });
});
