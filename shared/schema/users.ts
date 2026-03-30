import { pgTable, text, integer, timestamp, serial, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  microsoft_id: text("microsoft_id").unique(),
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
  // Current 6-section navigation model
  'HOME',
  'MY_WORK',
  'PROJECTS',
  'FINANCE',
  'REPORTS',
  'ADMIN',
  // Legacy keys kept for backward compatibility with existing DB records
  'EXCO',
  'PROJECT_MANAGEMENT',
  'ENGINEERING',
  'QUALITY',
  'MY_TOOL',
  'OPERATIONS',
  'GOVERNANCE',
  'COCKPIT',
  'MONEY',
  'COLLABORATION',
  'INFORMATION',
  'PROJECT_DEVELOPMENT',
] as const;
export type AppSection = typeof APP_SECTIONS[number];

export const APP_SECTION_LABELS: Record<AppSection, string> = {
  HOME: "Home",
  MY_WORK: "My Work (Tasks, Approvals, Inbox)",
  PROJECTS: "Projects (Lifecycle, Engineering, Quality, PD, Construction)",
  FINANCE: "Finance (Cashflow, COS, Revenue, Procurement)",
  REPORTS: "Reports (Priorities, PM Reports, SOPs, Training, Feedback)",
  ADMIN: "Admin (Settings, Templates, Import)",
  // Legacy labels (kept for backward compat)
  EXCO: "Executive (Lifecycle, Priorities)",
  PROJECT_MANAGEMENT: "Project Management (Execution, Projects, Deliverables)",
  ENGINEERING: "Engineering (Overview, Tasks, Stages)",
  QUALITY: "Quality Management",
  MY_TOOL: "My Tool (Daily Planner)",
  OPERATIONS: "Operations (Finance, Engineering, Procurement)",
  GOVERNANCE: "Quality (Quality Workspace)",
  COCKPIT: "Home (Home, My Work)",
  MONEY: "Finance (Cashflow, COS, Revenue, Procurement)",
  COLLABORATION: "Collaboration (Chat, Meetings)",
  INFORMATION: "Knowledge (Lifecycle & SOP, Leaderboard, Training)",
  PROJECT_DEVELOPMENT: "Project Development (PD Dashboard, Tickets)",
};

export const UX_REDESIGN_ENABLED = true;

export type PermissionEntity = 'projects' | 'financials' | 'quality' | 'engineering' | 'procurement' | 'admin' | 'governance'
  | 'cos' | 'cashflow' | 'smart_import' | 'tr_register' | 'pm_dashboard'
  | 'eng_stages' | 'eng_tasks' | 'lifecycle' | 'my_tool' | 'create_project'
  | 'weekly_reviews' | 'ee_info'
  | 'execution_board' | 'leaderboard' | 'training' | 'knowledge_game' | 'department_scores' | 'feedback' | 'approvals' | 'activity_log'
  | 'company_priorities' | 'meetings' | 'phase_templates' | 'invoice_patterns'
  | 'portfolios' | 'notifications' | 'subcontractors' | 'cos_control' | 'cashflow_forecast' | 'home'
  | 'pd_overview' | 'pd_plan' | 'pd_finance' | 'pd_engineering' | 'pd_quality' | 'pd_history'
  | 'pd_revenue' | 'pd_expenditure' | 'pd_cos_tracker' | 'pd_cashflow' | 'pd_subcontractors'
  | 'pd_eng_tasks' | 'pd_eng_stages' | 'pd_gantt' | 'pd_key_dates'
  | 'pd_tickets' | 'pd_dashboard' | 'pd_clients'
  | 'triage_inbox' | 'unclassified_tasks' | 'eng_sync' | 'eng_inbox'
  | 'portfolio_detail' | 'project_normalized' | 'admin_roles' | 'revenue'
  | 'ee_info_lifecycle' | 'ee_info_departments' | 'ee_info_processes' | 'ee_info_templates'
  | 'teams_chat' | 'financial_integration' | 'pd_collaboration' | 'operational_tasks' | 'gamification'
  | 'dashboard_widgets' | 'pm_on_the_go' | 'weekly_review_wizard' | 'project_creation' | 'financial_linking'
  | 'collaboration_hub' | 'sharepoint_files' | 'project_chat' | 'deliverables'
  | 'data_import' | 'data_export' | 'audit_trail'
  | 'ms_integration'
  | 'my_work' | 'ms_sync' | 'project_tagging' | 'database_migration'
  | 'revenue_tracker' | 'gp_tracker' | 'work_items'
  | 'task_management' | 'standups' | 'fye_revenue_tracking' | 'reports'
  | 'handover' | 'commissioning' | 'counterparties'
  | 'pd_change_control' | 'pd_commissioning' | 'pd_dependencies' | 'pd_raid'
  | 'stage_lifecycle' | 'stage_exceptions' | 'stage_dependencies' | 'stage_admin'
  | 'stage_gate' | 'exception' | 'stage_config' | 'gate_override'
  | 'project_charter' | 'client_update' | 'handover_acceptance'
  | 'performance' | 'project_access_mgmt';
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

