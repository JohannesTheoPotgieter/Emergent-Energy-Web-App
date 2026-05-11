import { describe, expect, it } from "vitest";
import {
  buildVisibleTopSections,
  getBreadcrumbs,
  linkIsActive,
  parseDisabledSubPages,
  TOP_SECTIONS,
  DISPLAY_TOP_NAV,
  validateDisabledSubPages,
} from "../../../client/src/config/app-navigation";

/**
 * Navigation helpers — locked to the COO-spec six-tab nav (2026-05-11):
 *
 *   Home · Project Delivery · Finance · Engineering · Quality Management · Settings
 *
 * Hidden modules (Gates, Project Development, Portfolio, HSE, Reports,
 * legacy Admin grid) are kept in TOP_SECTIONS for path-matching but never
 * surfaced in DISPLAY_TOP_NAV. Functionality Control can re-enable them.
 */
describe("app navigation helpers", () => {
  it("buildVisibleTopSections respects role scope and disabled sub-pages", () => {
    const disabled = parseDisabledSubPages(["!PROJECT_DELIVERY:/projects"]);
    const sections = buildVisibleTopSections({
      companyRole: "PROJECT_MANAGER_SITE",
      canViewPath: () => true,
      disabledSubPages: disabled,
    });

    const delivery = sections.find((section) => section.key === "PROJECT_DELIVERY");
    expect(delivery).toBeTruthy();
    expect(delivery?.secondary.some((item) => item.path === "/projects")).toBe(false);
    expect(delivery?.secondary.some((item) => item.path === "/execution-board")).toBe(true);
  });

  it("linkIsActive handles nested routes and query-param routes", () => {
    expect(linkIsActive("/cashflow/analysis", "/cashflow")).toBe(true);
    expect(linkIsActive("/my-work/tasks?source=approvals", "/my-work/approvals")).toBe(true);
    expect(linkIsActive("/my-work/tasks", "/my-work/approvals")).toBe(false);
    expect(linkIsActive("/handover?tab=sseg", "/handover?tab=sseg")).toBe(true);
    expect(linkIsActive("/handover?tab=closeout", "/handover?tab=sseg")).toBe(false);
  });

  it("getBreadcrumbs returns business-readable crumbs for key nested routes", () => {
    const projectDelivery = TOP_SECTIONS.find((section) => section.key === "PROJECT_DELIVERY");
    expect(projectDelivery).toBeTruthy();

    const crumbs = getBreadcrumbs("/project/Solar%20Alpha", projectDelivery!);
    expect(crumbs[0]?.label).toBe("Project Delivery");
    // The leaf segment is decoded so business names survive in the breadcrumb.
    expect(crumbs[crumbs.length - 1]?.label).toBe("Solar Alpha");
  });

  it("validateDisabledSubPages and parseDisabledSubPages enforce expected format", () => {
    const entries = [
      "HOME",
      "!FINANCE:/cashflow",
      "!NOPE:/cashflow",
      "!FINANCE:/",
      "!malformed",
    ];

    const issues = validateDisabledSubPages(entries);
    expect(issues).toEqual([
      { entry: "!NOPE:/cashflow", reason: "unknown_section_key" },
      { entry: "!FINANCE:/", reason: "invalid_path" },
      { entry: "!malformed", reason: "malformed" },
    ]);

    const parsed = parseDisabledSubPages(entries);
    expect(Array.from(parsed.get("FINANCE") ?? [])).toEqual(["/cashflow", "/"]);
    expect(parsed.has("HOME")).toBe(false);
  });

  it("DISPLAY_TOP_NAV locks the six-tab COO spec", () => {
    const labels = DISPLAY_TOP_NAV.map((item) => item.label);
    expect(labels).toEqual([
      "Home",
      "Project Delivery",
      "Finance",
      "Engineering",
      "Quality Management",
      "Settings",
    ]);

    // Settings tab gates on ADMIN section access.
    const settings = DISPLAY_TOP_NAV.find((i) => i.label === "Settings");
    expect(settings?.requiredSectionKey).toBe("ADMIN");
  });
});
