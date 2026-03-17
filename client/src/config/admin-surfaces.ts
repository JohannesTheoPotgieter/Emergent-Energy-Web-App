import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

export type AdminSurfaceId =
  | "control-center"
  | "smart-import"
  | "excel-updates"
  | "roles"
  | "audit-log";

export interface AdminSurfaceMeta {
  id: AdminSurfaceId;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
}

export const ADMIN_SURFACES: AdminSurfaceMeta[] = [
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
    id: "excel-updates",
    label: "Excel Updates",
    path: "/admin/excel-updates",
    description: "Pending source confirmations and tracker reconciliation work.",
    icon: ClipboardCheck,
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
];

export const ADMIN_NAV_ITEMS = ADMIN_SURFACES.map(({ label, path }) => ({ label, path }));

export function getAdminSurfaceMeta(surfaceId: AdminSurfaceId) {
  return ADMIN_SURFACES.find((surface) => surface.id === surfaceId);
}
