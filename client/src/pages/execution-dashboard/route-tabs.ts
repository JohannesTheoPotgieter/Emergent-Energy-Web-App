export const EXECUTION_DASHBOARD_TABS = [
  { value: "overview", label: "Overview", path: "/execution-board" },
  { value: "programme", label: "Programme", path: "/execution-board/program" },
  { value: "construction", label: "Construction", path: "/execution-board/construction" },
  { value: "finance", label: "Finance", path: "/execution-board/finance" },
  { value: "realisation", label: "Realisation", path: "/execution-board/realisation" },
] as const;

export type ExecutionDashboardTab = typeof EXECUTION_DASHBOARD_TABS[number]["value"];

const TAB_BY_PATH = new Map<string, ExecutionDashboardTab>(
  EXECUTION_DASHBOARD_TABS.map((tab) => [tab.path, tab.value]),
);

const PATH_BY_TAB = new Map<ExecutionDashboardTab, string>(
  EXECUTION_DASHBOARD_TABS.map((tab) => [tab.value, tab.path]),
);

function normalizePath(pathname: string): string {
  const [withoutHash] = pathname.split("#");
  const [withoutQuery] = withoutHash.split("?");
  const normalized = withoutQuery.trim().toLowerCase();
  if (!normalized || normalized === "/") return "/";
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function getExecutionDashboardTabFromPath(pathname: string): ExecutionDashboardTab {
  return TAB_BY_PATH.get(normalizePath(pathname)) ?? "overview";
}

export function getExecutionDashboardPathForTab(tab: ExecutionDashboardTab): string {
  return PATH_BY_TAB.get(tab) ?? "/execution-board";
}
