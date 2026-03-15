import { ApiV2Error } from "../utils/http";

const rolePermissions: Record<string, string[]> = {
  CEO_ADMIN: ["*"],
  COO_ADMIN: ["*"],
  CFO: ["dashboard", "projects.read", "finance.read", "finance.write", "procurement.read", "procurement.write"],
  PROGRAM_MANAGER: ["dashboard", "projects.read", "projects.write", "pm.read", "pm.write", "engineering.read", "quality.read"],
  PROJECT_DEVELOPER: ["dashboard", "projects.read", "development.read", "development.write"],
  ENGINEER: ["dashboard", "projects.read", "engineering.read", "engineering.write"],
  QUALITY_MANAGER: ["dashboard", "projects.read", "quality.read", "quality.write"],
  CONSTRUCTION_MANAGER: ["dashboard", "projects.read", "pm.read", "pm.write", "procurement.read"],
  ACCOUNTANT: ["dashboard", "projects.read", "finance.read", "procurement.read", "procurement.write"],
};

export function assertPermission(role: string | undefined, permission: string) {
  const grants = role ? rolePermissions[role] ?? [] : [];
  if (grants.includes("*") || grants.includes(permission)) return;
  throw new ApiV2Error("FORBIDDEN", 403, `Missing permission: ${permission}`);
}
