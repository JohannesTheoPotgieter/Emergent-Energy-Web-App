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
    { label: "Exceptions", path: "/exceptions", iconKey: "AlertTriangle" },
    { label: "Portfolio Overview", path: "/execution-board", iconKey: "LayoutDashboard" },
    { label: "GP Tracker", path: "/gp-tracker", iconKey: "Activity" },
  ],
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
    { label: "Weekly Review", path: "/weekly-reviews", iconKey: "CalendarCheck" },
    { label: "Project List", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "Programme Reports", path: "/reports/programme", iconKey: "FileText" },
  ],
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
    { label: "My Tasks", path: "/my-work", iconKey: "ListChecks" },
    { label: "Approvals", path: "/pm/approvals", iconKey: "ClipboardCheck" },
    { label: "Deliverables", path: "/pm/deliverables", iconKey: "Package" },
  ],
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
    { label: "My Tasks", path: "/my-work", iconKey: "ListChecks" },
  ],
};

const PD_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "my_opportunities", label: "My Opportunities" },
    { key: "handover_readiness", label: "Handover Readiness" },
    { key: "pd_tickets_open", label: "PD Tickets Open" },
    { key: "proposals_pending", label: "Proposals Pending" },
  ],
  attentionPriority: ["handovers_needing_prep", "returned_tickets", "stale_opportunities", "my_overdue"],
  quickActions: [
    { label: "PD Dashboard", path: "/pd", iconKey: "Sun" },
    { label: "Create Ticket", path: "/pd/tickets/create", iconKey: "ClipboardList" },
    { label: "Clients", path: "/clients", iconKey: "Users" },
  ],
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
    { label: "Revenue", path: "/revenue-tracker", iconKey: "TrendingUp" },
    { label: "Costs (COS)", path: "/cos", iconKey: "TrendingUp" },
  ],
};

const QUALITY_CONFIG: RoleDashboardConfig = {
  kpis: [
    { key: "open_ncrs", label: "Open NCRs" },
    { key: "snags_due", label: "Snags Due" },
    { key: "inspections_pending", label: "Inspections Pending" },
    { key: "corrective_actions_open", label: "Corrective Actions Open" },
  ],
  attentionPriority: ["overdue_ncrs", "quality_gate_blocks", "overdue_snags", "inspection_failures"],
  quickActions: [
    { label: "Quality Dashboard", path: "/quality", iconKey: "ShieldCheck" },
    { label: "NCR List", path: "/quality/ncrs", iconKey: "ListTodo" },
    { label: "My Tasks", path: "/my-work", iconKey: "ListChecks" },
  ],
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
    { label: "Portfolio Overview", path: "/execution-board", iconKey: "LayoutDashboard" },
    { label: "Project List", path: "/projects", iconKey: "FileSpreadsheet" },
    { label: "My Tasks", path: "/my-work", iconKey: "ListChecks" },
  ],
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
