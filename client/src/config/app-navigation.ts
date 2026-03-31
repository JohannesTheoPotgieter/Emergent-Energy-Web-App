/**
 * Master Navigation Structure
 *
 * 8-section model reflecting the real business system:
 *   Home | Portfolio | Project Development | Project Delivery | Engineering | Quality & HSE | Finance | Admin
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
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox", "/priorities"]),
    secondary: [
      { label: "My Dashboard", path: "/" },
      { label: "My Tasks", path: "/my-work/tasks" },
      { label: "Approvals", path: "/my-work/approvals" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Company Priorities", path: "/priorities" },
      { label: "Inbox", path: "/inbox" },
      { label: "Settings", path: "/my-work/settings" },
    ],
  },
  {
    label: "Portfolio",
    key: "PORTFOLIO",
    path: "/portfolios",
    match: (pathname) => startsWithAny(pathname, [
      "/portfolios", "/execution-board", "/lifecycle-board",
      "/gates", "/exceptions", "/weekly-reviews",
      "/project-lifecycle",
    ]),
    secondary: [
      { label: "Portfolio Dashboard", path: "/portfolios" },
      { label: "Lifecycle Board", path: "/project-lifecycle" },
      { label: "Execution Board", path: "/execution-board" },
      { label: "Gate Tracker", path: "/gates" },
      { label: "Blocked Gates", path: "/gates/blocked" },
      { label: "Exceptions", path: "/gates/exceptions" },
      { label: "Weekly Reviews", path: "/weekly-reviews" },
      { label: "Reports", path: "/reports/programme" },
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
    path: "/projects",
    match: (pathname) => startsWithAny(pathname, [
      "/projects", "/project", "/project-create",
      "/construction", "/procurement",
      "/tasks", "/standups", "/handover",
      "/pm", "/sites",
      "/governance/financial-reviews",
      "/po-approval-board", "/payment-request-board", "/payment-batch-manager",
    ]),
    secondary: [
      { label: "All Projects", path: "/projects" },
      { label: "Construction", path: "/construction" },
      { label: "Procurement", path: "/procurement" },
      { label: "PO Approvals", path: "/po-approval-board" },
      { label: "Task Management", path: "/tasks" },
      { label: "Milestone Tracker", path: "/gates/commitments" },
      { label: "Handover & Closeout", path: "/handover" },
      { label: "Sites", path: "/sites" },
    ],
  },
  {
    label: "Engineering",
    key: "ENGINEERING",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Design Requests", path: "/engineering/tasks" },
      { label: "Standup", path: "/engineering/standup" },
    ],
  },
  {
    label: "Quality & HSE",
    key: "QUALITY_HSE",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality", "/hse"]),
    secondary: [
      { label: "Quality Dashboard", path: "/quality" },
      { label: "HSE Dashboard", path: "/hse" },
      { label: "Inspections / NCRs", path: "/quality/ncrs" },
      { label: "Compliance / SSEG", path: "/hse" },
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
    label: "Admin",
    key: "ADMIN",
    path: "/admin/control-center",
    match: (pathname) => startsWithAny(pathname, [
      "/admin", "/settings", "/reports", "/ee-info", "/feedback", "/training",
      "/leaderboard", "/department-scores",
    ]),
    secondary: [
      { label: "Control Center", path: "/admin/control-center" },
      { label: "Users & Roles", path: "/admin/roles" },
      { label: "Smart Import", path: "/admin/smart-import" },
      { label: "Audit Log", path: "/admin/activity-log" },
      { label: "Report Center", path: "/reports/center" },
      { label: "PM Reports", path: "/reports/pm/monthly" },
      { label: "Eng Reports", path: "/reports/engineering/monthly" },
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
  COO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY_HSE", "FINANCE", "ADMIN"],
  CEO_ADMIN:              ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "FINANCE", "ADMIN"],
  CCO:                    ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE"],
  KEY_ACCOUNTS_MANAGER:   ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE"],
  PROGRAM_MANAGER:        ["HOME", "PORTFOLIO", "PROJECT_DELIVERY", "QUALITY_HSE", "FINANCE"],
  PROJECT_MANAGER_SITE:   ["HOME", "PROJECT_DELIVERY", "QUALITY_HSE", "FINANCE"],
  CONSTRUCTION_MANAGER:   ["HOME", "PROJECT_DELIVERY", "FINANCE", "QUALITY_HSE"],
  ENGINEER:               ["HOME", "ENGINEERING", "QUALITY_HSE"],
  ENGINEERING_MANAGER:    ["HOME", "ENGINEERING", "QUALITY_HSE", "PROJECT_DELIVERY"],
  QUALITY_MANAGER:        ["HOME", "QUALITY_HSE", "PROJECT_DELIVERY"],
  HSE_MANAGER:            ["HOME", "QUALITY_HSE", "PROJECT_DELIVERY"],
  SSEG_MANAGER:           ["HOME", "QUALITY_HSE", "ENGINEERING"],
  CFO:                    ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY"],
  PROGRAM_FINANCE_MANAGER:["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY"],
  ACCOUNTANT:             ["HOME", "FINANCE"],
  PROJECT_DEVELOPER:      ["HOME", "PROJECT_DEVELOPMENT", "FINANCE"],
};

export function buildVisibleTopSections(options: {
  canViewPath: (path: string) => boolean;
  companyRole?: string | null;
}) {
  const { canViewPath, companyRole } = options;

  // Get role-specific visible section keys
  const allowedKeys = companyRole ? ROLE_VISIBLE_SECTIONS[companyRole] : null;

  return TOP_SECTIONS
    .map((section) => {
      // Role-based section filtering
      if (allowedKeys && !allowedKeys.includes(section.key)) {
        return null;
      }

      const secondary = section.secondary.filter((item) => item.path === "/" || canViewPath(item.path));
      const firstVisiblePath = secondary[0]?.path || section.path;

      if (section.key === "HOME") {
        return { ...section, path: firstVisiblePath, secondary };
      }

      const canSeeSectionRoot = canViewPath(section.path);
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

  const priorityDetailMatch = pathname.match(/^\/priorities\/(\d+)/);
  if (priorityDetailMatch) return [
    { label: "Home", path: "/" },
    { label: "Priorities", path: "/priorities" },
    { label: `Priority #${priorityDetailMatch[1]}` },
  ];

  if (pathname === "/priorities") return [
    { label: "Home" },
  ];

  const projectMatch = pathname.match(/^\/project\/([^/]+)/);
  if (projectMatch) return [
    { label: "Project Delivery", path: "/projects" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)/);
  if (portfolioMatch) return [
    { label: "Portfolio", path: "/portfolios" },
    { label: decodeURIComponent(portfolioMatch[1]) },
  ];

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

  if (pathname.startsWith("/gates")) return [
    { label: "Portfolio", path: "/portfolios" },
    { label: "Gate Tracker", path: "/gates" },
    ...(pathname !== "/gates" ? [{
      label: activeSection.secondary.find((item) => linkIsActive(pathname, item.path))?.label || pathname.split("/").pop() || "",
    }] : []),
  ];

  const leaf = activeSection.secondary
    .filter((item) => linkIsActive(pathname, item.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const items: BreadcrumbItem[] = [{ label: activeSection.label, path: activeSection.path }];
  if (leaf && leaf.label !== activeSection.label) {
    items.push({ label: leaf.label });
  }
  return items;
}
