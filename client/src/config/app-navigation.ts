/**
 * Master Navigation Structure
 *
 * 10-section top-nav model reflecting the real business system:
 *   Home | Company | Project Development | Project Delivery | Finance | Engineering | HSE | Quality | Reports | Admin
 *
 * Role-based visibility determines which sections each role sees.
 * "Gates" is not a top-level section — it lives inside Portfolio and functional areas.
 * Labels are consistent across the company.
 *
 * Note: the section key "PORTFOLIO" is the stable identifier used in DB-stored
 * permissions and the permission matrix; the user-facing label is "Company".
 * Do not rename the key without a coordinated migration.
 */

import type { CompanyRole } from "@shared/schema/users";

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

export const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    key: "HOME",
    path: "/",
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox", "/priorities"]),
    // Prompt 0.7: "Approvals" removed — duplicate of Project Delivery →
    // PM Approvals which points at the canonical /pm/approvals page.
    // /my-work/approvals remains as a redirect alias for bookmarks.
    secondary: [
      { label: "My Dashboard", path: "/" },
      { label: "My Tasks", path: "/my-work/tasks" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Priorities", path: "/priorities", requiredSectionKey: "PRIORITIES" },
    ],
  },
  {
    label: "Company",
    key: "PORTFOLIO",
    path: "/lifecycle-board",
    match: (pathname) => startsWithAny(pathname, [
      "/company-overview",
      "/company/team",
      "/lifecycle-board",
      "/gates", "/exceptions",
      "/project-lifecycle",
    ]) && !matchesPathPrefix(pathname, "/gates/commitments"),
    secondary: [
      { label: "Company Overview", path: "/company-overview" },
      { label: "Team", path: "/company/team" },
      { label: "Lifecycle Board", path: "/lifecycle-board" },
      { label: "Gate Tracker", path: "/gates" },
      { label: "Blocked Gates", path: "/gates/blocked" },
      { label: "Exceptions", path: "/gates/exceptions" },
    ],
  },
  {
    label: "Project Development",
    key: "PROJECT_DEVELOPMENT",
    path: "/pd",
    match: (pathname) => startsWithAny(pathname, [
      "/pd", "/opportunities", "/clients",
      "/handover-control",
      "/engineering-board", "/engineering-dashboard",
    ]),
    secondary: [
      { label: "Project Development Dashboard", path: "/pd" },
      { label: "Pipeline / Opportunities", path: "/opportunities" },
      { label: "Clients", path: "/clients" },
      { label: "Handover Queue", path: "/handover-control" },
    ],
  },
  {
    label: "Project Delivery",
    key: "PROJECT_DELIVERY",
    path: "/execution-board",
    match: (pathname) => startsWithAny(pathname, [
      "/execution-board",
      "/portfolios",
      "/projects", "/project", "/project-create",
      "/procurement",
      "/handover",
      "/sseg-submissions",
      "/pm", "/sites",
      "/governance/financial-reviews",
      "/po-approval-board", "/payment-request-board", "/payment-batch-manager",
      "/gates/commitments",
      "/milestone-tracker",
      "/weekly-reviews",
      "/pm-dashboard",
    ]),
    secondary: [
      { label: "Execution Dashboard", path: "/execution-board" },
      { label: "PM Dashboard", path: "/pm-dashboard" },
      { label: "Portfolio Dashboard", path: "/portfolios" },
      { label: "All Projects", path: "/projects" },
      { label: "PO Approvals", path: "/po-approval-board" },
      { label: "Payment Requests", path: "/payment-request-board" },
      { label: "Payment Batches", path: "/payment-batch-manager" },
      { label: "Milestone Tracker", path: "/milestone-tracker" },
      { label: "Standups", path: "/standups" },
      { label: "PM Approvals", path: "/pm/approvals" },
      { label: "PM On-The-Go", path: "/pm/on-the-go" },
      { label: "Handover & Closeout", path: "/handover" },
      { label: "SSEG Submissions", path: "/sseg-submissions" },
      { label: "Financial Reviews", path: "/governance/financial-reviews" },
      { label: "Sites", path: "/sites" },
    ],
  },
  {
    label: "Finance",
    key: "FINANCE",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, [
      "/cashflow", "/cos", "/revenue-tracker", "/finance",
    ]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cashflow Analysis", path: "/cashflow/analysis" },
      { label: "COS", path: "/cos" },
      { label: "COS Analysis", path: "/cos/analysis" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "QB Throughput", path: "/finance/quickbooks" },
    ],
  },
  {
    label: "Engineering",
    key: "ENGINEERING",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Task Board", path: "/engineering/tasks" },
      { label: "Standup", path: "/engineering/standup" },
    ],
  },
  {
    label: "HSE",
    key: "HSE",
    path: "/hse",
    match: (pathname) => startsWithAny(pathname, ["/hse"]),
    secondary: [
      { label: "HSE Dashboard", path: "/hse" },
    ],
  },
  {
    label: "Quality",
    key: "QUALITY",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality", "/commissioning-dashboard"]),
    secondary: [
      { label: "Quality Dashboard", path: "/quality" },
      { label: "Commissioning", path: "/commissioning-dashboard" },
    ],
  },
  {
    label: "Reports",
    key: "REPORTS",
    path: "/reports/center",
    match: (pathname) => startsWithAny(pathname, ["/reports", "/ceo", "/coo"]),
    secondary: [
      { label: "Report Center", path: "/reports/center" },
      { label: "Programme Reports", path: "/reports/programme" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "CEO Report View", path: "/ceo", requiredRoles: ["CEO_ADMIN"] },
      { label: "COO Report View", path: "/coo", requiredRoles: ["COO_ADMIN"] },
    ],
  },
  {
    label: "Admin",
    key: "ADMIN",
    path: "/settings",
    match: (pathname) => startsWithAny(pathname, [
      "/admin", "/settings", "/ee-info", "/feedback", "/training",
      "/leaderboard", "/department-scores",
    ]),
    secondary: [
      { label: "Settings", path: "/settings" },
      { label: "Roles & Permissions", path: "/admin/roles" },
            { label: "Smart Import", path: "/admin/smart-import" },
      { label: "Audit Log", path: "/admin/activity-log" },
      { label: "Processes & SOPs", path: "/ee-info" },
      { label: "Templates", path: "/admin/phase-templates" },
      { label: "Recovery", path: "/admin/recovery" },
    ],
  },
];

