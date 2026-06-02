import type { ProjectImportLineage } from "@shared/api-types/project-v2";

export type ProjectDetailDeptKey =
  | "overview"
  | "pm"
  | "finance"
  | "eng"
  | "quality"
  | "procurement"
  | "documents"
  | "history"
  | "excel";

export type ProjectDetailSubTabKey =
  | "command"
  | "plan"
  | "board"
  | "calendar"
  | "commissioning"
  | "raid"
  | "handover"
  | "financial-review"
  | "tasks"
  | "drawings"
  | "documents"
  | "checklist"
  | "history"
  | "approvals"
  | "revenue"
  | "cost-lines"
  | "cos-tracker"
  | "rev-tracker"
  | "gp-tracker"
  | "cashflow"
  | "procurement"
  | "subcontractors"
  | "qb-recon"
  | "changes"
  | "controlled-docs"
  | "comms"
  | "rev-replica"
  | "exp-replica"
  | "plan-replica"
  | "edit-log"
  | "drift";

export const PROJECT_DETAIL_DEFAULT_SUBTAB: Record<ProjectDetailDeptKey, ProjectDetailSubTabKey> = {
  overview: "command",
  pm: "plan",
  finance: "revenue",
  eng: "tasks",
  quality: "checklist",
  procurement: "procurement",
  documents: "controlled-docs",
  history: "changes",
  excel: "rev-replica",
};

export const PROJECT_DETAIL_LEGACY_TAB_MAP: Record<string, { dept: ProjectDetailDeptKey; sub: ProjectDetailSubTabKey }> = {
  "task-grid": { dept: "pm", sub: "plan" },
  board: { dept: "pm", sub: "board" },
  calendar: { dept: "pm", sub: "calendar" },
  "project-plan": { dept: "pm", sub: "plan" },
  gantt: { dept: "pm", sub: "plan" },
  "key-dates": { dept: "pm", sub: "plan" },
  raid: { dept: "pm", sub: "raid" },
  commissioning: { dept: "pm", sub: "plan" },
  construction: { dept: "pm", sub: "plan" },
  handover: { dept: "pm", sub: "handover" },
  "readiness-gate": { dept: "pm", sub: "plan" },
  plan: { dept: "pm", sub: "plan" },
  overview: { dept: "overview", sub: "command" },
  delivery: { dept: "pm", sub: "plan" },
  "eng-tasks": { dept: "eng", sub: "tasks" },
  "eng-stages": { dept: "eng", sub: "tasks" },
  engineering: { dept: "eng", sub: "tasks" },
  quality: { dept: "quality", sub: "checklist" },
  history: { dept: "history", sub: "history" },
  approvals: { dept: "history", sub: "approvals" },
  "revenue-tracking": { dept: "finance", sub: "revenue" },
  expenditure: { dept: "finance", sub: "cost-lines" },
  "monthly-realisation": { dept: "finance", sub: "cos-tracker" },
  "revenue-tracker": { dept: "finance", sub: "rev-tracker" },
  "gp-tracker": { dept: "finance", sub: "gp-tracker" },
  cashflow: { dept: "finance", sub: "cashflow" },
  subcontractors: { dept: "procurement", sub: "subcontractors" },
  procurement: { dept: "procurement", sub: "procurement" },
  money: { dept: "finance", sub: "revenue" },
  revenue: { dept: "finance", sub: "revenue" },
  "change-control": { dept: "history", sub: "changes" },
  chat: { dept: "history", sub: "comms" },
  sharepoint: { dept: "documents", sub: "controlled-docs" },
  "local-files": { dept: "documents", sub: "documents" },
  collaboration: { dept: "documents", sub: "documents" },
  "revenue-replica": { dept: "excel", sub: "rev-replica" },
  "expenditure-replica": { dept: "excel", sub: "exp-replica" },
  "program-plan-replica": { dept: "excel", sub: "plan-replica" },
  "manual-overrides": { dept: "excel", sub: "edit-log" },
  "excel-vs-app": { dept: "excel", sub: "drift" },
};

