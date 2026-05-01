import { describe, expect, it } from "vitest";
import {
  buildVisibleTopSections,
  getBreadcrumbs,
  linkIsActive,
  parseDisabledSubPages,
  TOP_SECTIONS,
  validateDisabledSubPages,
} from "../../../client/src/config/app-navigation";

describe("app navigation helpers", () => {
  it("buildVisibleTopSections respects role scope and disabled sub-pages", () => {
    const disabled = parseDisabledSubPages(["!PROJECT_DELIVERY:/pm-dashboard"]);
    const sections = buildVisibleTopSections({
      companyRole: "PROJECT_MANAGER_SITE",
      canViewPath: (path) => path !== "/reports/pm/monthly",
      disabledSubPages: disabled,
    });

    expect(sections.some((section) => section.key === "PORTFOLIO")).toBe(false);

    const delivery = sections.find((section) => section.key === "PROJECT_DELIVERY");
    expect(delivery).toBeTruthy();
    expect(delivery?.secondary.some((item) => item.path === "/pm-dashboard")).toBe(false);

    const reports = sections.find((section) => section.key === "REPORTS");
    expect(reports?.secondary.some((item) => item.path === "/reports/pm/monthly")).toBe(false);
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
    const company = TOP_SECTIONS.find((section) => section.key === "PORTFOLIO");
    const reports = TOP_SECTIONS.find((section) => section.key === "REPORTS");

    expect(projectDelivery).toBeTruthy();
    expect(company).toBeTruthy();
    expect(reports).toBeTruthy();

    expect(getBreadcrumbs("/project/Solar%20Alpha", projectDelivery!)).toEqual([
      { label: "Project Delivery", path: "/projects" },
      { label: "Solar Alpha" },
    ]);

    expect(getBreadcrumbs("/gates/exceptions", company!)).toEqual([
      { label: "Company", path: "/lifecycle-board" },
      { label: "Gate Tracker", path: "/gates" },
      { label: "Exceptions" },
    ]);

    expect(getBreadcrumbs("/reports/pm/monthly/history", reports!)).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "History" },
    ]);
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
});
