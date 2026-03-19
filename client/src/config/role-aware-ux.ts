import type { PageRegistryEntry } from "@/config/page-registry";

export type RoleAwareSection =
  | "MY_WORK"
  | "PROJECT_MANAGEMENT"
  | "ENGINEERING"
  | "QUALITY"
  | "FINANCE"
  | "PROJECT_DEVELOPMENT"
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
};

const ROLE_SECTION_PRIORITIES: Record<string, RoleAwareSection[]> = {
  LEADERSHIP: ["MY_WORK", "PROJECT_MANAGEMENT", "FINANCE", "ENGINEERING", "QUALITY", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
  SITE_MANAGEMENT: ["MY_WORK", "PROJECT_MANAGEMENT", "ENGINEERING", "QUALITY", "FINANCE", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
  ENGINEERING: ["MY_WORK", "ENGINEERING", "PROJECT_MANAGEMENT", "QUALITY", "FINANCE", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
  QUALITY: ["MY_WORK", "QUALITY", "PROJECT_MANAGEMENT", "ENGINEERING", "FINANCE", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
  FINANCE: ["MY_WORK", "FINANCE", "PROJECT_MANAGEMENT", "QUALITY", "ENGINEERING", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
  PROJECT_DEVELOPMENT: ["MY_WORK", "PROJECT_DEVELOPMENT", "PROJECT_MANAGEMENT", "ENGINEERING", "QUALITY", "FINANCE", "FEEDBACK", "SYSTEM"],
  DEFAULT: ["MY_WORK", "PROJECT_MANAGEMENT", "ENGINEERING", "QUALITY", "FINANCE", "PROJECT_DEVELOPMENT", "FEEDBACK", "SYSTEM"],
};

const ROLE_LANDING_CANDIDATES: Record<string, string[]> = {
  LEADERSHIP: ["executionBoard", "projects", "myWork", "commandCenter"],
  SITE_MANAGEMENT: ["executionBoard", "projects", "pmOnTheGo", "myWorkTasks", "myWork"],
  ENGINEERING: ["engineering", "engineeringTasks", "myWorkTasks", "myWork"],
  QUALITY: ["quality", "myWorkApprovals", "myWorkTasks", "myWork"],
  FINANCE: ["cashflow", "cos", "revenueTracker", "gpTracker", "myWork"],
  PROJECT_DEVELOPMENT: ["pdDashboard", "pdTickets", "clients", "myWork"],
  DEFAULT: ["myWork", "executionBoard", "projects"],
};

const MICROSOFT_PRIORITY_BY_ROLE: Record<string, string[]> = {
  LEADERSHIP: ["myWorkEmail", "myWorkTeams", "myWorkMeetings"],
  SITE_MANAGEMENT: ["myWorkTeams", "myWorkMeetings", "myWorkEmail"],
  ENGINEERING: ["myWorkTeams", "myWorkMeetings", "myWorkEmail"],
  QUALITY: ["myWorkMeetings", "myWorkTeams", "myWorkEmail"],
  FINANCE: ["myWorkEmail", "myWorkMeetings", "myWorkTeams"],
  PROJECT_DEVELOPMENT: ["myWorkTeams", "myWorkEmail", "myWorkMeetings"],
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
