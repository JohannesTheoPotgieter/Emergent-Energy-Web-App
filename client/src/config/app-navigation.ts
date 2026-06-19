/**
 * Master Navigation Structure
 *
 * 10-section top-nav model reflecting the real business system:
 *   Home | Company | Project Development | Project Delivery | Finance | Engineering | HSE | Quality | Reports | Admin
 *
 * Role-based visibility determines which sections each role sees.
 * "Gates" is a top-level display nav item.
 * Labels are consistent across the company.
 *
 * Note: the section key "PORTFOLIO" is the stable identifier used in DB-stored
 * permissions and the permission matrix; the user-facing label is "Company".
 * Do not rename the key without a coordinated migration.
 */

import type { CompanyRole } from "@shared/schema/users";
import { isNavGroupEnabled } from "@shared/config/enabled-modules";

export const SECTION_KEYS = [
  "HOME",
  "PORTFOLIO",
  "PRIORITIES",
  "PROJECT_DEVELOPMENT",
  "PROJECT_DELIVERY",
  "FINANCE",
  "ENGINEERING",
  "HSE",
  "QUALITY",
  "REPORTS",
  "ADMIN",
] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export type SecondaryItem = {
  label: string;
  path: string;
  disabled?: boolean;
  requiredSectionKey?: SectionKey;
  requiredAnySectionKeys?: SectionKey[];
  requiredPathPermissions?: string[];
  requiredRoles?: CompanyRole[];
};
export type SecondaryGroup = {
  label: string;
  items: SecondaryItem[];
};
export type TopSection = {
  label: string;
  key: SectionKey;
  path: string;
  match: (pathname: string) => boolean;
  secondary: SecondaryItem[];
  secondaryGroups?: SecondaryGroup[];
  requiredSectionKey?: SectionKey;
  requiredAnySectionKeys?: SectionKey[];
  requiredPathPermissions?: string[];
};

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}

/**
 * Locked, canonical top-nav per COO spec (2026-05-11):
 *   Home · Project Delivery · Finance · Engineering · Quality Management · Settings
 *
 * Anything not in this list (Gates, Portfolio, Project Development, HSE,
 * Reports, Knowledge, all of the legacy Admin sub-grid) is hidden from the
 * sidebar by default and surfaced only via Settings → Functionality Control.
 */
export const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    key: "HOME",
    path: "/",
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox", "/priorities"]),
    secondary: [
      { label: "My Dashboard", path: "/" },
      // Phase 7B: "My Tasks" removed from secondary nav — surface unified
      // under Priorities → "My" tab (work_items + personal priorities in
      // one feed). The /my-work/tasks page stays routable for bookmarks +
      // the transition banner pointing back to /priorities?tab=my.
      { label: "Priorities", path: "/priorities" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Inbox", path: "/inbox" },
    ],
  },
  {
    // Section key stays PROJECT_DELIVERY (role visibility + lens mapping carry
    // over); the user-facing tab is now "Execution" — the program-wide control
    // tower that replaced the legacy /execution-board dashboard.
    label: "Execution",
    key: "PROJECT_DELIVERY",
    path: "/execution",
    match: (pathname) => startsWithAny(pathname, [
      "/execution", "/projects", "/project", "/milestone-tracker",
    ]),
    secondary: [
      { label: "Board", path: "/execution" },
      { label: "This fortnight", path: "/execution/upcoming" },
      { label: "Deliveries", path: "/execution/deliveries" },
      { label: "Allocations", path: "/execution/allocations" },
      { label: "Milestone Tracker", path: "/milestone-tracker" },
    ],
  },
  {
    label: "Finance",
    key: "FINANCE",
    // Finance landing = Finance Home (/finance), the accountant's dashboard.
    // The section root drives the top-nav "Finance" link AND the "Finance"
    // breadcrumb crumb; both must resolve to /finance, not /cashflow. Roles that
    // cannot view /finance fall back to their first visible finance item in
    // buildVisibleTopSections (e.g. /cashflow), so this is safe.
    path: "/finance",
    match: (pathname) => startsWithAny(pathname, [
      "/cashflow", "/cos", "/revenue-tracker", "/finance", "/fye-revenue-tracking",
      "/payment-request-board", "/po-approval-board", "/payment-batch-manager",
    ]),
    // Every item gates on its own path: buildVisibleTopSections calls
    // canViewPath(item.path), which resolves the path's permission entity via
    // page-registry (e.g. /finance → financials:view, /finance/close →
    // cashflow:view). Do NOT gate finance items with
    // requiredPathPermissions: ["financials:view"] — that field is evaluated
    // as a PATH (canViewPath), and an "entity:action" string is an unknown
    // path → denied for everyone. That mis-gate was hiding Reconciliation.
    // Live-Ready module sidebar — exactly 7 items (2026-06-11). Weekly Close
    // is SCRAPPED (its AR + missing-invoice worklists moved into Cashflow;
    // /finance/close now redirects to /cashflow). Payment Requests + PO
    // Approvals are PARKED (procure-to-pay deferred — see AGENT_GUARDRAILS § 3B
    // S4) and removed from the sidebar.
    secondary: [
      { label: "Finance Home", path: "/finance" },
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cost of Sales", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "Gross Profit", path: "/finance/gp/company" },
      { label: "QB Reconciliation", path: "/finance/qb-reconciliation" },
      { label: "FYE Tracking Report", path: "/fye-revenue-tracking" },
    ],
  },
  {
    label: "Engineering",
    key: "ENGINEERING",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Engineering Task Board", path: "/engineering/tasks" },
      { label: "Engineering Document Management", path: "/engineering/documents" },
      { label: "Standup", path: "/engineering/standup" },
    ],
  },
  {
    label: "Quality Management",
    key: "QUALITY",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality"]),
    secondary: [
      { label: "Quality Dashboard", path: "/quality" },
      { label: "Quality Task Board", path: "/quality/tasks" },
      { label: "Quality Document Management", path: "/quality/documents" },
    ],
  },
  {
    label: "Settings",
    key: "ADMIN",
    path: "/settings",
    match: (pathname) => startsWithAny(pathname, [
      "/admin", "/settings",
    ]),
    secondary: [
      { label: "Roles & Permissions", path: "/admin/roles" },
      { label: "Integration Statuses", path: "/admin/integrations" },
      { label: "Audit Log", path: "/admin/activity-log" },
    ],
  },
];

