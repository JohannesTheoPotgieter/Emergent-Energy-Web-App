import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const controlPage = readFileSync(resolve(process.cwd(), "client/src/pages/handover-control.tsx"), "utf8");
const handoverRoutes = readFileSync(resolve(process.cwd(), "server/handover-routes.ts"), "utf8");
const permissions = readFileSync(resolve(process.cwd(), "shared/permissions/registry.ts"), "utf8");

describe("handover health score surfaces", () => {
  it("renders explicit incomplete-data state instead of undefined score", () => {
    expect(controlPage).toContain("Not enough data");
    expect(controlPage).toContain("health_missing_inputs");
    expect(controlPage).toContain("health_score");
  });

  it("exposes explainable score context from control API", () => {
    expect(handoverRoutes).toContain("health_blockers");
    expect(handoverRoutes).toContain("health_missing_inputs");
    expect(handoverRoutes).toContain("health_not_enough_data");
  });

  it("keeps COO/PD/PM/Program Manager scoped handover permissions", () => {
    expect(permissions).toContain("entity: 'handover'");
    expect(permissions).toContain("'COO_ADMIN'");
    expect(permissions).toContain("'PROJECT_DEVELOPER'");
    expect(permissions).toContain("'PROJECT_MANAGER_SITE'");
    expect(permissions).toContain("'PROGRAM_MANAGER'");
  });

  it("retains engineering-pm alias endpoint usage on the control page", () => {
    expect(controlPage).toContain('/api/engineering-pm-handover/control');
  });
});
