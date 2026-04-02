import { describe, expect, it } from "vitest";
import { buildAuthPermissionsPayload } from "../../../server/role-management";

describe("auth permissions payload", () => {
  it("reflects PROGRAM_FINANCE_MANAGER section mutations in /api/auth/permissions payload shape", () => {
    const before = buildAuthPermissionsPayload({
      perm: {
        role: "PROGRAM_FINANCE_MANAGER",
        label: "Program Finance Manager",
        sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"],
        canManageUsers: false,
        canManageRoles: false,
        canEditData: true,
        entityPermissions: null,
        authorityModel: null,
      },
      userOverrides: {},
    });

    const after = buildAuthPermissionsPayload({
      perm: {
        role: "PROGRAM_FINANCE_MANAGER",
        label: "Program Finance Manager",
        sections: ["HOME", "FINANCE"],
        canManageUsers: false,
        canManageRoles: false,
        canEditData: true,
        entityPermissions: null,
        authorityModel: null,
      },
      userOverrides: {},
    });

    expect(before.sections).toEqual(["HOME", "PROJECT_DELIVERY", "FINANCE"]);
    expect(after.sections).toEqual(["HOME", "FINANCE"]);
  });
});
