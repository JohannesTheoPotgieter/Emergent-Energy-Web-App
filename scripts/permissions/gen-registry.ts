#!/usr/bin/env tsx
/**
 * One-shot generator — Task #101.
 *
 * Reads the existing ENTITY_PERMISSION_DEFAULTS and produces
 * `shared/permissions/registry.ts` with plain-English titles,
 * descriptions, and category labels so COO/CEO can read the matrix
 * without a translator.
 *
 * Plain-English copy is sourced from the same map already used by the
 * admin-roles page (kept in sync), with a fallback that titlecases the
 * entity key.
 *
 * Run once after editing this script:
 *   npx tsx scripts/permissions/gen-registry.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ENTITY_PERMISSION_DEFAULTS, type EntityPermissionRule } from "@shared/schema";

// ────────────────────────────────────────────────────────────────────
// Plain-English titles + descriptions (single source of truth — the
// admin-roles page now imports from here).
// ────────────────────────────────────────────────────────────────────

const DESCRIPTIONS: Record<string, string> = {
  home: "Home page dashboard & landing",
  my_work: "My Work hub — tasks, calendar, meetings",
  my_tool: "My Work task planner (Today, Week, Backlog)",
  company_priorities: "Company-wide priorities & goals",
  lifecycle: "Project Lifecycle overview & board",
  create_project: "Create new project from lifecycle",
  pd_clients: "Clients list & client overview",
  pd_dashboard: "Project Development Dashboard — pipeline overview",
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
  collaboration_hub: "Collaboration Hub — files & communication",
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
  pd_raid: "Project detail > RAID log",
  hse: "HSE — health & safety operations",
  hse_dashboard: "HSE Dashboard — incidents, audits, KPIs",
  hse_compliance: "HSE Compliance — regulatory & corrective actions",
  hse_sseg: "HSE > SSEG — small-scale embedded generation tracking",
  hse_incidents: "HSE Incidents — incident reports & investigations",
  performance: "Performance — team / project performance tracking",
  opportunities: "Opportunities — sales pipeline & deals",
  stage_lifecycle: "Stage Lifecycle — phase tracking",
  stage_gate: "Stage Gate — phase-gate evaluation",
  stage_exceptions: "Stage Exceptions — stage exception requests",
  stage_dependencies: "Stage Dependencies — cross-stage links",
  stage_config: "Stage Config — stage configuration",
  stage_admin: "Stage Admin — stage administration",
  gate_override: "Gate Override — phase-gate override controls",
  exception: "Exceptions — general exception workflow",
  project_charter: "Project Charter — initial project authorisation",
  client_update: "Client Update — client-facing status",
  handover_acceptance: "Handover Acceptance — accepting incoming handover",
  project_access_mgmt: "Project Access — manage project membership",
  project_creation: "Create Project — new project wizard",
  work_items: "Work Items — canonical task/work tracking",
  company_team: "Company Team — staff directory",
};

// Categories shown in the admin UI. Each entity belongs to exactly one.
const CATEGORIES = {
  HOME: "Home & Personal",
  COMPANY: "Company & Lifecycle",
  PD: "Project Development",
  DELIVERY: "Project Delivery",
  ENGINEERING: "Engineering",
  QUALITY_HSE: "Quality & HSE",
  FINANCE: "Finance",
  REPORTING: "Reporting & Knowledge",
  ADMIN: "Administration",
  PROJECT_DETAIL: "Project Detail Tabs",
} as const;
type CategoryKey = keyof typeof CATEGORIES;

const CATEGORY_BY_ENTITY: Record<string, CategoryKey> = {
  home: "HOME", my_work: "HOME", my_tool: "HOME", meetings: "HOME",
  teams_chat: "HOME", collaboration_hub: "HOME", company_priorities: "HOME",
  feedback: "HOME", company_team: "HOME",

  lifecycle: "COMPANY", create_project: "COMPANY", project_creation: "COMPANY",
  stage_lifecycle: "COMPANY", stage_gate: "COMPANY", stage_exceptions: "COMPANY",
  stage_dependencies: "COMPANY", stage_config: "COMPANY", stage_admin: "COMPANY",
  gate_override: "COMPANY", exception: "COMPANY", phase_templates: "COMPANY",

  pd_dashboard: "PD", pd_tickets: "PD", pd_clients: "PD",
  handover: "PD", project_charter: "PD", client_update: "PD",
  opportunities: "PD",

  projects: "DELIVERY", execution_board: "DELIVERY", deliverables: "DELIVERY",
  pm_dashboard: "DELIVERY", pm_on_the_go: "DELIVERY", approvals: "DELIVERY",
  weekly_reviews: "DELIVERY", weekly_review_wizard: "DELIVERY",
  portfolios: "DELIVERY", portfolio_detail: "DELIVERY", tr_register: "DELIVERY",
  handover_acceptance: "DELIVERY", commissioning: "DELIVERY",
  task_management: "DELIVERY", standups: "DELIVERY",
  project_access_mgmt: "DELIVERY", work_items: "DELIVERY",

  engineering: "ENGINEERING", eng_tasks: "ENGINEERING", eng_stages: "ENGINEERING",

  quality: "QUALITY_HSE",
  hse: "QUALITY_HSE", hse_dashboard: "QUALITY_HSE",
  hse_compliance: "QUALITY_HSE", hse_sseg: "QUALITY_HSE",
  hse_incidents: "QUALITY_HSE",

  cashflow: "FINANCE", cashflow_forecast: "FINANCE", cos: "FINANCE",
  cos_control: "FINANCE", revenue_tracker: "FINANCE", revenue: "FINANCE",
  gp_tracker: "FINANCE", fye_revenue_tracking: "FINANCE",
  financials: "FINANCE", financial_integration: "FINANCE",
  financial_linking: "FINANCE", procurement: "FINANCE",
  counterparties: "FINANCE", subcontractors: "FINANCE",
  invoice_patterns: "FINANCE",

  reports: "REPORTING", performance: "REPORTING",
  leaderboard: "REPORTING", department_scores: "REPORTING",
  ee_info: "REPORTING", ee_info_lifecycle: "REPORTING",
  ee_info_departments: "REPORTING", ee_info_processes: "REPORTING",
  ee_info_templates: "REPORTING", training: "REPORTING",
  knowledge_game: "REPORTING",

  admin: "ADMIN", admin_roles: "ADMIN", smart_import: "ADMIN",
  data_import: "ADMIN", data_export: "ADMIN", database_migration: "ADMIN",
  ms_integration: "ADMIN", ms_sync: "ADMIN",
  activity_log: "ADMIN", audit_trail: "ADMIN",

  pd_overview: "PROJECT_DETAIL", pd_plan: "PROJECT_DETAIL",
  pd_gantt: "PROJECT_DETAIL", pd_finance: "PROJECT_DETAIL",
  pd_revenue: "PROJECT_DETAIL", pd_cashflow: "PROJECT_DETAIL",
  pd_cos_tracker: "PROJECT_DETAIL", pd_expenditure: "PROJECT_DETAIL",
  pd_history: "PROJECT_DETAIL", pd_key_dates: "PROJECT_DETAIL",
  pd_quality: "PROJECT_DETAIL", pd_engineering: "PROJECT_DETAIL",
  pd_eng_tasks: "PROJECT_DETAIL", pd_eng_stages: "PROJECT_DETAIL",
  pd_collaboration: "PROJECT_DETAIL", pd_subcontractors: "PROJECT_DETAIL",
  pd_change_control: "PROJECT_DETAIL", pd_commissioning: "PROJECT_DETAIL",
  pd_dependencies: "PROJECT_DETAIL", pd_raid: "PROJECT_DETAIL",
};

function titleFromEntity(entity: string): string {
  return entity
    .replace(/^pd_/, "Project ")
    .replace(/^eng_/, "Engineering ")
    .replace(/^ms_/, "Microsoft ")
    .replace(/^hse_/, "HSE ")
    .replace(/^ee_info_/, "Knowledge: ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function quoteArr(arr: string[]): string {
  if (arr.length === 0) return "[]";
  return `[${arr.map((r) => `'${r}'`).join(", ")}]`;
}

function generate(): string {
  const lines: string[] = [];
  lines.push("// AUTO-GENERATED by scripts/permissions/gen-registry.ts — DO NOT EDIT BY HAND.");
  lines.push("// Edit DESCRIPTIONS / CATEGORY_BY_ENTITY in the generator and re-run, OR");
  lines.push("// edit ENTITY_PERMISSION_DEFAULTS in this file directly (canonical source).");
  lines.push("// Companion: shared/permissions/registry-meta.ts (manually edited).");
  lines.push("//");
  lines.push("// Owns the master entity-permission table for every protected resource.");
  lines.push("// `shared/schema/users.ts` re-exports ENTITY_PERMISSION_DEFAULTS from here so");
  lines.push("// every existing import path keeps working (1,068 backend call sites).");
  lines.push("");
  lines.push("import type { EntityPermissionRule, PermissionEntity } from '../schema/users';");
  lines.push("");
  lines.push(`export const PERMISSION_CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)} as const;`);
  lines.push("export type PermissionCategoryKey = keyof typeof PERMISSION_CATEGORIES;");
  lines.push("");
  lines.push("export interface EntityRegistryEntry extends EntityPermissionRule {");
  lines.push("  /** Plain-English heading (Title Case) shown in the admin UI. */");
  lines.push("  title: string;");
  lines.push("  /** One-line description shown under the title. */");
  lines.push("  description: string;");
  lines.push("  /** Grouping for the admin matrix. */");
  lines.push("  category: PermissionCategoryKey;");
  lines.push("}");
  lines.push("");
  lines.push("/**");
  lines.push(" * The ONE canonical entity registry.");
  lines.push(" * Adding a new protected resource? Add an entry here, then add it to");
  lines.push(" * the PermissionEntity union in shared/schema/users.ts.");
  lines.push(" */");
  lines.push("export const ENTITY_REGISTRY: EntityRegistryEntry[] = [");
  for (const rule of ENTITY_PERMISSION_DEFAULTS as EntityPermissionRule[]) {
    const e = rule.entity;
    const title = titleFromEntity(e);
    const description = (DESCRIPTIONS as Record<string, string>)[e] ?? title;
    const category = CATEGORY_BY_ENTITY[e] ?? "ADMIN";
    lines.push("  {");
    lines.push(`    entity: '${e}',`);
    lines.push(`    title: ${JSON.stringify(title)},`);
    lines.push(`    description: ${JSON.stringify(description)},`);
    lines.push(`    category: '${category}',`);
    lines.push(`    view_roles: ${quoteArr(rule.view_roles)},`);
    lines.push(`    create_roles: ${quoteArr(rule.create_roles)},`);
    lines.push(`    edit_roles: ${quoteArr(rule.edit_roles)},`);
    lines.push(`    approve_roles: ${quoteArr(rule.approve_roles)},`);
    lines.push(`    override_roles: ${quoteArr(rule.override_roles)},`);
    lines.push(`    delete_roles: ${quoteArr(rule.delete_roles)},`);
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  lines.push("/**");
  lines.push(" * Backwards-compat export — the array shape consumed by");
  lines.push(" * `shared/permission-resolver.ts` and 1,068 other call sites.");
  lines.push(" * Do NOT change the field set here without updating the resolver.");
  lines.push(" */");
  lines.push("export const ENTITY_PERMISSION_DEFAULTS: EntityPermissionRule[] = ENTITY_REGISTRY.map(");
  lines.push("  ({ title, description, category, ...rest }) => rest,");
  lines.push(");");
  lines.push("");
  lines.push("export function findEntityRegistry(entity: PermissionEntity): EntityRegistryEntry | undefined {");
  lines.push("  return ENTITY_REGISTRY.find((e) => e.entity === entity);");
  lines.push("}");
  lines.push("");
  lines.push("export function entityTitle(entity: PermissionEntity): string {");
  lines.push("  return findEntityRegistry(entity)?.title ?? entity;");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const out = path.join(process.cwd(), "shared/permissions/registry.ts");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, generate());
console.log(`[gen-registry] wrote ${out} (${ENTITY_PERMISSION_DEFAULTS.length} entities)`);
