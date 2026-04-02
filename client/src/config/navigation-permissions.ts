import { TOP_SECTIONS } from "@/config/app-navigation";
import { getPermissionEntityForPath } from "@/config/page-registry";
import { ENTITY_DESCRIPTIONS } from "@/pages/admin-settings/settings-types";
import type { PermissionEntity } from "@shared/schema";

export type AccessLevel = "none" | "view" | "edit";

export type NavigationPermissionItem = {
  sectionKey: string;
  sectionLabel: string;
  itemLabel: string;
  path: string;
  permissionEntity?: PermissionEntity;
  description?: string;
  supportsEdit: boolean;
};

const SECTION_HELP_TEXT: Record<string, string> = {
  HOME: "Dashboard, My Tasks, Approvals, Calendar, Meetings, Inbox",
  PORTFOLIO: "Company Overview, Lifecycle Board, Gate Tracker, Blocked Gates, Exceptions",
  PRIORITIES: "My Priorities, Department, Company",
  PROJECT_DEVELOPMENT: "PD Dashboard, Pipeline / Opportunities, PD Tickets, Clients, Handover Queue, PD Reports",
  PROJECT_DELIVERY: "Execution Dashboard, PM Dashboard, Portfolio Dashboard, All Projects, PM On-The-Go, Handover & Closeout, and delivery controls",
  FINANCE: "Cashflow, Revenue, COS, GP / Margin, FYE Revenue, Counterparties, Subcontractors, Invoice Patterns",
  ENGINEERING: "Engineering Dashboard, Task Board, Standup",
  HSE: "HSE Dashboard",
  QUALITY: "Quality Dashboard, Commissioning",
  REPORTS: "Report Center, Programme Reports, PM Monthly, Engineering Monthly, Performance",
  ADMIN: "Control Center, Roles & Permissions, Smart Import, Audit Log, Processes & SOPs, Templates, Recovery",
};

function basePath(path: string) {
  return path.split("?")[0] || path;
}

export const NAVIGATION_PERMISSION_MODEL = TOP_SECTIONS.map((section) => {
  const items = section.secondary.map((item) => {
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

export function validateNavigationPermissionModel() {
  const warnings: string[] = [];
  const keySet = new Set<string>();

  for (const section of NAVIGATION_PERMISSION_MODEL) {
    for (const item of section.items) {
      const identity = `${section.key}:${item.path}`;
      if (keySet.has(identity)) {
        warnings.push(`Duplicate navigation key detected: ${identity}`);
      }
      keySet.add(identity);

      if (!item.permissionEntity) {
        warnings.push(`Navigation item "${item.itemLabel}" (${item.path}) has no permission entity mapping.`);
      }
    }
  }

  return warnings;
}
