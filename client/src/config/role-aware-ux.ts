import type { PageRegistryEntry } from "@/config/page-registry";
import { resolveUserLens, type LensRole, DEFAULT_LENS_PROFILES } from "@shared/schema/role-based-upgrade";

export type RoleAwareSection =
  | "MY_WORK"
  | "PROJECTS"
  | "PROJECT_DEVELOPMENT"
  | "ENGINEERING"
  | "EXECUTION"
  | "OPERATIONS"
  | "FINANCE"
  | "INSIGHTS"
  | "SYSTEM"
  | "FEEDBACK";

const ROLE_ALIASES: Record<string, string> = {
  CEO_ADMIN: "LEADERSHIP",
  COO_ADMIN: "LEADERSHIP",
  PROGRAM_MANAGER: "LEADERSHIP",
  PROJECT_MANAGER_SITE: "SITE_MANAGEMENT",
  CONSTRUCTION_MANAGER: "SITE_MANAGEMENT",
  ENGINEER: "ENGINEERING",
  ENGINEERING_MANAGER: "ENGINEERING",
  QUALITY_MANAGER: "QUALITY",
  CFO: "FINANCE",
  PROGRAM_FINANCE_MANAGER: "FINANCE",
  ACCOUNTANT: "FINANCE",
  PROJECT_DEVELOPER: "PROJECT_DEVELOPMENT",
  CCO: "PROJECT_DEVELOPMENT",
  KEY_ACCOUNTS_MANAGER: "PROJECT_DEVELOPMENT",
  // New roles — mapped to their own intents
  HSE_MANAGER: "HSE",
  SSEG_MANAGER: "SSEG",
};

const ROLE_SECTION_PRIORITIES: Record<string, RoleAwareSection[]> = {
  LEADERSHIP: ["MY_WORK", "EXECUTION", "FINANCE", "OPERATIONS", "PROJECTS", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  SITE_MANAGEMENT: ["MY_WORK", "EXECUTION", "OPERATIONS", "PROJECTS", "FINANCE", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  ENGINEERING: ["MY_WORK", "OPERATIONS", "EXECUTION", "PROJECTS", "FINANCE", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  QUALITY: ["MY_WORK", "OPERATIONS", "EXECUTION", "PROJECTS", "FINANCE", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  FINANCE: ["MY_WORK", "FINANCE", "EXECUTION", "OPERATIONS", "PROJECTS", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  PROJECT_DEVELOPMENT: ["MY_WORK", "PROJECT_DEVELOPMENT", "PROJECTS", "EXECUTION", "OPERATIONS", "FINANCE", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  HSE: ["MY_WORK", "OPERATIONS", "EXECUTION", "PROJECTS", "FINANCE", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  SSEG: ["MY_WORK", "OPERATIONS", "ENGINEERING", "EXECUTION", "PROJECTS", "FINANCE", "INSIGHTS", "FEEDBACK", "SYSTEM"],
  DEFAULT: ["MY_WORK", "EXECUTION", "OPERATIONS", "PROJECTS", "FINANCE", "PROJECT_DEVELOPMENT", "INSIGHTS", "FEEDBACK", "SYSTEM"],
};

const ROLE_LANDING_CANDIDATES: Record<string, string[]> = {
  LEADERSHIP: ["executionBoard", "projects", "myWork", "commandCenter"],
  SITE_MANAGEMENT: ["executionBoard", "projects", "pmOnTheGo", "myWorkTasks", "myWork"],
  ENGINEERING: ["engineering", "engineeringTasks", "myWorkTasks", "myWork"],
  QUALITY: ["quality", "qualityNcrList", "myWorkApprovals", "myWorkTasks", "myWork"],
  FINANCE: ["cashflow", "cos", "revenueTracker", "gpTracker", "myWork"],
  PROJECT_DEVELOPMENT: ["pdDashboard", "pdTickets", "pdReports", "clients", "myWork"],
  HSE: ["hseDashboard", "quality", "myWorkTasks", "myWork"],
  SSEG: ["hseDashboard", "engineering", "myWorkTasks", "myWork"],
  DEFAULT: ["myWork", "executionBoard", "projects"],
};

const MICROSOFT_PRIORITY_BY_ROLE: Record<string, string[]> = {
  LEADERSHIP: ["myWorkEmail", "myWorkTeams", "myWorkMeetings"],
  SITE_MANAGEMENT: ["myWorkTeams", "myWorkMeetings", "myWorkEmail"],
  ENGINEERING: ["myWorkTeams", "myWorkMeetings", "myWorkEmail"],
  QUALITY: ["myWorkMeetings", "myWorkTeams", "myWorkEmail"],
  FINANCE: ["myWorkEmail", "myWorkMeetings", "myWorkTeams"],
  PROJECT_DEVELOPMENT: ["myWorkTeams", "myWorkEmail", "myWorkMeetings"],
  HSE: ["myWorkMeetings", "myWorkTeams", "myWorkEmail"],
  SSEG: ["myWorkEmail", "myWorkTeams", "myWorkMeetings"],
  DEFAULT: ["myWorkTeams", "myWorkEmail", "myWorkMeetings"],
};

export function getRoleIntent(role?: string | null): string {
  if (!role) return "DEFAULT";
  return ROLE_ALIASES[role] ?? "DEFAULT";
}

export function getRoleSectionPriority(role?: string | null): RoleAwareSection[] {
  const intent = getRoleIntent(role);
  return ROLE_SECTION_PRIORITIES[intent] ?? ROLE_SECTION_PRIORITIES.DEFAULT;
}

export function getRoleLandingCandidates(role?: string | null): string[] {
  const intent = getRoleIntent(role);
  return ROLE_LANDING_CANDIDATES[intent] ?? ROLE_LANDING_CANDIDATES.DEFAULT;
}

export function sortRoleAwareNavItems(items: { id?: string; path: string }[], role?: string | null): { id?: string; path: string }[] {
  const intent = getRoleIntent(role);
  const priority = MICROSOFT_PRIORITY_BY_ROLE[intent] ?? MICROSOFT_PRIORITY_BY_ROLE.DEFAULT;
  const rank = new Map(priority.map((id, index) => [id, index]));

  return [...items].sort((a, b) => {
    const aScore = rank.get(a.id ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bScore = rank.get(b.id ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (aScore !== bScore) return aScore - bScore;
    return a.path.localeCompare(b.path);
  });
}

export function pickRoleAwareLandingPage(
  role: string | null | undefined,
  pagesById: Map<string, PageRegistryEntry>,
  canAccess: (path: string) => boolean,
): PageRegistryEntry | undefined {
  const candidates = getRoleLandingCandidates(role);
  for (const id of candidates) {
    const page = pagesById.get(id);
    if (page && canAccess(page.path)) {
      return page;
    }
  }
  return undefined;
}

/**
 * Lens-aware landing page resolution.
 * Uses the new lens profile system for landing pages.
 * Falls back to the legacy pickRoleAwareLandingPage if no lens profile match.
 */
export function getLensLandingPage(dbRole?: string | null): string {
  const lens = resolveUserLens(dbRole);
  const profile = DEFAULT_LENS_PROFILES.find(p => p.lensRole === lens);
  return profile?.landingPage ?? "/gates";
}
