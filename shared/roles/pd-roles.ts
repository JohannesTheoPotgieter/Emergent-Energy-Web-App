/**
 * Centralised role definitions for the Project Development module.
 * All PD role checks should import from here to ensure consistency.
 */

/** Roles that can work in the PD module (view + manage) */
export const PD_ROLES = [
  "PROJECT_DEVELOPER",
  "KEY_ACCOUNTS_MANAGER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "admin",
] as const;

/** Roles that can create PD tickets */
export const PD_CREATE_ROLES = [
  "PROJECT_DEVELOPER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "admin",
] as const;

/** Roles that can see all tickets (not filtered by assignment) */
export const PD_VIEW_ALL_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "admin",
] as const;

/** Roles that can review, accept, or reject handovers */
export const PM_REVIEW_ROLES = [
  "PROJECT_MANAGER_SITE",
  "PROGRAM_MANAGER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "admin",
] as const;

/** Admin roles with full access */
export const ADMIN_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "admin",
] as const;

/** Engineering request types that engineers should see */
export const ENGINEERING_REQUEST_TYPES = [
  "Feasibility Study",
  "Design Review",
  "IFC Planning",
  "Grid Application",
  "Battery Assessment",
  "Site Assessment",
  "Full EPC",
] as const;

// ---- Helper functions ----

export function isPdRole(role: string): boolean {
  return (PD_ROLES as readonly string[]).includes(role);
}

export function canCreatePdTicket(role: string): boolean {
  return (PD_CREATE_ROLES as readonly string[]).includes(role);
}

export function canViewAllTickets(role: string): boolean {
  return (PD_VIEW_ALL_ROLES as readonly string[]).includes(role);
}

export function canReviewHandover(role: string): boolean {
  return (PM_REVIEW_ROLES as readonly string[]).includes(role);
}

export function isAdmin(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export function isEngineeringRequestType(type: string): boolean {
  return (ENGINEERING_REQUEST_TYPES as readonly string[]).includes(type);
}
