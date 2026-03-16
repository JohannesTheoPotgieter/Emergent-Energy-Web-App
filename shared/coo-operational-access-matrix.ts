import type { PermissionAction, PermissionEntity } from "./schema";

export type OperationalDomain =
  | "projects"
  | "project_development"
  | "engineering"
  | "quality"
  | "project_management"
  | "procurement"
  | "project_finance"
  | "hse_compliance"
  | "admin_config";

export interface DomainAccessSpec {
  domain: OperationalDomain;
  entities: PermissionEntity[];
  requiredActions: PermissionAction[];
  discoverablePaths: string[];
}

const FULL_OPERATIONAL_ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "delete"];

export const COO_OPERATIONAL_ACCESS_MATRIX: DomainAccessSpec[] = [
  {
    domain: "projects",
    entities: ["projects", "lifecycle", "execution_board", "portfolios"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/projects", "/lifecycle-board", "/dashboard", "/portfolios"],
  },
  {
    domain: "project_development",
    entities: ["pd_dashboard", "pd_tickets", "pd_overview", "pd_plan"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/pd", "/pd/tickets"],
  },
  {
    domain: "engineering",
    entities: ["engineering", "eng_tasks", "eng_stages", "work_items"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/engineering", "/engineering/tasks"],
  },
  {
    domain: "quality",
    entities: ["quality", "governance", "pd_quality"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/quality", "/project/:projectName"],
  },
  {
    domain: "project_management",
    entities: ["pm_dashboard", "weekly_review_wizard", "pm_on_the_go", "tr_register"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/pm-dashboard", "/weekly-reviews", "/pm/on-the-go"],
  },
  {
    domain: "procurement",
    entities: ["procurement", "subcontractors"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/subcontractor-dashboard"],
  },
  {
    domain: "project_finance",
    entities: ["financials", "cashflow", "cos", "revenue_tracker", "gp_tracker", "pd_finance"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker"],
  },
  {
    domain: "hse_compliance",
    entities: ["quality", "governance", "audit_trail"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/quality", "/admin/activity-log"],
  },
  {
    domain: "admin_config",
    entities: ["admin", "admin_roles", "phase_templates", "financial_integration"],
    requiredActions: FULL_OPERATIONAL_ACTIONS,
    discoverablePaths: ["/admin", "/admin/control-center", "/admin/roles", "/admin/settings"],
  },
];

export const COO_OPERATIONAL_ENTITIES = Array.from(
  new Set(COO_OPERATIONAL_ACCESS_MATRIX.flatMap((domain) => domain.entities)),
);
