import { pgTable, pgSchema, text, integer, timestamp, serial, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { ENTITY_PERMISSION_DEFAULTS, rolesForCategoryAction } from "../permissions/registry";
export { ENTITY_PERMISSION_DEFAULTS } from "../permissions/registry";
export { ENTITY_REGISTRY, PERMISSION_CATEGORIES, findEntityRegistry, entityTitle, rolesForCategoryAction } from "../permissions/registry";
export type { EntityRegistryEntry, PermissionCategoryKey } from "../permissions/registry";

/**
 * Task #101 — structural type for the JSONB permission map columns
 * (`role_permissions.entity_permissions`, `role_templates.permissions`).
 * Declared inline so this file does not depend on `permissions/templates.ts`
 * (which would create a circular import). Service-layer code can cast its
 * own typed `EntityPermissionMap` to this without resorting to `as any`.
 */
export type EntityPermissionsJson = Record<string, Partial<Record<string, boolean>>>;

// ===================== ORGANIZATIONS (Prompt 11 — Multi-tenancy) =====================
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
});
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default('member'),
  department: text("department"),
  // Free-text office / region location (e.g. "Cape Town", "Johannesburg",
  // "Remote — South Africa"). Surfaced on the Company Team page; editable
  // by admins from the Roles & Permissions > Users tab. Added 2026-04-24
  // by migration 0033_users_location.sql for task #97.
  location: text("location"),
  microsoft_id: text("microsoft_id").unique(),
  // Task #110 — admin-controlled active/inactive flag. `true` (default)
  // means the account can sign in normally; `false` blocks login at the
  // password and Microsoft callback paths and rejects bearer/session
  // checks. Distinct from `deletedAt` (full soft-delete): an inactive
  // user is temporarily disabled and can be re-enabled with one click.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true } as any);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Error Logs
