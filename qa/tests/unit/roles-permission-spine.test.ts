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

    expect(unmapped).toEqual([]);
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
