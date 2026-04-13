import { describe, expect, it } from "vitest";
import { resolveEffectivePermissionRole } from "../../../client/src/hooks/use-lens-context";
import { buildVisibleTopSections } from "../../../client/src/config/app-navigation";
import { evaluatePathAccess } from "../../../client/src/config/runtime-access";

describe("lens permission alignment", () => {
  it("uses the simulated role permission identity in both read-only and full-power modes", () => {
    const readOnlyRole = resolveEffectivePermissionRole({
      dbRole: "COO_ADMIN",
      simulation: { simulatedLens: "PROGRAM_FINANCE_MANAGER", mode: "read_only" },
    });
    const fullPowerRole = resolveEffectivePermissionRole({
      dbRole: "COO_ADMIN",
      simulation: { simulatedLens: "PROGRAM_FINANCE_MANAGER", mode: "full_power" },
    });

    expect(readOnlyRole).toBe("PROGRAM_FINANCE_MANAGER");
    expect(fullPowerRole).toBe("PROGRAM_FINANCE_MANAGER");
  });

  it("keeps Program Finance Manager top-nav and route access aligned for Reports/Admin", () => {
    const snapshot = {
      sections: ["HOME", "PROJECT_DELIVERY", "FINANCE"],
      entityPermissions: {
        reports: { view: false },
        admin: { view: false },
      },
    };

    const nav = buildVisibleTopSections({
      canViewPath: (path) => evaluatePathAccess({
        role: "PROGRAM_FINANCE_MANAGER",
        path,
        snapshot,
        failOpenForUnknown: false,
      }).allowed,
    });

    expect(nav.some((section) => section.key === "REPORTS")).toBe(false);
    expect(nav.some((section) => section.key === "ADMIN")).toBe(false);

    const reportsAccess = evaluatePathAccess({
      role: "PROGRAM_FINANCE_MANAGER",
      path: "/reports/center",
      snapshot,
      failOpenForUnknown: false,
    });
    const adminAccess = evaluatePathAccess({
      role: "PROGRAM_FINANCE_MANAGER",
      path: "/admin/control-center",
      snapshot,
      failOpenForUnknown: false,
    });

    expect(reportsAccess.allowed).toBe(false);
    expect(adminAccess.allowed).toBe(false);
  });
});
