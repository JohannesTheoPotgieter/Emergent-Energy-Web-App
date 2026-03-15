export const PERMISSION_CATALOG = {
  "*": ["*"],
  CFO: ["dashboard.read", "projects.read", "finance.read", "finance.write", "procurement.read", "procurement.write", "invoice.write"],
  PROGRAM_MANAGER: ["dashboard.read", "projects.read", "projects.write", "pm.read", "pm.write", "engineering.read", "quality.read", "work_items.write", "milestones.write", "procurement.read"],
  PROJECT_DEVELOPER: ["dashboard.read", "projects.read", "development.read", "development.write", "work_items.write"],
  ENGINEER: ["dashboard.read", "projects.read", "engineering.read", "engineering.write", "work_items.write"],
  ENGINEERING_MANAGER: ["dashboard.read", "projects.read", "engineering.read", "engineering.write", "work_items.write", "milestones.write"],
  QUALITY_MANAGER: ["dashboard.read", "projects.read", "quality.read", "quality.write", "work_items.read"],
  CONSTRUCTION_MANAGER: ["dashboard.read", "projects.read", "pm.read", "pm.write", "procurement.read", "milestones.write", "work_items.write"],
  ACCOUNTANT: ["dashboard.read", "projects.read", "finance.read", "finance.write", "procurement.read", "procurement.write", "invoice.write"],
} as const;

export const ADMIN_ROLES = ["CEO_ADMIN", "COO_ADMIN"] as const;

export function catalogPermissionsForRole(role: string | undefined): string[] {
  if (!role) return [];
  if (ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return [...PERMISSION_CATALOG["*"]];
  }
  return [...(PERMISSION_CATALOG[role as keyof typeof PERMISSION_CATALOG] ?? [])];
}
