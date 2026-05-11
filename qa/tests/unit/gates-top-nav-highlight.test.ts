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
    // The COO-spec nav (2026-05-11) no longer surfaces "Projects" or "Gates"
    // as a top-level tab; both move behind Functionality Control. The Gates
    // TopSection is retained for path-matching so any code that re-enables it
    // still highlights correctly.
    const gates = getSection("Gates");
    const projectDelivery = getSection("Project Delivery");

    expect(gates.match("/gates")).toBe(true);
    expect(gates.match("/gates/commitments")).toBe(true);
    expect(gates.match("/dashboard")).toBe(true);
    expect(gates.match("/exceptions")).toBe(true);

    expect(projectDelivery.match("/gates")).toBe(false);
    expect(projectDelivery.match("/gates/commitments")).toBe(false);
  });

  it("shows Gates for PORTFOLIO and also for PROJECT_DELIVERY holders", () => {
    const canViewPath = () => true;

    const withPortfolio = buildVisibleTopSections({
      canViewPath,
      allowedSectionKeys: ["HOME", "PORTFOLIO"],
    });
    expect(withPortfolio.some((section) => section.label === "Gates")).toBe(true);

    // Gates declares requiredAnySectionKeys: ["PORTFOLIO", "PROJECT_DELIVERY"],
    // so delivery roles (e.g. PROJECT_MANAGER_SITE) can also reach it.
    const withDeliveryOnly = buildVisibleTopSections({
      canViewPath,
      allowedSectionKeys: ["HOME", "PROJECT_DELIVERY"],
    });
    expect(withDeliveryOnly.some((section) => section.label === "Gates")).toBe(true);

    // A user with no project access at all should not see Gates.
    const withFinanceOnly = buildVisibleTopSections({
      canViewPath,
      allowedSectionKeys: ["HOME", "FINANCE"],
    });
    expect(withFinanceOnly.some((section) => section.label === "Gates")).toBe(false);
  });
});
