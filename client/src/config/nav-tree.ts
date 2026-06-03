/**
 * Registry-driven navigation tree — the single source of truth for the
 * modern sidebar, the mobile drawer, and the breadcrumb resolver.
 *
 * Unlike the legacy `TOP_SECTIONS` (a hand-curated 6-tab list that left ~100
 * screens orphaned), this derives the menu directly from `PAGE_REGISTRY`:
 * every rendered, permitted, enabled page that has a `navGroup` gets a home,
 * grouped by domain. Add a page to the registry with a `navGroup` and it shows
 * up here automatically — no second list to maintain.
 *
 * Filtering by RBAC (`canViewPath`) and screen-availability happens at build
 * time so the tree only ever contains what the current role may actually open.
 */
import { PAGE_REGISTRY, type PageRegistryEntry, type NavGroupKey } from "@/config/page-registry";

export interface NavItem {
  id: string;
  path: string;
  label: string;
  iconKey?: string;
}

export interface NavGroup {
  key: NavGroupKey;
  heading: string;
  iconKey: string;
  items: NavItem[];
}

/**
 * Group order + display heading + group icon. The order is the vertical order
 * in the sidebar; headings are the company-facing domain names.
 */
export const NAV_GROUP_META: ReadonlyArray<{ key: NavGroupKey; heading: string; iconKey: string }> = [
  { key: "MY_WORK", heading: "Home", iconKey: "Home" },
  { key: "PRIORITIES", heading: "Priorities", iconKey: "Flag" },
  { key: "PORTFOLIO", heading: "Company", iconKey: "Building2" },
  { key: "PROJECT_DEVELOPMENT", heading: "Project Development", iconKey: "FolderOpen" },
  { key: "PROJECTS", heading: "Projects", iconKey: "FileSpreadsheet" },
  { key: "PROJECT_MANAGEMENT", heading: "Project Delivery", iconKey: "LayoutGrid" },
  { key: "GATES", heading: "Gates", iconKey: "Milestone" },
  { key: "FINANCE", heading: "Finance", iconKey: "BarChart3" },
  { key: "ENGINEERING", heading: "Engineering", iconKey: "Wrench" },
  { key: "QUALITY", heading: "Quality", iconKey: "ShieldCheck" },
  { key: "HSE", heading: "HSE", iconKey: "ShieldAlert" },
  { key: "REPORTS", heading: "Reports", iconKey: "FileText" },
  { key: "KNOWLEDGE", heading: "Knowledge", iconKey: "BookOpen" },
  { key: "SYSTEM", heading: "Settings", iconKey: "Settings" },
];

/**
 * Sub-views and duplicates that are reached *contextually* (a tab inside a
 * parent page, or an absorbed surface) and should not get their own sidebar
 * row. Everything else with a navGroup is surfaced automatically.
 */
const NAV_EXCLUDE = new Set<string>([
  // Execution Board internal tabs
  "/execution-board/program", "/execution-board/construction",
  "/execution-board/finance", "/execution-board/realisation",
  "/execution-board", // legacy board — superseded by Now + Portfolio
  "/execution-dashboard",
  // Project Lifecycle internal tabs
  "/project-lifecycle/stage-gates", "/project-lifecycle/latest-updates",
  "/project-lifecycle/client-overview",
  // Report drill-downs (reached from the report itself)
  "/reports/pm/monthly/history", "/reports/pm/monthly/compare",
  "/reports/engineering/monthly/history", "/reports/engineering/monthly/compare",
  // Finance analysis / absorbed QB surfaces (live inside their parent page)
  "/cashflow/analysis", "/cos/analysis", "/finance/gp",
  "/finance/quickbooks-customer-mapping", "/finance/quickbooks-links",
  "/program/excel-vs-app",
  // Misc sub-flows reached from buttons / merged elsewhere
  "/priorities/lineage", "/my-work/tasks", "/my-work/settings",
  "/pending-approvals",
  "/admin/database-migration", "/admin/document-types", "/admin/handover-health",
  // Intentionally retired from nav in the registry — honour that here too:
  "/counterparties", "/subcontractor-dashboard", "/invoice-patterns", // absorbed into QuickBooks → Suppliers
  "/admin/email-linker-dev", // dev-only tool
  "/feedback", // not actively monitored
]);

const PATH_TO_SCREEN_ID = new Map<string, string>(
  PAGE_REGISTRY.filter((p) => p.id && p.path).map((p) => [p.path, p.id]),
);

/**
 * Cleaner display labels for the sidebar. The group heading already gives
 * context, so items drop the redundant domain prefix (e.g. "Engineering Task
 * Board" → "Task Board") and abbreviations are spelled out ("COS" → "Cost of
 * Sales"). Keyed by registry id; the registry label is the fallback and stays
 * the source of truth for breadcrumbs/search elsewhere.
 */
