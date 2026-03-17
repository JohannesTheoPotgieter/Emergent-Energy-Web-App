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
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/dashboard", "/my-work", "/my-tool"]),
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
    path: "/pm-dashboard",
    match: (pathname) => startsWithAny(pathname, ["/pm-dashboard", "/projects", "/execution-board", "/pm/approvals", "/pm/deliverables", "/handover-control", "/pm/on-the-go", "/weekly-reviews", "/pm/handover-review", "/portfolios"]),
    secondary: [
      { label: "Execution Overview", path: "/pm-dashboard" },
      { label: "Project List", path: "/projects" },
      { label: "Work Plan / Board", path: "/execution-board" },
      { label: "Deliverables", path: "/pm/deliverables" },
      { label: "Approvals", path: "/pm/approvals" },
      { label: "Site / Execution Controls", path: "/handover-control" },
    ],
  },
  {
    label: "Engineering",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Overview", path: "/engineering" },
      { label: "Requests & Tasks", path: "/engineering/tasks" },
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
    match: (pathname) => startsWithAny(pathname, ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker", "/invoice-patterns", "/counterparties", "/subcontractor-dashboard"]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cost of Sales", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "Gross Profit", path: "/gp-tracker" },
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

export function getBreadcrumbs(pathname: string, activeSection: TopSection) {
  if (pathname === "/") return ["Home"];

  const projectMatch = pathname.match(/^\/project\/([^/]+)/);
  if (projectMatch) return ["Project Lifecycle", decodeURIComponent(projectMatch[1])];

  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)/);
  if (portfolioMatch) return ["Project Management", "Portfolios", decodeURIComponent(portfolioMatch[1])];

  if (pathname === "/pd/tickets/create") return ["Project Development", "PD Tickets", "Create"];

  const ticketMatch = pathname.match(/^\/pd\/tickets\/([^/]+)/);
  if (ticketMatch) return ["Project Development", "PD Tickets", `Ticket ${decodeURIComponent(ticketMatch[1])}`];

  const leaf = activeSection.secondary.find((item) => linkIsActive(pathname, item.path));
  return [activeSection.label, leaf?.label].filter(Boolean) as string[];
}
