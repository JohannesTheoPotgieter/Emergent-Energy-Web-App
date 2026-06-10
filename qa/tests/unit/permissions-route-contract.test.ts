import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY, getPermissionEntityForPath, getRouteAccessPolicyForPath } from "@/config/page-registry";
import { evaluatePathAccess } from "@/config/runtime-access";
import { ENTITY_PERMISSION_DEFAULTS, DEFAULT_ROLE_PERMISSIONS, checkPermission, type PermissionEntity } from "@shared/schema";
import { NAV_GROUP_TO_SECTION } from "@shared/permissions/permission-matrix";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("permissions contract: frontend + backend + registry", () => {
  const catalogEntities = new Set(ENTITY_PERMISSION_DEFAULTS.map((r) => r.entity));
  const appTs = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");

  it("every PAGE_REGISTRY permissionEntity exists in backend permission catalog", () => {
    const missing = PAGE_REGISTRY
      .map((p) => p.permissionEntity)
      .filter((e): e is PermissionEntity => Boolean(e))
      .filter((e) => !catalogEntities.has(e));

    expect(missing, `Missing catalog entity mappings: ${missing.join(", ")}`).toEqual([]);
  });

  it("sidebar-visible routes map to sections present in seeded roles", () => {
    const sectionUniverse = new Set(DEFAULT_ROLE_PERMISSIONS.flatMap((r) => r.sections || []));
    const allowedUnseededSections = new Set(["PRIORITIES"]);
    const unknownSectionMappings = PAGE_REGISTRY
      .filter((p) => p.showInSidebar && p.navGroup)
      .map((p) => ({ id: p.id, navGroup: p.navGroup!, section: NAV_GROUP_TO_SECTION[p.navGroup!] }))
      .filter((x) => !x.section || (!allowedUnseededSections.has(x.section) && !sectionUniverse.has(x.section)));

    expect(unknownSectionMappings).toEqual([]);
  });

  it("direct URL access is guarded in App routing for denied users", () => {
    expect(appTs).toContain("!canViewPath(location)");
    expect(appTs).toContain("return <AccessDenied />");
  });

  it("every page route has at least one role that can view it via defaults", () => {
    const roles = DEFAULT_ROLE_PERMISSIONS.map((r) => r.role);
    const inaccessible = PAGE_REGISTRY.filter((p) => {
      if (!p.permissionEntity) return false;
      return !roles.some((role) => checkPermission(role, p.permissionEntity as PermissionEntity, "view"));
    }).map((p) => `${p.id}:${p.path}:${p.permissionEntity}`);

    expect(inaccessible, `No role can view these routes by default: ${inaccessible.join(", ")}`).toEqual([]);
  });
});

describe("permission-contract: /finance/revenue resolves to the Revenue page (regression #1044)", () => {
  // #1044 (modern gates) made each finance path gate on its own page-registry
  // entry via canViewPath/evaluatePathAccess. /finance/revenue had NO entry, so
  // it resolved as an "unknown" route and was denied for EVERYONE — including
  // COO_ADMIN. It must resolve to the Revenue page's `revenue_tracker` entity,
  // exactly like the canonical /revenue-tracker, restoring the pre-#1044 access
  // without broadening it.
  const ALL_ROLES = DEFAULT_ROLE_PERMISSIONS.map((r) => r.role);

  it("is a registered, protected route mapped to revenue_tracker (not an unknown route)", () => {
    expect(getRouteAccessPolicyForPath("/finance/revenue")).toBe("protected");
    expect(getPermissionEntityForPath("/finance/revenue")).toBe("revenue_tracker");
  });

  it("COO_ADMIN can view /finance/revenue", () => {
    expect(evaluatePathAccess({ role: "COO_ADMIN", path: "/finance/revenue", snapshot: {} }).allowed).toBe(true);
  });

  it("a role without revenue access stays denied on /finance/revenue", () => {
    expect(evaluatePathAccess({ role: "ENGINEER", path: "/finance/revenue", snapshot: {} }).allowed).toBe(false);
  });

  it("grants exactly the revenue_tracker view-roles, with parity to /revenue-tracker (broadens no one)", () => {
    for (const role of ALL_ROLES) {
      const finance = evaluatePathAccess({ role, path: "/finance/revenue", snapshot: {} }).allowed;
      const canonical = evaluatePathAccess({ role, path: "/revenue-tracker", snapshot: {} }).allowed;
      const granted = checkPermission(role, "revenue_tracker", "view");
      expect(finance, `${role}: /finance/revenue access must equal the revenue_tracker grant`).toBe(granted);
      expect(finance, `${role}: /finance/revenue must match canonical /revenue-tracker`).toBe(canonical);
    }
  });
});
