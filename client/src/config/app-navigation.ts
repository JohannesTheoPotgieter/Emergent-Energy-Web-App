/**
 * Master Navigation Structure
 *
 * 10-section model reflecting the real business system:
 *   Home | Portfolio | Project Development | Project Delivery | Engineering | Quality | HSE | Finance | Reports | Admin
 *
 * Role-based visibility determines which sections each role sees.
 * "Gates" is not a top-level section — it lives inside Portfolio and functional areas.
 * Labels are consistent across the company.
 */

export type SecondaryItem = { label: string; path: string; disabled?: boolean };
export type TopSection = {
  label: string;
  key: string; // stable key for role-visibility matching
  path: string;
  match: (pathname: string) => boolean;
  secondary: SecondaryItem[];
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
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox"]),
    secondary: [
      { label: "My Dashboard", path: "/" },
      { label: "My Tasks", path: "/my-work/tasks" },
      { label: "Approvals", path: "/my-work/approvals" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Inbox", path: "/inbox" },
    ],
  },
  {
    label: "Company",
    key: "PORTFOLIO",
    path: "/lifecycle-board",
    match: (pathname) => startsWithAny(pathname, [
      "/company-overview",
      "/lifecycle-board",
      "/gates", "/exceptions",
      "/project-lifecycle",
    ]) && !matchesPathPrefix(pathname, "/gates/commitments"),
    secondary: [
      { label: "Company Overview", path: "/company-overview" },
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
    ]),
    secondary: [
      { label: "PD Dashboard", path: "/pd" },
      { label: "Pipeline / Opportunities", path: "/opportunities" },
      { label: "PD Tickets", path: "/pd/tickets" },
      { label: "Clients", path: "/clients" },
      { label: "Handover Queue", path: "/handover-control" },
      { label: "PD Reports", path: "/pd/reports" },
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
      "/standups", "/handover",
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
      { label: "Weekly Reviews", path: "/weekly-reviews" },
      { label: "Standups", path: "/standups" },
      { label: "PM Deliverables", path: "/pm/deliverables" },
      { label: "PM Approvals", path: "/pm/approvals" },
      { label: "PM On-The-Go", path: "/pm/on-the-go" },
      { label: "Handover & Closeout", path: "/handover" },
      { label: "Financial Reviews", path: "/governance/financial-reviews" },
      { label: "Sites", path: "/sites" },
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
    label: "Quality",
    key: "QUALITY",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality", "/commissioning-dashboard"]),
    secondary: [
      { label: "Quality Dashboard", path: "/quality" },
      { label: "Commissioning", path: "/commissioning-dashboard" },
      { label: "Inspections / NCRs", path: "/quality/ncrs" },
    ],
  },
  {
    label: "Finance",
    key: "FINANCE",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, [
      "/cashflow", "/cos", "/revenue-tracker", "/gp-tracker",
      "/invoice-patterns", "/counterparties", "/subcontractor-dashboard",
      "/fye-revenue-tracking",
    ]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "COS", path: "/cos" },
      { label: "GP / Margin", path: "/gp-tracker" },
      { label: "FYE Revenue", path: "/fye-revenue-tracking" },
      { label: "Counterparties", path: "/counterparties" },
      { label: "Subcontractors", path: "/subcontractor-dashboard" },
      { label: "Invoice Patterns", path: "/invoice-patterns" },
    ],
  },
  {
    label: "Reports",
    key: "REPORTS",
    path: "/reports/center",
    match: (pathname) => startsWithAny(pathname, ["/reports"]),
    secondary: [
      { label: "Report Center", path: "/reports/center" },
      { label: "Programme Reports", path: "/reports/programme" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "Performance", path: "/reports/performance" },
    ],
  },
  {
    label: "Priorities",
    key: "EXCO",
    path: "/priorities",
    match: (pathname) => startsWithAny(pathname, ["/priorities"]),
    secondary: [
      { label: "All Priorities", path: "/priorities" },
    ],
  },
  {
    label: "Admin",
    key: "ADMIN",
    path: "/admin/control-center",
    match: (pathname) => startsWithAny(pathname, [
      "/admin", "/settings", "/ee-info", "/feedback", "/training",
      "/leaderboard", "/department-scores",
    ]),
    secondary: [
      { label: "Control Center", path: "/admin/control-center" },
      { label: "Users & Roles", path: "/admin/roles" },
      { label: "Smart Import", path: "/admin/smart-import" },
      { label: "Audit Log", path: "/admin/activity-log" },
      { label: "Processes & SOPs", path: "/ee-info" },
      { label: "Templates", path: "/admin/phase-templates" },
      { label: "Recovery", path: "/admin/recovery" },
    ],
  },
];

