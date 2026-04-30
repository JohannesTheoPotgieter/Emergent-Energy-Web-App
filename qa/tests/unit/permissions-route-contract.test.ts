import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";
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
