/**
 * Master Navigation Structure — 9-Department Model
 *
 *   Home | Priorities | Project Development | Project Management | Engineering | Quality | Finance | Parties | Admin
 *
 *   - HSE folded into Project Management
 *   - Portfolio/Company folded into Project Management
 *   - Reports distributed into each department
 *   - Parties added as new top-level department
 *
 * Role-based visibility determines which sections each role sees.
 * Labels are consistent across the company.
 */

import { DEPARTMENT_SECTIONS, DEPARTMENT_ROLE_VISIBLE_SECTIONS, DEPARTMENT_MODULE_TO_SECTION_KEYS } from "./department-nav";

export type SecondaryItem = { label: string; path: string; disabled?: boolean };
export type TopSection = {
  label: string;
  key: string; // stable key for role-visibility matching
  path: string;
  match: (pathname: string) => boolean;
  secondary: SecondaryItem[];
};

export const TOP_SECTIONS: TopSection[] = DEPARTMENT_SECTIONS;
export const ROLE_VISIBLE_SECTIONS: Record<string, string[]> = DEPARTMENT_ROLE_VISIBLE_SECTIONS;

/**
 * Maps canonical module names (from lens profiles) to TopSection.key values.
 */
const CANONICAL_MODULE_TO_SECTION_KEYS: Record<string, string[]> = DEPARTMENT_MODULE_TO_SECTION_KEYS;

/**
 * Converts a lens profile's allowedModules into TopSection key values.
 */
export function getAllowedSectionKeysForLens(allowedModules: string[], moduleToSectionKeys?: Record<string, string[]>): string[] {
  const mapping = moduleToSectionKeys ?? CANONICAL_MODULE_TO_SECTION_KEYS;
  const keys = new Set<string>();
  for (const mod of allowedModules) {
    const mapped = mapping[mod];
    if (mapped) {
      for (const k of mapped) keys.add(k);
    }
  }
  return Array.from(keys);
}

export function parseDisabledSubPages(sections: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of sections) {
    if (entry.startsWith("!")) {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 1) {
        const sectionKey = entry.substring(1, colonIdx);
        const path = entry.substring(colonIdx + 1);
        if (!map.has(sectionKey)) map.set(sectionKey, new Set());
        map.get(sectionKey)!.add(path);
      }
    }
  }
  return map;
}

export function buildVisibleTopSections(options: {
  canViewPath: (path: string) => boolean;
  companyRole?: string | null;
  allowedSectionKeys?: string[] | null;
  disabledSubPages?: Map<string, Set<string>> | null;
  sections?: TopSection[];
  roleVisibleSections?: Record<string, string[]>;
}) {
  const { canViewPath, companyRole, allowedSectionKeys, disabledSubPages } = options;
  const activeSections = options.sections ?? TOP_SECTIONS;
  const activeRoleVisibility = options.roleVisibleSections ?? ROLE_VISIBLE_SECTIONS;

  const allowedKeys = allowedSectionKeys
    ?? (companyRole ? activeRoleVisibility[companyRole] : null);

  return activeSections
    .map((section) => {
      if (allowedKeys && !allowedKeys.includes(section.key)) {
        return null;
      }

      const sectionDisabled = disabledSubPages?.get(section.key);
      const secondary = section.secondary.filter((item) => {
        if (sectionDisabled && sectionDisabled.has(item.path)) return false;
        return item.path === "/" || canViewPath(item.path);
      });
      const firstVisiblePath = secondary[0]?.path || section.path;

      if (section.key === "HOME") {
        return { ...section, path: firstVisiblePath, secondary };
      }

      const sectionRootDisabled = sectionDisabled && sectionDisabled.has(section.path);
      const canSeeSectionRoot = !sectionRootDisabled && canViewPath(section.path);
      if (!canSeeSectionRoot && secondary.length === 0) {
        return null;
      }

      return {
        ...section,
        path: canSeeSectionRoot ? section.path : firstVisiblePath,
        secondary,
      };
    })
    .filter(Boolean) as TopSection[];
}

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function linkIsActive(current: string, target: string) {
  if (target === "/") return current === "/";
  const targetBase = target.split("?")[0];
  const targetQuery = target.includes("?") ? target.split("?")[1] : null;

  if (current === targetBase || current.startsWith(`${targetBase}/`)) {
    if (targetQuery) {
      const params = new URLSearchParams(window.location.search);
      const targetParams = new URLSearchParams(targetQuery);
      for (const [key, val] of targetParams.entries()) {
        if (params.get(key) !== val) return false;
      }
      return true;
    }
    if (target === "/my-work" && current === "/my-work/tasks") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("source") === "approvals") return false;
    }
    return true;
  }
  if (target === "/my-work/approvals" && current === "/my-work/tasks") {
    const params = new URLSearchParams(window.location.search);
    return params.get("source") === "approvals";
  }
  return false;
}

export type BreadcrumbItem = { label: string; path?: string };

