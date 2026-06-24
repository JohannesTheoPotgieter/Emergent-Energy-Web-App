/**
 * Security contract — admin read endpoints must not leak to non-admins.
 *
 * The Roles & Permissions and Integration Statuses surfaces are COO/CEO-only
 * in the live nav. The UI hides + route-guards them, but the *data* endpoints
 * they read must also reject non-admins — otherwise a hidden tab's data is
 * still fetchable directly via the API ("hidden, not secured").
 *
 * These three GET endpoints used to carry only `requireAuth` (any logged-in
 * user). This test pins the 2026-06-24 hardening:
 *   - GET /api/roles            → requireAdmin
 *   - GET /api/roles/:role      → requireSelfRoleOrAdmin (own role OR admin)
 *   - GET /api/integrations     → requireAdmin
 *
 * Static source assertions (same idiom as standup-security-contract.test.ts):
 * cheap, deterministic, and they fail loudly if a guard is dropped.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("admin read endpoints are gated (not just authenticated)", () => {
  const roleMgmt = read("server/role-management.ts");
  const integrations = read("server/departments/integration-health-routes.ts");

  it("GET /api/roles requires admin", () => {
    const re = /app\.get\(\s*["']\/api\/roles["']\s*,[^\n]*requireAdmin/;
    expect(re.test(roleMgmt), "GET /api/roles must carry requireAdmin").toBe(true);
  });

  it("GET /api/roles/:role requires self-or-admin", () => {
    const re = /app\.get\(\s*["']\/api\/roles\/:role["']\s*,[^\n]*requireSelfRoleOrAdmin/;
    expect(re.test(roleMgmt), "GET /api/roles/:role must carry requireSelfRoleOrAdmin").toBe(true);
  });

  it("the self-or-admin guard falls back to requireAdmin for any non-self role", () => {
    // Guard against the carve-out being silently widened to "any authenticated
    // user": the middleware must delegate to requireAdmin when not self.
    const guardStart = roleMgmt.indexOf("const requireSelfRoleOrAdmin");
    const guardBody = roleMgmt.slice(guardStart, guardStart + 800);
    expect(guardBody).toMatch(/return requireAdmin\(req, res, next\)/);
  });

  it("GET /api/integrations requires admin", () => {
    const re = /router\.get\(\s*["']\/api\/integrations["']\s*,[^\n]*requireAdmin/;
    expect(re.test(integrations), "GET /api/integrations must carry requireAdmin").toBe(true);
  });

  it("none of the three hardened endpoints are left with only requireAuth", () => {
    // Belt-and-braces: the exact "only requireAuth" signatures must be gone.
    expect(roleMgmt).not.toMatch(/app\.get\(\s*["']\/api\/roles["']\s*,\s*jwtAuth\s*,\s*requireAuth\s*,\s*async/);
    expect(roleMgmt).not.toMatch(/app\.get\(\s*["']\/api\/roles\/:role["']\s*,\s*jwtAuth\s*,\s*requireAuth\s*,\s*async/);
    expect(integrations).not.toMatch(/router\.get\(\s*["']\/api\/integrations["']\s*,\s*requireAuth\s*,\s*async/);
  });
});
