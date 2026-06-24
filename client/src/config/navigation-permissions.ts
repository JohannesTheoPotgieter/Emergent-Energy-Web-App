import { TOP_SECTIONS, type SectionKey } from "@/config/app-navigation";
import { getPermissionEntityForPath } from "@/config/page-registry";
import { ENTITY_DESCRIPTIONS } from "@/pages/admin-settings/settings-types";
import type { PermissionEntity } from "@shared/schema";

export type AccessLevel = "none" | "view" | "edit";

export type NavigationPermissionItem = {
  sectionKey: SectionKey;
  sectionLabel: string;
  itemLabel: string;
  path: string;
  permissionEntity?: PermissionEntity;
  description?: string;
  supportsEdit: boolean;
};

// Friendly one-line summary shown under each section heading in the role
// nav-access editor. Keep the rendered entries in step with the live sub-pages
// in app-navigation.ts (TOP_SECTIONS). Only keys that appear in TOP_SECTIONS —
// the live six-tab nav — are rendered; the remaining keys are legacy
// data-scope sections kept for role storage and are not shown.
const SECTION_HELP_TEXT: Partial<Record<SectionKey, string>> = {
  // Rendered — live six-tab nav (must mirror TOP_SECTIONS sub-pages):
  HOME: "My Dashboard, Priorities, Calendar, Meetings, Inbox",
  PROJECT_DELIVERY: "Board, Activity Planning, Deliveries, Allocations",
  ENGINEERING: "Home, Task Manager, Document Manager",
  FINANCE: "Finance Home, Cashflow, Cost of Sales, Revenue, Gross Profit, QB Reconciliation, FYE Tracking Report",
  QUALITY: "Quality Dashboard, Quality Task Board, Quality Document Management",
  ADMIN: "Roles & Permissions, Integration Statuses, Audit Log",
  // Legacy data-scope sections — not in the live nav, not rendered today:
  PORTFOLIO: "Company Overview, Lifecycle Board, Gate Tracker, Blocked Gates, Exceptions",
  PRIORITIES: "Department, Company",
  PROJECT_DEVELOPMENT: "Project Development Dashboard, Pipeline / Opportunities, Clients, Handover Queue, Project Development Reports",
  HSE: "HSE Dashboard",
  REPORTS: "Report Center, Programme Reports, PM Monthly, Engineering Monthly, Performance, CEO Dashboard, COO Dashboard",
};

function basePath(path: string) {
  return path.split("?")[0] || path;
}

export const NAVIGATION_PERMISSION_MODEL = TOP_SECTIONS.map((section) => {
  const items = (section.secondary ?? []).map((item) => {
    const entity = getPermissionEntityForPath(basePath(item.path));
    return {
      sectionKey: section.key,
      sectionLabel: section.label,
      itemLabel: item.label,
      path: item.path,
      permissionEntity: entity,
      description: entity ? ENTITY_DESCRIPTIONS[entity] : undefined,
      supportsEdit: Boolean(entity),
    } satisfies NavigationPermissionItem;
  });

  return {
    key: section.key,
    label: section.label,
    helpText: SECTION_HELP_TEXT[section.key] || "",
    items,
  };
});

/**
 * Paths that are intentionally allowed to have no permission entity.
 * Examples: the root "/" (HOME is always visible), and query-param-only tabs
 * whose base path is already gated by a separate entry.
 */
const MISSING_ENTITY_ALLOWLIST = new Set<string>([
  "/",
  "/priorities?tab=department",
  "/priorities?tab=company",
]);

export type NavigationPermissionIssue = {
  severity: "error" | "warning";
  message: string;
};

export function validateNavigationPermissionModel(): NavigationPermissionIssue[] {
  const issues: NavigationPermissionIssue[] = [];
  const keySet = new Set<string>();

  for (const section of NAVIGATION_PERMISSION_MODEL) {
    for (const item of section.items) {
      const identity = `${section.key}:${item.path}`;
      if (keySet.has(identity)) {
        issues.push({ severity: "error", message: `Duplicate navigation key: ${identity}` });
      }
      keySet.add(identity);

      if (!item.permissionEntity && !MISSING_ENTITY_ALLOWLIST.has(item.path)) {
        issues.push({
          severity: "warning",
          message: `Navigation item "${item.itemLabel}" (${item.path}) has no permission entity mapping.`,
        });
      }
    }
  }

  return issues;
}
