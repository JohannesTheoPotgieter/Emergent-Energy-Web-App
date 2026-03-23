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

export const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    path: "/",
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work"]),
    secondary: [
      { label: "Home", path: "/" },
      { label: "My Work", path: "/my-work" },
    ],
  },
  {
    label: "Project Lifecycle",
    path: "/project-lifecycle",
    match: (pathname) => startsWithAny(pathname, ["/project-lifecycle", "/lifecycle-board", "/project", "/clients"]),
    secondary: [
      { label: "Overview", path: "/project-lifecycle" },
      { label: "Lifecycle", path: "/lifecycle-board" },
      { label: "Stage Gates", path: "/project-lifecycle/stage-gates" },
      { label: "Latest Updates", path: "/project-lifecycle/latest-updates" },
      { label: "Clients", path: "/clients" },
      { label: "Client Overview", path: "/project-lifecycle/client-overview" },
    ],
  },
  {
    label: "Project Development",
    path: "/pd",
    match: (pathname) => startsWithAny(pathname, ["/pd"]),
    secondary: [
      { label: "PD Dashboard", path: "/pd" },
      { label: "PD Tickets", path: "/pd/tickets" },
    ],
  },
  {
    label: "Project Management",
    path: "/execution-board",
    match: (pathname) => startsWithAny(pathname, ["/dashboard", "/pm-dashboard", "/projects", "/execution-board", "/pm/approvals", "/pm/deliverables", "/handover-control", "/pm/on-the-go", "/weekly-reviews", "/pm/handover-review", "/portfolios", "/exceptions"]),
    secondary: [
      { label: "Execution Dashboard", path: "/execution-board" },
      { label: "Project List", path: "/projects" },
      { label: "Portfolios", path: "/portfolios" },
      { label: "Exceptions", path: "/exceptions" },
      { label: "Deliverables", path: "/pm/deliverables" },
      { label: "Site / Execution Controls", path: "/handover-control" },
      { label: "PM On-The-Go", path: "/pm/on-the-go" },
    ],
  },
  {
    label: "Engineering",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Overview", path: "/engineering" },
      { label: "Requests & Tasks", path: "/engineering/tasks" },
      { label: "Audit Log", path: "/engineering/audit" },
    ],
  },
  {
    label: "Quality",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality"]),
    secondary: [{ label: "Quality Workspace", path: "/quality" }],
  },
  {
    label: "Finance",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker", "/invoice-patterns", "/counterparties", "/subcontractor-dashboard", "/fye-revenue-tracking"]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cost of Sales", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "Gross Profit", path: "/gp-tracker" },
      { label: "FYE Revenue", path: "/fye-revenue-tracking" },
      { label: "Procurement", path: "/subcontractor-dashboard" },
      { label: "Counterparties", path: "/counterparties" },
    ],
  },
  {
    label: "Knowledge",
    path: "/ee-info",
    match: (pathname) => startsWithAny(pathname, ["/ee-info", "/leaderboard", "/feedback", "/training", "/department-scores"]),
    secondary: [
      { label: "Lifecycle & SOP", path: "/ee-info" },
      { label: "Leaderboard", path: "/leaderboard" },
      { label: "Dept Scores", path: "/department-scores" },
      { label: "Training", path: "/training" },
      { label: "Feedback", path: "/feedback" },
    ],
  },
  {
    label: "Reports",
    path: "/reports/pm/monthly",
    match: (pathname) => startsWithAny(pathname, ["/reports"]),
    secondary: [
      { label: "PM Monthly Report", path: "/reports/pm/monthly" },
      { label: "Engineering Monthly Report", path: "/reports/engineering/monthly" },
      { label: "Programme Reports", path: "/reports/programme" },
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

  const projectMatch = pathname.match(/^\/project\/([^/]+)/);
  if (projectMatch) return [
    { label: "Project Management", path: "/execution-board" },
    { label: "Project List", path: "/projects" },
    { label: decodeURIComponent(projectMatch[1]) },
  ];

  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)/);
  if (portfolioMatch) return [
    { label: "Project Management", path: "/execution-board" },
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
