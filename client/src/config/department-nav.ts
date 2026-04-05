/**
 * Department Navigation Configuration — Migration Control Pack Wave 1
 *
 * 9-department model (revised per Johannes):
 *   Home | Priorities | Project Development | Project Management | Engineering | Quality | Finance | Parties | Admin
 *
 * Changes from 11-section model:
 *   - HSE: folded into Project Management as a tab
 *   - Portfolio: folded into Project Management as a tab
 *   - Reports: distributed into each department's secondary nav
 *   - Company: merged into Project Management (lifecycle board, gates, etc.)
 *   - Priorities: stays as top-level
 *
 * Feature-flagged behind DEPARTMENT_SHELL_ENABLED.
 */

import type { TopSection } from "./app-navigation";

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}

export const DEPARTMENT_SECTIONS: TopSection[] = [
  {
    label: "Home",
    key: "HOME",
    path: "/",
    match: (pathname) => pathname === "/" || startsWithAny(pathname, ["/my-work", "/inbox"]),
    secondary: [
      { label: "My Dashboard", path: "/" },
      { label: "My Tasks", path: "/my-work/tasks" },
      { label: "Approvals", path: "/my-work/approvals" },
      { label: "Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
      { label: "Inbox", path: "/inbox" },
    ],
  },
  {
    label: "Priorities",
    key: "PRIORITIES",
    path: "/priorities",
    match: (pathname) => startsWithAny(pathname, ["/priorities"]),
    secondary: [
      { label: "My Priorities", path: "/priorities?tab=mine" },
      { label: "Department", path: "/priorities?tab=department" },
      { label: "Company", path: "/priorities?tab=company" },
    ],
  },
  {
    label: "Project Development",
    key: "PROJECT_DEVELOPMENT",
    path: "/pd",
    match: (pathname) => startsWithAny(pathname, [
      "/pd", "/opportunities", "/clients",
      "/handover-control",
    ]),
    secondary: [
      { label: "PD Dashboard", path: "/pd" },
      { label: "Pipeline / Opportunities", path: "/opportunities" },
      { label: "PD Tickets", path: "/pd/tickets" },
      { label: "Clients", path: "/clients" },
      { label: "Handover Queue", path: "/handover-control" },
      { label: "PD Reports", path: "/pd/reports" },
    ],
  },
  {
    label: "Project Management",
    key: "PROJECT_MANAGEMENT",
    path: "/execution-board",
    match: (pathname) => startsWithAny(pathname, [
      "/execution-board",
      "/portfolios",
      "/projects", "/project", "/project-create",
      "/procurement",
      "/handover",
      "/pm", "/sites",
      "/governance/financial-reviews",
      "/po-approval-board", "/payment-request-board", "/payment-batch-manager",
      "/gates",
      "/milestone-tracker",
      "/weekly-reviews",
      "/pm-dashboard",
      "/company-overview",
      "/lifecycle-board",
      "/exceptions",
      "/project-lifecycle",
      "/hse",
      "/construction-dashboard",
      "/standups",
    ]),
    secondary: [
      // Core PM
      { label: "Execution Dashboard", path: "/execution-board" },
      { label: "PM Dashboard", path: "/pm-dashboard" },
      { label: "Workboard", path: "/pm/workboard" },
      { label: "All Projects", path: "/projects" },
      { label: "Milestone Tracker", path: "/milestone-tracker" },
      { label: "Weekly Reviews", path: "/weekly-reviews" },
      { label: "Standups", path: "/standups" },
      { label: "PM Approvals", path: "/pm/approvals" },
      { label: "PM On-The-Go", path: "/pm/on-the-go" },
      // Financial processes under PM
      { label: "PO Approvals", path: "/po-approval-board" },
      { label: "Payment Requests", path: "/payment-request-board" },
      { label: "Payment Batches", path: "/payment-batch-manager" },
      { label: "Financial Reviews", path: "/governance/financial-reviews" },
      // Handover & closeout
      { label: "Handover & Closeout", path: "/handover" },
      { label: "Sites", path: "/sites" },
      // Portfolio tab (folded from Company section)
      { label: "Company Overview", path: "/company-overview" },
      { label: "Lifecycle Board", path: "/lifecycle-board" },
      { label: "Portfolio Dashboard", path: "/portfolios" },
      { label: "Gate Tracker", path: "/gates" },
      { label: "Blocked Gates", path: "/gates/blocked" },
      { label: "Exceptions", path: "/gates/exceptions" },
      // HSE tab (folded from standalone HSE section)
      { label: "HSE Dashboard", path: "/hse" },
      // PM Reports (distributed from Reports section)
      { label: "PM Monthly Report", path: "/reports/pm/monthly" },
      { label: "Programme Reports", path: "/reports/programme" },
      { label: "Performance", path: "/reports/performance" },
    ],
  },
  {
    label: "Engineering",
    key: "ENGINEERING",
    path: "/engineering",
    match: (pathname) => startsWithAny(pathname, ["/engineering"]),
    secondary: [
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Task Board", path: "/engineering/tasks" },
      { label: "Standup", path: "/engineering/standup" },
      // Engineering Reports (distributed from Reports section)
      { label: "Engineering Monthly Report", path: "/reports/engineering/monthly" },
    ],
  },
  {
    label: "Quality",
    key: "QUALITY",
    path: "/quality",
    match: (pathname) => startsWithAny(pathname, ["/quality", "/commissioning-dashboard"]),
    secondary: [
      { label: "Quality Dashboard", path: "/quality" },
      { label: "Commissioning", path: "/commissioning-dashboard" },
    ],
  },
  {
    label: "Finance",
    key: "FINANCE",
    path: "/cashflow",
    match: (pathname) => startsWithAny(pathname, [
      "/cashflow", "/cos", "/revenue-tracker", "/gp-tracker",
      "/invoice-patterns",
      "/fye-revenue-tracking",
    ]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "COS", path: "/cos" },
      { label: "GP / Margin", path: "/gp-tracker" },
      { label: "FYE Revenue", path: "/fye-revenue-tracking" },
      { label: "Invoice Patterns", path: "/invoice-patterns" },
    ],
  },
  {
    label: "Parties",
    key: "PARTIES",
    path: "/counterparties",
    match: (pathname) => startsWithAny(pathname, [
      "/counterparties", "/subcontractor-dashboard",
      "/parties",
    ]),
    secondary: [
      { label: "Counterparties", path: "/counterparties" },
      { label: "Subcontractors", path: "/subcontractor-dashboard" },
    ],
  },
  {
    label: "Admin",
    key: "ADMIN",
    path: "/admin/control-center",
    match: (pathname) => startsWithAny(pathname, [
      "/admin", "/settings", "/ee-info", "/feedback", "/training",
      "/leaderboard", "/department-scores",
    ]),
    secondary: [
      { label: "Control Center", path: "/admin/control-center" },
      { label: "Roles & Permissions", path: "/admin/roles" },
      { label: "Smart Import", path: "/admin/smart-import" },
      { label: "Audit Log", path: "/admin/activity-log" },
      { label: "Processes & SOPs", path: "/ee-info" },
      { label: "Templates", path: "/admin/phase-templates" },
      { label: "Recovery", path: "/admin/recovery" },
      { label: "Migration Control", path: "/admin/migration-control" },
      { label: "Report Center", path: "/reports/center" },
    ],
  },
];

