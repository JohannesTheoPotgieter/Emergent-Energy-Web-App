import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_ROUTE_OWNERSHIP } from "../../../server/platform/route-ownership";

const ROOT = process.cwd();

describe("platform route ownership", () => {
  it("keeps platform route ownership entries unique and backed by real files", () => {
    const routes = PLATFORM_ROUTE_OWNERSHIP.map((entry) => entry.route);
    expect(new Set(routes).size).toBe(routes.length);

    for (const entry of PLATFORM_ROUTE_OWNERSHIP) {
      const absoluteOwnerPath = path.join(ROOT, entry.ownerFile);
      expect(fs.existsSync(absoluteOwnerPath), `${entry.ownerFile} should exist`).toBe(true);
      expect(entry.readEntities.length).toBeGreaterThan(0);
    }
  });

  it("registers the platform routes in the core startup path", () => {
    const registerCoreRoutes = fs.readFileSync(path.join(ROOT, "server/routes/register-core-routes.ts"), "utf8");
    expect(registerCoreRoutes).toContain("registerPlatformRoutes");

    const platformRoutes = fs.readFileSync(path.join(ROOT, "server/platform-routes.ts"), "utf8");
    expect(platformRoutes).toContain("/api/platform/contracts");
    expect(platformRoutes).toContain("/api/platform/projects/:projectId/summary");
  });

  it("keeps legacy department project routes out of active route registration", () => {
    const registerAllRoutes = fs.readFileSync(path.join(ROOT, "server/routes/register-all-routes.ts"), "utf8");
    const registerDepartmentRoutes = fs.readFileSync(path.join(ROOT, "server/routes/register-department-routes.ts"), "utf8");

    expect(registerAllRoutes).not.toContain("../departments/project-routes");
    expect(registerDepartmentRoutes).not.toContain("../departments/project-routes");
  });
});
