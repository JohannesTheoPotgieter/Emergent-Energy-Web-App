import { describe, expect, it } from "vitest";
import { buildVisibleTopSections, getBreadcrumbs } from "@/config/app-navigation";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";

describe("app navigation visibility", () => {
  it("keeps Home secondary navigation limited to Home and My Work", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const homeSection = sections.find((section) => section.label === "Home");

    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home", "My Work"]);
  });

  it("filters inaccessible sections and secondary items by permission", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => ["/", "/my-work", "/project-lifecycle", "/dashboard", "/projects", "/pm-dashboard"].includes(path),
    });

    expect(sections.some((section) => section.label === "Admin")).toBe(false);
    expect(sections.some((section) => section.label === "Engineering")).toBe(false);

    const projectLifecycle = sections.find((section) => section.label === "Project Lifecycle");
    expect(projectLifecycle?.secondary.map((item) => item.label)).toEqual(["Overview"]);

    const projectManagement = sections.find((section) => section.label === "Project Management");
    expect(projectManagement?.secondary.map((item) => item.label)).toEqual([
      "Execution Dashboard",
      "Project List",
      "Per Project Manager Dashboard",
    ]);
  });

  it("retargets a section link to the first visible child when the root page is not permitted", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => path === "/" || path === "/admin/smart-import",
    });

    const adminSection = sections.find((section) => section.label === "Admin");
    expect(adminSection?.path).toBe("/admin/smart-import");
    expect(adminSection?.secondary.map((item) => item.label)).toEqual(["Smart Import"]);
  });

  it("keeps Home visible even when My Work is not permitted", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => path === "/",
    });

    const homeSection = sections.find((section) => section.label === "Home");
    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home"]);
  });

  it("exposes the approved Project Lifecycle sub-structure when permitted", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projectLifecycle = sections.find((section) => section.label === "Project Lifecycle");

    expect(projectLifecycle?.secondary.map((item) => item.label)).toEqual([
      "Overview",
      "Lifecycle",
      "Stage Gates",
      "Latest Updates",
      "Clients",
      "Client Overview",
    ]);
  });

  it("exposes the approved Project Management execution structure when permitted", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projectManagement = sections.find((section) => section.label === "Project Management");

    expect(projectManagement?.secondary.map((item) => item.label)).toEqual([
      "Execution Dashboard",
      "Project List",
      "Work Plan / Board",
      "Deliverables",
      "Approvals",
      "Site / Execution Controls",
      "PM On-The-Go",
      "Per Project Manager Dashboard",
    ]);
  });

  it("maps project detail breadcrumbs back to Project Lifecycle", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projectLifecycle = sections.find((section) => section.label === "Project Lifecycle");

    expect(projectLifecycle).toBeDefined();
    expect(getBreadcrumbs("/project/Alpha_Site", projectLifecycle!)).toEqual(["Project Lifecycle", "Alpha_Site"]);
  });

  it("keeps admin navigation aligned to the approved governed surfaces", () => {
    expect(ADMIN_SURFACES.map((surface) => surface.label)).toEqual([
      "Control Center",
      "Smart Import",
      "Excel Updates",
      "Roles & Permissions",
      "System Settings",
      "Audit Log",
    ]);
  });

  it("does not surface Command Center in admin navigation", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const adminSection = sections.find((section) => section.label === "Admin");

    expect(adminSection?.secondary.some((item) => /command center/i.test(item.label))).toBe(false);
  });
});
