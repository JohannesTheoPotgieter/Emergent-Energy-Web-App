/**
 * Role-Based UX Upgrade — Schema additions
 *
 * New tables for role lens profiles, contracts, SSEG applications,
 * and homepage configuration. Additive only — no existing tables modified.
 */

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// ===================== CANONICAL MODULES =====================

/**
 * The 12 canonical modules that organize the platform.
 * Used to map pages, nav items, and role visibility into a unified model.
 */
export const CANONICAL_MODULES = [
  'HOME',
  'EXECUTIVE',
  'PORTFOLIO',
  'PIPELINE',
  'PROJECTS',
  'DELIVERY',
  'FINANCE',
  'ENGINEERING',
  'COMPLIANCE',
  'DOCUMENTS',
  'REPORTS',
  'ADMIN',
] as const;
export type CanonicalModule = typeof CANONICAL_MODULES[number];

export const CANONICAL_MODULE_LABELS: Record<CanonicalModule, string> = {
  HOME: "Home",
  EXECUTIVE: "Executive",
  PORTFOLIO: "Portfolio",
  PIPELINE: "Pipeline",
  PROJECTS: "Projects",
  DELIVERY: "Delivery",
  FINANCE: "Finance",
  ENGINEERING: "Engineering",
  COMPLIANCE: "Compliance",
  DOCUMENTS: "Documents",
  REPORTS: "Reports",
  ADMIN: "Admin",
};

// ===================== CANONICAL LENS ROLES =====================

/**
 * Target lens roles for the new UX model.
 * These are UX lenses — NOT replacements for existing DB roles.
 * Legacy roles map to these via ROLE_TO_LENS_MAP.
 */
export const LENS_ROLES = [
  'CEO',
  'COO_SUPER_ADMIN',
  'CFO',
  'HEAD_OF_PROJECT_DEVELOPMENT',
  'PROGRAM_MANAGER',
  'CONSTRUCTION_MANAGER',
  'PROGRAM_FINANCE_MANAGER',
  'HSE_MANAGER',
  'SSEG_MANAGER',
  'QUALITY_MANAGER',
  'ENGINEER',
  'PROJECT_MANAGER',
  'PROJECT_DEVELOPER',
] as const;
export type LensRole = typeof LENS_ROLES[number];

export const LENS_ROLE_LABELS: Record<LensRole, string> = {
  CEO: "CEO",
  COO_SUPER_ADMIN: "COO (Super Admin)",
  CFO: "CFO",
  HEAD_OF_PROJECT_DEVELOPMENT: "Head of Project Development",
  PROGRAM_MANAGER: "Program Manager",
  CONSTRUCTION_MANAGER: "Construction Manager",
  PROGRAM_FINANCE_MANAGER: "Program Finance Manager",
  HSE_MANAGER: "HSE Manager",
  SSEG_MANAGER: "SSEG Manager",
  QUALITY_MANAGER: "Quality Manager",
  ENGINEER: "Engineer",
  PROJECT_MANAGER: "Project Manager",
  PROJECT_DEVELOPER: "Project Developer",
};

/**
 * Non-destructive alias mapping: existing DB roles → UX lens roles.
 * The source role in the user table is NEVER modified.
 * This mapping drives UX behavior only.
 */
export const ROLE_TO_LENS_MAP: Record<string, LensRole> = {
  // Direct mappings (DB role name === lens role or 1:1)
  COO_ADMIN: 'COO_SUPER_ADMIN',
  CEO_ADMIN: 'CEO',
  CFO: 'CFO',
  PROGRAM_MANAGER: 'PROGRAM_MANAGER',
  CONSTRUCTION_MANAGER: 'CONSTRUCTION_MANAGER',
  PROGRAM_FINANCE_MANAGER: 'PROGRAM_FINANCE_MANAGER',
  ENGINEER: 'ENGINEER',
  PROJECT_DEVELOPER: 'PROJECT_DEVELOPER',
  HSE_MANAGER: 'HSE_MANAGER',
  SSEG_MANAGER: 'SSEG_MANAGER',
  QUALITY_MANAGER: 'QUALITY_MANAGER',
  // Alias mappings (UX-only, source role preserved in DB)
  PROJECT_MANAGER_SITE: 'PROJECT_MANAGER',
  CCO: 'HEAD_OF_PROJECT_DEVELOPMENT',
  KEY_ACCOUNTS_MANAGER: 'HEAD_OF_PROJECT_DEVELOPMENT',
  ENGINEERING_MANAGER: 'ENGINEER', // maps to Engineering lead lens
  ACCOUNTANT: 'PROGRAM_FINANCE_MANAGER', // maps to Finance support lens
};

