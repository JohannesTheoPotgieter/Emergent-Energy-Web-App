import { checkPermission, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { getAppSectionForPath, getPermissionEntityForPath, getRouteAccessPolicyForPath } from "@/config/page-registry";
import { parseDisabledSubPages } from "@/config/app-navigation";

export type PermissionSnapshot = {
  sections?: string[] | null;
  entityPermissions?: Record<string, Record<string, boolean>> | null;
  userOverrides?: Record<string, boolean> | null;
};

const OLD_TO_NEW_SECTIONS: Record<string, string[]> = {
  COCKPIT: ["HOME"],
  MONEY: ["FINANCE"],
  INFORMATION: ["ADMIN"],
  COLLABORATION: ["HOME"],
  PROJECTS: ["PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE"],
  MY_WORK: ["HOME"],
  GATES: ["PORTFOLIO"],
  QUALITY_HSE: ["QUALITY", "HSE"],
  QUALITY: ["QUALITY", "HSE"],
  GOVERNANCE: ["QUALITY", "HSE"],
  PROJECT_MANAGEMENT: ["PROJECT_DELIVERY"],
};

export function normalizeAllowedSections(sections?: string[] | null): Set<string> | null {
  if (!sections || sections.length === 0) return null;
  const normalized = new Set<string>();
  for (const key of sections) {
    if (key.startsWith("!")) continue;
    const mapped = OLD_TO_NEW_SECTIONS[key];
    if (mapped) mapped.forEach((item) => normalized.add(item));
    else normalized.add(key);
  }
  return normalized;
}

export function evaluateEntityAccess(options: {
  role: string;
  entity: PermissionEntity;
  action: PermissionAction;
  snapshot: PermissionSnapshot;
}): boolean {
  const { role, entity, action, snapshot } = options;
  const overrideKey = `${entity}:${action}`;
  const userOverrides = snapshot.userOverrides;
  if (userOverrides && overrideKey in userOverrides) {
    return userOverrides[overrideKey];
  }

  const entityPermissions = snapshot.entityPermissions as Partial<Record<PermissionEntity, Record<string, boolean>>> | null | undefined;
  const explicit = entityPermissions?.[entity];
  if (explicit && typeof explicit[action] === "boolean") {
    return explicit[action] === true;
  }

  return checkPermission(role, entity, action);
}

export function evaluatePathAccess(options: {
  role: string;
  path: string;
  snapshot: PermissionSnapshot;
  failOpenForUnknown?: boolean;
}): { allowed: boolean; reason: string; section?: string; entity?: PermissionEntity } {
  const { role, path, snapshot, failOpenForUnknown = true } = options;
  if (path === "/") return { allowed: true, reason: "home" };

  const policy = getRouteAccessPolicyForPath(path);
  if (policy === "unknown") {
    return { allowed: failOpenForUnknown, reason: failOpenForUnknown ? "unknown_route_allow" : "unknown_route_deny" };
  }
  if (policy === "public" || policy === "ungated") {
    return { allowed: true, reason: policy };
  }

  const allowedSections = normalizeAllowedSections(snapshot.sections);
  const section = getAppSectionForPath(path);
  if (allowedSections && section && !allowedSections.has(section)) {
    return { allowed: false, reason: "section_block", section };
  }

  const disabled = parseDisabledSubPages(snapshot.sections || []);
  if (section) {
    const disabledForSection = disabled.get(section);
    if (disabledForSection?.has(path)) {
      return { allowed: false, reason: "subpage_block", section };
    }
  }

  const entity = getPermissionEntityForPath(path);
  if (!entity) {
    return { allowed: false, reason: "missing_permission_entity", section };
  }

  const allowed = evaluateEntityAccess({ role, entity, action: "view", snapshot });
  return { allowed, reason: allowed ? "entity_allow" : "entity_block", section, entity };
}
