import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Cloud,
  Database,
  FileSpreadsheet,
  FileText,
  Gauge,
  ListChecks,
  Plug,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  BookOpen,
  Handshake,
  Mail,
  Milestone,
} from "lucide-react";

export type AdminSurfaceId =
  | "control-center"
  | "smart-import"
  | "roles"
  | "audit-log"
  | "import-control-tower"
  | "data-migration"
  | "pipedrive"
  | "quickbooks"
  | "sharepoint-intake"
  | "phase-templates"
  | "eng-templates"
  | "workflow-config"
  | "my-work-settings"
  | "kpi-traceability"
  | "recovery"
  | "database-migration"
  | "document-types"
  | "email-linker-dev"
  | "lessons-learnt"
  | "handover-health"
  | "system-settings"
  | "stage-lifecycle";

export interface AdminSurfaceMeta {
  id: AdminSurfaceId;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
}

export const ADMIN_SURFACES: AdminSurfaceMeta[] = [
  // --- Core ---
  {
    id: "control-center",
    label: "Control Center",
    path: "/admin/control-center",
    description: "System governance, health, and operational exceptions.",
    icon: Gauge,
  },
  {
    id: "smart-import",
    label: "Smart Import",
    path: "/admin/smart-import",
    description: "Controlled intake, review, and commit of Excel tracker data.",
    icon: FileSpreadsheet,
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    path: "/admin/roles",
    description: "Backend-aligned access, authority, and role assignment control.",
    icon: ShieldCheck,
  },
  {
    id: "audit-log",
    label: "Audit Log",
    path: "/admin/activity-log",
    description: "Trace who changed what, when, and from where.",
    icon: ScrollText,
  },
  // --- Data & Integration ---
  {
    id: "import-control-tower",
    label: "Import Control Tower",
    path: "/admin/import-control-tower",
    description: "Monitor and manage import pipelines and data ingestion.",
    icon: FileSpreadsheet,
  },
  {
    id: "data-migration",
    label: "Data Migration Status",
    path: "/admin/data-migration-status",
    description: "Track progress of data migrations and backfill operations.",
    icon: Database,
  },
  {
    id: "pipedrive",
    label: "Pipedrive Integration",
    path: "/admin/pipedrive",
    description: "Manage Pipedrive CRM sync and deal pipeline integration.",
    icon: Plug,
  },
  {
    id: "sharepoint-intake",
    label: "SharePoint Intake",
    path: "/admin/sharepoint-intake",
    description: "Configure SharePoint document and data intake channels.",
    icon: Cloud,
  },
  // --- Configuration ---
  {
    id: "phase-templates",
    label: "Phase Templates",
    path: "/admin/phase-templates",
    description: "Define and manage project phase and milestone templates.",
    icon: ListChecks,
  },
  {
    id: "eng-templates",
    label: "Engineering Templates",
    path: "/admin/eng-templates",
    description: "Manage engineering stage and deliverable templates.",
    icon: FileText,
  },
  {
    id: "workflow-config",
    label: "Workflow Configuration",
    path: "/admin/workflow-config",
    description: "Configure approval workflows and automation rules.",
    icon: Workflow,
  },
  {
    id: "my-work-settings",
    label: "My Work Admin",
    path: "/admin/my-tool-settings",
    description: "Configure My Work defaults and task board settings.",
    icon: Settings,
  },
  // --- Operations ---
  {
    id: "kpi-traceability",
    label: "KPI Traceability",
    path: "/admin/kpi-traceability",
    description: "Trace KPI calculations back to source data and rules.",
    icon: Activity,
  },
  {
    id: "recovery",
    label: "Recovery Center",
    path: "/admin/recovery",
    description: "Restore soft-deleted records and recover lost data.",
    icon: ShieldAlert,
  },
  {
    id: "database-migration",
    label: "Database Migration",
    path: "/admin/database-migration",
    description: "Run and monitor database schema migrations.",
    icon: Database,
  },
  // --- Document & Knowledge ---
  {
    id: "document-types",
    label: "Document Types",
    path: "/admin/document-types",
    description: "Manage controlled document taxonomy and SharePoint root config.",
    icon: FileText,
  },
  {
    id: "email-linker-dev",
    label: "Email Auto-Linker (dev)",
    path: "/admin/email-linker-dev",
    description: "Inspect and tune the email→entity auto-linking heuristics.",
    icon: Mail,
  },
  {
    id: "lessons-learnt",
    label: "Lessons Learnt",
    path: "/admin/lessons",
    description: "Review captured lessons learnt across project handovers.",
    icon: BookOpen,
  },
  {
    id: "handover-health",
    label: "Handover Health",
    path: "/admin/handover-health",
    description: "Health scoring across PD↔PM handovers.",
    icon: Handshake,
  },
  {
    id: "system-settings",
    label: "System Settings",
    path: "/admin/settings",
    description: "Global system settings and tenant configuration.",
    icon: Settings,
  },
  {
    id: "quickbooks",
    label: "QuickBooks Integration",
    path: "/admin/quickbooks",
    description: "Manage QuickBooks OAuth, sync state, and reconnections.",
    icon: Plug,
  },
  {
    id: "stage-lifecycle",
    label: "Stage Lifecycle",
    path: "/admin/stage-lifecycle",
    description: "Configure stage definitions, gate rules, and lifecycle policies.",
    icon: Milestone,
  },
];

// Essential admin tools shown as secondary nav pills. Other admin surfaces
// remain accessible via command palette, direct URL, and Control Center page.
const ADMIN_NAV_IDS: AdminSurfaceId[] = [
  "control-center",
  "smart-import",
  "roles",
  "audit-log",
  "recovery",
  "import-control-tower",
];

// Reports items absorbed into Admin (Prompt 2 — Reports moves under Admin)
const REPORTS_NAV_ITEMS: Array<{ label: string; path: string }> = [
  { label: "PM Monthly", path: "/reports/pm/monthly" },
  { label: "Eng Monthly", path: "/reports/engineering/monthly" },
  { label: "Programme", path: "/reports/programme" },
  { label: "Priorities", path: "/priorities" },
  { label: "Processes & SOPs", path: "/ee-info" },
  { label: "Feedback", path: "/feedback" },
];

export const ADMIN_NAV_ITEMS = [
  ...ADMIN_SURFACES
    .filter((s) => ADMIN_NAV_IDS.includes(s.id))
    .map(({ label, path }) => ({ label, path })),
  ...REPORTS_NAV_ITEMS,
];

export function getAdminSurfaceMeta(surfaceId: AdminSurfaceId) {
  return ADMIN_SURFACES.find((surface) => surface.id === surfaceId);
}
