import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("platform route ownership", () => {
  it("ensures every route in PAGE_REGISTRY has a permission entity or an explicit access policy", () => {
    const ungatedRoutes: string[] = [];

    for (const page of PAGE_REGISTRY) {
      if (!page.permissionEntity && page.accessPolicy !== "public" && page.accessPolicy !== "ungated") {
        ungatedRoutes.push(`${page.id} (${page.path})`);
      }
    }

    expect(
      ungatedRoutes,
      `Routes without permissionEntity or accessPolicy: ${ungatedRoutes.join(", ")}`,
    ).toHaveLength(0);
  });

  it("has a non-trivial number of registered routes", () => {
    expect(PAGE_REGISTRY.length).toBeGreaterThan(50);
  });
});