export type DisplayTopNavItem = {
  label: "Home" | "Execution" | "Finance" | "Engineering" | "Quality Management" | "Settings";
  path: string;
  requiredSectionKey?: SectionKey;
  requiredAnySectionKeys?: SectionKey[];
  requiredPathPermissions?: string[];
  sectionKeys: SectionKey[];
};

/**
 * Canonical six-tab top navigation per COO spec (2026-05-11).
 * Hidden modules (Project Development, Gates, HSE, Reports, Portfolio, Knowledge,
 * legacy Admin grid) are reachable only via Settings → Functionality Control.
 */
export const DISPLAY_TOP_NAV: DisplayTopNavItem[] = [
  { label: "Home", path: "/", requiredSectionKey: "HOME", sectionKeys: ["HOME"] },
  { label: "Execution", path: "/execution", requiredSectionKey: "PROJECT_DELIVERY", sectionKeys: ["PROJECT_DELIVERY"] },
  { label: "Finance", path: "/finance", requiredSectionKey: "FINANCE", sectionKeys: ["FINANCE"] },
  { label: "Engineering", path: "/engineering", requiredSectionKey: "ENGINEERING", sectionKeys: ["ENGINEERING"] },
  { label: "Quality Management", path: "/quality", requiredSectionKey: "QUALITY", sectionKeys: ["QUALITY"] },
  { label: "Settings", path: "/settings", requiredSectionKey: "ADMIN", sectionKeys: ["ADMIN"] },
];

/**
 * Role-based section visibility.
 * Keys match TopSection.key values.
 * Each role sees only the sections listed here.
 *
 * Typed as `Record<CompanyRole, SectionKey[]>` so that adding a new role to
 * COMPANY_ROLES (shared/schema/users.ts) or typoing a section key is a TS error.
 *
 * NOTE on retained section keys (post-2026-05-12 nav cleanup):
 *   Several entries still list section keys that no longer appear in
 *   DISPLAY_TOP_NAV (PORTFOLIO, PROJECT_DEVELOPMENT, HSE, REPORTS). These are
 *   kept on purpose — they represent the role's *data scope*, not its UI tabs.
 *   If a COO re-enables (say) the Reports tab via Functionality Control, roles
 *   listed with REPORTS here will see it automatically with no migration.
 *   Stripping them now would break that forward-compat path.
 */
