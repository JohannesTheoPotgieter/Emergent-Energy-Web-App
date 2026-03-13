import { describe, expect, it } from "vitest";
import { buildRouteProofResults, PRIORITY_ROUTE_EXPECTATIONS } from "../../utils/route-proof";

describe("route proof coverage", () => {
  it("covers every priority route", () => {
    const results = buildRouteProofResults();
    expect(results).toHaveLength(PRIORITY_ROUTE_EXPECTATIONS.length);
    for (const result of results) {
      expect(result.routeExists, `${result.routeId} should exist in PAGE_REGISTRY`).toBe(true);
    }
  });

  it("has route rendering proof markers and actionable controls", () => {
    const results = buildRouteProofResults();
    const hardFailures = results.filter((result) => result.status === "fail");
    expect(hardFailures).toEqual([]);

    const missingAnchors = results.filter((result) => !result.headingOrAnchorFound).map((result) => result.route);
    const missingPrimaryActions = results.filter((result) => !result.primaryActionOrWidgetFound).map((result) => result.route);

    expect(missingAnchors, `Missing stable heading/anchor markers on: ${missingAnchors.join(", ")}`).toEqual([]);
    expect(missingPrimaryActions, `Missing obvious interactive controls on: ${missingPrimaryActions.join(", ")}`).toEqual([]);
  });

  it("keeps redirect-loop risk at none for covered routes", () => {
    const risky = buildRouteProofResults().filter((result) => result.redirectLoopRisk !== "none");
    expect(risky).toEqual([]);
  });

  it("captures route-to-api dependency mapping for observability", () => {
    const results = buildRouteProofResults();
    const withApiMappings = results.filter((result) => result.apiDependencies.length > 0);
    expect(withApiMappings.length).toBeGreaterThan(0);
  });
});