/**
 * Role-based section visibility for the 9-department model.
 * Changes from 11-section model:
 *   - PORTFOLIO → PROJECT_MANAGEMENT (folded in)
 *   - HSE → PROJECT_MANAGEMENT (folded in)
 *   - REPORTS → removed (distributed into departments)
 *   - PROJECT_DELIVERY → PROJECT_MANAGEMENT (renamed)
 *   - Added PARTIES for all roles that had counterparties/subcontractor access
 */
export const DEPARTMENT_ROLE_VISIBLE_SECTIONS: Record<string, string[]> = {
  COO_ADMIN:              ["HOME", "PROJECT_DEVELOPMENT", "PROJECT_MANAGEMENT", "ENGINEERING", "QUALITY", "FINANCE", "PRIORITIES", "PARTIES", "ADMIN"],
  CEO_ADMIN:              ["HOME", "PROJECT_DEVELOPMENT", "PROJECT_MANAGEMENT", "FINANCE", "PRIORITIES", "PARTIES", "ADMIN"],
  CCO:                    ["HOME", "PROJECT_DEVELOPMENT", "FINANCE", "PRIORITIES", "PARTIES"],
  KEY_ACCOUNTS_MANAGER:   ["HOME", "PROJECT_DEVELOPMENT", "FINANCE", "PRIORITIES", "PARTIES"],
  PROGRAM_MANAGER:        ["HOME", "PROJECT_MANAGEMENT", "QUALITY", "FINANCE", "PRIORITIES", "PARTIES"],
  PROJECT_MANAGER_SITE:   ["HOME", "PROJECT_MANAGEMENT", "QUALITY", "FINANCE", "PRIORITIES", "PARTIES"],
  CONSTRUCTION_MANAGER:   ["HOME", "PROJECT_MANAGEMENT", "FINANCE", "QUALITY", "PRIORITIES", "PARTIES"],
  ENGINEER:               ["HOME", "ENGINEERING", "QUALITY", "PRIORITIES"],
  ENGINEERING_MANAGER:    ["HOME", "ENGINEERING", "QUALITY", "PROJECT_MANAGEMENT", "PRIORITIES"],
  QUALITY_MANAGER:        ["HOME", "QUALITY", "PROJECT_MANAGEMENT", "PRIORITIES"],
  HSE_MANAGER:            ["HOME", "PROJECT_MANAGEMENT", "PRIORITIES"],
  SSEG_MANAGER:           ["HOME", "PROJECT_MANAGEMENT", "QUALITY", "ENGINEERING", "PRIORITIES"],
  CFO:                    ["HOME", "FINANCE", "PROJECT_MANAGEMENT", "PRIORITIES"],
  PROGRAM_FINANCE_MANAGER:["HOME", "FINANCE", "PROJECT_MANAGEMENT", "PRIORITIES"],
  ACCOUNTANT:             ["HOME", "FINANCE", "PRIORITIES"],
  PROJECT_DEVELOPER:      ["HOME", "PROJECT_DEVELOPMENT", "FINANCE", "PRIORITIES"],
};

/**
 * Maps canonical module names (from lens profiles) to department section keys.
 */
export const DEPARTMENT_MODULE_TO_SECTION_KEYS: Record<string, string[]> = {
  HOME:        ["HOME"],
  EXECUTIVE:   ["PROJECT_MANAGEMENT"],
  PORTFOLIO:   ["PROJECT_MANAGEMENT"],
  PIPELINE:    ["PROJECT_DEVELOPMENT"],
  PROJECTS:    ["PROJECT_MANAGEMENT"],
  DELIVERY:    ["PROJECT_MANAGEMENT"],
  FINANCE:     ["FINANCE"],
  ENGINEERING: ["ENGINEERING"],
  COMPLIANCE:  ["QUALITY"],
  DOCUMENTS:   [],
  REPORTS:     [],          // Reports are now distributed into each department
  PRIORITIES:  ["PRIORITIES"],
  ADMIN:       ["ADMIN"],
  PARTIES:     ["PARTIES"],
};
