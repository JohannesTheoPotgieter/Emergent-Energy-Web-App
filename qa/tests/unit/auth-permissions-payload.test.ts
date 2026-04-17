import { describe, expect, it } from "vitest";
import { buildAuthPermissionsPayload } from "../../../server/role-management";
import { ROLE_LANDING_PATHS } from "../../../shared/navigation/role-landing-paths";
import { COMPANY_ROLES } from "../../../shared/schema/users";

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

  it("returns landingPath from ROLE_LANDING_PATHS for every COMPANY_ROLES value", () => {
    for (const role of COMPANY_ROLES) {
      const payload = buildAuthPermissionsPayload({
        perm: {
          role,
          label: role,
          sections: [],
          canManageUsers: false,
          canManageRoles: false,
          canEditData: false,
          entityPermissions: null,
          authorityModel: null,
        },
        userOverrides: {},
      });
      expect(payload.landingPath, `landingPath missing for ${role}`).toBe(ROLE_LANDING_PATHS[role]);
    }
  });

  it("returns null landingPath for an unknown role", () => {
    const payload = buildAuthPermissionsPayload({
      perm: {
        role: "FAKE_ROLE",
        label: "Fake",
        sections: [],
        canManageUsers: false,
        canManageRoles: false,
        canEditData: false,
        entityPermissions: null,
        authorityModel: null,
      },
      userOverrides: {},
    });
    expect(payload.landingPath).toBeNull();
  });
});
