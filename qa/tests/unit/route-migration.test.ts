import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("routes.ts migration infrastructure", () => {
  const routesSource = read("server/routes.ts");
  const registrySource = read("server/routes/route-registry.ts");
  const registerAllSource = read("server/routes/register-all-routes.ts");
  const mytoolStub = read("server/routes/mytool-routes.ts");
  const migrationDoc = read("docs/route-migration-status.md");

  // ── LEGACY ROUTE SHELL header (migration complete) ──

  it("routes.ts has LEGACY ROUTE SHELL header", () => {
    expect(routesSource).toContain("LEGACY ROUTE SHELL");
    expect(routesSource).toContain("All handlers have been extracted");
  });

  it("routes.ts documents that new routes belong in server/routes/ or server/departments/", () => {
    expect(routesSource).toContain("New routes MUST go in server/routes/ or server/departments/");
  });

  // ── Route registry ──

  it("route-registry.ts exists and imports mytool-routes", () => {
    expect(registrySource).toContain("registerMytoolRoutes");
    expect(registrySource).toContain("mytool-routes");
  });

  it("register-all-routes.ts imports and calls registerExtractedRoutes", () => {
    expect(registerAllSource).toContain("registerExtractedRoutes");
    expect(registerAllSource).toContain("route-registry");
  });

  it("extracted routes are registered BEFORE legacy routes.ts", () => {
    const extractedIdx = registerAllSource.indexOf("registerExtractedRoutes");
    const legacyIdx = registerAllSource.indexOf("registerRoutes(httpServer");
    expect(extractedIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(-1);
    expect(extractedIdx).toBeLessThan(legacyIdx);
  });

  // ── Mytool extraction ──

  it("mytool-routes.ts documents all handler paths", () => {
    expect(mytoolStub).toContain("/api/mytool/settings");
    expect(mytoolStub).toContain("/api/mytool/tasks");
    expect(mytoolStub).toContain("/api/mytool/timeblocks");
    expect(mytoolStub).toContain("/api/mytool/daily-review");
    expect(mytoolStub).toContain("/api/mytool/preferences");
    expect(mytoolStub).toContain("/api/mytool/triage-rules");
    expect(mytoolStub).toContain("/api/mytool/triage-inbox");
    expect(mytoolStub).toContain("/api/mytool/unclassified-tasks");
    expect(mytoolStub).toContain("36 handlers");
  });

  it("routes.ts delegates to extracted route registration functions", () => {
    // Migration is complete — routes.ts is a thin shell that delegates
    expect(routesSource).toContain("registerAuthRoutes");
    expect(routesSource).toContain("registerDashboardRoutes");
    expect(routesSource).toContain("registerWorkingPlanRoutes");
  });

  // ── Migration doc ──

  it("migration doc has total handler count", () => {
    expect(migrationDoc).toContain("187");
  });

  it("migration doc lists domain groups with priorities", () => {
    expect(migrationDoc).toContain("MyTool");
    expect(migrationDoc).toContain("Admin");
    expect(migrationDoc).toContain("Outlook");
    expect(migrationDoc).toContain("P0");
    expect(migrationDoc).toContain("P1");
  });

  it("migration doc lists already-extracted route files", () => {
    expect(migrationDoc).toContain("notification-routes.ts");
    expect(migrationDoc).toContain("report-routes.ts");
    expect(migrationDoc).toContain("smart-import-routes.ts");
  });

  // ── CI check ──

  it("CI check script exists", () => {
    const script = read("scripts/check-routes-migration.ts");
    expect(script).toContain("FROZEN_BASELINE");
    expect(script).toContain("routes.ts Migration Progress");
  });

  it("package.json has check:routes-migration script", () => {
    const pkg = read("package.json");
    expect(pkg).toContain('"check:routes-migration"');
    expect(pkg).toContain("check-routes-migration.ts");
  });

  // ── routes.ts is now a thin shell ──

  it("routes.ts is a thin shell (under 50 lines)", () => {
    const lineCount = routesSource.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(50);
  });
});
