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

  it("has permanently removed the clear-audit-log endpoint", () => {
    // The audit log is append-only. There must be NO HTTP handler anywhere
    // in the server codebase that deletes audit_events rows.
    const adminControlRoutes = read("server/admin-control-routes.ts");
    expect(adminControlRoutes).not.toContain('"/api/admin/control-center/dangerous/clear-audit-log"');
    expect(adminControlRoutes).not.toMatch(/DELETE FROM audit_events/i);
  });

  it("double-gates clear-all-data with NODE_ENV and ALLOW_DESTRUCTIVE_OPS", () => {
    const importsAdmin = read("server/routes/imports-admin-extracted-routes.ts");
    expect(importsAdmin).toContain('"/api/admin/clear-all-data"');
    expect(importsAdmin).toContain("process.env.NODE_ENV === 'production'");
    expect(importsAdmin).toContain("ALLOW_DESTRUCTIVE_OPS");
  });

  it("blocks the dev-login auth bypass in production", () => {
    const authRoutes = read("server/routes/auth-routes.ts");
    expect(authRoutes).toContain('"/api/auth/dev-login"');
    // Registration guard prevents wiring in production.
    expect(authRoutes).toContain('process.env.NODE_ENV !== "production"');
    // Defence-in-depth: handler itself also 403s if NODE_ENV is production.
    expect(authRoutes).toMatch(/Blocked in production/);
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