const NAV_LABEL_OVERRIDES: Record<string, string> = {
  // Engineering
  engineering: "Overview",
  engineeringTasks: "Task Board",
  engineeringDocuments: "Documents",
  engineeringStandup: "Standup",
  // Quality
  quality: "Overview",
  qualityTasks: "Task Board",
  qualityDocuments: "Documents",
  // Company
  companyOverview: "Overview",
  // Project Development
  pdDashboard: "Overview",
  // Finance — spell out abbreviations
  cos: "Cost of Sales",
  financeGpCompany: "Gross Profit",
  financeQuickBooksThroughput: "QuickBooks",
  fyeRevenueTracking: "Year-End Tracking",
  financialReviewQueue: "Financial Reviews",
};

function isNavCandidate(e: PageRegistryEntry): boolean {
  return (
    Boolean(e.routeComponentKey) &&
    !e.redirectTo &&
    e.type !== "alias" &&
    Boolean(e.navGroup) &&
    !e.path.includes(":") &&
    !NAV_EXCLUDE.has(e.path)
  );
}

export interface BuildNavTreeOpts {
  canViewPath: (path: string) => boolean;
  isScreenEnabled: (screenId: string) => boolean;
}

export function buildNavTree({ canViewPath, isScreenEnabled }: BuildNavTreeOpts): NavGroup[] {
  const byGroup = new Map<NavGroupKey, NavItem[]>();
  for (const e of PAGE_REGISTRY) {
    if (!isNavCandidate(e)) continue;
    const screenId = PATH_TO_SCREEN_ID.get(e.path);
    if (screenId && !isScreenEnabled(screenId)) continue;
    if (e.path !== "/" && !canViewPath(e.path)) continue;
    const item: NavItem = { id: e.id, path: e.path, label: NAV_LABEL_OVERRIDES[e.id] ?? e.label, iconKey: e.iconKey };
    const group = e.navGroup as NavGroupKey;
    const arr = byGroup.get(group) ?? [];
    arr.push(item);
    byGroup.set(group, arr);
  }

  const groups: NavGroup[] = [];
  for (const meta of NAV_GROUP_META) {
    let items = byGroup.get(meta.key) ?? [];
    if (meta.key === "MY_WORK") {
      // The root dashboard ("/") has no registry navGroup — surface it as the
      // first Home item so every role has a clear way back to their landing.
      items = [{ id: "home", path: "/", label: "Home", iconKey: "Home" }, ...items];
    }
    if (items.length === 0) continue;
    groups.push({ key: meta.key, heading: meta.heading, iconKey: meta.iconKey, items });
  }
  return groups;
}

function stripQuery(p: string): string {
  return p.split("?")[0].split("#")[0];
}

function pathMatches(location: string, target: string): boolean {
  const loc = stripQuery(location);
  const tgt = stripQuery(target);
  if (tgt === "/") return loc === "/";
  return loc === tgt || loc.startsWith(`${tgt}/`);
}

/** The deepest nav item whose path is a prefix of the current location. */
export function findActiveNavItem(
  location: string,
  groups: NavGroup[],
): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  let bestLen = -1;
  for (const group of groups) {
    for (const item of group.items) {
      if (pathMatches(location, item.path) && item.path.length > bestLen) {
        best = { group, item };
        bestLen = item.path.length;
      }
    }
  }
  return best;
}

export interface NavCrumb {
  label: string;
  path?: string;
}

/**
 * Breadcrumbs derived from the tree: Domain › Page › [trailing segment].
 * Because it walks the same tree the sidebar renders, the root crumb is always
 * the correct domain — fixing the legacy "everything falls back to Home" bug.
 */
export function getNavBreadcrumbs(location: string, groups: NavGroup[]): NavCrumb[] {
  const loc = stripQuery(location);
  if (loc === "/") return [];

  const active = findActiveNavItem(location, groups);
  if (!active) {
    const segments = loc.split("/").filter(Boolean);
    return segments.map((seg, i) => ({
      label: decodeURIComponent(seg),
      path: i < segments.length - 1 ? `/${segments.slice(0, i + 1).join("/")}` : undefined,
    }));
  }

  const crumbs: NavCrumb[] = [];
  if (active.item.path !== "/") crumbs.push({ label: active.group.heading });
  crumbs.push({
    label: active.item.label,
    path: loc === active.item.path ? undefined : active.item.path,
  });
  if (loc !== active.item.path && loc.startsWith(active.item.path)) {
    const rest = loc.slice(active.item.path.length).split("/").filter(Boolean);
    if (rest.length > 0) crumbs.push({ label: decodeURIComponent(rest[rest.length - 1]) });
  }
  return crumbs;
}
