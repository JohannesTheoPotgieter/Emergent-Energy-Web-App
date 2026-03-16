import { describe, expect, it } from "vitest";
import { buildVisibleTopSections } from "@/config/app-navigation";

describe("app navigation visibility", () => {
  it("keeps Home secondary navigation limited to Home and My Work", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const homeSection = sections.find((section) => section.label === "Home");

    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home", "My Work"]);
  });

  it("filters inaccessible sections and secondary items by permission", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => ["/", "/my-work", "/projects", "/pm-dashboard"].includes(path),
    });

    expect(sections.some((section) => section.label === "Admin")).toBe(false);
    expect(sections.some((section) => section.label === "Engineering")).toBe(false);

    const projectManagement = sections.find((section) => section.label === "Project Management");
    expect(projectManagement?.secondary.map((item) => item.label)).toEqual(["Project List", "PM Dashboard"]);
  });

  it("keeps Home visible even when My Work is not permitted", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => path === "/",
    });

    const homeSection = sections.find((section) => section.label === "Home");
    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["Home"]);
  });
});
