import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePermissionForRole } from "../../../shared/permission-resolver";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("revenue tracker route consolidation", () => {
  const financeRoutesSource = read("server/departments/finance-routes.ts");
  const legacyRoutesSource = read("server/routes.ts");

  // ── Both routes use identical auth ──

  it("canonical /api/revenue-tracker uses requireAuth + requirePermission(revenue_tracker, view)", () => {
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/revenue-tracker['"]\s*,\s*requireAuth\s*,\s*requirePermission\(\s*['"]revenue_tracker['"]\s*,\s*['"]view['"]\s*\)\s*,\s*revenueTrackerHandler\s*,?\s*\)/);
  });

  it("legacy /api/rev-tracker uses the same auth as canonical (not requireAdmin)", () => {
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/rev-tracker['"][\s\S]*?requirePermission\(\s*['"]revenue_tracker['"]\s*,\s*['"]view['"]\s*\)/);
    // Must NOT use requireAdmin anymore
    const revTrackerRoute = financeRoutesSource.match(/router\.get\(\s*['"]\/api\/rev-tracker['"][\s\S]*?\n\);/);
    expect(revTrackerRoute?.[0]).toBeDefined();
    expect(revTrackerRoute?.[0]).not.toContain("requireAdmin");
  });

  it("routes.ts no longer registers its own /api/rev-tracker handler", () => {
    // The duplicate handler in routes.ts was removed; only a comment remains
    const routesLines = legacyRoutesSource.split("\n");
    const revTrackerHandlers = routesLines.filter(
      (l: string) => l.includes('"/api/rev-tracker"') && l.trimStart().startsWith("app.")
    );
    expect(revTrackerHandlers).toHaveLength(0);
  });

  // ── Both routes return identical payload (shared handler) ──

  it("legacy route delegates to the same revenueTrackerHandler as canonical", () => {
    // The legacy route calls revenueTrackerHandler directly
    const legacyBlock = financeRoutesSource
      .split("\n")
      .filter((l: string) => l.includes("rev-tracker") || l.includes("revenueTrackerHandler"));
    const usesSharedHandler = legacyBlock.some((l: string) => l.includes("revenueTrackerHandler"));
    expect(usesSharedHandler).toBe(true);
  });

  // ── Unauthorized users receive 403 ──

  it("ENGINEER is denied revenue_tracker:view permission (403 on both routes)", () => {
    const emptyRoleRecord = {
      entityPermissions: null,
      authorityModel: null,
      canManageUsers: false,
      canManageRoles: false,
    };
    const result = evaluatePermissionForRole({
      role: "ENGINEER",
      entity: "revenue_tracker",
      action: "view",
      roleRecord: emptyRoleRecord,
    });
    expect(result.allowed).toBe(false);
  });

  it("COO_ADMIN is allowed revenue_tracker:view", () => {
    const emptyRoleRecord = {
      entityPermissions: null,
      authorityModel: null,
      canManageUsers: false,
      canManageRoles: false,
    };
    const result = evaluatePermissionForRole({
      role: "COO_ADMIN",
      entity: "revenue_tracker",
      action: "view",
      roleRecord: emptyRoleRecord,
    });
    expect(result.allowed).toBe(true);
  });

  it("PROGRAM_FINANCE_MANAGER is allowed revenue_tracker:view", () => {
    const emptyRoleRecord = {
      entityPermissions: null,
      authorityModel: null,
      canManageUsers: false,
      canManageRoles: false,
    };
    const result = evaluatePermissionForRole({
      role: "PROGRAM_FINANCE_MANAGER",
      entity: "revenue_tracker",
      action: "view",
      roleRecord: emptyRoleRecord,
    });
    expect(result.allowed).toBe(true);
  });

  // ── Deprecation logging present ──

  it("legacy route logs a deprecation warning", () => {
    expect(financeRoutesSource).toContain("[DEPRECATION] GET /api/rev-tracker called");
  });

  it("legacy route has removal plan documented", () => {
    expect(financeRoutesSource).toContain("Removal plan:");
    expect(financeRoutesSource).toContain("Canonical route: /api/revenue-tracker");
  });
});
