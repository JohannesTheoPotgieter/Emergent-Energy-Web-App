/**
 * A9: Role-based home screen configuration
 *
 * Maps each company role to its most relevant KPIs, attention priorities,
 * and quick actions. Used by the dashboard to reorder/filter widgets.
 */
import type { CompanyRole } from "@shared/schema/users";

export interface RoleKpi {
  key: string;
  label: string;
}

export interface RoleQuickAction {
  label: string;
  path: string;
  iconKey?: string;
}

export interface RoleDashboardConfig {
  kpis: RoleKpi[];
  attentionPriority: string[];
  quickActions: RoleQuickAction[];
  cockpitPath: string;
  cockpitLabel: string;
}

const COO_CEO_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "revenue_vs_target", label: "Revenue vs Target" },
    { key: "gp_margin", label: "GP Margin" },
    { key: "projects_off_track", label: "Projects Off Track" },
    { key: "open_vos", label: "Open VOs" },
  ],
  attentionPriority: ["exceptions", "gate_failures", "handover_bottlenecks", "budget_deviation"],
  quickActions: [
    { label: "Execution Board", path: "/execution-board", iconKey: "LayoutDashboard" },
    { label: "Exceptions", path: "/exceptions", iconKey: "AlertTriangle" },
    { label: "Gate Pipeline", path: "/gates", iconKey: "Milestone" },
    { label: "Reports", path: "/reports", iconKey: "FileText" },
    { label: "Control Center", path: "/admin/control-center", iconKey: "Gauge" },
  ],
  cockpitPath: "/execution-board",
  cockpitLabel: "Execution Board",
};

const PROGRAM_MANAGER_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "projects_on_track", label: "Projects On Track" },
    { key: "projects_off_track", label: "Projects Off Track" },
    { key: "milestones_due", label: "Milestones Due" },
    { key: "overdue_tasks", label: "Overdue Tasks" },
  ],
  attentionPriority: ["behind_plan", "resource_bottlenecks", "gate_failures", "handover_bottlenecks"],
  quickActions: [
    { label: "Gates Pipeline", path: "/gates", iconKey: "Milestone" },
    { label: "Weekly Reviews", path: "/weekly-reviews", iconKey: "CalendarCheck" },
    { label: "Execution Board", path: "/execution-board", iconKey: "LayoutDashboard" },
    { label: "Project List", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "Programme Reports", path: "/reports/programme", iconKey: "FileText" },
    { label: "Exceptions", path: "/exceptions", iconKey: "AlertTriangle" },
  ],
  cockpitPath: "/execution-board",
  cockpitLabel: "Execution Board",
};

const PM_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "my_projects_rag", label: "My Projects RAG" },
    { key: "my_overdue_tasks", label: "My Overdue Tasks" },
    { key: "my_approvals_pending", label: "Approvals Pending" },
    { key: "my_deliverables_due", label: "Deliverables Due" },
  ],
  attentionPriority: ["my_behind_plan", "my_blockers", "my_approvals", "my_overdue"],
  quickActions: [
    { label: "My Tasks", path: "/priorities?tab=my", iconKey: "ListChecks" },
    { label: "Approvals", path: "/pm/approvals", iconKey: "ClipboardCheck" },
    { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "Weekly Reviews", path: "/weekly-reviews", iconKey: "CalendarCheck" },
    { label: "Gates Pipeline", path: "/gates", iconKey: "Milestone" },
  ],
  cockpitPath: "/execution-board",
  cockpitLabel: "Execution Board",
};

const ENGINEER_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "my_eng_tasks", label: "My Engineering Tasks" },
    { key: "design_queue", label: "Design Queue" },
    { key: "review_queue", label: "Review Queue" },
    { key: "my_overdue_deliverables", label: "Overdue Deliverables" },
  ],
  attentionPriority: ["my_overdue_deliverables", "ncrs_assigned", "reviews_pending", "my_overdue"],
  quickActions: [
    { label: "Engineering Tasks", path: "/engineering/tasks", iconKey: "ListTodo" },
    { label: "Standup", path: "/engineering/standup", iconKey: "Users" },
    { label: "My Tasks", path: "/priorities?tab=my", iconKey: "ListChecks" },
    { label: "Engineering Overview", path: "/engineering", iconKey: "Wrench" },
    { label: "Quality", path: "/quality", iconKey: "ShieldCheck" },
  ],
  cockpitPath: "/engineering",
  cockpitLabel: "Engineering Overview",
};

