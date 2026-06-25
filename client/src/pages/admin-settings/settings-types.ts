import type { PermissionAction, PermissionEntity } from "@shared/schema";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";

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
  // Task #110 — admin-controlled active/inactive toggle. The API
  // (GET /api/admin/users) always returns this field post-migration 0037,
  // so it is required on the client type. `true` means the account can
  // sign in; `false` blocks login at the LocalStrategy / bearer / session
  // gates and at the Microsoft OAuth callback.
  isActive: boolean;
};

export type AdminSettingsSection = "roles" | "users" | "visibility" | "screens" | "audit";

export interface ScreenSetting {
  screenId: string;
  isEnabled: boolean;
}

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

export const ACTIONS: PermissionAction[] = ["view", "edit"];

export const DEPARTMENTS = [
  "Executive", "Engineering", "Finance", "Operations", "Project Development",
  "Project Management", "Quality", "Procurement", "Commercial", "Construction",
  "Health & Safety", "IT", "HR", "Legal",
];

export const NAV_SECTIONS = [
  { key: "HOME", label: "Home", description: "Dashboard, My Tasks, Approvals, Calendar, Meetings, Inbox" },
  { key: "PORTFOLIO", label: "Company", description: "Company Overview, Lifecycle Overview, Lifecycle Board, Gate Tracker, Blocked Gates, Exceptions" },
  { key: "PROJECT_DEVELOPMENT", label: "Project Development", description: "Project Development Dashboard, Pipeline / Opportunities, Project Development Tickets, Clients, Handover Queue, Project Development Reports" },
  { key: "PROJECT_DELIVERY", label: "Project Delivery", description: "Execution Dashboard, PM Dashboard, Portfolio, All Projects, Procurement, PO Approvals, Payment Requests, Payment Batches, Milestones, Weekly Reviews, Standups, PM Approvals, PM On-The-Go, Handover & Closeout, Financial Reviews, SSEG, Sites" },
  { key: "HSE", label: "HSE", description: "HSE Dashboard" },
  { key: "ENGINEERING", label: "Engineering", description: "Engineering Dashboard, Task Board, Standup" },
  { key: "QUALITY", label: "Quality", description: "Quality Dashboard, Commissioning" },
  { key: "FINANCE", label: "Finance", description: "Cashflow, Revenue, COS, GP / Margin, FYE Revenue, Counterparties, Subcontractors, Invoice Patterns" },
  { key: "REPORTS", label: "Reports", description: "Report Center, Programme Reports, PM Monthly, Engineering Monthly, Performance" },
  { key: "PRIORITIES", label: "Priorities", description: "Company Priorities — strategic goals & progress tracking" },
  { key: "ADMIN", label: "Admin", description: "Control Center, Roles & Permissions, Smart Import, Audit Log, Processes & SOPs, Templates, Recovery" },
];

