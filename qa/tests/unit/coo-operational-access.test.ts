import { describe, expect, it } from "vitest";
import { evaluatePermissionForRole } from "@shared/permission-resolver";
import { COO_OPERATIONAL_ACCESS_MATRIX } from "@shared/coo-operational-access-matrix";
import { PAGE_REGISTRY } from "@/config/page-registry";
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
    const registryPaths = new Set(PAGE_REGISTRY.map((page) => page.path));

    for (const domain of COO_OPERATIONAL_ACCESS_MATRIX) {
      for (const path of domain.discoverablePaths) {
        expect(registryPaths.has(path), `${domain.domain} missing discoverable path: ${path}`).toBe(true);
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