const PD_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "my_opportunities", label: "Total Projects" },
    { key: "handover_readiness", label: "Active Projects" },
    { key: "pd_tickets_open", label: "Planned Revenue (FY)" },
    { key: "proposals_pending", label: "Received Inflow (FY)" },
  ],
  attentionPriority: ["handovers_needing_prep", "returned_tickets", "stale_opportunities", "my_overdue"],
  quickActions: [
    { label: "Project Development Dashboard", path: "/pd", iconKey: "Sun" },
    { label: "Opportunities", path: "/opportunities", iconKey: "TrendingUp" },
    { label: "Clients", path: "/clients", iconKey: "Users" },
  ],
  cockpitPath: "/pd",
  cockpitLabel: "Project Development Dashboard",
};

const FINANCE_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "revenue_this_month", label: "Revenue This Month" },
    { key: "cos_this_month", label: "COS This Month" },
    { key: "cash_position", label: "Cash Position" },
    { key: "margin_drift", label: "Margin Drift" },
  ],
  attentionPriority: ["invoices_overdue", "payment_due", "margin_drift", "budget_deviation"],
  quickActions: [
    { label: "Cashflow", path: "/cashflow", iconKey: "Wallet" },
    { label: "Revenue Tracker", path: "/revenue-tracker", iconKey: "TrendingUp" },
    { label: "Costs (COS)", path: "/cos", iconKey: "TrendingUp" },
    { label: "Payment Requests", path: "/payment-request-board", iconKey: "DollarSign" },
    { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
  ],
  cockpitPath: "/cashflow",
  cockpitLabel: "Cashflow",
};

const QUALITY_CONFIG: RoleDashboardConfig = {
  // open_warnings is the only quality metric with a real server-side count today.
  // Open NCRs, Snags Due, Inspections Pending, Corrective Actions Open need
  // dashboard endpoints before they can show real numbers — they render "—"
  // until then rather than substituting an unrelated count under a misleading
  // label (Phase 5 NAME-007 / NAME-008).
  kpis: [
    { key: "open_warnings", label: "Open Quality Warnings" },
    { key: "open_ncrs", label: "Open NCRs" },
    { key: "snags_due", label: "Snags Due" },
    { key: "corrective_actions_open", label: "Corrective Actions Open" },
  ],
  attentionPriority: ["overdue_ncrs", "quality_gate_blocks", "overdue_snags", "inspection_failures"],
  quickActions: [
    { label: "Quality Dashboard", path: "/quality", iconKey: "ShieldCheck" },
    { label: "Commissioning", path: "/commissioning-dashboard", iconKey: "ClipboardCheck" },
    { label: "My Tasks", path: "/priorities?tab=my", iconKey: "ListChecks" },
    { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "Approvals", path: "/pm/approvals", iconKey: "ClipboardList" },
  ],
  cockpitPath: "/quality",
  cockpitLabel: "Quality Dashboard",
};

const CONSTRUCTION_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "active_sites", label: "Active Sites" },
    { key: "site_readiness", label: "Site Readiness" },
    { key: "open_snags", label: "Open Snags" },
    { key: "inspections_due", label: "Inspections Due" },
  ],
  attentionPriority: ["material_delays", "inspection_failures", "critical_snags", "safety_incidents"],
  quickActions: [
    { label: "Execution Board", path: "/execution-board", iconKey: "LayoutDashboard" },
    { label: "Project List", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "Quality", path: "/quality", iconKey: "ShieldCheck" },
    { label: "Gates Pipeline", path: "/gates", iconKey: "Milestone" },
    { label: "My Tasks", path: "/priorities?tab=my", iconKey: "ListChecks" },
  ],
  cockpitPath: "/execution-board",
  cockpitLabel: "Execution Board",
};

const DEFAULT_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "my_tasks", label: "My Tasks" },
    { key: "my_approvals", label: "My Approvals" },
    { key: "my_projects", label: "My Projects" },
    { key: "upcoming_events", label: "Upcoming Events" },
  ],
  attentionPriority: ["my_overdue", "my_blockers", "my_approvals"],
  quickActions: [
    { label: "My Tasks", path: "/my-work", iconKey: "ListChecks" },
    { label: "Project List", path: "/projects", iconKey: "FileSpreadsheet" },
  ],
  cockpitPath: "/execution-board",
  cockpitLabel: "Execution Board",
};

