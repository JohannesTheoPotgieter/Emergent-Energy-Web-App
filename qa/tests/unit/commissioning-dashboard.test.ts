import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "../../../client/src/config/page-registry";
import {
  ENTITY_PERMISSION_DEFAULTS,
  type PermissionEntity,
  type EntityPermissionRule,
} from "@shared/schema";

describe("commissioning-dashboard registration", () => {
  const entry = PAGE_REGISTRY.find((p) => p.id === "commissioningDashboard");

  it("is registered in page registry", () => {
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/commissioning-dashboard");
    expect(entry!.routeComponentKey).toBe("CommissioningDashboardPage");
    expect(entry!.permissionEntity).toBe("commissioning");
    expect(entry!.showInSidebar).toBe(true);
  });

  it("uses a valid permission entity", () => {
    const entity = entry!.permissionEntity as PermissionEntity;
    const defaults = ENTITY_PERMISSION_DEFAULTS.find((r: EntityPermissionRule) => r.entity === entity);
    expect(defaults).toBeDefined();
  });

  it("has correct navGroup", () => {
    expect(entry!.navGroup).toBe("PROJECT_MANAGEMENT");
  });

  it("supports sub-routes for project ID", () => {
    expect(entry!.matchSubRoutes).toBe(true);
  });
});

describe("commissioning permission entity access", () => {
  const defaults = ENTITY_PERMISSION_DEFAULTS.find((r: EntityPermissionRule) => r.entity === "commissioning");

  it("allows view for expected roles", () => {
    expect(defaults).toBeDefined();
    const viewRoles = defaults?.view_roles || [];
    expect(viewRoles).toContain("COO_ADMIN");
    expect(viewRoles).toContain("CEO_ADMIN");
    expect(viewRoles).toContain("PROGRAM_MANAGER");
    expect(viewRoles).toContain("CONSTRUCTION_MANAGER");
    expect(viewRoles).toContain("PROJECT_MANAGER_SITE");
    expect(viewRoles).toContain("QUALITY_MANAGER");
  });

  it("restricts create to authorized roles", () => {
    const createRoles = defaults?.create_roles || [];
    expect(createRoles).toContain("COO_ADMIN");
    expect(createRoles).toContain("CEO_ADMIN");
    expect(createRoles).not.toContain("ACCOUNTANT");
  });

  it("restricts delete to admin roles only", () => {
    const deleteRoles = defaults?.delete_roles || [];
    expect(deleteRoles).toContain("COO_ADMIN");
    expect(deleteRoles).toContain("CEO_ADMIN");
    expect(deleteRoles.length).toBe(2);
  });
});

describe("commissioning source schema types", () => {
  it("exports expected types", async () => {
    const schema = await import("../../../shared/schema/commissioning-source");
    expect(schema.commissioningSources).toBeDefined();
    expect(schema.commissioningSnapshots).toBeDefined();
    expect(schema.insertCommissioningSourceSchema).toBeDefined();
    expect(schema.insertCommissioningSnapshotSchema).toBeDefined();
  });
});
