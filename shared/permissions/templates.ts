// Curated role-template library — Task #101.
//
// Each template is a "starter pack" admins can apply to a role with one
// click in the Roles & Permissions UI. The shape mirrors what the
// existing role_permissions.entityPermissions JSON expects:
//
//   { [entity]: { view: bool, create: bool, edit: bool,
//                 approve: bool, override: bool, delete: bool } }
//
// Plain-English `summary` is shown to COO/CEO on the apply screen.
// Categories drive the "gallery" grouping in the Roles tab.

import { ENTITY_REGISTRY } from "./registry";
import type { PermissionAction, PermissionEntity, AppSection } from "../schema/users";

export type EntityPermissionMap = Partial<Record<PermissionEntity, Record<PermissionAction, boolean>>>;

export interface RoleTemplateDef {
  key: string;
  name: string;
  category: "Executive" | "Finance" | "Delivery" | "Engineering" | "Quality & HSE" | "Project Development" | "Operations";
  summary: string;
  /** AppSection keys this template grants. */
  sections: AppSection[];
  /** The role this template targets (or 'CUSTOM' for one-offs). */
  baseRole?: string;
  /** Permission overrides — built from the registry by buildPermissionsForRoles(). */
  permissions: EntityPermissionMap;
}

const ALL_ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

/**
 * Snapshot the registry's defaults for a single role into the
 * `entityPermissions` shape consumed by the resolver / DB column.
 * Templates use this so a "Project Manager" template stays in sync
 * with the registry defaults for that role automatically.
 */
export function buildPermissionsForRole(role: string): EntityPermissionMap {
  const out: EntityPermissionMap = {};
  for (const entry of ENTITY_REGISTRY) {
    const row: Record<PermissionAction, boolean> = {} as any;
    for (const action of ALL_ACTIONS) {
      const key = `${action}_roles` as const;
      const list = (entry as any)[key] as string[] | undefined;
      row[action] = !!list?.includes(role);
    }
    out[entry.entity] = row;
  }
  return out;
}

/**
 * Layer two role defaults — the second role's grants are unioned on
 * top of the first. Used for the "Executive" template that wants the
 * superset of CEO_ADMIN + COO_ADMIN.
 */
function unionPermissions(a: EntityPermissionMap, b: EntityPermissionMap): EntityPermissionMap {
  const out: EntityPermissionMap = { ...a };
  for (const entity of Object.keys(b) as PermissionEntity[]) {
    const existing = out[entity] ?? ({} as Record<PermissionAction, boolean>);
    const incoming = b[entity]!;
    const merged: Record<PermissionAction, boolean> = { ...existing } as any;
    for (const action of ALL_ACTIONS) {
      merged[action] = !!existing[action] || !!incoming[action];
    }
    out[entity] = merged;
  }
  return out;
}

const COO = buildPermissionsForRole("COO_ADMIN");
const CEO = buildPermissionsForRole("CEO_ADMIN");
const EXEC = unionPermissions(COO, CEO);

