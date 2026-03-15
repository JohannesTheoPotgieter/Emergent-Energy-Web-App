import { ApiV2Error } from "../utils/http";
import { catalogPermissionsForRole } from "./permission-catalog";

const ROLE_ALIASES: Record<string, string> = {
  admin: "COO_ADMIN",
  quality_manager: "QUALITY_MANAGER",
  eng_program_manager: "ENGINEERING_MANAGER",
  member: "PROGRAM_MANAGER",
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  COO_ADMIN: ["*"],
  CEO_ADMIN: ["*"],
};

function normalizeRole(role: string | undefined): string | undefined {
  if (!role) return role;
  return ROLE_ALIASES[role] ?? role;
}

export function permissionsForRole(role: string | undefined) {
  const normalizedRole = normalizeRole(role);
  const dynamicPerms = catalogPermissionsForRole(normalizedRole);
  if (dynamicPerms.length) return dynamicPerms;
  return normalizedRole ? ROLE_PERMISSIONS[normalizedRole] ?? [] : [];
}

export function assertPermission(role: string | undefined, permission: string) {
  const grants = permissionsForRole(role);
  if (grants.includes("*") || grants.includes(permission)) return;
  throw new ApiV2Error("FORBIDDEN", 403, `Missing permission: ${permission}`);
}