export const ENTITY_PERMISSION_DEFAULTS: EntityPermissionRule[] = [
  {
    entity: 'projects',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT', 'HSE_MANAGER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'financials',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cos',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cashflow',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'revenue_tracker',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'gp_tracker',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'quality',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'HSE_MANAGER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER', 'HSE_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER', 'HSE_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'HSE_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'engineering',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER', 'SSEG_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER', 'SSEG_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_stages',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
  },
  {
    entity: 'procurement',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'admin',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'governance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'weekly_reviews',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'smart_import',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'tr_register',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pm_dashboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'lifecycle',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'HSE_MANAGER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'create_project',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'my_tool',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_overview',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_plan',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_finance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_engineering',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_quality',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
  },
  {
    entity: 'pd_history',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_revenue',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_expenditure',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_cos_tracker',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_cashflow',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_subcontractors',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_eng_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
  },
  {
    entity: 'pd_eng_stages',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_gantt',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_key_dates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'execution_board',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT', 'HSE_MANAGER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'leaderboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'training',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'knowledge_game',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'department_scores',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'feedback',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'approvals',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'activity_log',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'company_priorities',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'meetings',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'phase_templates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'invoice_patterns',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'portfolios',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'notifications',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'subcontractors',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cos_control',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cashflow_forecast',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'home',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT', 'HSE_MANAGER', 'SSEG_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_tickets',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_dashboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_clients',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'triage_inbox',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'unclassified_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_sync',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_inbox',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'portfolio_detail',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_normalized',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'admin_roles',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'revenue',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_lifecycle',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_departments',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_processes',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_templates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'teams_chat',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
  },
  {
    entity: 'financial_integration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_collaboration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'operational_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'gamification',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'dashboard_widgets',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pm_on_the_go',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROJECT_MANAGER_SITE'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'weekly_review_wizard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_creation',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'financial_linking',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'collaboration_hub',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'my_work',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ms_sync',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_tagging',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
  },
  {
    entity: 'work_items',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'sharepoint_files',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_chat',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'deliverables',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'data_import',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'data_export',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'audit_trail',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ms_integration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'database_migration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'fye_revenue_tracking',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'standups',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
  },
  {
    entity: 'handover',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'commissioning',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'counterparties',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_change_control',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_commissioning',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_dependencies',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_raid',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'reports',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'task_management',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  // ── Stage lifecycle permission defaults (Prompt 6) ──
  {
    entity: 'stage_lifecycle',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'stage_exceptions',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'stage_dependencies',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'stage_admin',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'stage_gate',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'exception',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'stage_config',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'gate_override',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_charter',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_DEVELOPER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'client_update',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'handover_acceptance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'performance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_access_mgmt',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    create_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
];

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
  entityPermissions: jsonb("entity_permissions"),
  authorityModel: jsonb("authority_model"),
  isSystem: boolean("is_system").notNull().default(false),
  permissionVersion: integer("permission_version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

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

/** Default workstream visibility per role — used when no DB config exists */
export const WORKSTREAM_VISIBILITY_DEFAULTS: Record<string, { workstreams: string[]; ticketTypes: string[]; scope: string; sections: string[] }> = {
  // ADMIN — full access
  COO_ADMIN:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_DEVELOPMENT', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION', 'ADMIN'] },
  CEO_ADMIN:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_DEVELOPMENT', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION', 'ADMIN'] },

  // LEADERSHIP — full read
  CCO:              { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_DEVELOPMENT', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },
  PROGRAM_MANAGER:  { workstreams: ['PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },

  // ENGINEERING
  ENGINEERING_MANAGER: { workstreams: ['ENG', 'QUALITY', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },
  ENGINEER:            { workstreams: ['ENG'], ticketTypes: ['engineering'], scope: 'own', sections: ['COCKPIT', 'COLLABORATION', 'ENGINEERING', 'INFORMATION'] },
  QUALITY_MANAGER:     { workstreams: ['QUALITY', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'GOVERNANCE', 'INFORMATION'] },

  // PROJECT DEVELOPMENT
  PROJECT_DEVELOPER:    { workstreams: ['PD'], ticketTypes: ['pd'], scope: 'own', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'PROJECT_DEVELOPMENT', 'GOVERNANCE', 'INFORMATION'] },
  KEY_ACCOUNTS_MANAGER: { workstreams: ['PD'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'INFORMATION'] },

  // PROJECT MANAGEMENT — CONSTRUCTION_MANAGER now PM + QUALITY focused
  CONSTRUCTION_MANAGER: { workstreams: ['PM', 'QUALITY'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'PROJECT_MANAGEMENT', 'GOVERNANCE', 'INFORMATION'] },
  PROJECT_MANAGER_SITE: { workstreams: ['PM', 'PD'], ticketTypes: ['pd', 'engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },

  // FINANCE
  CFO:                     { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'GOVERNANCE', 'INFORMATION'] },
  PROGRAM_FINANCE_MANAGER: { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },
  ACCOUNTANT:              { workstreams: ['FINANCE'], ticketTypes: [], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'MONEY', 'INFORMATION'] },

  // HSE & SSEG — new roles added by role-based UX upgrade
  HSE_MANAGER:  { workstreams: ['QUALITY', 'PM', 'GOVERNANCE'], ticketTypes: ['engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'GOVERNANCE', 'PROJECT_MANAGEMENT', 'INFORMATION'] },
  SSEG_MANAGER: { workstreams: ['ENG', 'QUALITY', 'PM'], ticketTypes: ['engineering'], scope: 'all', sections: ['COCKPIT', 'COLLABORATION', 'PROJECTS', 'ENGINEERING', 'GOVERNANCE', 'INFORMATION'] },
};

export const DEFAULT_ROLE_PERMISSIONS: InsertRolePermission[] = [
  { role: "COO_ADMIN", label: "COO", description: "Full executive access, settings, user management", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CEO_ADMIN", label: "CEO", description: "Full executive access, strategic oversight", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CCO", label: "CCO", description: "Commercial operations, project oversight", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CFO", label: "CFO", description: "Financial oversight, cashflow, budgets", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_MANAGER", label: "Program Manager", description: "Project management, engineering dashboard", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_FINANCE_MANAGER", label: "Program Finance Manager", description: "Project finance, cost tracking", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CONSTRUCTION_MANAGER", label: "Construction Manager", description: "Construction oversight, site management — PM and quality focused", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "QUALITY_MANAGER", label: "Quality Manager", description: "Quality checklists, post-mortems, inspections", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEERING_MANAGER", label: "Engineering Manager", description: "Engineering tasks, deliverables, approvals", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "KEY_ACCOUNTS_MANAGER", label: "Key Accounts Manager", description: "Client relations, account management", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROJECT_MANAGER_SITE", label: "Project Manager", description: "Site project manager — view-only access to assigned projects, dates, financials, quality, engineering", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: false, isSystem: true },
  { role: "PROJECT_DEVELOPER", label: "Project Developer", description: "Project developer — manages project development, cost proposals, and client relations", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEER", label: "Engineer", description: "Engineering team member — engineering tasks, deliverables, stage checklists", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ACCOUNTANT", label: "Accountant", description: "Finance team — cashflow, COS tracking, invoice management", sections: ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "HSE_MANAGER", label: "HSE Manager", description: "Health, Safety & Environment — incidents, audits, corrective actions, safety files", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "SSEG_MANAGER", label: "SSEG Manager", description: "SSEG applications — authority tracking, rejections, queries, turnaround", sections: ["HOME", "MY_WORK", "PROJECTS", "REPORTS"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
];
