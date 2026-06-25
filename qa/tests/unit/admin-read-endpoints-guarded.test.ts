/**
 * Security contract — admin read endpoints must not leak to non-admins.
 *
 * The Roles & Permissions and Integration Statuses surfaces are COO/CEO-only
 * in the live nav. The UI hides + route-guards them, but the *data* endpoints
 * they read must also reject non-admins — otherwise a hidden tab's data is
 * still fetchable directly via the API ("hidden, not secured").
 *
 * These GET endpoints used to carry only `requireAuth` (any logged-in user).
 * This test pins the 2026-06-24 hardening + the 2026-06-25 integration-health
 * scoping:
 *   - GET /api/roles                  → requireAdmin
 *   - GET /api/roles/:role            → requireSelfRoleOrAdmin (own role OR admin)
 *   - GET /api/integrations           → requirePermission("integration_health","view")
 *   - GET /api/integrations/:name/runs→ requirePermission("integration_health","view")
 *
 * Integration *statuses* are now a grantable, view-only surface (so finance can
 * monitor QuickBooks sync health) while integration *setup* (the POST routes)
 * stays `requireAdmin`. The runs endpoint, previously authenticated-only, is
 * tightened onto the same grant.
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

  it("GET /api/integrations requires the integration_health view permission", () => {
    const re = /router\.get\(\s*["']\/api\/integrations["']\s*,[^\n]*requirePermission\(\s*["']integration_health["']\s*,\s*["']view["']\s*\)/;
    expect(re.test(integrations), "GET /api/integrations must carry requirePermission(integration_health, view)").toBe(true);
  });

  it("GET /api/integrations/:name/runs is gated on integration_health view (was authenticated-only)", () => {
    const re = /router\.get\(\s*["']\/api\/integrations\/:name\/runs["']\s*,[^\n]*requirePermission\(\s*["']integration_health["']\s*,\s*["']view["']\s*\)/;
    expect(re.test(integrations), "GET /api/integrations/:name/runs must carry requirePermission(integration_health, view)").toBe(true);
  });

  it("integration setup (POST routes) stays admin-only", () => {
    // Viewing statuses is grantable; mutating integration config is not.
    expect(integrations).toMatch(/router\.post\([\s\S]{0,200}?requireAdmin/);
  });

  it("none of the hardened read endpoints are left with only requireAuth", () => {
    // Belt-and-braces: the exact "only requireAuth" signatures must be gone.
    expect(roleMgmt).not.toMatch(/app\.get\(\s*["']\/api\/roles["']\s*,\s*jwtAuth\s*,\s*requireAuth\s*,\s*async/);
    expect(roleMgmt).not.toMatch(/app\.get\(\s*["']\/api\/roles\/:role["']\s*,\s*jwtAuth\s*,\s*requireAuth\s*,\s*async/);
    expect(integrations).not.toMatch(/router\.get\(\s*["']\/api\/integrations["']\s*,\s*requireAuth\s*,\s*async/);
    expect(integrations).not.toMatch(/router\.get\(\s*["']\/api\/integrations\/:name\/runs["']\s*,\s*requireAuth\s*,\s*async/);
  });
});