// Registry descriptions always win; the static map below covers UI-only
// entities that have no backend RBAC entry in ENTITY_REGISTRY.
const _STATIC_ENTITY_DESCRIPTIONS: Record<string, string> = {
  home: "Home page dashboard & landing",
  my_work: "My Work hub — tasks, calendar, meetings",
  my_tool: "My Work task planner (Today, Week, Backlog)",
  company_priorities: "Company-wide priorities & goals",
  lifecycle: "Project Lifecycle overview & board",
  create_project: "Create new project from lifecycle",
  pd_clients: "Clients list & client overview",
  pd_dashboard: "Project Development Dashboard — project development pipeline",
  pd_tickets: "Project Development — opportunity workflow & tracking",
  projects: "Project List — all projects summary table",
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
  phase_templates: "Phase Templates — project phase configuration",
  engineering: "Engineering Overview — team workload & status",
  eng_tasks: "Engineering Requests & Tasks",
  eng_stages: "Engineering 5-Stage Checklist system",
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
  counterparties: "Counterparties — external counterparty records & management",
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
  collaboration_hub: "Collaboration Hub — files & communication",
  meetings: "Meetings — calendar & meeting notes",
  admin: "Admin Control Center — system settings",
  admin_roles: "Roles & Permissions management",
  smart_import: "Smart Import — Excel data import",
  data_import: "Data Import tools",
  data_export: "Data Export tools",
  database_migration: "Database Migration tools",
  sseg: "SSEG — small-scale embedded generation application tracker",
  handover: "PD-PM Handover — submit, approve, reject, reopen handovers",
  standups: "Standups — manage standup schedules and entries",
  reports: "Reports — view project plan, cost, quality, resource reports",
  stage_lifecycle: "Stage Lifecycle — project stage progression",
  stage_exceptions: "Stage Exceptions — exception requests on stages",
  stage_dependencies: "Stage Dependencies — inter-stage dependencies",
  stage_admin: "Stage Admin — stage configuration & templates",
  stage_gate: "Stage Gate — gate reviews & approvals",
  stage_config: "Stage Config — stage template configuration",
  gate_override: "Gate Override — override gate decisions",
  exception: "Exception — exception requests & approvals",
  project_charter: "Project Charter — project initiation document",
  client_update: "Client Update — client communication updates",
  handover_acceptance: "Handover Acceptance — accept/reject handovers",
  performance: "Performance — team & project performance metrics",
  project_access_mgmt: "Project Access — manage project team access",
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
  hse_dashboard: "HSE Dashboard — health, safety & environment overview",
  hse_compliance: "HSE Compliance — regulatory compliance tracking",
  hse_sseg: "SSEG — small-scale embedded generation compliance",
  hse_incidents: "HSE Incidents — incident reporting & investigation",
  project_creation: "Create Project — new project wizard",
  work_items: "Work Items — canonical task/work tracking",
  milestone_tracker: "Milestone Tracker — revenue milestones per project",
  construction: "Construction — construction management & tracking",
  po_approvals: "PO Approvals — purchase order approval board",
  payment_requests: "Payment Requests — payment request board & batches",
  financial_reviews: "Financial Reviews — governance financial review sessions",
  sites: "Sites — site management & map view",
  handover_closeout: "Handover & Closeout — project handover and closeout management",
  pd_pipeline: "Pipeline / Opportunities — PD pipeline tracking",
  pd_handover_queue: "Handover Queue — PD-to-PM handover queue",
  pd_reports: "PD Reports — project development reporting",
  eng_standup: "Engineering Standup — daily standup management",
  report_center: "Report Center — centralized report hub",
  programme_reports: "Programme Reports — programme-level reporting",
  pm_monthly: "PM Monthly — project manager monthly reports",
  eng_monthly: "Engineering Monthly — engineering monthly reports",
  admin_control_center: "Control Center — admin system overview",
  admin_processes: "Processes & SOPs — process documentation management",
  admin_templates: "Templates — phase & document template management",
  admin_recovery: "Recovery — system recovery tools",
  company_team: "Company > Team — workforce directory and utilisation summary",
};

// Registry descriptions win; the static map above covers UI-only entities
// not present in ENTITY_REGISTRY (no backend RBAC gate).
export const ENTITY_DESCRIPTIONS: Record<string, string> = {
  ..._STATIC_ENTITY_DESCRIPTIONS,
  ...Object.fromEntries(ENTITY_REGISTRY.map((e) => [e.entity, e.description])),
};

