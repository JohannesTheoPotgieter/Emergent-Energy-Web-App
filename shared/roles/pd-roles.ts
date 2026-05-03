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
] as const;

/** Roles that can create PD tickets */
export const PD_CREATE_ROLES = [
  "PROJECT_DEVELOPER",
  "COO_ADMIN",
  "CEO_ADMIN",
] as const;

/** Roles that can see all tickets (not filtered by assignment) — used as fallback when no pdVisibilityConfig exists */
export const PD_VIEW_ALL_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
] as const;

/** Roles that can initiate and edit handovers (PD-side) */
export const HANDOVER_INITIATE_ROLES = [
  "PROJECT_DEVELOPER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
] as const;

/** Roles that can review, accept, or reject handovers */
export const PM_REVIEW_ROLES = [
  "PROJECT_MANAGER_SITE",
  "PROGRAM_MANAGER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
] as const;

/** Roles that can view and act on the Opportunities intake working list */
export const OPPORTUNITY_INTAKE_VIEW_ROLES = [
  "PROJECT_DEVELOPER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
] as const;

/** Admin roles with full access */
export const ADMIN_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
] as const;

/**
 * Engineering request types that engineers should see.
 *
 * The convert-to-project flow lets PDs author free-form `request_type`
 * strings (e.g. "Cost Proposal", "First Assessment", "Site visit Report"),
 * so this list is the union of (a) the legacy template names and
 * (b) the actual values produced by the convert flow as of 2026-04.
 *
 * Code that filters by this list (e.g. server/pd-routes.ts) should
 * fall back to "show everything that isn't terminal" when in doubt —
 * see `getEngineeringTicketCounts` in opportunities-repository for
 * the pattern.
 */
export const ENGINEERING_REQUEST_TYPES = [
  // Legacy template names
  "Feasibility Study",
  "Design Review",
  "IFC Planning",
  "Grid Application",
  "Battery Assessment",
  "Site Assessment",
  "Full EPC",
  // Names produced by the convert-to-project flow
  "First Assessment",
  "Cost Proposal",
  "Site Visit Report",
  "Site visit Report",
  "Sizing Rational Request",
  "CP - PVSOL",
  "First Assessment - PowerPoint Template",
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

export function canInitiateHandover(role: string): boolean {
  return (HANDOVER_INITIATE_ROLES as readonly string[]).includes(role);
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

export function canViewOpportunityIntake(role: string): boolean {
  return (OPPORTUNITY_INTAKE_VIEW_ROLES as readonly string[]).includes(role);
}