export const ROLE_VISIBLE_SECTIONS: Record<CompanyRole, SectionKey[]> = {
  COO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE", "FINANCE", "REPORTS", "PRIORITIES", "ADMIN"],
  CEO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "FINANCE", "REPORTS", "PRIORITIES", "ADMIN"],
  CCO:                    ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "REPORTS", "PRIORITIES"],
  KEY_ACCOUNTS_MANAGER:   ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "PRIORITIES"],
  PROGRAM_MANAGER:        ["HOME", "PORTFOLIO", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS", "PRIORITIES"],
  PROJECT_MANAGER_SITE:   ["HOME", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS", "PRIORITIES"],
  CONSTRUCTION_MANAGER:   ["HOME", "PROJECT_DELIVERY", "FINANCE", "QUALITY", "HSE", "REPORTS", "PRIORITIES"],
  ENGINEER:               ["HOME", "ENGINEERING", "QUALITY", "PRIORITIES"],
  ENGINEERING_MANAGER:    ["HOME", "ENGINEERING", "QUALITY", "PROJECT_DELIVERY", "REPORTS", "PRIORITIES"],
  QUALITY_MANAGER:        ["HOME", "QUALITY", "PROJECT_DELIVERY", "REPORTS", "PRIORITIES"],
  HSE_MANAGER:            ["HOME", "HSE", "PROJECT_DELIVERY", "REPORTS", "PRIORITIES"],
  SSEG_MANAGER:           ["HOME", "PROJECT_DELIVERY", "HSE", "QUALITY", "ENGINEERING", "PRIORITIES"],
  CFO:                    ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS", "PRIORITIES"],
  PROGRAM_FINANCE_MANAGER:["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS", "PRIORITIES"],
  ACCOUNTANT:             ["HOME", "FINANCE", "PRIORITIES"],
  PROJECT_DEVELOPER:      ["HOME", "PROJECT_DEVELOPMENT", "FINANCE", "PRIORITIES"],
};

/**
 * Maps canonical module names (from lens profiles) to TopSection.key values.
 * Used to translate lens profile `allowedModules` into nav section visibility.
 */
const CANONICAL_MODULE_TO_SECTION_KEYS: Record<string, SectionKey[]> = {
  HOME:        ["HOME"],
  EXECUTIVE:   ["PORTFOLIO"],
  PORTFOLIO:   ["PORTFOLIO"],
  PIPELINE:    ["PROJECT_DEVELOPMENT"],
  PROJECTS:    ["PROJECT_DELIVERY"],
  DELIVERY:    ["PROJECT_DELIVERY"],
  FINANCE:     ["FINANCE"],
  ENGINEERING: ["ENGINEERING"],
  COMPLIANCE:  ["QUALITY", "HSE"],
  DOCUMENTS:   [],
  REPORTS:     ["REPORTS"],
  PRIORITIES:  ["PRIORITIES"],
  ADMIN:       ["ADMIN"],
};

/**
 * Converts a lens profile's allowedModules into TopSection key values.
 */
export function getAllowedSectionKeysForLens(allowedModules: string[]): SectionKey[] {
  const keys = new Set<SectionKey>();
  for (const mod of allowedModules) {
    const mapped = CANONICAL_MODULE_TO_SECTION_KEYS[mod];
    if (mapped) {
      for (const k of mapped) keys.add(k);
    }
  }
  return Array.from(keys);
}

/**
 * Disabled-subpage string format:
 *   "!<SECTION_KEY>:/<path>"
 *
 * Examples:
 *   "!FINANCE:/cashflow"           — disables Cashflow for the role
 *   "!ADMIN:/admin/smart-import"   — disables Smart Import for the role
 *
 * Plain entries without the "!" prefix are treated as enabled section keys
 * by the caller and ignored by this parser.
 */
const DISABLED_SUBPAGE_PATTERN = /^!([A-Z_]+):(\/.*)$/;

export type DisabledSubPageIssue = {
  entry: string;
  reason: "malformed" | "unknown_section_key" | "invalid_path";
};

/**
 * Validates disabled-subpage entries without mutating state. Returns an issue
 * list for reporting — empty means every "!"-prefixed entry is well-formed.
 * Non-prefixed entries (plain section keys) are skipped.
 */
export function validateDisabledSubPages(entries: string[]): DisabledSubPageIssue[] {
  const issues: DisabledSubPageIssue[] = [];
  const validKeys = new Set<string>(SECTION_KEYS);
  for (const entry of entries) {
    if (!entry.startsWith("!")) continue;
    const match = DISABLED_SUBPAGE_PATTERN.exec(entry);
    if (!match) {
      issues.push({ entry, reason: "malformed" });
      continue;
    }
    const [, key, path] = match;
    if (!validKeys.has(key)) {
      issues.push({ entry, reason: "unknown_section_key" });
    }
    if (path.length <= 1) {
      issues.push({ entry, reason: "invalid_path" });
    }
  }
  return issues;
}

export function parseDisabledSubPages(sections: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of sections) {
    if (!entry.startsWith("!")) continue;
    const match = DISABLED_SUBPAGE_PATTERN.exec(entry);
    if (!match) continue;
    const [, sectionKey, path] = match;
    if (!map.has(sectionKey)) map.set(sectionKey, new Set());
    map.get(sectionKey)!.add(path);
  }
  return map;
}

