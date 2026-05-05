import { describe, expect, it } from "vitest";

import { TOP_SECTIONS, buildVisibleTopSections } from "@/config/app-navigation";

function getSection(label: string) {
  const section = TOP_SECTIONS.find((item) => item.label === label);
  expect(section, `${label} section must exist`).toBeDefined();
  return section!;
}

describe("gates top-nav section", () => {
  it("defines Gates as a top-level section with the expected tree", () => {
    const gates = getSection("Gates");

    expect(gates.path).toBe("/gates");
    expect(gates.secondary.map((item) => item.path)).toEqual([
      "/gates",
      "/gates/blocked",
      "/gates/ready",
      "/gates/exceptions",
      "/gates/client-updates",
      "/gates/handovers",
      "/gates/queries",
      "/gates/commitments",
    ]);
  });

  it("highlights Gates for gate routes, including commitments and legacy aliases", () => {
    const gates = getSection("Gates");
    const projects = getSection("Projects");

    expect(gates.match("/gates")).toBe(true);
    expect(gates.match("/gates/commitments")).toBe(true);
    expect(gates.match("/dashboard")).toBe(true);
    expect(gates.match("/exceptions")).toBe(true);

    expect(projects.match("/gates")).toBe(false);
    expect(projects.match("/gates/commitments")).toBe(false);
  });

  it("shows Gates only when existing PORTFOLIO/lifecycle permissions can surface it", () => {
    const canViewPath = () => true;

    const withPortfolio = buildVisibleTopSections({
      canViewPath,
      allowedSectionKeys: ["HOME", "PORTFOLIO"],
    });
    expect(withPortfolio.some((section) => section.label === "Gates")).toBe(true);

    const withDeliveryOnly = buildVisibleTopSections({
      canViewPath,
      allowedSectionKeys: ["HOME", "PROJECT_DELIVERY"],
    });
    expect(withDeliveryOnly.some((section) => section.label === "Gates")).toBe(false);
  });
});
