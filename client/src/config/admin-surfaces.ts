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
} from "lucide-react";

export type AdminSurfaceId =
  | "control-center"
  | "smart-import"
  | "roles"
  | "audit-log"
  | "import-control-tower"
  | "data-migration"
  | "pipedrive"
  | "sharepoint-intake"
  | "phase-templates"
  | "eng-templates"
  | "workflow-config"
  | "my-work-settings"
  | "kpi-traceability"
  | "recovery"
  | "database-migration";

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
];

export const ADMIN_NAV_ITEMS = ADMIN_SURFACES.map(({ label, path }) => ({ label, path }));

export function getAdminSurfaceMeta(surfaceId: AdminSurfaceId) {
  return ADMIN_SURFACES.find((surface) => surface.id === surfaceId);
}
