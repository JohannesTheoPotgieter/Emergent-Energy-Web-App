/**
 * Authoritative map of company role → post-login landing path.
 *
 * Shared by the server (returned in /api/auth/permissions) and verified
 * against the client's PAGE_REGISTRY-derived ROLE_LANDING_PAGE by a parity
 * test. When a role's landing page needs to change, update this file — the
 * parity test will enforce that the corresponding PAGE_REGISTRY entry also
 * carries the matching `roleLandingEligibility` value.
 *
 * A role's landing path must resolve to a renderable route. Validation lives
 * in qa/tests/unit/app-navigation.test.ts.
 */

import type { CompanyRole } from "../schema/users";

export const ROLE_LANDING_PATHS: Record<CompanyRole, string> = {
  COO_ADMIN: "/execution-board",
  CEO_ADMIN: "/execution-board",
  CCO: "/pd",
  CFO: "/cashflow",
  PROGRAM_MANAGER: "/execution-board",
  PROGRAM_FINANCE_MANAGER: "/cashflow",
  CONSTRUCTION_MANAGER: "/execution-board",
  QUALITY_MANAGER: "/quality",
  ENGINEERING_MANAGER: "/engineering",
  KEY_ACCOUNTS_MANAGER: "/pd",
  ACCOUNTANT: "/cashflow",
  ENGINEER: "/engineering",
  PROJECT_MANAGER_SITE: "/execution-board",
  PROJECT_DEVELOPER: "/pd",
  HSE_MANAGER: "/hse",
  SSEG_MANAGER: "/hse",
};

export function getLandingPathForRole(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LANDING_PATHS[role as CompanyRole] ?? null;
}