/**
 * Resolve a user's DB role to their UX lens role.
 * Returns the lens role, or falls back to ENGINEER as a safe default.
 */
export function resolveUserLens(dbRole?: string | null): LensRole {
  if (!dbRole) return 'ENGINEER';
  return ROLE_TO_LENS_MAP[dbRole] ?? 'ENGINEER';
}

/**
 * Check if a DB role maps to COO super admin lens.
 */
export function isSuperAdmin(dbRole?: string | null): boolean {
  return resolveUserLens(dbRole) === 'COO_SUPER_ADMIN';
}

// ===================== ROLE LENS PROFILES =====================

/**
 * Persistent role lens profile configuration.
 * One row per lens role — defines homepage, modules, widgets, and filters.
 */
export const roleLensProfiles = pgTable("role_lens_profiles", {
  id: serial("id").primaryKey(),
  lensRole: text("lens_role").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  landingPage: text("landing_page").notNull(),
  allowedModules: text("allowed_modules").array().notNull().default([]),
  navPriority: text("nav_priority").array().notNull().default([]),
  quickActions: jsonb("quick_actions").notNull().default([]),
  defaultFilters: jsonb("default_filters").notNull().default({}),
  widgetLayout: jsonb("widget_layout").notNull().default([]),
  recordTabEmphasis: jsonb("record_tab_emphasis").notNull().default({}),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRoleLensProfileSchema = createInsertSchema(roleLensProfiles).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRoleLensProfile = z.infer<typeof insertRoleLensProfileSchema>;
export type RoleLensProfile = typeof roleLensProfiles.$inferSelect;

// ===================== ROLE HOMEPAGE WIDGETS =====================

/**
 * Widget configurations for role-based homepages.
 * Each row represents one widget card on a role's homepage.
 */
export const roleHomepageWidgets = pgTable("role_homepage_widgets", {
  id: serial("id").primaryKey(),
  lensRole: text("lens_role").notNull(),
  widgetKey: text("widget_key").notNull(),
  label: text("label").notNull(),
  widgetType: text("widget_type").notNull(), // 'kpi', 'list', 'chart', 'alert', 'action', 'gate_checklist'
  dataSource: text("data_source"),            // API endpoint or query key
  position: integer("position").notNull().default(0),
  span: integer("span").notNull().default(1), // grid column span (1-4)
  config: jsonb("config").notNull().default({}),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRoleHomepageWidgetSchema = createInsertSchema(roleHomepageWidgets).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRoleHomepageWidget = z.infer<typeof insertRoleHomepageWidgetSchema>;
export type RoleHomepageWidget = typeof roleHomepageWidgets.$inferSelect;

// ===================== CONTRACTS =====================

/**
 * Contracts table — linked to opportunity/project/site/client.
 * Fills the gap where contract data was previously embedded in opportunities/projectInfo.
 */
export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  opportunityId: integer("opportunity_id"), // FK set up at app level to avoid circular import
  clientName: text("client_name"),
  counterpartyName: text("counterparty_name"),
  contractType: text("contract_type"),           // 'epc', 'design_build', 'supply', 'o_and_m', 'ppa', 'lease', 'other'
  contractReference: text("contract_reference"),
  signatureStatus: text("signature_status").notNull().default("draft"), // 'draft', 'sent', 'negotiating', 'signed', 'expired', 'terminated'
  signedDate: date("signed_date"),
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  contractValue: integer("contract_value"),       // in cents
  currency: text("currency").default("ZAR"),
  documentRefs: jsonb("document_refs").notNull().default([]),
  financialCloseRelevance: boolean("financial_close_relevance").default(false),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});

export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;

// ===================== SSEG APPLICATIONS =====================

/**
 * Dedicated SSEG application tracking — extends the existing ssegItems table
 * with a more structured application-focused model.
 * The existing ssegItems table is preserved and continues to work.
 */
export const ssegApplications = pgTable("sseg_applications", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  siteId: integer("site_id"),                    // FK to sites, set at app level
  authority: text("authority").notNull(),         // 'eskom', 'city_power', 'municipality', 'nersa', 'other'
  applicationStage: text("application_stage").notNull().default("preparation"),
    // 'preparation', 'submitted', 'query_received', 'response_sent', 'under_review', 'approved', 'rejected', 'expired'
  referenceNumber: text("reference_number"),
  submissionDate: date("submission_date"),
  queryDate: date("query_date"),
  responseDueDate: date("response_due_date"),
  approvalDate: date("approval_date"),
  expiryDate: date("expiry_date"),
  requiredDocuments: jsonb("required_documents").notNull().default([]),
  rejectionNotes: text("rejection_notes"),
  queryNotes: text("query_notes"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  ssegItemId: integer("sseg_item_id"),           // optional link to legacy ssegItems
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSsegApplicationSchema = createInsertSchema(ssegApplications).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSsegApplication = z.infer<typeof insertSsegApplicationSchema>;
export type SsegApplication = typeof ssegApplications.$inferSelect;

// ===================== COO LENS SWITCHER STATE =====================

/**
 * Tracks active lens simulation state for COO users.
 * One row per active simulation session.
 */
export const lensSimulationSessions = pgTable("lens_simulation_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  simulatedLensRole: text("simulated_lens_role").notNull(),
  simulatedUserId: integer("simulated_user_id").references(() => users.id),
  mode: text("mode").notNull().default("read_only"), // 'read_only', 'full_power'
  isActive: boolean("is_active").notNull().default(true),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export type LensSimulationSession = typeof lensSimulationSessions.$inferSelect;
export type InsertLensSimulationSession = typeof lensSimulationSessions.$inferInsert;

// ===================== ROLE HOMEPAGE SNAPSHOT (Read Model) =====================

/**
 * Pre-computed homepage snapshot data for fast role-based homepage rendering.
 * Updated periodically by background jobs or on-demand.
 */
export const roleHomepageSnapshots = pgTable("role_homepage_snapshots", {
  id: serial("id").primaryKey(),
  lensRole: text("lens_role").notNull(),
  userId: integer("user_id").references(() => users.id), // null = role-level, set = user-level
  snapshotData: jsonb("snapshot_data").notNull().default({}),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
});

export type RoleHomepageSnapshot = typeof roleHomepageSnapshots.$inferSelect;

// ===================== DEFAULT LENS PROFILE DATA =====================

export interface LensProfileSeed {
  lensRole: LensRole;
  label: string;
  description: string;
  landingPage: string;
  allowedModules: CanonicalModule[];
  navPriority: CanonicalModule[];
  quickActions: Array<{ label: string; path: string; iconKey?: string }>;
}

export const DEFAULT_LENS_PROFILES: LensProfileSeed[] = [
  {
    lensRole: 'CEO',
    label: 'CEO',
    description: 'Executive overview — company performance, strategic risk, decisions',
    landingPage: '/gates',
    allowedModules: ['HOME', 'EXECUTIVE', 'PORTFOLIO', 'FINANCE', 'PIPELINE', 'REPORTS', 'PROJECTS'],
    navPriority: ['HOME', 'EXECUTIVE', 'PORTFOLIO', 'FINANCE', 'PIPELINE', 'REPORTS'],
    quickActions: [
      { label: "Executive Overview", path: "/gates", iconKey: "LayoutDashboard" },
      { label: "GP Tracker", path: "/gp-tracker", iconKey: "Activity" },
      { label: "Priorities", path: "/priorities", iconKey: "Flag" },
    ],
  },
  {
    lensRole: 'COO_SUPER_ADMIN',
    label: 'COO (Super Admin)',
    description: 'Unrestricted access — full global edit/control, lens switching, system admin',
    landingPage: '/admin/control-center',
    allowedModules: ['HOME', 'EXECUTIVE', 'PORTFOLIO', 'PIPELINE', 'PROJECTS', 'DELIVERY', 'FINANCE', 'ENGINEERING', 'COMPLIANCE', 'DOCUMENTS', 'REPORTS', 'ADMIN'],
    navPriority: ['HOME', 'EXECUTIVE', 'PORTFOLIO', 'PROJECTS', 'DELIVERY', 'FINANCE', 'ENGINEERING', 'COMPLIANCE', 'REPORTS', 'ADMIN'],
    quickActions: [
      { label: "Control Center", path: "/admin/control-center", iconKey: "Gauge" },
      { label: "Execution Board", path: "/execution-board", iconKey: "LayoutDashboard" },
      { label: "Users & Roles", path: "/admin/roles", iconKey: "ShieldAlert" },
      { label: "Activity Log", path: "/admin/activity-log", iconKey: "Activity" },
    ],
  },
  {
    lensRole: 'CFO',
    label: 'CFO',
    description: 'Finance command center — cash, margin, receivables, payables, funding, exposure',
    landingPage: '/cashflow',
    allowedModules: ['HOME', 'FINANCE', 'EXECUTIVE', 'PORTFOLIO', 'REPORTS', 'PROJECTS'],
    navPriority: ['HOME', 'FINANCE', 'EXECUTIVE', 'PORTFOLIO', 'REPORTS'],
    quickActions: [
      { label: "Cashflow", path: "/cashflow", iconKey: "Wallet" },
      { label: "Revenue", path: "/revenue-tracker", iconKey: "TrendingUp" },
      { label: "GP Tracker", path: "/gp-tracker", iconKey: "Activity" },
    ],
  },
  {
    lensRole: 'HEAD_OF_PROJECT_DEVELOPMENT',
    label: 'Head of Project Development',
    description: 'Development pipeline — opportunities, readiness, permits, bankable handover',
    landingPage: '/pd',
    allowedModules: ['HOME', 'PIPELINE', 'PROJECTS', 'PORTFOLIO', 'FINANCE', 'REPORTS'],
    navPriority: ['HOME', 'PIPELINE', 'PROJECTS', 'PORTFOLIO', 'FINANCE', 'REPORTS'],
    quickActions: [
      { label: "PD Dashboard", path: "/pd", iconKey: "Sun" },
      { label: "Opportunities", path: "/opportunities", iconKey: "Sun" },
      { label: "Clients", path: "/clients", iconKey: "Users" },
    ],
  },
  {
    lensRole: 'PROGRAM_MANAGER',
    label: 'Program Manager',
    description: 'Program cockpit — cross-project dependencies, slippage, escalations, resources',
    landingPage: '/gates',
    allowedModules: ['HOME', 'DELIVERY', 'PROJECTS', 'PORTFOLIO', 'ENGINEERING', 'COMPLIANCE', 'FINANCE', 'REPORTS'],
    navPriority: ['HOME', 'DELIVERY', 'PROJECTS', 'PORTFOLIO', 'ENGINEERING', 'COMPLIANCE', 'FINANCE', 'REPORTS'],
    quickActions: [
      { label: "Gates Pipeline", path: "/gates", iconKey: "Milestone" },
      { label: "Weekly Reviews", path: "/weekly-reviews", iconKey: "CalendarCheck" },
      { label: "Programme Reports", path: "/reports/programme", iconKey: "FileText" },
    ],
  },
  {
    lensRole: 'CONSTRUCTION_MANAGER',
    label: 'Construction Manager',
    description: 'Construction control — active sites, progress, materials, subcontractors, closeout',
    landingPage: '/construction',
    allowedModules: ['HOME', 'DELIVERY', 'PROJECTS', 'COMPLIANCE', 'ENGINEERING', 'FINANCE', 'REPORTS'],
    navPriority: ['HOME', 'DELIVERY', 'PROJECTS', 'COMPLIANCE', 'ENGINEERING', 'FINANCE'],
    quickActions: [
      { label: "Construction", path: "/construction", iconKey: "HardHat" },
      { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
      { label: "Quality", path: "/quality", iconKey: "ShieldCheck" },
    ],
  },
  {
    lensRole: 'PROGRAM_FINANCE_MANAGER',
    label: 'Program Finance Manager',
    description: 'Program finance — invoices, margin erosion, forecast-to-complete, collections',
    landingPage: '/cashflow',
    allowedModules: ['HOME', 'FINANCE', 'PROJECTS', 'DELIVERY', 'REPORTS'],
    navPriority: ['HOME', 'FINANCE', 'PROJECTS', 'DELIVERY', 'REPORTS'],
    quickActions: [
      { label: "Cashflow", path: "/cashflow", iconKey: "Wallet" },
      { label: "COS", path: "/cos", iconKey: "TrendingUp" },
      { label: "Payment Requests", path: "/payment-request-board", iconKey: "CreditCard" },
    ],
  },
  {
    lensRole: 'HSE_MANAGER',
    label: 'HSE Manager',
    description: 'HSE compliance center — incidents, audits, corrective actions, safety files',
    landingPage: '/hse',
    allowedModules: ['HOME', 'COMPLIANCE', 'PROJECTS', 'DELIVERY', 'REPORTS'],
    navPriority: ['HOME', 'COMPLIANCE', 'PROJECTS', 'DELIVERY', 'REPORTS'],
    quickActions: [
      { label: "HSE Dashboard", path: "/hse", iconKey: "ShieldAlert" },
      { label: "Quality", path: "/quality", iconKey: "ShieldCheck" },
      { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
    ],
  },
  {
    lensRole: 'SSEG_MANAGER',
    label: 'SSEG Manager',
    description: 'SSEG control — application queue, authority tracker, rejections, turnaround',
    landingPage: '/hse',
    allowedModules: ['HOME', 'COMPLIANCE', 'PROJECTS', 'ENGINEERING', 'DELIVERY', 'REPORTS'],
    navPriority: ['HOME', 'COMPLIANCE', 'PROJECTS', 'ENGINEERING', 'DELIVERY'],
    quickActions: [
      { label: "HSE Dashboard", path: "/hse", iconKey: "ShieldAlert" },
      { label: "Engineering", path: "/engineering", iconKey: "Wrench" },
      { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
    ],
  },
  {
    lensRole: 'QUALITY_MANAGER',
    label: 'Quality Manager',
    description: 'Quality workspace — NCRs, snags, inspections, checklists, corrective actions',
    landingPage: '/quality',
    allowedModules: ['HOME', 'COMPLIANCE', 'PROJECTS', 'DELIVERY', 'ENGINEERING', 'REPORTS'],
    navPriority: ['HOME', 'COMPLIANCE', 'PROJECTS', 'DELIVERY', 'ENGINEERING', 'REPORTS'],
    quickActions: [
      { label: "Quality Dashboard", path: "/quality", iconKey: "ShieldCheck" },
      { label: "Commissioning", path: "/commissioning-dashboard", iconKey: "ListTodo" },
      { label: "Projects", path: "/projects", iconKey: "FileSpreadsheet" },
    ],
  },
  {
    lensRole: 'ENGINEER',
    label: 'Engineer',
    description: 'Engineering workbench — tasks, review queue, blockers, revision control',
    landingPage: '/engineering',
    allowedModules: ['HOME', 'ENGINEERING', 'PROJECTS', 'DELIVERY', 'COMPLIANCE'],
    navPriority: ['HOME', 'ENGINEERING', 'PROJECTS', 'DELIVERY', 'COMPLIANCE'],
    quickActions: [
      { label: "Engineering Tasks", path: "/engineering/tasks", iconKey: "ListTodo" },
      { label: "Standup", path: "/engineering/standup", iconKey: "Users" },
      { label: "My Tasks", path: "/my-work/tasks", iconKey: "ListChecks" },
    ],
  },
  {
    lensRole: 'PROJECT_MANAGER',
    label: 'Project Manager',
    description: 'Project delivery — assigned projects, lookahead, tasks, budget burn, approvals',
    landingPage: '/gates',
    allowedModules: ['HOME', 'DELIVERY', 'PROJECTS', 'FINANCE', 'ENGINEERING', 'COMPLIANCE', 'REPORTS'],
    navPriority: ['HOME', 'DELIVERY', 'PROJECTS', 'FINANCE', 'ENGINEERING', 'COMPLIANCE'],
    quickActions: [
      { label: "My Tasks", path: "/my-work/tasks", iconKey: "ListChecks" },
      { label: "Approvals", path: "/governance/approvals", iconKey: "ClipboardCheck" },
      { label: "Weekly Reviews", path: "/weekly-reviews", iconKey: "CalendarCheck" },
    ],
  },
  {
    lensRole: 'PROJECT_DEVELOPER',
    label: 'Project Developer',
    description: 'Developer pipeline — opportunities, feasibility, client follow-ups, approvals',
    landingPage: '/pd',
    allowedModules: ['HOME', 'PIPELINE', 'PROJECTS', 'FINANCE', 'REPORTS'],
    navPriority: ['HOME', 'PIPELINE', 'PROJECTS', 'FINANCE'],
    quickActions: [
      { label: "PD Dashboard", path: "/pd", iconKey: "Sun" },
      { label: "Create Ticket", path: "/pd/tickets/create", iconKey: "ClipboardList" },
      { label: "Clients", path: "/clients", iconKey: "Users" },
    ],
  },
];

// ===================== MODULE-TO-PAGE MAPPING =====================

/**
 * Maps canonical modules to existing page registry navGroups.
 * This is the bridge between the new module model and existing page registry.
 */
export const MODULE_TO_NAV_GROUPS: Record<CanonicalModule, string[]> = {
  HOME: ['MY_WORK', 'PRIORITIES'],
  EXECUTIVE: ['PRIORITIES', 'PROJECT_MANAGEMENT'],
  PORTFOLIO: ['PROJECT_MANAGEMENT'],
  PIPELINE: ['PROJECT_DEVELOPMENT'],
  PROJECTS: ['PROJECTS', 'PROJECT_MANAGEMENT'],
  DELIVERY: ['GATES', 'PROJECT_MANAGEMENT'],
  FINANCE: ['FINANCE'],
  ENGINEERING: ['ENGINEERING'],
  COMPLIANCE: ['QUALITY'],
  DOCUMENTS: [],
  REPORTS: ['REPORTS', 'KNOWLEDGE'],
  ADMIN: ['SYSTEM'],
};

/**
 * Lifecycle gates that should be prominent operational surfaces.
 */
export const LIFECYCLE_GATES = [
  { key: 'design_cost_proposal', label: 'Design & Cost Proposal', path: '/pd', module: 'PIPELINE' as CanonicalModule },
  { key: 'signature_financial_close', label: 'Signature & Financial Close', path: '/gates', module: 'DELIVERY' as CanonicalModule },
  { key: 'pd_to_pm_handover', label: 'PD to PM Handover', path: '/handover-control', module: 'DELIVERY' as CanonicalModule },
  { key: 'financial_review', label: 'Financial Review', path: '/governance/financial-reviews', module: 'FINANCE' as CanonicalModule },
  { key: 'weekly_client_update', label: 'Weekly Client Communication', path: '/gates/client-updates', module: 'DELIVERY' as CanonicalModule },
  { key: 'commissioning', label: 'Commissioning', path: '/commissioning-dashboard', module: 'COMPLIANCE' as CanonicalModule },
  { key: 'om_handover', label: 'O&M Handover', path: '/handover', module: 'DELIVERY' as CanonicalModule },
  { key: 'client_handover', label: 'Client Handover', path: '/handover', module: 'DELIVERY' as CanonicalModule },
] as const;
