import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY, LEGACY_REDIRECTS } from "../../../client/src/config/page-registry";
import { buildRoutePlan } from "../../../client/src/config/app-route-plan";
import { ROUTE_COMPONENT_KEYS } from "../../../client/src/config/route-components";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("route registry ↔ router parity", () => {
  it("contains no unresolved routeComponentKey references", () => {
    const { unresolvedComponentKeys } = buildRoutePlan(ROUTE_COMPONENT_KEYS);
    expect(unresolvedComponentKeys).toEqual([]);
  });

  it("keeps one canonical source for route plan generation", () => {
    const appSource = read("client/src/App.tsx");
    expect(appSource).toContain("buildRoutePlan(ROUTE_COMPONENT_KEYS)");
    expect(appSource).not.toContain("LEGACY_REDIRECTS.map");
    expect(appSource).not.toContain("PAGE_REGISTRY.filter((page)");
  });

  it("has no duplicate concrete route paths in the generated plan", () => {
    const routeComponentKeys = PAGE_REGISTRY
      .map((entry) => entry.routeComponentKey)
      .filter((key): key is string => Boolean(key));

    const { entries } = buildRoutePlan(routeComponentKeys);
    const byPath = new Map<string, number>();
    for (const entry of entries) {
      byPath.set(entry.path, (byPath.get(entry.path) ?? 0) + 1);
    }

    const duplicates = [...byPath.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  it("keeps redirects in one place per source path", () => {
    const redirectSources = new Set<string>();
    for (const r of LEGACY_REDIRECTS) {
      expect(redirectSources.has(r.path)).toBe(false);
      redirectSources.add(r.path);
    }

    for (const page of PAGE_REGISTRY.filter((entry) => Boolean(entry.redirectTo))) {
      expect(redirectSources.has(page.path)).toBe(false);
      redirectSources.add(page.path);
    }
  });
});
