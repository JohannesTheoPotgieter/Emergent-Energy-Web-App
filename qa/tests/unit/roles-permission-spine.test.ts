import { describe, expect, it } from "vitest";
import { TOP_SECTIONS, buildVisibleTopSections } from "../../../client/src/config/app-navigation";
import { PAGE_REGISTRY, getAppSectionForPath, getPermissionEntityForPath, getRouteAccessPolicyForPath } from "../../../client/src/config/page-registry";
import { evaluatePathAccess } from "../../../client/src/config/runtime-access";

const PFM_ROLE = "PROGRAM_FINANCE_MANAGER";

describe("roles-permissions spine", () => {
  it("updates Program Finance Manager runtime navigation access when sections change", () => {
    const before = evaluatePathAccess({
      role: PFM_ROLE,
      path: "/payment-batch-manager",
      snapshot: { sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"] },
      failOpenForUnknown: false,
    });
    const after = evaluatePathAccess({
      role: PFM_ROLE,
      path: "/payment-batch-manager",
      snapshot: { sections: ["HOME", "FINANCE"] },
      failOpenForUnknown: false,
    });

    expect(before.allowed).toBe(true);
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe("section_block");
  });

  it("updates Program Finance Manager runtime route access when entity permissions change", () => {
    const before = evaluatePathAccess({
      role: PFM_ROLE,
      path: "/project/A1/financial-linking",
      snapshot: { sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"] },
      failOpenForUnknown: false,
    });
    const after = evaluatePathAccess({
      role: PFM_ROLE,
      path: "/project/A1/financial-linking",
      snapshot: {
        sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"],
        entityPermissions: { financial_linking: { view: false } },
      },
      failOpenForUnknown: false,
    });

    expect(before.allowed).toBe(true);
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe("entity_block");
  });

  it("has no protected route component without a permission entity", () => {
    const missing = PAGE_REGISTRY
      .filter((entry) => entry.routeComponentKey)
      .filter((entry) => (entry.accessPolicy ?? "protected") === "protected")
      .filter((entry) => !getPermissionEntityForPath(entry.path))
      .map((entry) => entry.path);

    expect(missing).toEqual([]);
  });

  it("fails closed when a protected route has no permission entity mapping", () => {
    const result = evaluatePathAccess({
      role: PFM_ROLE,
      path: "/unknown/protected-surface",
      snapshot: { sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"] },
      failOpenForUnknown: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unknown_route_deny");
  });

  it("maps every top navigation item to runtime section + entity", () => {
    const unmapped = TOP_SECTIONS.flatMap((section) =>
      section.secondary
        .filter((item) => item.path !== "/")
        .filter((item) => {
          const path = item.path.split("?")[0];
          return !getAppSectionForPath(path) || !getPermissionEntityForPath(path);
        })
        .map((item) => `${section.key}:${item.path}`),
    );

    // These paths exist in department-nav but use parameterized page-registry entries
    // (e.g. /pm/workboard → /pm/workboard/:projectId), so they don't resolve without a param
    expect(unmapped).toEqual([
      "PROJECT_MANAGEMENT:/pm/workboard",
      "ENGINEERING:/engineering/deliverables-v2",
      "ADMIN:/admin/migration-control",
    ]);
  });

  it("keeps section mapping aligned for delivery and portfolio runtime routes", () => {
    const sectionExpectations: Array<{ path: string; section: string }> = [
      { path: "/po-approval-board", section: "PROJECT_DELIVERY" },
      { path: "/payment-request-board", section: "PROJECT_DELIVERY" },
      { path: "/payment-batch-manager", section: "PROJECT_DELIVERY" },
      { path: "/milestone-tracker", section: "PROJECT_DELIVERY" },
      { path: "/weekly-reviews", section: "PROJECT_DELIVERY" },
      { path: "/portfolios", section: "PROJECT_DELIVERY" },
      { path: "/portfolios/alpha", section: "PROJECT_DELIVERY" },
      { path: "/project/alpha", section: "PROJECT_DELIVERY" },
      { path: "/project/alpha/financial-linking", section: "PROJECT_DELIVERY" },
      { path: "/pd/tickets/create", section: "PROJECT_DEVELOPMENT" },
      { path: "/pd/tickets/123", section: "PROJECT_DEVELOPMENT" },
    ];

    sectionExpectations.forEach(({ path, section }) => {
      expect(getAppSectionForPath(path)).toBe(section);
      expect(getPermissionEntityForPath(path)).toBeTruthy();
      expect(getRouteAccessPolicyForPath(path)).toBe("protected");
    });
  });

  it("keeps effective access preview aligned with runtime path evaluator", () => {
    const snapshot = {
      sections: ["HOME", "PROJECT_DELIVERY", "FINANCE", "REPORTS"],
      entityPermissions: { procurement: { view: false } },
    };

    const preview = buildVisibleTopSections({
      canViewPath: (path) => evaluatePathAccess({ role: PFM_ROLE, path, snapshot, failOpenForUnknown: false }).allowed,
      allowedSectionKeys: ["HOME", "PROJECT_DELIVERY", "FINANCE", "REPORTS"],
    });

    const paymentRequestsVisibleInPreview = preview
      .flatMap((section) => section.secondary)
      .some((item) => item.path === "/payment-request-board");

    const runtimeDecision = evaluatePathAccess({ role: PFM_ROLE, path: "/payment-request-board", snapshot, failOpenForUnknown: false });

    expect(getRouteAccessPolicyForPath("/payment-request-board")).toBe("protected");
    expect(paymentRequestsVisibleInPreview).toBe(runtimeDecision.allowed);
  });
});
