import { ADMIN_NAV_ITEMS } from "@/config/admin-surfaces";

export type SecondaryItem = { label: string; path: string; disabled?: boolean };
export type TopSection = {
  label: string;
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

/**
 * Redesigned navigation (A1+A2):
 *   Home | My Work | Projects | Finance | Reports | Admin
 *
 * - "Execution" items merged into "Projects"
 * - "Operations" (Engineering, Quality) merged into "Projects"
 * - "Insights" renamed to "Reports"
 * - "Project Development" lives as sub-items under "Projects" (visible to PD roles)
 * - Naming improvements applied throughout (A2)
 */
export const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    path: "/",
    match: (pathname) => pathname === "/",
    secondary: [
      { label: "Home", path: "/" },
    ],
  },
  {
    label: "My Work",
    path: "/my-work",
    match: (pathname) => startsWithAny(pathname, ["/my-work", "/inbox", "/pm/approvals"]),
    secondary: [
      { label: "My Tasks", path: "/my-work" },
      { label: "Approvals", path: "/pm/approvals" },
      { label: "Inbox", path: "/inbox" },
    ],
  },
  {
    label: "Projects",
    path: "/projects",
    match: (pathname) => startsWithAny(pathname, [
      "/projects", "/project", "/project-lifecycle", "/lifecycle-board", "/clients",
      "/execution-board", "/pm-dashboard", "/dashboard",
      "/pm/deliverables", "/handover-control", "/pm/on-the-go", "/weekly-reviews",
      "/pm/handover-review", "/portfolios", "/exceptions",
      "/engineering", "/quality", "/construction", "/hse", "/handover",
      "/sites", "/opportunities",
      "/pd",
    ]),
    secondary: [
      { label: "Project List", path: "/projects" },
      { label: "Portfolio Overview", path: "/execution-board" },
      { label: "Lifecycle", path: "/lifecycle-board" },
      { label: "Exceptions", path: "/exceptions" },
      { label: "Deliverables", path: "/pm/deliverables" },
      { label: "Weekly Reviews", path: "/weekly-reviews" },
      { label: "Construction", path: "/construction" },
      { label: "Engineering", path: "/engineering" },
      { label: "Quality & HSE", path: "/quality" },
      { label: "Handover & Closeout", path: "/handover" },
      { label: "PD Dashboard", path: "/pd" },
      { label: "Clients", path: "/clients" },
    ],
  },
  {
    label: "Finance",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker", "/invoice-patterns", "/counterparties", "/subcontractor-dashboard", "/fye-revenue-tracking", "/procurement"]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "COS", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "GP Tracker", path: "/gp-tracker" },
      { label: "FYE Revenue", path: "/fye-revenue-tracking" },
      { label: "Counterparties", path: "/counterparties" },
      { label: "Invoice Patterns", path: "/invoice-patterns" },
      { label: "Procurement Hub", path: "/procurement" },
      { label: "Subcontractors", path: "/subcontractor-dashboard" },
    ],
  },
  {
    label: "Reports",
    path: "/priorities",
    match: (pathname) => startsWithAny(pathname, ["/priorities", "/reports", "/ee-info", "/feedback", "/training"]),
    secondary: [
      { label: "Priorities", path: "/priorities" },
      { label: "PM Monthly Report", path: "/reports/pm/monthly" },
      { label: "Eng Monthly Report", path: "/reports/engineering/monthly" },
      { label: "Programme Reports", path: "/reports/programme" },
      { label: "Processes & SOPs", path: "/ee-info" },
      { label: "Training", path: "/training" },
      { label: "Feedback", path: "/feedback" },
    ],
  },
  {
    label: "Admin",
    path: "/admin/control-center",
    match: (pathname) => startsWithAny(pathname, ["/admin", "/settings"]),
    secondary: ADMIN_NAV_ITEMS,
  },
];

export function buildVisibleTopSections(options: {
  canViewPath: (path: string) => boolean;
}) {
  const { canViewPath } = options;

  return TOP_SECTIONS
    .map((section) => {
      const secondary = section.secondary.filter((item) => item.path === "/" || canViewPath(item.path));
      const firstVisiblePath = secondary[0]?.path || section.path;
      if (section.label === "Home") {
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
  return current === target || current.startsWith(`${target}/`);
}

export type BreadcrumbItem = { label: string; path?: string };

export function getBreadcrumbs(pathname: string, activeSection: TopSection): BreadcrumbItem[] {
  if (pathname === "/") return [];

  // Priority detail breadcrumb
  const priorityDetailMatch = pathname.match(/^\/priorities\/(\d+)/);
  if (priorityDetailMatch) return [
    { label: "Reports", path: "/priorities" },
    { label: "Priorities", path: "/priorities" },
    { label: `Priority #${priorityDetailMatch[1]}` },
  ];

  // Priority list breadcrumb
  if (pathname === "/priorities") return [
    { label: "Reports" },
  ];

  const projectMatch = pathname.match(/^\/project\/([^/]+)/);
  if (projectMatch) return [
    { label: "Projects", path: "/projects" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)/);
  if (portfolioMatch) return [
    { label: "Projects", path: "/projects" },
    { label: "Portfolios", path: "/portfolios" },
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

  const leaf = activeSection.secondary.find((item) => linkIsActive(pathname, item.path));
  const items: BreadcrumbItem[] = [{ label: activeSection.label, path: activeSection.path }];
  if (leaf && leaf.label !== activeSection.label) {
    items.push({ label: leaf.label });
  }
  return items;
}