export function buildVisibleTopSections(options: {
  canViewPath: (path: string) => boolean;
  companyRole?: string | null;
  allowedSectionKeys?: string[] | null;
  disabledSubPages?: Map<string, Set<string>> | null;
}) {
  const { canViewPath, companyRole, allowedSectionKeys, disabledSubPages } = options;

  const allowedKeys = allowedSectionKeys
    ?? (companyRole ? ROLE_VISIBLE_SECTIONS[companyRole as CompanyRole] ?? null : null);
  const canAccessBySection = (section: { requiredSectionKey?: SectionKey; requiredAnySectionKeys?: SectionKey[] }) => {
    if (!allowedKeys) return true;
    if (section.requiredSectionKey && !allowedKeys.includes(section.requiredSectionKey)) return false;
    if (section.requiredAnySectionKeys && !section.requiredAnySectionKeys.some((key) => allowedKeys.includes(key))) return false;
    return true;
  };
  const canAccessByPathPerms = (item: { requiredPathPermissions?: string[] }) =>
    !item.requiredPathPermissions || item.requiredPathPermissions.every((path) => canViewPath(path));
  const filterSecondaryItem = (item: SecondaryItem, sectionDisabled?: Set<string>) => {
    if (item.requiredRoles && (!companyRole || !item.requiredRoles.includes(companyRole as CompanyRole))) return false;
    if (sectionDisabled && sectionDisabled.has(item.path)) return false;
    if (!canAccessBySection(item)) return false;
    if (!canAccessByPathPerms(item)) return false;
    return item.path === "/" || canViewPath(item.path);
  };

  return TOP_SECTIONS
    .map((section) => {
      if (!canAccessBySection(section)) return null;
      if (!canAccessByPathPerms(section)) return null;
      if (allowedKeys && !allowedKeys.includes(section.key)) {
        const hasAnyAccess = section.requiredAnySectionKeys?.some((key) => allowedKeys.includes(key)) ?? false;
        if (!hasAnyAccess) return null;
      }

      const sectionDisabled = disabledSubPages?.get(section.key);
      const secondary = section.secondary.filter((item) => filterSecondaryItem(item, sectionDisabled));
      const secondaryGroups = section.secondaryGroups
        ?.map((group) => ({ ...group, items: group.items.filter((item) => filterSecondaryItem(item, sectionDisabled)) }))
        .filter((group) => group.items.length > 0);
      const firstVisiblePath = secondary[0]?.path || section.path;

      if (section.key === "HOME") {
        return { ...section, path: firstVisiblePath, secondary, secondaryGroups };
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
        secondaryGroups,
      };
    })
    .filter(Boolean) as TopSection[];
}

/**
 * Module-enablement layer (live-ready) — orthogonal to the role/permission
 * model in buildVisibleTopSections. A top-nav section maps to one or more
 * page-registry nav-groups; the section is shown only when at least one of
 * those nav-groups is enabled in shared/config/enabled-modules.ts.
 *
 * Keeping this separate from buildVisibleTopSections means the role→section
 * capability model is unchanged (a module re-enabled in the registry shows up
 * for exactly the roles that already had it), while the active module set is a
 * single one-line config flip.
 */
