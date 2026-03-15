import { ApiV2Error } from "../utils/http";

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  CEO_ADMIN: ["*"],
  COO_ADMIN: ["*"],
  CFO: ["dashboard.read", "projects.read", "finance.read", "finance.write", "procurement.read", "procurement.write", "invoice.write"],
  PROGRAM_MANAGER: ["dashboard.read", "projects.read", "projects.write", "pm.read", "pm.write", "engineering.read", "quality.read", "work_items.write", "milestones.write", "procurement.read"],
  PROJECT_DEVELOPER: ["dashboard.read", "projects.read", "development.read", "development.write", "work_items.write"],
  ENGINEER: ["dashboard.read", "projects.read", "engineering.read", "engineering.write", "work_items.write"],
  QUALITY_MANAGER: ["dashboard.read", "projects.read", "quality.read", "quality.write", "work_items.read"],
  CONSTRUCTION_MANAGER: ["dashboard.read", "projects.read", "pm.read", "pm.write", "procurement.read", "milestones.write", "work_items.write"],
  ACCOUNTANT: ["dashboard.read", "projects.read", "finance.read", "finance.write", "procurement.read", "procurement.write", "invoice.write"],
};

export function permissionsForRole(role: string | undefined) {
  return role ? ROLE_PERMISSIONS[role] ?? [] : [];
}

export function assertPermission(role: string | undefined, permission: string) {
  const grants = permissionsForRole(role);
  if (grants.includes("*") || grants.includes(permission)) return;
  throw new ApiV2Error("FORBIDDEN", 403, `Missing permission: ${permission}`);
}