export const ENTITY_CATEGORIES: Record<string, { label: string; entities: string[] }> = {
  home: {
    label: "Home",
    entities: ["home", "my_work", "my_tool", "meetings", "teams_chat", "collaboration_hub"],
  },
  portfolio: {
    label: "Company",
    entities: ["lifecycle", "company_team", "create_project", "stage_lifecycle", "stage_gate", "stage_exceptions", "stage_dependencies", "stage_config", "stage_admin", "gate_override", "exception"],
  },
  project_dev: {
    label: "Project Development",
    entities: ["pd_dashboard", "pd_pipeline", "pd_tickets", "pd_clients", "pd_handover_queue", "pd_reports", "handover", "project_charter", "client_update"],
  },
  project_delivery: {
    label: "Project Delivery",
    entities: ["projects", "execution_board", "deliverables", "pm_dashboard", "pm_on_the_go", "approvals", "weekly_reviews", "weekly_review_wizard", "portfolios", "portfolio_detail", "tr_register", "handover_acceptance", "standups", "phase_templates", "project_access_mgmt", "project_creation", "work_items", "milestone_tracker", "construction", "po_approvals", "payment_requests", "financial_reviews", "sites", "handover_closeout", "sseg", "hse_sseg"],
  },
  hse: {
    label: "HSE",
    entities: ["hse_dashboard", "hse_compliance", "hse_incidents"],
  },
  engineering: {
    label: "Engineering",
    entities: ["engineering", "eng_tasks", "eng_stages", "eng_standup"],
  },
  quality: {
    label: "Quality",
    entities: ["quality", "commissioning"],
  },
  finance: {
    label: "Finance",
    entities: ["cashflow", "cashflow_forecast", "cos", "cos_control", "revenue_tracker", "revenue", "gp_tracker", "fye_revenue_tracking", "financials", "financial_integration", "financial_linking", "procurement", "counterparties", "subcontractors", "invoice_patterns"],
  },
  reports: {
    label: "Reports",
    entities: ["reports", "report_center", "programme_reports", "pm_monthly", "eng_monthly", "performance", "leaderboard", "department_scores"],
  },
  priorities: {
    label: "Priorities",
    entities: ["company_priorities"],
  },
  admin: {
    label: "Admin",
    entities: ["admin", "admin_control_center", "admin_roles", "integration_health", "smart_import", "data_import", "data_export", "database_migration", "ms_integration", "ms_sync", "activity_log", "audit_trail", "ee_info", "ee_info_lifecycle", "ee_info_departments", "ee_info_processes", "ee_info_templates", "admin_processes", "admin_templates", "admin_recovery", "training", "knowledge_game", "feedback"],
  },
  project_detail: {
    label: "Project Detail Tabs",
    entities: ["pd_overview", "pd_plan", "pd_gantt", "pd_finance", "pd_revenue", "pd_cashflow", "pd_cos_tracker", "pd_expenditure", "pd_history", "pd_key_dates", "pd_quality", "pd_engineering", "pd_eng_tasks", "pd_eng_stages", "pd_collaboration", "pd_subcontractors", "pd_change_control", "pd_commissioning", "pd_dependencies", "pd_raid"],
  },
};

// Auto-inject registry entities that are not yet listed in any category above
// into an "uncategorized" bucket so they appear in the admin UI without manual
// maintenance of this file.
(function () {
  const categorized = new Set(
    Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities),
  );
  const uncategorized = ENTITY_REGISTRY.map((e) => e.entity).filter(
    (entity) => !categorized.has(entity),
  );
  if (uncategorized.length > 0) {
    (ENTITY_CATEGORIES as Record<string, { label: string; entities: string[] }>).uncategorized = {
      label: "Other",
      entities: uncategorized,
    };
  }
})();

export const NAV_SECTION_TO_PERM_CATEGORY: Record<string, string> = {
  HOME: "home",
  PORTFOLIO: "portfolio",
  PROJECT_DEVELOPMENT: "project_dev",
  PROJECT_DELIVERY: "project_delivery",
  HSE: "hse",
  ENGINEERING: "engineering",
  QUALITY: "quality",
  FINANCE: "finance",
  REPORTS: "reports",
  PRIORITIES: "priorities",
  ADMIN: "admin",
};

export const PERM_CATEGORY_TO_NAV_SECTION: Record<string, string> = Object.fromEntries(
  Object.entries(NAV_SECTION_TO_PERM_CATEGORY).map(([k, v]) => [v, k])
);

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

// ── UI/UX audit X3 — shared permission-diff helper ──
// Used by the post-save change summary in the roles surfaces.
export interface PermDiff {
  added: string[];
  removed: string[];
}

function grantedPermissionKeys(
  ep: Record<string, Record<string, boolean>> | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!ep) return out;
  for (const [entity, actions] of Object.entries(ep)) {
    if (entity.startsWith("_")) continue;
    for (const [action, allowed] of Object.entries(actions || {})) {
      if (allowed === true) out.add(`${entity}:${action}`);
    }
  }
  return out;
}

export function computePermDiff(
  before: Record<string, Record<string, boolean>> | null | undefined,
  after: Record<string, Record<string, boolean>> | null | undefined,
): PermDiff {
  const a = grantedPermissionKeys(before);
  const b = grantedPermissionKeys(after);
  const added: string[] = [];
  const removed: string[] = [];
  b.forEach((k) => { if (!a.has(k)) added.push(k); });
  a.forEach((k) => { if (!b.has(k)) removed.push(k); });
  return { added: added.sort(), removed: removed.sort() };
}
