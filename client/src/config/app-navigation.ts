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
 * Navigation structure (Prompt 2):
 *   Home | Projects | Gates | Finance | Admin
 *
 * - Home absorbs My Work (same question: "what needs my attention")
 * - "Gates" replaces "Lifecycle Board" — concrete word, everyone knows what a gate is
 * - Reports moves under Admin — consumed mainly by Exco/Finance
 * - 5 items instead of 7 — less cognitive load
 */
export const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    path: "/",
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox"]),
    secondary: [
      { label: "Actions", path: "/" },
      { label: "Approvals", path: "/my-work/approvals" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Inbox", path: "/inbox" },
      { label: "Settings", path: "/my-work/settings" },
    ],
  },
  {
    label: "Projects",
    path: "/projects",
    match: (pathname) => startsWithAny(pathname, [
      "/projects", "/project", "/project-lifecycle", "/clients",
      "/pm-dashboard", "/dashboard",
      "/pm/deliverables", "/handover-control", "/pm/on-the-go", "/pm/handover-review",
      "/portfolios",
      "/sites", "/opportunities",
      "/pd",
    ]),
    secondary: [
      { label: "All Projects", path: "/projects" },
      { label: "PD Pipeline", path: "/projects?filter=pd-pipeline" },
      { label: "Execution", path: "/projects?filter=execution" },
      { label: "Closeout", path: "/projects?filter=closeout" },
      { label: "Post-Handover", path: "/projects?filter=post-handover" },
      { label: "Clients", path: "/clients" },
    ],
  },
  {
    label: "Gates",
    path: "/gates",
    match: (pathname) => startsWithAny(pathname, [
      "/gates", "/lifecycle-board", "/execution-board",
      "/exceptions", "/weekly-reviews",
      "/engineering", "/quality", "/construction", "/hse", "/handover",
    ]),
    secondary: [
      { label: "Pipeline", path: "/gates" },
      { label: "Blocked", path: "/gates/blocked" },
      { label: "Ready", path: "/gates/ready" },
      { label: "Exceptions", path: "/gates/exceptions" },
      { label: "Client Updates", path: "/gates/client-updates" },
      { label: "Handovers", path: "/gates/handovers" },
    ],
  },
  {
    label: "Finance",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker", "/invoice-patterns", "/counterparties", "/subcontractor-dashboard", "/fye-revenue-tracking", "/procurement", "/po-approval-board", "/payment-request-board", "/payment-batch-manager"]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "COS", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "GP Tracker", path: "/gp-tracker" },
      { label: "FYE Revenue", path: "/fye-revenue-tracking" },
      { label: "PO Approvals", path: "/po-approval-board" },
      { label: "Payment Requests", path: "/payment-request-board" },
      { label: "Payment Batches", path: "/payment-batch-manager" },
      { label: "Counterparties", path: "/counterparties" },
      { label: "Invoice Patterns", path: "/invoice-patterns" },
      { label: "Procurement Hub", path: "/procurement" },
      { label: "Subcontractors", path: "/subcontractor-dashboard" },
    ],
  },
  {
    label: "Admin",
    path: "/admin/control-center",
    match: (pathname) => startsWithAny(pathname, ["/admin", "/settings", "/priorities", "/reports", "/ee-info", "/feedback", "/training"]),
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
  // Strip query string for comparison when target has query params
  const targetBase = target.split("?")[0];
  const targetQuery = target.includes("?") ? target.split("?")[1] : null;

  if (current === targetBase || current.startsWith(`${targetBase}/`)) {
    // If target has query params, check they match
    if (targetQuery) {
      const params = new URLSearchParams(window.location.search);
      const targetParams = new URLSearchParams(targetQuery);
      for (const [key, val] of targetParams.entries()) {
        if (params.get(key) !== val) return false;
      }
      return true;
    }
    // When on /my-work/tasks?source=approvals, My Tasks pill (/my-work) should not be active
    if (target === "/my-work" && current === "/my-work/tasks") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("source") === "approvals") return false;
    }
    return true;
  }
  // Approvals pill: /my-work/tasks with ?source=approvals should match /my-work/approvals
  if (target === "/my-work/approvals" && current === "/my-work/tasks") {
    const params = new URLSearchParams(window.location.search);
    return params.get("source") === "approvals";
  }
  return false;
}

export type BreadcrumbItem = { label: string; path?: string };

export function getBreadcrumbs(pathname: string, activeSection: TopSection): BreadcrumbItem[] {
  if (pathname === "/") return [];

  // Priority detail breadcrumb
  const priorityDetailMatch = pathname.match(/^\/priorities\/(\d+)/);
  if (priorityDetailMatch) return [
    { label: "Admin", path: "/priorities" },
    { label: "Priorities", path: "/priorities" },
    { label: `Priority #${priorityDetailMatch[1]}` },
  ];

  // Priority list breadcrumb
  if (pathname === "/priorities") return [
    { label: "Admin" },
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

  // Gates breadcrumbs
  if (pathname.startsWith("/gates")) return [
    { label: "Gates", path: "/gates" },
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