/**
 * Role-based section visibility.
 * Keys match TopSection.key values.
 * Each role sees only the sections listed here.
 */
export const ROLE_VISIBLE_SECTIONS: Record<string, string[]> = {
  COO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE", "FINANCE", "REPORTS", "EXCO", "ADMIN"],
  CEO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "FINANCE", "REPORTS", "EXCO", "ADMIN"],
  CCO:                    ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "REPORTS", "EXCO"],
  KEY_ACCOUNTS_MANAGER:   ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE"],
  PROGRAM_MANAGER:        ["HOME", "PORTFOLIO", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS", "EXCO"],
  PROJECT_MANAGER_SITE:   ["HOME", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS"],
  CONSTRUCTION_MANAGER:   ["HOME", "PROJECT_DELIVERY", "FINANCE", "QUALITY", "HSE", "REPORTS"],
  ENGINEER:               ["HOME", "ENGINEERING", "QUALITY"],
  ENGINEERING_MANAGER:    ["HOME", "ENGINEERING", "QUALITY", "PROJECT_DELIVERY", "REPORTS"],
  QUALITY_MANAGER:        ["HOME", "QUALITY", "PROJECT_DELIVERY", "REPORTS"],
  HSE_MANAGER:            ["HOME", "HSE", "PROJECT_DELIVERY", "REPORTS"],
  SSEG_MANAGER:           ["HOME", "PROJECT_DELIVERY", "HSE", "QUALITY", "ENGINEERING"],
  CFO:                    ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS", "EXCO"],
  PROGRAM_FINANCE_MANAGER:["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS"],
  ACCOUNTANT:             ["HOME", "FINANCE"],
  PROJECT_DEVELOPER:      ["HOME", "PROJECT_DEVELOPMENT", "FINANCE"],
};

/**
 * Maps canonical module names (from lens profiles) to TopSection.key values.
 * Used to translate lens profile `allowedModules` into nav section visibility.
 */
const CANONICAL_MODULE_TO_SECTION_KEYS: Record<string, string[]> = {
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
  ADMIN:       ["ADMIN"],
};

/**
 * Converts a lens profile's allowedModules into TopSection key values.
 */
export function getAllowedSectionKeysForLens(allowedModules: string[]): string[] {
  const keys = new Set<string>();
  for (const mod of allowedModules) {
    const mapped = CANONICAL_MODULE_TO_SECTION_KEYS[mod];
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
}) {
  const { canViewPath, companyRole, allowedSectionKeys, disabledSubPages } = options;

  const allowedKeys = allowedSectionKeys
    ?? (companyRole ? ROLE_VISIBLE_SECTIONS[companyRole] : null);

  return TOP_SECTIONS
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
    { label: "Company Priorities" },
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

  // --- Quality NCR detail ---
  const ncrMatch = pathname.match(/^\/quality\/ncr\/([^/]+)$/);
  if (ncrMatch) return [
    { label: "Quality", path: "/quality" },
    { label: "Inspections / NCRs", path: "/quality/ncrs" },
    { label: `NCR ${decodeURIComponent(ncrMatch[1])}` },
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
