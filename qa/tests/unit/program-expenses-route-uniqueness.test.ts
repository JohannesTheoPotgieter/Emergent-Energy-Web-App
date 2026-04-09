/**
 * Regression test: /api/program-expenses route uniqueness
 *
 * Verifies that the program-expenses routes are registered exactly once,
 * in server/departments/finance-routes.ts only. The legacy duplicate
 * in server/routes.ts was removed because it was shadowed (registered
 * later in the Express middleware stack) and unreachable at runtime.
 *
 * Evidence chain:
 *   register-all-routes.ts → registerDepartmentRoutes(app) [line 25]
 *     → register-department-routes.ts → registerFinanceRoutes(app) [line 34]
 *       → finance-routes.ts → app.use(router) [line 4951]
 *         → router.get("/api/program-expenses", ...) [line 2851]
 *         → router.get("/api/program-expenses/:projectName", ...) [line 2877]
 *   register-all-routes.ts → registerRoutes(httpServer, app) [line 28]
 *     → routes.ts [line 477] — registered AFTER department routes
 *     → Legacy handlers were unreachable due to Express first-match semantics
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function countOccurrences(source: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(pattern, pos)) !== -1) {
    count++;
    pos += pattern.length;
  }
  return count;
}

describe("/api/program-expenses route uniqueness", () => {
  const financeRoutes = read("server/departments/finance-routes.ts");
  const legacyRoutes = read("server/routes.ts");

  it("canonical route GET /api/program-expenses exists in finance-routes.ts", () => {
    expect(financeRoutes).toContain('"/api/program-expenses"');
  });

  it("canonical route GET /api/program-expenses/:projectName exists in finance-routes.ts", () => {
    expect(financeRoutes).toContain('"/api/program-expenses/:projectName"');
  });

  it("legacy routes.ts does NOT register /api/program-expenses (removed duplicate)", () => {
    // Must not contain an active app.get registration for this path.
    // The REMOVED comment is expected; an actual handler registration is not.
    const hasActiveHandler = /app\.get\(\s*["']\/api\/program-expenses["']/.test(legacyRoutes);
    expect(hasActiveHandler).toBe(false);
  });

  it("legacy routes.ts does NOT register /api/program-expenses/:projectName (removed duplicate)", () => {
    const hasActiveHandler = /app\.get\(\s*["']\/api\/program-expenses\/:projectName["']/.test(legacyRoutes);
    expect(hasActiveHandler).toBe(false);
  });

  it("finance-routes.ts registers GET /api/program-expenses exactly once", () => {
    // Count router.get("/api/program-expenses" — must appear exactly once
    // (the query-string variant, not the parameterized one)
    const matches = financeRoutes.match(/router\.get\(\s*["']\/api\/program-expenses["']/g);
    expect(matches).toHaveLength(1);
  });

  it("finance-routes.ts registers GET /api/program-expenses/:projectName exactly once", () => {
    const matches = financeRoutes.match(/router\.get\(\s*["']\/api\/program-expenses\/:projectName["']/g);
    expect(matches).toHaveLength(1);
  });

  it("registration order: department routes register before legacy routes", () => {
    const allRoutes = read("server/routes/register-all-routes.ts");
    const deptIdx = allRoutes.indexOf("registerDepartmentRoutes(app)");
    const legacyIdx = allRoutes.indexOf("registerRoutes(httpServer, app)");
    expect(deptIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(-1);
    expect(deptIdx).toBeLessThan(legacyIdx);
  });

  it("department routes import and call registerFinanceRoutes", () => {
    const deptRoutes = read("server/routes/register-department-routes.ts");
    expect(deptRoutes).toContain("registerFinanceRoutes");
    expect(deptRoutes).toContain('import("../departments/finance-routes")');
  });
});
