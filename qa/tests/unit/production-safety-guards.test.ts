import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProductionRuntime } from "../../../server/middleware/production-safety";

describe("production safety middleware", () => {
  it("detects production runtime", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(isProductionRuntime()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(isProductionRuntime()).toBe(false);
    process.env.NODE_ENV = original;
  });
});

describe("dangerous route guard coverage", () => {
  function read(file: string) {
    return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
  }

  it("blocks high-risk destructive routes in production", () => {
    const invoiceRoutes = read("server/invoice-pattern-routes.ts");
    expect(invoiceRoutes).toContain('"/api/admin/wipe-all-data"');
    expect(invoiceRoutes).toContain("blockInProduction(\"Full database wipe is disabled in production.\")");
    expect(invoiceRoutes).toContain('"/api/procurement-analysis/reset-tags"');
    expect(invoiceRoutes).toContain("blockInProduction(\"Reset tags is disabled in production pending dual-control approval flow.\")");
  });

  it("prevents audit history deletion in production", () => {
    const adminControlRoutes = read("server/admin-control-routes.ts");
    expect(adminControlRoutes).toContain('"/api/admin/control-center/dangerous/clear-audit-log"');
    expect(adminControlRoutes).toContain("Audit log deletion is disabled in production to preserve immutable history.");
  });

  it("guards seed/debug-style write routes in production", () => {
    const eeInfoRoutes = read("server/ee-info-routes.ts");
    const roleAuthRoutes = read("server/role-auth-routes.ts");
    const standupRoutes = read("server/standup-routes.ts");
    const taskRoutes = read("server/task-management-routes.ts");

    expect(eeInfoRoutes).toContain('"/api/ee-info/os/seed"');
    expect(eeInfoRoutes).toContain("blockInProduction(\"OS seed route is disabled in production.\")");
    expect(eeInfoRoutes).toContain('"/api/ee-info/story/seed-demo"');
    expect(eeInfoRoutes).toContain('"/api/ee-info/story/auto-seed"');

    expect(roleAuthRoutes).toContain('"/api/role-auth/seed"');
    expect(roleAuthRoutes).toContain("blockInProduction(\"Role credential seed route is disabled in production.\")");

    expect(standupRoutes).toContain('"/api/standups/seed-default"');
    expect(taskRoutes).toContain('"/api/tasks/seed-identified-items"');
  });

  it("keeps explicit session expiry configuration", () => {
    const sessionSource = read("server/bootstrap/session.ts");
    expect(sessionSource).toContain("const SESSION_MAX_AGE = 8 * 60 * 60 * 1000");
    expect(sessionSource).toContain("const IDLE_TIMEOUT = 2 * 60 * 60 * 1000");
  });
});
