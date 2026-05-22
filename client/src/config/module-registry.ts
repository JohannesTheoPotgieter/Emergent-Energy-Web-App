/**
 * Module Registry — maps existing page registry entries to the 12 canonical modules.
 *
 * This is the bridge layer between the existing page-registry.ts (canonical for routing)
 * and the new role-based module model. It does NOT replace page-registry — it adds
 * a grouping/visibility layer on top.
 */

import type { CanonicalModule } from "@shared/schema/role-based-upgrade";
import { CANONICAL_MODULES, CANONICAL_MODULE_LABELS, MODULE_TO_NAV_GROUPS } from "@shared/schema/role-based-upgrade";
import { PAGE_REGISTRY, type PageRegistryEntry } from "./page-registry";

export interface ModuleDefinition {
  id: CanonicalModule;
  label: string;
  iconKey: string;
  description: string;
  /** Page registry IDs that belong to this module */
  pageIds: string[];
  /** Primary entry path for this module */
  primaryPath: string;
}

/**
 * Canonical module definitions with their primary paths and associated pages.
 * Pages are mapped from the existing page registry using navGroup matching.
 */
export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: 'HOME',
    label: 'Home',
    iconKey: 'Home',
    description: 'Personal workspace — tasks, approvals, calendar, inbox',
    pageIds: ['myWork', 'inbox', 'myWorkCalendar', 'myWorkTasks', 'myWorkApprovals', 'myWorkMeetings', 'myWorkEmail', 'myWorkTeams', 'myWorkSettings'],
    primaryPath: '/',
  },
  {
    id: 'EXECUTIVE',
    label: 'Executive',
    iconKey: 'LayoutDashboard',
    description: 'Executive overview — KPIs, strategic risk, decisions',
    pageIds: ['executionBoard', 'executionBoardProgram', 'executionBoardConstruction', 'executionBoardFinance', 'priorities', 'priorityDetail'],
    primaryPath: '/gates',
  },
  {
    id: 'PORTFOLIO',
    label: 'Portfolio',
    iconKey: 'FolderOpen',
    description: 'Portfolio management — program views, analytics',
    pageIds: ['portfolios', 'portfolioDetail'],
    primaryPath: '/portfolios',
  },
  {
    id: 'PIPELINE',
    label: 'Pipeline',
    iconKey: 'Sun',
    description: 'Development pipeline — opportunities (Pipedrive) and clients',
    pageIds: ['pdDashboard', 'opportunities', 'clients'],
    primaryPath: '/pd',
  },
  {
    id: 'PROJECTS',
    label: 'Projects',
    iconKey: 'FileSpreadsheet',
    description: 'Project hub — all projects, lifecycle, detail views',
    pageIds: ['projects', 'projectDetail', 'projectFinancialLinking', 'projectLifecycle', 'projectLifecycleStageGates', 'projectLifecycleLatestUpdates', 'projectLifecycleClientOverview', 'projectCreate', 'sites'],
    primaryPath: '/projects',
  },
  {
    id: 'DELIVERY',
    label: 'Delivery',
    iconKey: 'Milestone',
    description: 'Delivery management — gates, construction, handovers, weekly reviews',
    pageIds: ['gatesPipeline', 'gatesBlocked', 'gatesReady', 'gatesExceptions', 'gatesClientUpdates', 'gatesHandovers', 'gatesQueries', 'gatesCommitments', 'handoverControl', 'handoverDashboard', 'weeklyReviews', 'taskManagement', 'standups', 'exceptions', 'pmApprovals', 'pmHandoverReview', 'pmOnTheGo', 'pmOnTheGoProject', 'financialReviewQueue'],
    primaryPath: '/gates',
  },
  {
    id: 'FINANCE',
    label: 'Finance',
    iconKey: 'Wallet',
    description: 'Finance — cashflow, COS, revenue, procurement, payments',
    pageIds: ['cashflow', 'cos', 'revenueTracker', 'gpTracker', 'fyeRevenueTracking', 'invoicePatterns', 'counterparties', 'subcontractor', 'procurementDashboard', 'poApprovalBoard', 'paymentRequestBoard', 'paymentBatchManager'],
    primaryPath: '/cashflow',
  },
  {
    id: 'ENGINEERING',
    label: 'Engineering',
    iconKey: 'Wrench',
    description: 'Engineering — tasks, stages, standups, deliverables',
    pageIds: ['engineering', 'engineeringTasks', 'engineeringStandup', 'engineeringAudit'],
    primaryPath: '/engineering',
  },
  {
    id: 'COMPLIANCE',
    label: 'Compliance',
    iconKey: 'ShieldCheck',
    description: 'Compliance — quality, HSE, NCRs, safety',
    pageIds: ['quality', 'qualityNcrList', 'qualityNcrDetail', 'hseDashboard'],
    primaryPath: '/quality',
  },
  {
    id: 'DOCUMENTS',
    label: 'Documents',
    iconKey: 'FileText',
    description: 'Document management — SharePoint, uploads',
    pageIds: ['sharepointIntake'],
    primaryPath: '/admin/sharepoint-intake',
  },
  {
    id: 'REPORTS',
    label: 'Reports',
    iconKey: 'BarChart3',
    description: 'Reports — programme, PM, engineering, performance',
    pageIds: ['reportCenter', 'programmeReports', 'performanceDashboard', 'pmMonthlyReport', 'pmMonthlyReportHistory', 'pmMonthlyReportCompare', 'pmMonthlyReportProject', 'engMonthlyReport', 'engMonthlyReportHistory', 'engMonthlyReportCompare', 'engMonthlyReportProject', 'leaderboard', 'feedback', 'eeInfo', 'training', 'departmentScores'],
    primaryPath: '/reports/center',
  },
  {
    id: 'ADMIN',
    label: 'Admin',
    iconKey: 'Settings',
    description: 'Administration — settings, imports, templates, users',
    pageIds: ['settingsHome', 'smartImport', 'adminRoles', 'adminActivity', 'adminKpiTraceability', 'adminImportControlTower', 'adminRecovery', 'stageAdmin', 'phaseTemplates', 'engTemplateAdmin', 'adminDatabaseMigration', 'adminMyTool', 'lessonsLearnt', 'handoverHealth', 'adminWorkflowConfig', 'adminBackfill', 'adminPipedrive'],
    primaryPath: '/settings',
  },
];

/** Look up which module a page belongs to by its registry ID */
export function getModuleForPage(pageId: string): CanonicalModule | undefined {
  for (const mod of MODULE_DEFINITIONS) {
    if (mod.pageIds.includes(pageId)) {
      return mod.id;
    }
  }
  return undefined;
}

/** Look up which module a path belongs to */
export function getModuleForPath(pathname: string): CanonicalModule | undefined {
  const page = PAGE_REGISTRY.find(p => p.path === pathname || (p.matchSubRoutes && pathname.startsWith(`${p.path}/`)));
  if (page) {
    return getModuleForPage(page.id);
  }
  return undefined;
}

/** Get module definitions visible for a given set of allowed modules */
export function getVisibleModules(allowedModules: CanonicalModule[]): ModuleDefinition[] {
  const allowed = new Set(allowedModules);
  return MODULE_DEFINITIONS.filter(mod => allowed.has(mod.id));
}

/** Get all pages in a module */
export function getModulePages(moduleId: CanonicalModule): PageRegistryEntry[] {
  const mod = MODULE_DEFINITIONS.find(m => m.id === moduleId);
  if (!mod) return [];
  const idSet = new Set(mod.pageIds);
  return PAGE_REGISTRY.filter(p => idSet.has(p.id));
}