export const ROLE_TEMPLATES: RoleTemplateDef[] = [
  {
    key: "executive_full",
    name: "Executive (CEO / COO)",
    category: "Executive",
    summary: "Full access to every workspace, settings, role management, and approvals. Use for the CEO and COO only.",
    baseRole: "COO_ADMIN",
    sections: ["HOME","PORTFOLIO","PROJECT_DEVELOPMENT","PROJECT_DELIVERY","ENGINEERING","QUALITY","HSE","FINANCE","REPORTS","ADMIN"],
    permissions: EXEC,
  },
  {
    key: "cfo_full",
    name: "CFO — Financial Oversight",
    category: "Executive",
    summary: "Full financial oversight: cashflow, COS, revenue, GP, integration. View of delivery and reports. No admin or role management.",
    baseRole: "CFO",
    sections: ["HOME","PORTFOLIO","FINANCE","PROJECT_DELIVERY","REPORTS"],
    permissions: buildPermissionsForRole("CFO"),
  },
  {
    key: "finance_read_only",
    name: "Finance — Read-Only",
    category: "Finance",
    summary: "Look-only access to cashflow, COS, revenue, and GP. Can run reports but cannot edit, approve, or override anything.",
    sections: ["HOME","FINANCE","REPORTS"],
    permissions: (() => {
      const base = buildPermissionsForRole("ACCOUNTANT");
      const out: EntityPermissionMap = {};
      for (const entity of Object.keys(base) as PermissionEntity[]) {
        const row = base[entity]!;
        out[entity] = {
          view: row.view,
          create: false,
          edit: false,
          approve: false,
          override: false,
          delete: false,
        };
      }
      return out;
    })(),
  },
  {
    key: "program_manager",
    name: "Program Manager",
    category: "Delivery",
    summary: "Cross-project delivery: portfolio, gates, escalations, finance review. Can approve at gates but not change financial integrations.",
    baseRole: "PROGRAM_MANAGER",
    sections: ["HOME","PORTFOLIO","PROJECT_DELIVERY","QUALITY","HSE","FINANCE","REPORTS"],
    permissions: buildPermissionsForRole("PROGRAM_MANAGER"),
  },
  {
    key: "program_finance_manager",
    name: "Program Finance Manager",
    category: "Finance",
    summary: "Program-finance lead: invoicing, forecasting, collections, COS overrides. Read access to delivery.",
    baseRole: "PROGRAM_FINANCE_MANAGER",
    sections: ["HOME","PORTFOLIO","FINANCE","PROJECT_DELIVERY","REPORTS"],
    permissions: buildPermissionsForRole("PROGRAM_FINANCE_MANAGER"),
  },
  {
    key: "project_manager",
    name: "Project Manager (Site)",
    category: "Delivery",
    summary: "Owns assigned projects end-to-end on site: tasks, milestones, approvals, quality, HSE, project finance read.",
    baseRole: "PROJECT_MANAGER_SITE",
    sections: ["HOME","PROJECT_DELIVERY","QUALITY","HSE","FINANCE","REPORTS"],
    permissions: buildPermissionsForRole("PROJECT_MANAGER_SITE"),
  },
  {
    key: "project_developer",
    name: "Project Developer",
    category: "Project Development",
    summary: "Project Development — pipeline, opportunities, cost proposals, client relations. No delivery or admin.",
    baseRole: "PROJECT_DEVELOPER",
    sections: ["HOME","PROJECT_DEVELOPMENT","FINANCE"],
    permissions: buildPermissionsForRole("PROJECT_DEVELOPER"),
  },
  {
    key: "engineer",
    name: "Engineer",
    category: "Engineering",
    summary: "Engineering team member — tasks, deliverables, design reviews, stage checklists. No finance or admin.",
    baseRole: "ENGINEER",
    sections: ["HOME","ENGINEERING","QUALITY"],
    permissions: buildPermissionsForRole("ENGINEER"),
  },
  {
    key: "engineering_manager",
    name: "Engineering Manager",
    category: "Engineering",
    summary: "Engineering lead — design ownership, approvals, deliverables, project engineering tabs.",
    baseRole: "ENGINEERING_MANAGER",
    sections: ["HOME","ENGINEERING","QUALITY","PROJECT_DELIVERY","REPORTS"],
    permissions: buildPermissionsForRole("ENGINEERING_MANAGER"),
  },
  {
    key: "construction_manager",
    name: "Construction Manager",
    category: "Delivery",
    summary: "Construction delivery — sites, milestones, inflow planning, procurement, HSE. Project finance read.",
    baseRole: "CONSTRUCTION_MANAGER",
    sections: ["HOME","PROJECT_DELIVERY","FINANCE","QUALITY","HSE","REPORTS"],
    permissions: buildPermissionsForRole("CONSTRUCTION_MANAGER"),
  },
  {
    key: "qa_hse",
    name: "Quality & HSE Manager",
    category: "Quality & HSE",
    summary: "Quality and HSE workspace — NCRs, audits, incidents, corrective actions, inspections. Project delivery read.",
    baseRole: "QUALITY_MANAGER",
    sections: ["HOME","QUALITY","HSE","PROJECT_DELIVERY","REPORTS"],
    permissions: unionPermissions(
      buildPermissionsForRole("QUALITY_MANAGER"),
      buildPermissionsForRole("HSE_MANAGER"),
    ),
  },
  {
    key: "accountant",
    name: "Accountant",
    category: "Finance",
    summary: "Finance team member — cashflow, COS tracking, invoice management, reconciliation.",
    baseRole: "ACCOUNTANT",
    sections: ["HOME","FINANCE"],
    permissions: buildPermissionsForRole("ACCOUNTANT"),
  },
  {
    key: "sseg_manager",
    name: "SSEG Manager",
    category: "Operations",
    summary: "Authority and SSEG application tracker — queries, compliance, engineering coordination.",
    baseRole: "SSEG_MANAGER",
    sections: ["HOME","HSE","QUALITY","ENGINEERING"],
    permissions: buildPermissionsForRole("SSEG_MANAGER"),
  },
];

export function findRoleTemplate(key: string): RoleTemplateDef | undefined {
  return ROLE_TEMPLATES.find((t) => t.key === key);
}