export type DisplayTopNavItem = {
  label: "Home" | "Projects" | "Gates" | "Finance" | "Departments" | "Reports" | "Admin";
  path: string;
  requiredSectionKey?: SectionKey;
  requiredAnySectionKeys?: SectionKey[];
  requiredPathPermissions?: string[];
  sectionKeys: SectionKey[];
};

export const DISPLAY_TOP_NAV: DisplayTopNavItem[] = [
  { label: "Home", path: "/", requiredSectionKey: "HOME", sectionKeys: ["HOME"] },
  {
    label: "Projects",
    path: "/lifecycle-board",
    requiredAnySectionKeys: ["PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY"],
    sectionKeys: ["PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY"],
  },
  {
    label: "Gates",
    path: "/gates",
    requiredAnySectionKeys: ["PORTFOLIO", "PROJECT_DELIVERY", "QUALITY", "HSE"],
    requiredPathPermissions: ["/gates"],
    sectionKeys: ["PORTFOLIO", "PROJECT_DELIVERY", "QUALITY", "HSE"],
  },
  { label: "Finance", path: "/cashflow", requiredSectionKey: "FINANCE", sectionKeys: ["FINANCE"] },
  {
    label: "Departments",
    path: "/engineering",
    requiredAnySectionKeys: ["ENGINEERING", "QUALITY", "HSE"],
    sectionKeys: ["ENGINEERING", "QUALITY", "HSE"],
  },
  { label: "Reports", path: "/reports/center", requiredSectionKey: "REPORTS", sectionKeys: ["REPORTS"] },
  { label: "Admin", path: "/settings", requiredSectionKey: "ADMIN", sectionKeys: ["ADMIN"] },
];

/**
 * Role-based section visibility.
 * Keys match TopSection.key values.
 * Each role sees only the sections listed here.
 *
 * Typed as `Record<CompanyRole, SectionKey[]>` so that adding a new role to
 * COMPANY_ROLES (shared/schema/users.ts) or typoing a section key is a TS error.
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
        return null;
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
      { label: "Project Delivery", path: "/projects" },
      { label: name, path: `/project/${projectFinancialMatch[1]}` },
      { label: "Financial Linking" },
    ];
  }
  const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
  if (projectMatch) return [
    { label: "Project Delivery", path: "/projects" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  // --- Portfolio detail ---
  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)$/);
  if (portfolioMatch) return [
    { label: "Company", path: "/lifecycle-board" },
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
    { label: "Company", path: "/lifecycle-board" },
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