export const PROJECT_DETAIL_DEPT_SUBTABS: Record<ProjectDetailDeptKey, ProjectDetailSubTabKey[]> = {
  overview: ["command"],
  pm: ["plan", "board", "calendar", "raid", "handover"],
  finance: ["revenue", "cost-lines", "cos-tracker", "rev-tracker", "gp-tracker", "cashflow", "qb-recon"],
  eng: ["tasks", "drawings", "documents"],
  quality: ["checklist", "documents"],
  procurement: ["procurement", "subcontractors"],
  documents: ["controlled-docs", "documents"],
  history: ["changes", "history", "approvals", "comms"],
  excel: ["rev-replica", "exp-replica", "plan-replica", "edit-log", "drift"],
};

export interface ProjectDepartmentGates {
  overview: boolean;
  pm: boolean;
  finance: boolean;
  engineering: boolean;
  quality: boolean;
  procurement: boolean;
  documents: boolean;
  history: boolean;
  excel: boolean;
}

export interface FinanceSubTabGates {
  revenue: boolean;
  expenditure: boolean;
  cosTracker: boolean;
  revenueTracker: boolean;
  gpTracker: boolean;
  cashflow: boolean;
  quickBooks: boolean;
}

export function buildLegacyProjectNameRedirect(projectId: number, currentSearch = ""): string {
  const qs = currentSearch ? (currentSearch.startsWith("?") ? currentSearch : `?${currentSearch}`) : "";
  return `/project/id/${projectId}${qs}`;
}

export function normalizeProjectDetailDeepLink(search: string): { dept: ProjectDetailDeptKey; sub: ProjectDetailSubTabKey } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const dept = params.get("dept");
  const rawSub = params.get("sub") || params.get("subTab");
  if (dept === "pd") {
    const historySubs = PROJECT_DETAIL_DEPT_SUBTABS.history;
    const documentsSubs = PROJECT_DETAIL_DEPT_SUBTABS.documents;
    if (rawSub && documentsSubs.includes(rawSub as ProjectDetailSubTabKey)) {
      return { dept: "documents", sub: rawSub as ProjectDetailSubTabKey };
    }
    const sub = rawSub && historySubs.includes(rawSub as ProjectDetailSubTabKey)
      ? rawSub as ProjectDetailSubTabKey
      : "changes";
    return { dept: "history", sub };
  }
  if (dept === "finance" && (rawSub === "procurement" || rawSub === "subcontractors")) {
    return { dept: "procurement", sub: rawSub };
  }
  // Quality's "approvals" sub-tab was de-duplicated into History (its canonical
  // home). Redirect legacy ?dept=quality&subTab=approvals links there so the
  // user's intent (see approvals) is preserved rather than silently dropped.
  if (dept === "quality" && rawSub === "approvals") {
    return { dept: "history", sub: "approvals" };
  }
  if (isProjectDetailDept(dept)) {
    const allowed = PROJECT_DETAIL_DEPT_SUBTABS[dept];
    const sub = rawSub && allowed.includes(rawSub as ProjectDetailSubTabKey)
      ? rawSub as ProjectDetailSubTabKey
      : PROJECT_DETAIL_DEFAULT_SUBTAB[dept];
    return { dept, sub };
  }
  const legacyTab = params.get("tab");
  return legacyTab ? PROJECT_DETAIL_LEGACY_TAB_MAP[legacyTab] ?? null : null;
}

export function buildProjectDetailPath({
  projectId,
  currentSearch = "",
  dept,
  sub,
  extraParams,
}: {
  projectId: number;
  currentSearch?: string;
  dept: ProjectDetailDeptKey | string;
  sub?: ProjectDetailSubTabKey | string;
  extraParams?: Record<string, string | number | boolean | null | undefined>;
}): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  params.delete("dept");
  params.delete("sub");
  params.delete("subTab");
  params.delete("tab");
  params.set("dept", dept);
  if (sub) params.set("sub", sub);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === null || value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    }
  }
  const qs = params.toString();
  return `/project/id/${projectId}${qs ? `?${qs}` : ""}`;
}

