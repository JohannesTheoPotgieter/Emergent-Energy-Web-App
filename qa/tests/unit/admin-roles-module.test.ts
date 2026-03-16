import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@shared/schema";
import {
  buildRoleAuthorityCategories,
  canManageRoleActions,
  resolveAdminRolesViewState,
  resolveSelectedRole,
  type RoleSummary,
} from "@/pages/admin-roles.utils";

const role = (overrides: Partial<RoleSummary> = {}): RoleSummary => ({
  role: "COO_ADMIN",
  label: "COO",
  description: "system",
  sections: ["PROJECTS"],
  entityPermissions: null,
  authorityModel: null,
  canManageUsers: true,
  canManageRoles: true,
  canEditData: true,
  isSystem: true,
  userCount: 1,
  configuredResources: 0,
  protected: true,
  ...overrides,
});

describe("admin roles module state", () => {
  it("auto-selects the first role when nothing is selected", () => {
    const selected = resolveSelectedRole("", [role({ role: "COO_ADMIN" }), role({ role: "CEO_ADMIN" })]);
    expect(selected).toBe("COO_ADMIN");
  });

  it("keeps selected role when still present", () => {
    const selected = resolveSelectedRole("CEO_ADMIN", [role({ role: "COO_ADMIN" }), role({ role: "CEO_ADMIN" })]);
    expect(selected).toBe("CEO_ADMIN");
  });

  it("returns explicit empty state when no roles exist", () => {
    expect(resolveAdminRolesViewState({ isLoading: false, hasError: false, roleCount: 0, canManageRoles: true })).toBe("empty");
  });

  it("contains visible system roles in defaults", () => {
    const systemRoles = DEFAULT_ROLE_PERMISSIONS.filter((r) => r.isSystem).map((r) => r.role);
    expect(systemRoles).toContain("COO_ADMIN");
    expect(systemRoles).toContain("CEO_ADMIN");
    expect(systemRoles.length).toBeGreaterThan(2);
  });

  it("gates create/edit actions by permission and successful auth", () => {
    expect(canManageRoleActions(true, true)).toBe(true);
    expect(canManageRoleActions(false, true)).toBe(false);
    expect(canManageRoleActions(true, false)).toBe(false);
  });

  it("builds meaningful authority categories for the roles UI", () => {
    const categories = buildRoleAuthorityCategories(role({
      sections: ["PROJECTS", "MONEY"],
      authoritySummary: [
        {
          entity: "approvals",
          actions: [
            { action: "approve", allowed: true, scope: "all_projects" },
            { action: "assign", allowed: true, scope: "department" },
          ],
        },
        {
          entity: "procurement",
          actions: [
            { action: "edit", allowed: true, scope: "assigned_projects" },
          ],
        },
      ],
    }));

    expect(categories.find((category) => category.label === "Module access")?.items).toContain("MONEY");
    expect(categories.find((category) => category.label === "Assignment rights")?.items).toContain("approvals.assign");
    expect(categories.find((category) => category.label === "Approval rights")?.items).toContain("approvals");
    expect(categories.find((category) => category.label === "Financial authority")?.items).toContain("procurement.edit");
  });
});
