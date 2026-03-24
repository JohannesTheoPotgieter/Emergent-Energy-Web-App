export const PRIORITY_ADMIN_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
] as const;

export type PriorityAdminRole = (typeof PRIORITY_ADMIN_ROLES)[number];

export function isPriorityAdminRole(role: string | null | undefined): boolean {
  return !!role && PRIORITY_ADMIN_ROLES.includes(role as PriorityAdminRole);
}
