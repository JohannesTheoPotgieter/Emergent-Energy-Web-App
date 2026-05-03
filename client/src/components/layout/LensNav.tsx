import * as React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { NavGroupKey, PageRegistryEntry } from "@/config/page-registry";

/**
 * LensNav — role-adaptive sidebar navigation.
 *
 * Additive Phase 1 primitive. Renders a filtered view of PAGE_REGISTRY
 * grouped by navGroup, in the fixed group order documented in
 * docs/overhaul/01-design-system.md §3 (L3).
 *
 * Caller filters entries based on the current user's access-matrix state
 * (via useAccessMatrix) and hands in the subset visible to this lens.
 * The primitive itself is access-agnostic — it renders what it's given.
 * This keeps the primitive lean and testable without mocking the full
 * permission stack.
 */

/** Fixed group order — defines the visual order in the sidebar. */
export const LENS_NAV_GROUP_ORDER: NavGroupKey[] = [
  "MY_WORK",
  "PRIORITIES",
  "PORTFOLIO",
  "GATES",
  "PROJECTS",
  "PROJECT_MANAGEMENT",
  "PROJECT_DEVELOPMENT",
  "ENGINEERING",
  "QUALITY",
  "HSE",
  "FINANCE",
  "REPORTS",
  "KNOWLEDGE",
  "SYSTEM",
];

/** Human-readable section heading per nav group. */
const GROUP_HEADING: Record<NavGroupKey, string> = {
  MY_WORK: "My Work",
  PRIORITIES: "Priorities",
  PORTFOLIO: "Portfolio",
  GATES: "Gates",
  PROJECTS: "Projects",
  PROJECT_MANAGEMENT: "Project Delivery",
  PROJECT_DEVELOPMENT: "Development",
  ENGINEERING: "Engineering",
  QUALITY: "Quality",
  HSE: "HSE",
  FINANCE: "Finance",
  REPORTS: "Reports",
  KNOWLEDGE: "Knowledge",
  SYSTEM: "System",
};

export interface LensNavProps {
  /**
   * Registry entries the caller has already filtered for the current role.
   * Pass the subset of PAGE_REGISTRY the lens is permitted to show.
   */
  entries: PageRegistryEntry[];
  /**
   * Render compact (icon-only) when true — AppShell passes its collapsed
   * state through here.
   */
  collapsed?: boolean;
  /** Optional icon resolver. Receives the entry's iconKey; returns a node. */
  renderIcon?: (iconKey: string | undefined) => React.ReactNode;
  /** Optional footer slot — usually a collapse toggle + build version. */
  footer?: React.ReactNode;
  className?: string;
}

function groupEntries(
  entries: PageRegistryEntry[],
): Map<NavGroupKey, PageRegistryEntry[]> {
  const byGroup = new Map<NavGroupKey, PageRegistryEntry[]>();
  for (const entry of entries) {
    if (!entry.navGroup || !entry.showInSidebar) continue;
    const group = byGroup.get(entry.navGroup) ?? [];
    group.push(entry);
    byGroup.set(entry.navGroup, group);
  }
  return byGroup;
}

function isActiveForPath(entry: PageRegistryEntry, pathname: string): boolean {
  if (entry.path === pathname) return true;
  if (entry.matchSubRoutes && pathname.startsWith(`${entry.path}/`)) return true;
  if (entry.aliases?.some((alias) => alias === pathname)) return true;
  return false;
}

export function LensNav({
  entries,
  collapsed = false,
  renderIcon,
  footer,
  className,
}: LensNavProps) {
  const [location] = useLocation();
  const grouped = groupEntries(entries);

  return (
    <nav
      aria-label="Lens navigation"
      data-testid="lens-nav"
      className={cn("flex h-full flex-col", className)}
    >
      <div className="flex-1 overflow-y-auto py-3">
        {LENS_NAV_GROUP_ORDER.map((groupKey) => {
          const groupItems = grouped.get(groupKey);
          if (!groupItems || groupItems.length === 0) return null;

          return (
            <div
              key={groupKey}
              data-testid={`lens-nav-group-${groupKey}`}
              className="mb-4"
            >
              {!collapsed && (
                <div
                  className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {GROUP_HEADING[groupKey]}
                </div>
              )}
              <ul className="space-y-0.5">
                {groupItems.map((entry) => {
                  const active = isActiveForPath(entry, location);
                  return (
                    <li key={entry.id}>
                      <Link
                        href={entry.path}
                        aria-current={active ? "page" : undefined}
                        data-testid={`lens-nav-item-${entry.id}`}
                        title={collapsed ? entry.label : undefined}
                        className={cn(
                          "relative flex items-center gap-3 px-4 py-1.5 text-sm transition-colors duration-150",
                          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          active &&
                            "bg-sidebar-accent text-sidebar-primary font-medium before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-sidebar-primary",
                          collapsed && "justify-center px-0",
                        )}
                      >
                        {renderIcon && (
                          <span
                            aria-hidden="true"
                            className="shrink-0 flex items-center justify-center"
                          >
                            {renderIcon(entry.iconKey)}
                          </span>
                        )}
                        {!collapsed && <span className="truncate">{entry.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {footer && (
        <div
          data-testid="lens-nav-footer"
          className="shrink-0 border-t border-sidebar-border p-3"
        >
          {footer}
        </div>
      )}
    </nav>
  );
}
