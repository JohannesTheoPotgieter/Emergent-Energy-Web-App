import { describe, expect, it } from "vitest";
import { buildVisibleTopSections, getBreadcrumbs } from "@/config/app-navigation";

describe("app navigation visibility", () => {
  it("keeps Home secondary navigation limited to Home and My Work", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const homeSection = sections.find((section) => section.label === "Home");

    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home", "My Work"]);
  });

  it("filters inaccessible sections and secondary items by permission", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => ["/", "/my-work", "/project-lifecycle", "/projects", "/pm-dashboard"].includes(path),
    });

    expect(sections.some((section) => section.label === "Admin")).toBe(false);
    expect(sections.some((section) => section.label === "Engineering")).toBe(false);

    const projectLifecycle = sections.find((section) => section.label === "Project Lifecycle");
    expect(projectLifecycle?.secondary.map((item) => item.label)).toEqual(["Overview", "Project List"]);

    const projectManagement = sections.find((section) => section.label === "Project Management");
    expect(projectManagement?.secondary.map((item) => item.label)).toEqual(["PM Dashboard"]);
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
      "Project List",
      "Stage Gates",
      "Latest Updates",
      "Clients",
      "Client Overview",
    ]);
  });

  it("maps project detail breadcrumbs back to Project Lifecycle", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const projectLifecycle = sections.find((section) => section.label === "Project Lifecycle");

    expect(projectLifecycle).toBeDefined();
    expect(getBreadcrumbs("/project/Alpha_Site", projectLifecycle!)).toEqual(["Project Lifecycle", "Alpha_Site"]);
  });
});
