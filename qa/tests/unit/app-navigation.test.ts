import { describe, expect, it } from "vitest";
import { buildVisibleTopSections, getBreadcrumbs } from "@/config/app-navigation";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";

describe("app navigation visibility", () => {
  it("keeps Home secondary navigation limited to Home", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const homeSection = sections.find((section) => section.label === "Home");

    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home"]);
  });

  it("filters inaccessible sections and secondary items by permission", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => ["/", "/my-work", "/projects"].includes(path),
    });

    expect(sections.some((section) => section.label === "Admin")).toBe(false);
    expect(sections.some((section) => section.label === "Finance")).toBe(false);

    const projects = sections.find((section) => section.label === "Projects");
    expect(projects?.secondary.map((item) => item.label)).toEqual(["Project List"]);
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

  it("exposes the Projects section with consolidated secondary items when permitted", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projects = sections.find((section) => section.label === "Projects");

    expect(projects).toBeDefined();
    const labels = projects!.secondary.map((item) => item.label);
    expect(labels).toContain("Project List");
    expect(labels).toContain("Portfolio Overview");
    expect(labels).toContain("Lifecycle");
    expect(labels).toContain("Engineering");
    expect(labels).toContain("Quality & HSE");
    expect(labels).toContain("Construction");
    // Verify consolidation: niche items removed from nav
    expect(labels).not.toContain("Mobile View");
    expect(labels).not.toContain("HSE"); // covered by "Quality & HSE"
    expect(labels).not.toContain("Sites"); // accessible from Project List
  });

  it("maps project detail breadcrumbs back to Projects section", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projects = sections.find((section) => section.label === "Projects");

    expect(projects).toBeDefined();
    const crumbs = getBreadcrumbs("/project/Alpha_Site", projects!);
    expect(crumbs).toEqual([
      { label: "Projects", path: "/projects" },
      { label: "Alpha_Site" },
    ]);
  });

  it("keeps admin navigation aligned to the approved governed surfaces", () => {
    const labels = ADMIN_SURFACES.map((surface) => surface.label);
    // Core surfaces must always be present
    expect(labels).toContain("Control Center");
    expect(labels).toContain("Smart Import");
    expect(labels).toContain("Roles & Permissions");
    expect(labels).toContain("Audit Log");
    // Every surface must have a valid path starting with /admin
    ADMIN_SURFACES.forEach((surface) => {
      expect(surface.path).toMatch(/^\/admin\//);
      expect(surface.description).toBeTruthy();
    });
  });

  it("does not surface Command Center in admin navigation", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const adminSection = sections.find((section) => section.label === "Admin");

    expect(adminSection?.secondary.some((item) => /command center/i.test(item.label))).toBe(false);
  });

  it("has six top-level sections", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    expect(sections.map((s) => s.label)).toEqual([
      "Home",
      "My Work",
      "Projects",
      "Finance",
      "Reports",
      "Admin",
    ]);
  });
});
