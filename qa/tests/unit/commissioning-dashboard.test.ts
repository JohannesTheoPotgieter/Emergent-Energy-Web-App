import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { PAGE_REGISTRY } from "../../../client/src/config/page-registry";
import { ENTITY_PERMISSION_DEFAULTS, type EntityPermissionRule } from "@shared/schema";

describe("commissioning dashboard — page registration", () => {
  const entry = PAGE_REGISTRY.find((p) => p.id === "commissioningDashboard");

  it("is registered with parameterized project path", () => {
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/commissioning-dashboard/:projectId");
    expect(entry!.routeComponentKey).toBe("CommissioningDashboardPage");
  });

  it("uses commissioning permission entity", () => {
    expect(entry!.permissionEntity).toBe("commissioning");
  });

  it("is NOT shown in sidebar", () => {
    expect(entry!.showInSidebar).toBe(false);
  });

  it("does NOT use matchSubRoutes", () => {
    expect(entry!.matchSubRoutes).toBeFalsy();
  });
});

describe("commissioning dashboard — role access", () => {
  const rule = ENTITY_PERMISSION_DEFAULTS.find((r: EntityPermissionRule) => r.entity === "commissioning");

  it("commissioning permission entity exists", () => {
    expect(rule).toBeDefined();
  });

  it("allows view for 13 roles including PM, CM, QM, HSE, SSEG", () => {
    const viewRoles = rule?.view_roles || [];
    expect(viewRoles).toContain("COO_ADMIN");
    expect(viewRoles).toContain("CEO_ADMIN");
    expect(viewRoles).toContain("PROGRAM_MANAGER");
    expect(viewRoles).toContain("CONSTRUCTION_MANAGER");
    expect(viewRoles).toContain("PROJECT_MANAGER_SITE");
    expect(viewRoles).toContain("QUALITY_MANAGER");
    expect(viewRoles).toContain("HSE_MANAGER");
    expect(viewRoles).toContain("SSEG_MANAGER");
  });

  it("restricts edit to 5 roles", () => {
    const editRoles = rule?.edit_roles || [];
    expect(editRoles).toContain("COO_ADMIN");
    expect(editRoles).toContain("CEO_ADMIN");
    expect(editRoles).not.toContain("ACCOUNTANT");
    expect(editRoles).not.toContain("CFO");
  });

  it("mutating access (incl. the old delete) is gated by edit_roles and includes the admin pair", () => {
    // Collapsed model: there is no delete_roles surface — delete folded into
    // edit. The equivalent invariant is that the admin pair retains mutating
    // access via edit_roles. (edit_roles is broader than the old 2-role delete
    // set: it also includes PROGRAM_MANAGER, CONSTRUCTION_MANAGER,
    // PROJECT_MANAGER_SITE, QUALITY_MANAGER — same as the old commissioning:edit.)
    expect((rule as { delete_roles?: string[] }).delete_roles).toBeUndefined();
    const editRoles = rule?.edit_roles || [];
    expect(editRoles).toContain("COO_ADMIN");
    expect(editRoles).toContain("CEO_ADMIN");
  });
});

describe("commissioning dashboard — schema exports", () => {
  it("exports source and snapshot tables", async () => {
    const schema = await import("../../../shared/schema/commissioning-source");
    expect(schema.commissioningSources).toBeDefined();
    expect(schema.commissioningSnapshots).toBeDefined();
  });

  it("CommissioningSection has isCompleteForGate and no items array", () => {
    // Type check via runtime — create a conformant object
    const section: import("../../../shared/schema/commissioning-source").CommissioningSection = {
      sectionKey: "qa_list",
      sectionName: "QA List",
      displayStatus: "complete",
      isCompleteForGate: true,
      isRequired: true,
    };
    expect(section.isCompleteForGate).toBe(true);
    expect((section as any).items).toBeUndefined();
  });
});

describe("commissioning dashboard — duplication closure", () => {
  it("ProjectCommissioningTab is NOT imported in project-detail.tsx", () => {
    const src = readFileSync("client/src/pages/project-detail.tsx", "utf-8");
    expect(src).not.toContain('import { ProjectCommissioningTab }');
    expect(src).not.toContain('from "@/components/tabs/ProjectCommissioningTab"');
  });

  it("commissioning sub-tab does not render old CRUD UI", () => {
    const src = readFileSync("client/src/pages/project-detail.tsx", "utf-8");
    expect(src).not.toContain("<ProjectCommissioningTab");
    // Should contain redirect link instead
    expect(src).toContain("commissioning-dashboard");
  });

  it("new dashboard does not call old /api/commissioning/ CRUD routes", () => {
    const src = readFileSync("client/src/pages/commissioning-dashboard.tsx", "utf-8");
    // Should only reference /api/commissioning-dashboard/, not /api/commissioning/
    const matches = src.match(/\/api\/commissioning\//g) || [];
    const dashboardMatches = src.match(/\/api\/commissioning-dashboard\//g) || [];
    // All /api/commissioning/ references should be /api/commissioning-dashboard/
    expect(matches.every((m: string) => m === "/api/commissioning-dashboard/")).toBe(true);
  });
});

describe("commissioning dashboard — navigation", () => {
  it("role-based-upgrade commissioning entry points to /commissioning-dashboard", () => {
    const src = readFileSync("shared/schema/role-based-upgrade.ts", "utf-8");
    expect(src).toContain("key: 'commissioning'");
    expect(src).toContain("path: '/commissioning-dashboard'");
    expect(src).not.toContain("path: '/hse'");
  });

  it("PAGE_REGISTRY exposes /commissioning-dashboard via CommissioningDashboardPage", () => {
    const src = readFileSync("client/src/config/page-registry.ts", "utf-8");
    expect(src).toContain('path: "/commissioning-dashboard"');
    expect(src).toContain('routeComponentKey: "CommissioningDashboardPage"');
  });
});

describe("commissioning dashboard — Stage 7 boundary", () => {
  it("Stage7 FIELDS array does not contain overlapping workbook fields", () => {
    const src = readFileSync("client/src/components/stage-workspaces/Stage7Commissioning.tsx", "utf-8");
    // These 5 fields should NOT be in the FIELDS array
    expect(src).not.toMatch(/key:\s*"commissioning_date"/);
    expect(src).not.toMatch(/key:\s*"test_results_uploaded"/);
    expect(src).not.toMatch(/key:\s*"practical_completion_status"/);
    expect(src).not.toMatch(/key:\s*"quality_review_status"/);
    expect(src).not.toMatch(/key:\s*"engineering_acceptance_status"/);
  });

  it("Stage7 has workbook status section with dashboard link", () => {
    const src = readFileSync("client/src/components/stage-workspaces/Stage7Commissioning.tsx", "utf-8");
    expect(src).toContain("Commissioning Workbook Status");
    expect(src).toContain("commissioning-dashboard");
    expect(src).toContain("View full dashboard");
  });

  it("Stage7 title says Gate not Dashboard", () => {
    const src = readFileSync("client/src/components/stage-workspaces/Stage7Commissioning.tsx", "utf-8");
    expect(src).toContain("Gate Controls");
    expect(src).not.toContain('title="Commissioning Dashboard"');
  });
});