export function getVisibleProjectDepartments(gates: ProjectDepartmentGates): { key: ProjectDetailDeptKey; label: string }[] {
  return [
    { key: "overview" as const, label: "Overview", visible: gates.overview },
    { key: "pm" as const, label: "PM Delivery", visible: gates.pm },
    { key: "finance" as const, label: "Finance / Commercial", visible: gates.finance },
    { key: "eng" as const, label: "Engineering", visible: gates.engineering },
    { key: "quality" as const, label: "Quality", visible: gates.quality },
    { key: "procurement" as const, label: "Procurement", visible: gates.procurement },
    { key: "documents" as const, label: "Documents / SharePoint", visible: gates.documents },
    { key: "history" as const, label: "History / Decisions", visible: gates.history },
    { key: "excel" as const, label: "Excel Replica", visible: gates.excel },
  ].filter((dept) => dept.visible).map(({ key, label }) => ({ key, label }));
}

export function getVisibleFinanceSubTabs(gates: FinanceSubTabGates): { key: ProjectDetailSubTabKey; label: string }[] {
  return [
    { key: "revenue" as const, label: "Invoice Milestones", visible: gates.revenue },
    { key: "cost-lines" as const, label: "Expenditure Breakdown", visible: gates.expenditure },
    { key: "cos-tracker" as const, label: "COS Tracker", visible: gates.cosTracker },
    { key: "rev-tracker" as const, label: "Revenue Tracker", visible: gates.revenueTracker },
    { key: "gp-tracker" as const, label: "GP Tracker", visible: gates.gpTracker },
    { key: "cashflow" as const, label: "Cashflow", visible: gates.cashflow },
    { key: "qb-recon" as const, label: "QB Recon", visible: gates.quickBooks },
  ].filter((tab) => tab.visible).map(({ key, label }) => ({ key, label }));
}

export function firstVisibleDepartment(gates: ProjectDepartmentGates): { dept: ProjectDetailDeptKey; sub: ProjectDetailSubTabKey } {
  const first = getVisibleProjectDepartments(gates)[0]?.key ?? "pm";
  return { dept: first, sub: PROJECT_DETAIL_DEFAULT_SUBTAB[first] };
}

export function isProjectDetailDept(value: string | null | undefined): value is ProjectDetailDeptKey {
  return value === "overview"
    || value === "pm"
    || value === "finance"
    || value === "eng"
    || value === "quality"
    || value === "procurement"
    || value === "documents"
    || value === "history"
    || value === "excel";
}

export function isSubTabAllowedForDept(dept: ProjectDetailDeptKey, sub: string | null | undefined): sub is ProjectDetailSubTabKey {
  return !!sub && PROJECT_DETAIL_DEPT_SUBTABS[dept].includes(sub as ProjectDetailSubTabKey);
}

export function summarizeImportLineage(lineage: ProjectImportLineage | null | undefined): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  if (!lineage?.latestImport) {
    return {
      label: "Missing import",
      detail: lineage?.freshness?.warning || "No committed tracker import found",
      tone: "warning",
    };
  }

  const state = lineage.freshness.state;
  const label = state === "live"
    ? "Live"
    : state === "reconciled"
      ? "Reconciled"
      : state === "stale"
        ? "Stale"
        : state === "missing"
          ? "Missing import"
          : "Unknown";
  const tone = state === "live" || state === "reconciled"
    ? "success"
    : state === "stale" || state === "missing"
      ? "warning"
      : "neutral";
  const run = lineage.latestImport;
  const date = run.committedAt || run.uploadedAt;
  const parts = [
    run.sourceFileName || "Unknown workbook",
    run.importRunId ? `Run #${run.importRunId}` : null,
    date ? date.slice(0, 10) : null,
  ].filter(Boolean);
  return {
    label,
    detail: parts.join(" | ") || lineage.freshness.warning || "Import lineage unavailable",
    tone,
  };
}