const SECTION_TO_NAV_GROUPS: Record<SectionKey, string[]> = {
  HOME: ["MY_WORK"],
  PORTFOLIO: ["PORTFOLIO", "GATES"],
  PRIORITIES: ["PRIORITIES"],
  PROJECT_DEVELOPMENT: ["PROJECT_DEVELOPMENT"],
  PROJECT_DELIVERY: ["PROJECTS", "PROJECT_MANAGEMENT"],
  FINANCE: ["FINANCE"],
  ENGINEERING: ["ENGINEERING"],
  HSE: ["HSE"],
  QUALITY: ["QUALITY"],
  REPORTS: ["REPORTS"],
  ADMIN: ["SYSTEM", "KNOWLEDGE"],
};

/** Is this top-nav section enabled by the active module registry? */
export function isSectionModuleEnabled(sectionKey: SectionKey): boolean {
  const groups = SECTION_TO_NAV_GROUPS[sectionKey] ?? [];
  return groups.some((group) => isNavGroupEnabled(group));
}

/** Drop any top-nav sections whose module is disabled (live-ready gate). */
export function filterSectionsByEnabledModules<T extends { key: SectionKey }>(sections: T[]): T[] {
  return sections.filter((section) => isSectionModuleEnabled(section.key));
}

export function linkIsActive(current: string, target: string) {
  const [currentPath, currentQuery = ""] = current.split("?");
  const [targetBase, targetQuery = ""] = target.split("?");

  if (targetBase === "/") return currentPath === "/";

  const currentParams = new URLSearchParams(currentQuery);
  const targetParams = new URLSearchParams(targetQuery);

  if (currentPath === targetBase || currentPath.startsWith(`${targetBase}/`)) {
    for (const [key, val] of targetParams.entries()) {
      if (currentParams.get(key) !== val) return false;
    }

    if (targetBase === "/my-work" && currentPath === "/my-work/tasks") {
      if (currentParams.get("source") === "approvals") return false;
    }
    return true;
  }

  if (targetBase === "/my-work/approvals" && currentPath === "/my-work/tasks") {
    return currentParams.get("source") === "approvals";
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
      { label: "Execution", path: "/execution" },
      { label: name, path: `/project/${projectFinancialMatch[1]}` },
      { label: "Financial Linking" },
    ];
  }
  const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
  if (projectMatch) return [
    { label: "Execution", path: "/execution" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  // --- Portfolio detail ---
  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)$/);
  if (portfolioMatch) return [
    { label: "Projects", path: "/execution" },
    { label: decodeURIComponent(portfolioMatch[1]) },
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
    { label: "Project Delivery", path: "/execution-board" },
    { label: "Mobile View", path: "/pm/on-the-go" },
    { label: decodeURIComponent(pmOtgMatch[1]) },
  ];

  // --- Report sub-pages ---
  if (pathname === "/reports/pm/monthly/history") return [
    { label: "Reports", path: "/reports/center" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: "History" },
  ];
  if (pathname === "/reports/pm/monthly/compare") return [
    { label: "Reports", path: "/reports/center" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: "Compare" },
  ];
  if (pathname === "/reports/engineering/monthly/history") return [
    { label: "Reports", path: "/reports/center" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: "History" },
  ];
  if (pathname === "/reports/engineering/monthly/compare") return [
    { label: "Reports", path: "/reports/center" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: "Compare" },
  ];
  const pmReportProjectMatch = pathname.match(/^\/reports\/pm\/monthly\/([^/]+)\/project\/([^/]+)$/);
  if (pmReportProjectMatch) return [
    { label: "Reports", path: "/reports/center" },
    { label: "PM Monthly", path: "/reports/pm/monthly" },
    { label: decodeURIComponent(pmReportProjectMatch[2]) },
  ];
  const engReportProjectMatch = pathname.match(/^\/reports\/engineering\/monthly\/([^/]+)\/project\/([^/]+)$/);
  if (engReportProjectMatch) return [
    { label: "Reports", path: "/reports/center" },
    { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
    { label: decodeURIComponent(engReportProjectMatch[2]) },
  ];

  // --- Gates workspace ---
  if (pathname.startsWith("/gates")) return [
    { label: "Projects", path: "/execution-board" },
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
      // Sub-page of a secondary item — make the secondary item a clickable middle crumb
      items.push({ label: leaf.label, path: leaf.path });
      const segment = pathname.split("/").pop() || "";
      items.push({ label: decodeURIComponent(segment) });
    } else {
      items.push({ label: leaf.label });
    }
  } else if (!leaf && pathname !== activeSection.path) {
    // No secondary match — use last path segment as label
    const segment = pathname.split("/").pop() || "";
    if (segment) items.push({ label: decodeURIComponent(segment) });
  }
  return items;
}