export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  route: text("route"),
  action: text("action"),
  correlationId: text("correlation_id").notNull(),
  errorMessage: text("error_message").notNull(),
  errorStack: text("error_stack"),
  payloadShape: text("payload_shape"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({ id: true, createdAt: true } as any);
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;
export type ErrorLog = typeof errorLogs.$inferSelect;

// ===================== CORE SCHEMA: DEPARTMENTS + ROLE DEFINITIONS (Phase A.1) =====================

const coreSchema = pgSchema("core");

export const departments = coreSchema.table("departments", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Department = typeof departments.$inferSelect;
export type InsertDepartment = typeof departments.$inferInsert;

export const roleDefinitions = coreSchema.table("role_definitions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  departmentId: integer("department_id").notNull().references(() => departments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type RoleDefinition = typeof roleDefinitions.$inferSelect;
export type InsertRoleDefinition = typeof roleDefinitions.$inferInsert;

// ===================== COMPANY ROLES (Part A) =====================

export const COMPANY_ROLES = [
  'COO_ADMIN',
  'CEO_ADMIN',
  'CCO',
  'CFO',
  'PROGRAM_MANAGER',
  'PROGRAM_FINANCE_MANAGER',
  'CONSTRUCTION_MANAGER',
  'QUALITY_MANAGER',
  'ENGINEERING_MANAGER',
  'KEY_ACCOUNTS_MANAGER',
  'ACCOUNTANT',
  'ENGINEER',
  'PROJECT_MANAGER_SITE',
  'PROJECT_DEVELOPER',
  // New roles added by role-based UX upgrade
  'HSE_MANAGER',
  'SSEG_MANAGER',
] as const;
export type CompanyRole = typeof COMPANY_ROLES[number];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  COO_ADMIN: "COO",
  CEO_ADMIN: "CEO",
  CCO: "CCO",
  CFO: "CFO",
  PROGRAM_MANAGER: "Program Manager",
  PROGRAM_FINANCE_MANAGER: "Program Finance Manager",
  CONSTRUCTION_MANAGER: "Construction Manager",
  QUALITY_MANAGER: "Quality Manager",
  ENGINEERING_MANAGER: "Engineering Manager",
  KEY_ACCOUNTS_MANAGER: "Key Accounts Manager",
  ACCOUNTANT: "Accountant",
  ENGINEER: "Engineer",
  PROJECT_MANAGER_SITE: "Project Manager",
  PROJECT_DEVELOPER: "Project Developer",
  HSE_MANAGER: "HSE Manager",
  SSEG_MANAGER: "SSEG Manager",
};

export const ADMIN_ROLES: CompanyRole[] = ['COO_ADMIN', 'CEO_ADMIN'];

// ===================== ROLE PERMISSION GROUPS =====================
// Use these groups when defining or updating entity permissions.
// When a new role is added, update the relevant groups here — all entity
// defaults that reference a group will automatically pick up the change.

/** Every company role — use for entities all staff should access (home, feedback, my_work, etc.) */
export const ALL_STAFF_ROLES: string[] = [...COMPANY_ROLES];

// ===================== DERIVED ROLE GROUPS (Task #101) =====================
//
// These nine groups used to be hand-maintained literal arrays that drifted
// out of sync with `shared/permissions/registry.ts`. They are now DERIVED
// from the registry at module-load time via `rolesForCategoryAction()`,
// which unions the `<action>_roles` of every entry whose `category` matches.
//
// Adding (or removing) a registry entry now automatically expands (or
// contracts) the matching group. Export NAMES are preserved so the 394
// existing call sites continue to work; values are now registry-derived.
//
// NOTE: these arrays are no longer the authoritative gate — every backend
// route reaches `requirePermission(entity, action)`, which consults
// `entityPermissions` directly. These groups remain useful as plain-English
// shorthands for fallback / legacy display code, with the guarantee that
// they cannot drift from the registry.

/** Finance-view roles — can see financial dashboards, cashflow, revenue, COS, GP */
export const FINANCE_VIEW_ROLES: readonly string[] = rolesForCategoryAction('FINANCE', 'view');

/** Finance-edit roles — can create/edit financial records */
export const FINANCE_EDIT_ROLES: readonly string[] = rolesForCategoryAction('FINANCE', 'edit');

/** Engineering-view roles — can see engineering dashboards, tasks, stages */
export const ENG_VIEW_ROLES: readonly string[] = rolesForCategoryAction('ENGINEERING', 'view');

/** Engineering-edit roles — can create/edit engineering items */
export const ENG_EDIT_ROLES: readonly string[] = rolesForCategoryAction('ENGINEERING', 'edit');

/** Quality & HSE view roles — can see quality, HSE, compliance dashboards */
export const QUALITY_HSE_VIEW_ROLES: readonly string[] = rolesForCategoryAction('QUALITY_HSE', 'view');

/** Quality & HSE edit roles — can create/edit quality/HSE items */
export const QUALITY_HSE_EDIT_ROLES: readonly string[] = rolesForCategoryAction('QUALITY_HSE', 'edit');

/** Project delivery view roles — can see projects, construction, tasks, milestones */
export const DELIVERY_VIEW_ROLES: readonly string[] = rolesForCategoryAction('DELIVERY', 'view');

/** Project development view roles — can see PD dashboard, tickets, pipeline */
export const PD_VIEW_ROLES: readonly string[] = rolesForCategoryAction('PD', 'view');

/** Project development edit roles — can create/edit PD items */
export const PD_EDIT_ROLES: readonly string[] = rolesForCategoryAction('PD', 'edit');

export const roleCredentials = pgTable("role_credentials", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertRoleCredentialSchema = createInsertSchema(roleCredentials).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRoleCredential = z.infer<typeof insertRoleCredentialSchema>;
export type RoleCredential = typeof roleCredentials.$inferSelect;

// ===================== APP SETTINGS (Part A) =====================

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AppSetting = typeof appSettings.$inferSelect;

// ===================== UNIFIED ROLE PERMISSIONS =====================

export const APP_SECTIONS = [
  // Current 11-section navigation model
  'HOME',
  'PORTFOLIO',
  'PRIORITIES',
  'PROJECT_DEVELOPMENT',
  'PROJECT_DELIVERY',
  'ENGINEERING',
  'QUALITY',
  'HSE',
  'FINANCE',
  'REPORTS',
  'ADMIN',
  // Legacy keys kept for backward compatibility with existing DB records
  'QUALITY_HSE',
  'MY_WORK',
  'PROJECTS',
  'EXCO',
  'PROJECT_MANAGEMENT',
  'MY_TOOL',
  'OPERATIONS',
  'GOVERNANCE',
  'COCKPIT',
  'MONEY',
  'COLLABORATION',
  'INFORMATION',
  'GATES',
] as const;
export type AppSection = typeof APP_SECTIONS[number];

export const APP_SECTION_LABELS: Record<AppSection, string> = {
  // Current 11-section model
  HOME: "Home",
  PORTFOLIO: "Portfolio (Lifecycle, Gates, Programme)",
  PRIORITIES: "Priorities (My, Department, Company)",
  PROJECT_DEVELOPMENT: "Project Development (Pipeline, Clients, Handovers)",
  PROJECT_DELIVERY: "Project Delivery (Execution, Projects, Construction, Procurement, Milestones)",
  ENGINEERING: "Engineering (Design, Tasks, Reviews)",
  QUALITY: "Quality (Inspections, NCRs, Checklists)",
  HSE: "HSE (Health, Safety & Environment, Compliance)",
  FINANCE: "Finance (Cashflow, Revenue, COS, Billing)",
  REPORTS: "Reports (PM, Engineering, Programme, Performance)",
  ADMIN: "Admin (Settings, Templates, Import)",
  // Legacy labels (kept for backward compat with existing DB records)
  QUALITY_HSE: "Quality & HSE (legacy combined)",
  MY_WORK: "My Work (Tasks, Approvals, Inbox)",
  PROJECTS: "Projects (legacy)",
  EXCO: "Executive (legacy)",
  PROJECT_MANAGEMENT: "Project Management (legacy)",
  MY_TOOL: "My Tool (legacy)",
  OPERATIONS: "Operations (legacy)",
  GOVERNANCE: "Quality (legacy)",
  COCKPIT: "Home (legacy)",
  MONEY: "Finance (legacy)",
  COLLABORATION: "Collaboration (legacy)",
  INFORMATION: "Knowledge (legacy)",
  GATES: "Gates (legacy)",
};

export const UX_REDESIGN_ENABLED = true;

export type PermissionEntity = 'projects' | 'financials' | 'quality' | 'hse' | 'engineering' | 'procurement' | 'admin'
  | 'cos' | 'cashflow' | 'smart_import' | 'tr_register' | 'pm_dashboard'
  | 'eng_stages' | 'eng_tasks' | 'lifecycle' | 'my_tool' | 'create_project'
  | 'weekly_reviews' | 'ee_info'
  | 'execution_board' | 'leaderboard' | 'training' | 'knowledge_game' | 'department_scores' | 'feedback' | 'approvals' | 'activity_log'
  | 'company_priorities' | 'meetings' | 'phase_templates' | 'invoice_patterns'
  | 'portfolios' | 'subcontractors' | 'cos_control' | 'cashflow_forecast' | 'home'
  | 'pd_overview' | 'pd_plan' | 'pd_finance' | 'pd_engineering' | 'pd_quality' | 'pd_history'
  | 'pd_revenue' | 'pd_expenditure' | 'pd_cos_tracker' | 'pd_cashflow' | 'pd_subcontractors'
  | 'pd_eng_tasks' | 'pd_eng_stages' | 'pd_gantt' | 'pd_key_dates'
  | 'pd_tickets' | 'pd_dashboard' | 'pd_clients' | 'opportunities'
  | 'portfolio_detail' | 'admin_roles' | 'revenue'
  | 'ee_info_lifecycle' | 'ee_info_departments' | 'ee_info_processes' | 'ee_info_templates'
  | 'teams_chat' | 'financial_integration' | 'pd_collaboration'
  | 'pm_on_the_go' | 'weekly_review_wizard' | 'project_creation' | 'financial_linking'
  | 'collaboration_hub' | 'deliverables'
  | 'data_import' | 'data_export' | 'audit_trail'
  | 'ms_integration'
  | 'my_work' | 'ms_sync' | 'database_migration'
  | 'revenue_tracker' | 'gp_tracker' | 'work_items'
  | 'task_management' | 'standups' | 'fye_revenue_tracking' | 'reports'
  | 'handover' | 'commissioning' | 'counterparties'
  | 'pd_change_control' | 'pd_commissioning' | 'pd_dependencies' | 'pd_raid'
  | 'stage_lifecycle' | 'stage_exceptions' | 'stage_dependencies' | 'stage_admin'
  | 'stage_gate' | 'exception' | 'stage_config' | 'gate_override'
  | 'project_charter' | 'client_update' | 'handover_acceptance'
  | 'performance' | 'project_access_mgmt'
  | 'hse_dashboard' | 'hse_compliance' | 'hse_sseg' | 'hse_incidents'
  | 'company_team'
  | 'documents' | 'documents_provision' | 'documents_admin'
  | 'company_team'
  | 'excel_vs_app';
export type PermissionAction = 'view' | 'create' | 'edit' | 'approve' | 'override' | 'delete';
export const AUTHORITY_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'assign',
  'reassign',
  'close_complete',
  'export',
  'manage_settings',
] as const;
export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number];

export const AUTHORITY_SCOPES = ['own', 'department', 'assigned_projects', 'all_projects', 'company_admin'] as const;
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

export const ROLE_PERMISSION_ALIASES: Record<string, string> = {
  admin: "COO_ADMIN",
  COO: "COO_ADMIN",
  // New lens role aliases — resolve to existing DB roles for permission checks
  COO_SUPER_ADMIN: "COO_ADMIN",
  CEO: "CEO_ADMIN",
  HEAD_OF_PROJECT_DEVELOPMENT: "CCO",
  PROJECT_MANAGER: "PROJECT_MANAGER_SITE",
  // HSE_MANAGER and SSEG_MANAGER are real company roles — no alias needed
};

export function normalizeRoleForPermissions(role?: string | null): string {
  if (!role) return "";
  return ROLE_PERMISSION_ALIASES[role] || role;
}

export interface EntityPermissionRule {
  entity: PermissionEntity;
  view_roles: string[];
  create_roles: string[];
    edit_roles: string[];
  approve_roles: string[];
  override_roles: string[];
  delete_roles: string[];
}

// ENTITY_PERMISSION_DEFAULTS now lives in shared/permissions/registry.ts
// (canonical source). It is re-exported above so every existing import keeps
// working — see the registry file for entity titles, descriptions, and categories.

export function checkPermission(role: string, entity: PermissionEntity, action: PermissionAction): boolean {
  const normalizedRole = normalizeRoleForPermissions(role);
  const rule = ENTITY_PERMISSION_DEFAULTS.find(r => r.entity === entity);
  if (!rule) return false;
  const actionKey = `${action}_roles` as keyof EntityPermissionRule;
  const allowedRoles = rule[actionKey] as string[];
  return allowedRoles.includes(normalizedRole);
}

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  sections: text("sections").array().notNull().default([]),
  canManageUsers: boolean("can_manage_users").notNull().default(false),
  canManageRoles: boolean("can_manage_roles").notNull().default(false),
  canEditData: boolean("can_edit_data").notNull().default(true),
  // Task #101: typed wrapper so callers don't need `as any` to write the JSON.
  entityPermissions: jsonb("entity_permissions").$type<EntityPermissionsJson>(),
  authorityModel: jsonb("authority_model"),
  isSystem: boolean("is_system").notNull().default(false),
  permissionVersion: integer("permission_version").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;



// ===================== ROLE TEMPLATES =====================

/**
 * Curated role templates ("starter packs") shown in the Roles & Permissions
 * admin UI. Each template captures plain-English summary plus the entity
 * permissions and section access. Seeded on boot from
 * shared/permissions/templates.ts. NEW table — additive.
 */
export const roleTemplates = pgTable("role_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  category: text("category").notNull(),
  permissions: jsonb("permissions").$type<EntityPermissionsJson>().notNull(),
  sections: text("sections").array().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(true),
  seededAt: timestamp("seeded_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertRoleTemplateSchema = createInsertSchema(roleTemplates).omit({ id: true, seededAt: true, updatedAt: true } as any);
export type InsertRoleTemplate = z.infer<typeof insertRoleTemplateSchema>;
export type RoleTemplate = typeof roleTemplates.$inferSelect;

// ===================== USER PERMISSION OVERRIDES =====================

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  action: text("action").notNull(),
  allowed: boolean("allowed").notNull().default(true),
  scope: text("scope"),
  grantedBy: integer("granted_by").references(() => users.id),
  reason: text("reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  notes: text("notes"),
});
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type InsertUserPermissionOverride = typeof userPermissionOverrides.$inferInsert;

// ===================== PERMISSION AUDIT LOG =====================

export const permissionAuditLog = pgTable("permission_audit_log", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  targetRole: text("target_role"),
  targetUserId: integer("target_user_id"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedByRole: text("changed_by_role"),
  changeDetail: jsonb("change_detail").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PermissionAuditLogEntry = typeof permissionAuditLog.$inferSelect;

// ===================== PERSISTENT TOKEN REVOCATION =====================

export const revokedTokens = pgTable("revoked_tokens", {
  id: serial("id").primaryKey(),
  tokenDigest: text("token_digest").notNull().unique(),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
export type RevokedToken = typeof revokedTokens.$inferSelect;

export const revokedSessions = pgTable("revoked_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
export type RevokedSession = typeof revokedSessions.$inferSelect;

// ===================== PD VISIBILITY CONFIG =====================

/**
 * Configurable PD ticket visibility rules.
 * – Role-level defaults: `role` is set, `userId` is null.
 * – Per-user overrides: `userId` is set (takes precedence over role config).
 *
 * `ticketTypes`: which ticket categories the role/user can see.
 *   - "pd"          — non-engineering PD tickets (e.g. Cost Proposal)
 *   - "engineering"  — engineering request types (Feasibility Study, Design Review, etc.)
 *
 * `scope`: whether they see all matching tickets or only their own.
 *   - "all" — see every ticket matching the type filter
 *   - "own" — only tickets they created or are assigned to
 */
export const pdVisibilityConfig = pgTable("pd_visibility_config", {
  id: serial("id").primaryKey(),
  role: text("role"),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  ticketTypes: text("ticket_types").array().notNull().default(["pd", "engineering"]),
  scope: text("scope").notNull().default("all"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});
export type PdVisibilityConfig = typeof pdVisibilityConfig.$inferSelect;
export type InsertPdVisibilityConfig = typeof pdVisibilityConfig.$inferInsert;

// ===================== WORKSTREAM VISIBILITY CONFIG =====================

/**
 * General-purpose workstream visibility rules that control which workstreams
 * (ENG, PD, PM, QUALITY, FINANCE, GOVERNANCE, PERSONAL) each role/user can see
 * across the task management system.
 *
 * Resolution priority:
 *   1. User-level override (userId set) — highest priority
 *   2. Role-level config (role set, userId null)
 *   3. WORKSTREAM_VISIBILITY_DEFAULTS constant — fallback
 *
 * `workstreams`: which workstream categories the role/user can see in task views.
 * `ticketTypes`: which PD ticket categories to show (migrated from pdVisibilityConfig).
 * `scope`: "all" — see every matching item, "own" — only own/assigned items.
 * `sections`: which app navigation sections are allowed (informational, enforcement via rolePermissions).
 */
export const workstreamVisibilityConfig = pgTable("workstream_visibility_config", {
  id: serial("id").primaryKey(),
  role: text("role"),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  workstreams: text("workstreams").array().notNull().default(["ENG", "PD", "PM", "QUALITY", "FINANCE", "GOVERNANCE", "PERSONAL"]),
  ticketTypes: text("ticket_types").array().notNull().default(["pd", "engineering"]),
  scope: text("scope").notNull().default("all"),
  sections: text("sections").array().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});
export type WorkstreamVisibilityConfig = typeof workstreamVisibilityConfig.$inferSelect;
export type InsertWorkstreamVisibilityConfig = typeof workstreamVisibilityConfig.$inferInsert;

/** Department clusters for role grouping */
export type DepartmentCluster = 'ADMIN' | 'LEADERSHIP' | 'ENGINEERING' | 'PROJECT_DEVELOPMENT' | 'PROJECT_MANAGEMENT' | 'FINANCE';

/** Maps each company role to its department cluster */
export const ROLE_DEPARTMENT_MAP: Record<string, DepartmentCluster> = {
  COO_ADMIN: 'ADMIN',
  CEO_ADMIN: 'ADMIN',
  CCO: 'LEADERSHIP',
  PROGRAM_MANAGER: 'LEADERSHIP',
  ENGINEER: 'ENGINEERING',
  ENGINEERING_MANAGER: 'ENGINEERING',
  QUALITY_MANAGER: 'ENGINEERING',
  CONSTRUCTION_MANAGER: 'PROJECT_MANAGEMENT',
  PROJECT_DEVELOPER: 'PROJECT_DEVELOPMENT',
  KEY_ACCOUNTS_MANAGER: 'PROJECT_DEVELOPMENT',
  PROJECT_MANAGER_SITE: 'PROJECT_MANAGEMENT',
  CFO: 'FINANCE',
  PROGRAM_FINANCE_MANAGER: 'FINANCE',
  ACCOUNTANT: 'FINANCE',
  HSE_MANAGER: 'PROJECT_MANAGEMENT',
  SSEG_MANAGER: 'ENGINEERING',
};

/** Default workstream visibility per role — used when no DB config exists.
 *  Sections use the canonical 11-section model: HOME, PORTFOLIO, PRIORITIES,
 *  PROJECT_DEVELOPMENT, PROJECT_DELIVERY, ENGINEERING, QUALITY, HSE, FINANCE, REPORTS, ADMIN.
 *  Must stay aligned with ROLE_VISIBLE_SECTIONS in app-navigation.ts and
 *  DEFAULT_ROLE_PERMISSIONS.sections below.
 */
export const WORKSTREAM_VISIBILITY_DEFAULTS: Record<string, { workstreams: string[]; ticketTypes: string[]; scope: string; sections: string[] }> = {
  // ADMIN — full access
  COO_ADMIN:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'PROJECT_DEVELOPMENT', 'PROJECT_DELIVERY', 'ENGINEERING', 'QUALITY', 'HSE', 'FINANCE', 'REPORTS', 'ADMIN'] },
  CEO_ADMIN:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'PROJECT_DEVELOPMENT', 'PROJECT_DELIVERY', 'FINANCE', 'REPORTS', 'ADMIN'] },

  // LEADERSHIP — full read
  CCO:              { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'PROJECT_DEVELOPMENT', 'FINANCE', 'REPORTS'] },
  PROGRAM_MANAGER:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'PROJECT_DELIVERY', 'QUALITY', 'HSE', 'FINANCE', 'REPORTS'] },

  // ENGINEERING
  ENGINEERING_MANAGER: { workstreams: ['ENG', 'QUALITY', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['HOME', 'ENGINEERING', 'QUALITY', 'PROJECT_DELIVERY', 'REPORTS'] },
  ENGINEER:            { workstreams: ['ENG'], ticketTypes: ['engineering'], scope: 'own', sections: ['HOME', 'ENGINEERING', 'QUALITY'] },
  QUALITY_MANAGER:     { workstreams: ['QUALITY', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['HOME', 'QUALITY', 'PROJECT_DELIVERY', 'REPORTS'] },

  // PROJECT DEVELOPMENT
  PROJECT_DEVELOPER:    { workstreams: ['PD'], ticketTypes: ['pd'], scope: 'own', sections: ['HOME', 'PROJECT_DEVELOPMENT', 'FINANCE'] },
  KEY_ACCOUNTS_MANAGER: { workstreams: ['PD'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'PROJECT_DEVELOPMENT', 'FINANCE'] },

  // PROJECT MANAGEMENT
  CONSTRUCTION_MANAGER: { workstreams: ['PM', 'QUALITY'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PROJECT_DELIVERY', 'FINANCE', 'QUALITY', 'HSE', 'REPORTS'] },
  PROJECT_MANAGER_SITE: { workstreams: ['PM', 'PD'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['HOME', 'PROJECT_DELIVERY', 'QUALITY', 'HSE', 'FINANCE', 'REPORTS'] },

  // FINANCE
  CFO:                     { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'FINANCE', 'PROJECT_DELIVERY', 'REPORTS'] },
  PROGRAM_FINANCE_MANAGER: { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['HOME', 'PORTFOLIO', 'FINANCE', 'PROJECT_DELIVERY', 'REPORTS'] },
  ACCOUNTANT:              { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['HOME', 'FINANCE'] },

  // HSE & SSEG
  HSE_MANAGER:  { workstreams: ['QUALITY', 'PM', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['HOME', 'HSE', 'PROJECT_DELIVERY', 'REPORTS'] },
  SSEG_MANAGER: { workstreams: ['ENG', 'QUALITY', 'PM'], ticketTypes: ['engineering'], scope: 'all', sections: ['HOME', 'HSE', 'QUALITY', 'ENGINEERING'] },
};

export const DEFAULT_ROLE_PERMISSIONS: InsertRolePermission[] = [
  { role: "COO_ADMIN", label: "COO", description: "Full executive access, settings, user management", sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE", "FINANCE", "REPORTS", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CEO_ADMIN", label: "CEO", description: "Full executive access, strategic oversight", sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "FINANCE", "REPORTS", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CCO", label: "CCO", description: "Head of Project Development — commercial, pipeline, client relations", sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CFO", label: "CFO", description: "Financial oversight — cashflow, budgets, margin, billing", sections: ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_MANAGER", label: "Program Manager", description: "Cross-project delivery — portfolio, gates, escalations", sections: ["HOME", "PORTFOLIO", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_FINANCE_MANAGER", label: "Program Finance Manager", description: "Program finance — invoicing, forecasting, collections", sections: ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CONSTRUCTION_MANAGER", label: "Construction Manager", description: "Construction delivery — sites, milestones, inflow planning, procurement", sections: ["HOME", "PROJECT_DELIVERY", "FINANCE", "QUALITY", "HSE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "QUALITY_MANAGER", label: "Quality Manager", description: "Quality workspace — NCRs, inspections, checklists, corrective actions", sections: ["HOME", "QUALITY", "PROJECT_DELIVERY", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEERING_MANAGER", label: "Engineering Manager", description: "Engineering lead — design, approvals, deliverables", sections: ["HOME", "ENGINEERING", "QUALITY", "PROJECT_DELIVERY", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "KEY_ACCOUNTS_MANAGER", label: "Key Accounts Manager", description: "Client relations, account management, pipeline", sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROJECT_MANAGER_SITE", label: "Project Manager", description: "Project delivery — assigned projects, tasks, approvals, milestones", sections: ["HOME", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: false, isSystem: true },
  { role: "PROJECT_DEVELOPER", label: "Project Developer", description: "Project development — pipeline, cost proposals, client relations", sections: ["HOME", "PROJECT_DEVELOPMENT", "FINANCE"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEER", label: "Engineer", description: "Engineering team — tasks, deliverables, reviews, stage checklists", sections: ["HOME", "ENGINEERING", "QUALITY"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ACCOUNTANT", label: "Accountant", description: "Finance team — cashflow, COS tracking, invoice management", sections: ["HOME", "FINANCE"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "HSE_MANAGER", label: "HSE Manager", description: "HSE compliance — incidents, audits, corrective actions, safety files", sections: ["HOME", "HSE", "PROJECT_DELIVERY", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "SSEG_MANAGER", label: "SSEG Manager", description: "SSEG applications — authority tracking, queries, compliance", sections: ["HOME", "HSE", "QUALITY", "ENGINEERING"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
];
