import { describe, expect, it } from "vitest";
import { evaluatePermissionForRole } from "@shared/permission-resolver";
import { COO_OPERATIONAL_ACCESS_MATRIX } from "@shared/coo-operational-access-matrix";
import { PAGE_REGISTRY, LEGACY_REDIRECTS } from "@/config/page-registry";
import fs from "node:fs";

describe("COO operational access matrix", () => {
  it("grants COO full operational CRUD+approve access for required domains", () => {
    for (const domain of COO_OPERATIONAL_ACCESS_MATRIX) {
      for (const entity of domain.entities) {
        for (const action of domain.requiredActions) {
          const result = evaluatePermissionForRole({
            role: "COO_ADMIN",
            entity,
            action,
          });

          expect(result.allowed, `${domain.domain}.${entity}.${action}`).toBe(true);
        }
      }
    }
  });

  it("keeps least privilege for VIEWER on operational write actions", () => {
    for (const domain of COO_OPERATIONAL_ACCESS_MATRIX) {
      for (const entity of domain.entities) {
        for (const action of ["create", "edit", "approve", "delete"] as const) {
          const result = evaluatePermissionForRole({
            role: "VIEWER",
            entity,
            action,
          });

          expect(result.allowed, `VIEWER unexpectedly allowed ${domain.domain}.${entity}.${action}`).toBe(false);
        }
      }
    }
  });

  it("ensures every operational domain has discoverable UI entry points", () => {
    // Discoverable means reachable from the URL: either a registered page or
    // a legacy redirect that lands on one. /admin/control-center, for
    // example, was retired (Task #101) but is preserved as a redirect to
    // /admin/roles so deep links still work.
    const registryPaths = new Set(PAGE_REGISTRY.map((page) => page.path));
    const redirectPaths = new Set(LEGACY_REDIRECTS.map((r) => r.path));

    for (const domain of COO_OPERATIONAL_ACCESS_MATRIX) {
      for (const path of domain.discoverablePaths) {
        const reachable = registryPaths.has(path) || redirectPaths.has(path);
        expect(reachable, `${domain.domain} missing discoverable path: ${path}`).toBe(true);
      }
    }
  });

  it("aligns weekly review API guard with weekly review permission entity", () => {
    const source = fs.readFileSync("server/weekly-review-routes.ts", "utf8");
    expect(source).toContain("requirePermission('weekly_review_wizard', 'view')");
    expect(source).toContain("requirePermission('weekly_review_wizard', 'create')");
    expect(source).toContain("requirePermission('weekly_review_wizard', 'edit')");
  });
});
