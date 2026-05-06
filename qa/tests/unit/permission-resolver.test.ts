import { describe, expect, it } from "vitest";
import { evaluateAuthorityForRole, evaluatePermissionForRole } from "@shared/permission-resolver";

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

  it("evaluates authority model rules with scope", () => {
    const result = evaluateAuthorityForRole({
      role: "PROGRAM_MANAGER",
      entity: "projects",
      action: "assign",
      roleRecord: {
        entityPermissions: {},
        authorityModel: {
          rules: {
            "projects.assign": { enabled: true, scope: "department" },
          },
        },
      } as any,
    });

    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("department");
    expect(result.source).toBe("authority_model");
  });

  it("denies strict authority actions by default for migration safety", () => {
    const result = evaluateAuthorityForRole({
      role: "COO_ADMIN",
      entity: "projects",
      action: "manage_settings",
      roleRecord: { entityPermissions: { projects: { view: true } } } as any,
    });

    expect(result.allowed).toBe(false);
    expect(result.source).toBe("none");
  });
});