const HSE_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "incidents_open", label: "Open Incidents" },
    { key: "corrective_actions_due", label: "Corrective Actions Due" },
    { key: "safety_file_compliance", label: "Safety File Compliance" },
    { key: "inspections_overdue", label: "Inspections Overdue" },
  ],
  attentionPriority: ["safety_incidents", "overdue_corrective_actions", "audit_findings", "compliance_gaps"],
  quickActions: [
    { label: "HSE Dashboard", path: "/hse", iconKey: "ShieldAlert" },
    { label: "Quality", path: "/quality", iconKey: "ShieldCheck" },
    { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
  ],
  cockpitPath: "/hse",
  cockpitLabel: "HSE Dashboard",
};

const SSEG_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "applications_pending", label: "Applications Pending" },
    { key: "queries_outstanding", label: "Queries Outstanding" },
    { key: "approvals_due", label: "Approvals Due" },
    { key: "rejections_open", label: "Rejections Open" },
  ],
  attentionPriority: ["response_due", "missing_documents", "authority_queries", "expired_approvals"],
  quickActions: [
    { label: "HSE Dashboard", path: "/hse", iconKey: "ShieldAlert" },
    { label: "Engineering", path: "/engineering", iconKey: "Wrench" },
    { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
  ],
  cockpitPath: "/hse",
  cockpitLabel: "SSEG Control Board",
};

const ROLE_CONFIG_MAP: Partial<Record<CompanyRole, RoleDashboardConfig>> = {
  COO_ADMIN: COO_CEO_CONFIG,
  CEO_ADMIN: COO_CEO_CONFIG,
  CCO: PD_CONFIG,
  CFO: FINANCE_CONFIG,
  PROGRAM_MANAGER: PROGRAM_MANAGER_CONFIG,
  PROGRAM_FINANCE_MANAGER: FINANCE_CONFIG,
  CONSTRUCTION_MANAGER: CONSTRUCTION_CONFIG,
  QUALITY_MANAGER: QUALITY_CONFIG,
  ENGINEERING_MANAGER: ENGINEER_CONFIG,
  KEY_ACCOUNTS_MANAGER: PD_CONFIG,
  ACCOUNTANT: FINANCE_CONFIG,
  ENGINEER: ENGINEER_CONFIG,
  PROJECT_MANAGER_SITE: PM_CONFIG,
  PROJECT_DEVELOPER: PD_CONFIG,
  HSE_MANAGER: HSE_CONFIG,
  SSEG_MANAGER: SSEG_CONFIG,
};

export function getRoleDashboardConfig(role: CompanyRole): RoleDashboardConfig {
  return ROLE_CONFIG_MAP[role] ?? DEFAULT_CONFIG;
}

export function getRoleKpis(role: CompanyRole): RoleKpi[] {
  return getRoleDashboardConfig(role).kpis;
}

export function getRoleAttentionFilters(role: CompanyRole): string[] {
  return getRoleDashboardConfig(role).attentionPriority;
}

export function getRoleQuickActions(role: CompanyRole): RoleQuickAction[] {
  return getRoleDashboardConfig(role).quickActions;
}

// ===================== LENS-BASED DASHBOARD CONFIG =====================

import { resolveUserLens, type LensRole } from "@shared/schema/role-based-upgrade";

const LENS_CONFIG_MAP: Record<LensRole, RoleDashboardConfig> = {
  CEO: COO_CEO_CONFIG,
  COO_SUPER_ADMIN: { ...COO_CEO_CONFIG, cockpitPath: "/admin/control-center", cockpitLabel: "Command Center" },
  CFO: FINANCE_CONFIG,
  HEAD_OF_PROJECT_DEVELOPMENT: PD_CONFIG,
  PROGRAM_MANAGER: PROGRAM_MANAGER_CONFIG,
  CONSTRUCTION_MANAGER: CONSTRUCTION_CONFIG,
  PROGRAM_FINANCE_MANAGER: FINANCE_CONFIG,
  HSE_MANAGER: HSE_CONFIG,
  SSEG_MANAGER: SSEG_CONFIG,
  QUALITY_MANAGER: QUALITY_CONFIG,
  ENGINEER: ENGINEER_CONFIG,
  PROJECT_MANAGER: PM_CONFIG,
  PROJECT_DEVELOPER: PD_CONFIG,
};

/**
 * Get dashboard config based on lens role (new system).
 * Falls back to legacy role-based config if lens not found.
 */
export function getLensDashboardConfig(dbRole?: string | null): RoleDashboardConfig {
  const lens = resolveUserLens(dbRole);
  return LENS_CONFIG_MAP[lens] ?? DEFAULT_CONFIG;
}

/**
 * Get dashboard config for a specific lens role directly.
 */
export function getDashboardConfigForLens(lens: LensRole): RoleDashboardConfig {
  return LENS_CONFIG_MAP[lens] ?? DEFAULT_CONFIG;
}