export function getBreadcrumbs(pathname: string, activeSection: TopSection): BreadcrumbItem[] {
  if (pathname === "/") return [];

  // --- Priorities ---
  if (pathname === "/priorities") return [
    { label: "Priorities" },
  ];
  const priorityDetailMatch = pathname.match(/^\/priorities\/(\d+)/);
  if (priorityDetailMatch) return [
    { label: "Priorities", path: "/priorities" },
    { label: `Priority #${priorityDetailMatch[1]}` },
  ];

  // --- Project detail & sub-pages ---
  const projectFinancialMatch = pathname.match(/^\/project\/([^/]+)\/financial-linking$/);
  if (projectFinancialMatch) {
    const name = decodeURIComponent(projectFinancialMatch[1]);
    return [
      { label: "Project Management", path: "/projects" },
      { label: name, path: `/project/${projectFinancialMatch[1]}` },
      { label: "Financial Linking" },
    ];
  }
  const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
  if (projectMatch) return [
    { label: "Project Management", path: "/projects" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  // --- Portfolio detail ---
  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)$/);
  if (portfolioMatch) return [
    { label: "Project Management", path: "/execution-board" },
    { label: decodeURIComponent(portfolioMatch[1]) },
  ];

  // --- PD Tickets ---
  if (pathname === "/pd/tickets/create") return [
    { label: "Project Development", path: "/pd" },
    { label: "PD Tickets", path: "/pd/tickets" },
    { label: "Create" },
  ];
  const ticketMatch = pathname.match(/^\/pd\/tickets\/([^/]+)/);
  if (ticketMatch) return [
    { label: "Project Development", path: "/pd" },
    { label: "PD Tickets", path: "/pd/tickets" },
    { label: `Ticket ${decodeURIComponent(ticketMatch[1])}` },
  ];

  // --- PD Handover ---
  const pdHandoverMatch = pathname.match(/^\/pd\/handover\/([^/]+)$/);
  if (pdHandoverMatch) return [
    { label: "Project Development", path: "/pd" },
    { label: "Handover Queue", path: "/handover-control" },
    { label: decodeURIComponent(pdHandoverMatch[1]) },
  ];

  // --- Client detail & sub-pages ---
  const clientProjectMatch = pathname.match(/^\/clients\/([^/]+)\/project\/([^/]+)$/);
  if (clientProjectMatch) return [
    { label: "Project Development", path: "/pd" },
    { label: "Clients", path: "/clients" },
    { label: decodeURIComponent(clientProjectMatch[1]), path: `/clients/${clientProjectMatch[1]}` },
    { label: "Project Departments" },
  ];
  const clientMatch = pathname.match(/^\/clients\/([^/]+)$/);
  if (clientMatch) return [
    { label: "Project Development", path: "/pd" },
    { label: "Clients", path: "/clients" },
    { label: decodeURIComponent(clientMatch[1]) },
  ];

  // --- PM On-The-Go project ---
  const pmOtgMatch = pathname.match(/^\/pm\/on-the-go\/project\/([^/]+)$/);
  if (pmOtgMatch) return [
    { label: "Project Management", path: "/execution-board" },
    { label: "Mobile View", path: "/pm/on-the-go" },
    { label: decodeURIComponent(pmOtgMatch[1]) },
  ];

  // --- Report sub-pages ---
  if (pathname === "/reports/pm/monthly/history") return [
    { label: "Project Management", path: "/execution-board" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: "History" },
  ];
  if (pathname === "/reports/pm/monthly/compare") return [
    { label: "Project Management", path: "/execution-board" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: "Compare" },
  ];
  if (pathname === "/reports/engineering/monthly/history") return [
    { label: "Engineering", path: "/engineering" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: "History" },
  ];
  if (pathname === "/reports/engineering/monthly/compare") return [
    { label: "Engineering", path: "/engineering" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: "Compare" },
  ];
  const pmReportProjectMatch = pathname.match(/^\/reports\/pm\/monthly\/([^/]+)\/project\/([^/]+)$/);
  if (pmReportProjectMatch) return [
    { label: "Project Management", path: "/execution-board" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: decodeURIComponent(pmReportProjectMatch[2]) },
  ];
  const engReportProjectMatch = pathname.match(/^\/reports\/engineering\/monthly\/([^/]+)\/project\/([^/]+)$/);
  if (engReportProjectMatch) return [
    { label: "Engineering", path: "/engineering" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: decodeURIComponent(engReportProjectMatch[2]) },
  ];

  // --- Gates workspace ---
  if (pathname.startsWith("/gates")) return [
    { label: "Project Management", path: "/execution-board" },
    { label: "Gate Tracker", path: "/gates" },
    ...(pathname !== "/gates" ? [{
      label: activeSection.secondary.filter((item) => linkIsActive(pathname, item.path)).sort((a, b) => b.path.length - a.path.length)[0]?.label || pathname.split("/").pop() || "",
    }] : []),
  ];

  // --- Generic fallback ---
  const leaf = activeSection.secondary
    .filter((item) => linkIsActive(pathname, item.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const items: BreadcrumbItem[] = [{ label: activeSection.label, path: activeSection.path }];
  if (leaf && leaf.label !== activeSection.label) {
    if (pathname !== leaf.path) {
      items.push({ label: leaf.label, path: leaf.path });
      const segment = pathname.split("/").pop() || "";
      items.push({ label: decodeURIComponent(segment) });
    } else {
      items.push({ label: leaf.label });
    }
  } else if (!leaf && pathname !== activeSection.path) {
    const segment = pathname.split("/").pop() || "";
    if (segment) items.push({ label: decodeURIComponent(segment) });
  }
  return items;
}
