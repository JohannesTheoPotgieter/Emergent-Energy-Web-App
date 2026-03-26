import type { PermissionAction, PermissionEntity } from "@shared/schema";

export type RoleSummary = {
  role: string;
  label: string;
  description: string | null;
  sections: string[];
  entityPermissions: Record<string, Record<string, boolean>> | null;
  authorityModel?: { rules?: Record<string, { enabled?: boolean; scope?: string }> } | null;
  authoritySummary?: Array<{
    entity: string;
    actions: Array<{
      action: string;
      allowed: boolean;
      scope: string;
      reason?: string;
      source?: string;
    }>;
  }> | null;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
  isSystem: boolean;
  userCount?: number;
  configuredResources?: number;
  protected?: boolean;
};

export type UserSummary = {
  id: number;
  name: string;
  email: string;
  role: string;
  department?: string | null;
};

export type AdminSettingsSection = "roles" | "users" | "visibility" | "audit";

export type AdminRolesViewState = "loading" | "error" | "empty" | "ready";

export interface UserOverrideRow {
  id: number;
  userId: number;
  entity: string;
  action: string;
  allowed: boolean;
  scope: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PdVisConfig {
  id: number;
  role: string | null;
  userId: number | null;
  ticketTypes: string[];
  scope: string;
  updatedAt: string;
  updatedBy: number | null;
}

export interface WorkstreamVisConfig {
  id: number;
  role: string | null;
  userId: number | null;
  workstreams: string[];
  ticketTypes: string[];
  scope: string;
  sections: string[];
  updatedAt: string;
  updatedBy: number | null;
}

export interface AuditLogEntry {
  id: number;
  eventType: string;
  targetRole: string | null;
  targetUserId: number | null;
  targetUserName: string | null;
  changedByUserId: number | null;
  changedByName: string | null;
  changedByRole: string | null;
  changeDetail: Record<string, any>;
  createdAt: string;
}

export interface EffectivePermission {
  entity: string;
  action: string;
  allowed: boolean;
  source: "user_override" | "role_override" | "default" | "none";
  scope?: string;
}

export interface RoleComparisonResult {
  roles: string[];
  entities: Array<{
    entity: string;
    permissions: Record<string, Record<string, { allowed: boolean; source: string }>>;
  }>;
  differences: number;
}

export const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

export const DEPARTMENTS = [
  "Executive", "Engineering", "Finance", "Operations", "Project Development",
  "Project Management", "Quality", "Procurement", "Commercial", "Construction",
  "Health & Safety", "IT", "HR", "Legal",
];

export const NAV_SECTIONS = [
  { key: "COCKPIT", label: "Home", description: "Home, My Work" },
  { key: "PROJECTS", label: "Project Lifecycle", description: "Overview, Lifecycle Board, Stage Gates, Clients" },
  { key: "PROJECT_DEVELOPMENT", label: "Project Development", description: "PD Dashboard, PD Tickets" },
  { key: "PROJECT_MANAGEMENT", label: "Project Management", description: "Execution Dashboard, Project List, Deliverables, PM Dashboard, PM On-The-Go" },
  { key: "ENGINEERING", label: "Engineering", description: "Engineering Overview, Requests & Tasks" },
  { key: "GOVERNANCE", label: "Quality", description: "Quality Workspace" },
  { key: "MONEY", label: "Finance", description: "Cashflow, Cost of Sales, Revenue, Gross Profit, Procurement" },
  { key: "INFORMATION", label: "Knowledge", description: "Lifecycle & SOP, Leaderboard, Training, Feedback" },
  { key: "COLLABORATION", label: "Collaboration", description: "Project Chat & Meetings" },
  { key: "ADMIN", label: "Admin", description: "Control Center, Smart Import, Roles & Permissions, Audit Log" },
];

export const ENTITY_DESCRIPTIONS: Record<string, string> = {
  home: "Home page dashboard & landing",
  my_work: "My Work hub — tasks, calendar, meetings",
  my_tool: "My Work task planner (Today, Week, Backlog)",
  company_priorities: "Company-wide priorities & goals",
  lifecycle: "Project Lifecycle overview & board",
  create_project: "Create new project from lifecycle",
  pd_clients: "Clients list & client overview",
  pd_dashboard: "PD Dashboard — project development pipeline",
  pd_tickets: "PD Tickets — development tickets & tracking",
  projects: "Project List — all projects summary table",
  project_normalized: "Project Normalized — standardized project view",
  execution_board: "Execution Dashboard — delivery KPIs & cards",
  deliverables: "Deliverables tracker across projects",
  pm_dashboard: "Project Manager Dashboard",
  pm_on_the_go: "PM On-The-Go mobile site management",
  approvals: "Approvals — pending approval queue",
  weekly_reviews: "Weekly Reviews — review submissions & history",
  weekly_review_wizard: "Weekly Reviews — guided review wizard",
  portfolios: "Portfolio view — grouped project analysis",
  portfolio_detail: "Portfolio detail — drilldown view",
  tr_register: "Technical Register — technical tracking & records",
  triage_inbox: "Triage Inbox — incoming items to classify",
  unclassified_tasks: "Unclassified Tasks — tasks pending classification",
  notifications: "Notifications — system & user notifications",
  phase_templates: "Phase Templates — project phase configuration",
  engineering: "Engineering Overview — team workload & status",
  eng_tasks: "Engineering Requests & Tasks",
  eng_stages: "Engineering 5-Stage Checklist system",
  eng_sync: "Engineering Sync — synchronize engineering data",
  eng_inbox: "Engineering Inbox — incoming engineering requests",
  quality: "Quality Workspace — QA gates & inspections",
  cashflow: "Cashflow — inflows, outflows, forecast",
  cashflow_forecast: "Cashflow Forecast — forward-looking projections",
  cos: "Cost of Sales — COS tracking & realised",
  cos_control: "COS Control — cost of sales oversight & rules",
  revenue_tracker: "Revenue Tracker — invoiced & outstanding",
  revenue: "Revenue — general revenue access & tracking",
  gp_tracker: "Gross Profit Tracker — GP% & margins",
  fye_revenue_tracking: "FYE Revenue Tracking — financial year-end revenue",
  financials: "Finance — general financial access",
  financial_integration: "Financial Integration — rule-based matching",
  financial_linking: "Financial Linking — expense/revenue pairing",
  procurement: "Procurement Hub & subcontractor management",
  subcontractors: "Counterparties & procurement pipeline",
  counterparties: "Counterparties — external counterparty records",
  invoice_patterns: "Invoice Pattern Library",
  ee_info: "Lifecycle & SOP — company knowledge base",
  ee_info_lifecycle: "EE Info > Lifecycle — lifecycle knowledge articles",
  ee_info_departments: "EE Info > Departments — department knowledge hub",
  ee_info_processes: "EE Info > Processes — process documentation",
  ee_info_templates: "EE Info > Templates — document templates",
  leaderboard: "Leaderboard — team & department scores",
  training: "Training — learning resources & modules",
  knowledge_game: "Knowledge Game — quiz & training game",
  feedback: "Feedback & Support — suggestions & issues",
  department_scores: "Department Scores — team performance",
  teams_chat: "Teams Chat — Microsoft Teams messages",
  project_chat: "Project Chat — per-project messaging",
  collaboration_hub: "Collaboration Hub — files & communication",
  sharepoint_files: "SharePoint Files — document library",
  meetings: "Meetings — calendar & meeting notes",
  admin: "Admin Control Center — system settings",
  admin_roles: "Roles & Permissions management",
  smart_import: "Smart Import — Excel data import",
  data_import: "Data Import tools",
  data_export: "Data Export tools",
  database_migration: "Database Migration tools",
  task_management: "Task Management — create, edit, assign, delete tasks",
  handover: "PD-PM Handover — submit, approve, reject, reopen handovers",
  standups: "Standups — manage standup schedules and entries",
  reports: "Reports — view project plan, cost, quality, resource reports",
  counterparties_manage: "Counterparties — manage external counterparty records",
  commissioning: "Commissioning — manage commissioning items and evidence",
  ms_integration: "Microsoft 365 integration setup",
  ms_sync: "MS Graph Sync — calendar, email, Teams",
  activity_log: "Activity Log — system change audit",
  audit_trail: "Audit Trail — detailed change history",
  pd_overview: "Project detail > Overview tab",
  pd_plan: "Project detail > Plan (WBS grid)",
  pd_gantt: "Project detail > Gantt chart",
  pd_finance: "Project detail > Finance tab",
  pd_revenue: "Project detail > Revenue tracker",
  pd_cashflow: "Project detail > Cashflow tab",
  pd_cos_tracker: "Project detail > Cost of Sales",
  pd_expenditure: "Project detail > Expenditure breakdown",
  pd_history: "Project detail > Change history",
  pd_key_dates: "Project detail > Key dates & milestones",
  pd_quality: "Project detail > Quality tab",
  pd_engineering: "Project detail > Engineering tab",
  pd_eng_tasks: "Project detail > Engineering tasks",
  pd_eng_stages: "Project detail > Engineering stages",
  pd_collaboration: "Project detail > Files & collaboration",
  pd_subcontractors: "Project detail > Subcontractors",
  pd_change_control: "Project detail > Change control / VOs",
  pd_commissioning: "Project detail > Commissioning & closeout",
  pd_dependencies: "Project detail > Linked dependencies",
  pd_raid: "Project detail > RAID log (Risks, Actions, Issues)",
  dashboard_widgets: "Home dashboard — widget cards & charts",
  governance: "Governance — phase gate & compliance controls",
  operational_tasks: "Operational Tasks — ad-hoc task tracking (via work_items)",
  gamification: "Gamification — points, streaks & leaderboard",
  project_creation: "Create Project — new project wizard",
  project_tagging: "Project Tagging — labels & categories",
  work_items: "Work Items — canonical task/work tracking",
};

export const ENTITY_CATEGORIES: Record<string, { label: string; entities: string[] }> = {
  home: {
    label: "Home",
    entities: ["home", "my_work", "my_tool", "company_priorities"],
  },
  lifecycle: {
    label: "Project Lifecycle",
    entities: ["lifecycle", "create_project", "pd_clients"],
  },
  project_dev: {
    label: "Project Development",
    entities: ["pd_dashboard", "pd_tickets"],
  },
  project_management: {
    label: "Project Management",
    entities: ["projects", "project_normalized", "execution_board", "deliverables", "pm_dashboard", "pm_on_the_go", "approvals", "weekly_reviews", "weekly_review_wizard", "portfolios", "portfolio_detail", "tr_register", "triage_inbox", "unclassified_tasks", "handover", "commissioning", "task_management", "standups", "notifications", "phase_templates"],
  },
  engineering: {
    label: "Engineering",
    entities: ["engineering", "eng_tasks", "eng_stages", "eng_sync", "eng_inbox"],
  },
  quality: {
    label: "Quality",
    entities: ["quality"],
  },
  finance: {
    label: "Finance",
    entities: ["cashflow", "cashflow_forecast", "cos", "cos_control", "revenue_tracker", "revenue", "gp_tracker", "fye_revenue_tracking", "financials", "financial_integration", "financial_linking", "procurement", "counterparties", "subcontractors", "invoice_patterns"],
  },
  knowledge: {
    label: "Knowledge",
    entities: ["ee_info", "ee_info_lifecycle", "ee_info_departments", "ee_info_processes", "ee_info_templates", "leaderboard", "training", "knowledge_game", "feedback", "department_scores"],
  },
  collaboration: {
    label: "Collaboration",
    entities: ["teams_chat", "project_chat", "collaboration_hub", "sharepoint_files", "meetings", "reports"],
  },
  admin: {
    label: "Admin",
    entities: ["admin", "admin_roles", "smart_import", "data_import", "data_export", "database_migration", "ms_integration", "ms_sync", "activity_log", "audit_trail"],
  },
  project_detail: {
    label: "Project Detail Tabs",
    entities: ["pd_overview", "pd_plan", "pd_gantt", "pd_finance", "pd_revenue", "pd_cashflow", "pd_cos_tracker", "pd_expenditure", "pd_history", "pd_key_dates", "pd_quality", "pd_engineering", "pd_eng_tasks", "pd_eng_stages", "pd_collaboration", "pd_subcontractors", "pd_change_control", "pd_commissioning", "pd_dependencies", "pd_raid"],
  },
  other: {
    label: "Other Permissions",
    entities: ["dashboard_widgets", "governance", "operational_tasks", "gamification", "project_creation", "project_tagging", "work_items"],
  },
};

export function formatEntityName(entity: string): string {
  return entity
    .replace(/^pd_/, "PD ")
    .replace(/^eng_/, "Eng ")
    .replace(/^ms_/, "MS ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveSelectedRole(currentRole: string, roles: RoleSummary[]): string {
  if (!roles.length) return "";
  if (currentRole && roles.some((role) => role.role === currentRole)) return currentRole;
  return roles[0]?.role || "";
}

export function resolveAdminRolesViewState(params: {
  isLoading: boolean;
  hasError: boolean;
  roleCount: number;
  canManageRoles: boolean;
}): AdminRolesViewState {
  if (params.isLoading) return "loading";
  if (params.hasError) return "error";
  if (params.roleCount === 0) return "empty";
  return "ready";
}

export function canManageRoleActions(hasPermissionFlag: boolean, requestOk: boolean): boolean {
  if (!requestOk) return false;
  return hasPermissionFlag;
}

export function summarizeChangeDetail(detail: Record<string, any>): string {
  if (!detail) return "";
  const parts: string[] = [];
  if (detail.entity) parts.push(`Entity: ${detail.entity}`);
  if (detail.action) parts.push(`Action: ${detail.action}`);
  if (detail.previousRole && detail.newRole) parts.push(`${detail.previousRole} → ${detail.newRole}`);
  if (detail.label) parts.push(`Label: ${detail.label}`);
  if (detail.sourceRole) parts.push(`Cloned from: ${detail.sourceRole}`);
  if (typeof detail.allowed === "boolean") parts.push(detail.allowed ? "Granted" : "Denied");
  if (detail.reason) parts.push(`Reason: ${detail.reason}`);
  if (detail.sections) parts.push(`Sections: ${Array.isArray(detail.sections) ? detail.sections.length : "updated"}`);
  if (detail.hasEntityPermChanges) parts.push("Entity perms updated");
  if (detail.hasAuthorityModelChanges) parts.push("Authority model updated");
  return parts.join(" | ") || JSON.stringify(detail).slice(0, 80);
}
