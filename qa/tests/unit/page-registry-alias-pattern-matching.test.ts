import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  getRouteAccessPolicyForPath,
  getPermissionEntityForPath,
  getAppSectionForPath,
  findPageByPath,
  PAGE_REGISTRY,
} from "../../../client/src/config/page-registry";

describe("page-registry alias pattern matching", () => {
  it("resolves /project/<slug> via the parametric alias on projectDetail", () => {
    const page = findPageByPath("/project/Swellengrebel");
    expect(page?.id).toBe("projectDetail");
    expect(getRouteAccessPolicyForPath("/project/Swellengrebel")).toBe("protected");
    expect(getPermissionEntityForPath("/project/Swellengrebel")).toBe("projects");
    expect(getAppSectionForPath("/project/Swellengrebel")).toBe("PROJECT_DELIVERY");
  });

  it("resolves canonical /project/id/:projectId path", () => {
    expect(getRouteAccessPolicyForPath("/project/id/385")).toBe("protected");
    expect(getPermissionEntityForPath("/project/id/385")).toBe("projects");
  });

  it("resolves project subroutes via the parametric alias when matchSubRoutes is enabled", () => {
    expect(getRouteAccessPolicyForPath("/project/Swellengrebel/financial-linking")).toBe("protected");
    expect(getRouteAccessPolicyForPath("/project/Swellengrebel/gate/L_DESIGN_PRELIM")).toBe("protected");
  });

  it("does not over-match unrelated parametric paths", () => {
    // matchesPattern() requires identical segment counts, so deeper or
    // structurally different paths must not accidentally hit the alias.
    expect(findPageByPath("/totally/unknown/path")).toBeUndefined();
    expect(getRouteAccessPolicyForPath("/totally/unknown/path")).toBe("unknown");
    expect(getRouteAccessPolicyForPath("/project")).toBe("unknown");
  });

  it("App.tsx renders the page component for parametric aliases (does not redirect to a literal :param template)", () => {
    // wouter's <Redirect to="/project/id/:projectId" /> emits the literal
    // string ":projectId" — params are not substituted. The fix is to render
    // the same page component on parametric alias routes so the page's own
    // useRoute() hooks resolve either the slug or the canonical id form.
    // This source-level tripwire prevents that branch from regressing.
    const appSrc = fs.readFileSync("client/src/App.tsx", "utf8");
    expect(appSrc).toMatch(/alias\.includes\(":"\)\s*&&\s*page\.routeComponentKey/);
    expect(appSrc).toMatch(/path:\s*alias,\s*component:\s*ROUTE_COMPONENTS\[page\.routeComponentKey\]/);
  });

  it("every parametric alias points at a page that has a routeComponentKey and a useRoute() handler for the alias path", () => {
    // Registry invariant: any alias containing :params must be backed by
    // (a) a page with a routeComponentKey (so App.tsx can render it on the
    // alias route instead of redirecting), and (b) the page's source must
    // include a useRoute() hook matching the alias pattern, so the
    // component actually resolves the alias's params.
    const parametricAliases = PAGE_REGISTRY.flatMap((page) =>
      (page.aliases ?? [])
        .filter((alias) => alias.includes(":"))
        .map((alias) => ({ pageId: page.id, alias, routeComponentKey: page.routeComponentKey })),
    );
    expect(parametricAliases.length).toBeGreaterThan(0);

    const componentKeyToFile: Record<string, string> = {
      ProjectDetailPage: "client/src/pages/project-detail.tsx",
      ProjectStageGatePage: "client/src/pages/project-stage-gate.tsx",
    };

    for (const { pageId, alias, routeComponentKey } of parametricAliases) {
      expect(routeComponentKey, `${pageId} alias ${alias} requires routeComponentKey`).toBeTruthy();
      const file = componentKeyToFile[routeComponentKey!];
      if (!file) {
        // If a new parametric-alias page is added, register its file mapping
        // here so the useRoute() coverage is enforced.
        throw new Error(
          `Add componentKeyToFile mapping for ${routeComponentKey} (page ${pageId}) so the test can verify useRoute("${alias}") exists.`,
        );
      }
      const src = fs.readFileSync(file, "utf8");
      expect(src.includes(`useRoute("${alias}")`), `${file} must call useRoute("${alias}") to handle parametric alias`).toBe(true);
    }
  });
});
