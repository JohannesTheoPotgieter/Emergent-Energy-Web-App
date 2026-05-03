import * as React from "react";
import { cn } from "@/lib/utils";
import { layout as layoutTokens } from "@/design/tokens";

/**
 * AppShell — outermost chrome frame for migrated pages.
 *
 * Additive Phase 1 primitive. Coexists with existing AppLayout.tsx; do not
 * replace AppLayout until every screen has migrated and the swap has been
 * explicitly signed off per overhaul rules.
 *
 * Layout contract (docs/overhaul/01-wireframes.md W1):
 *   - Top bar (56px desktop / 48px mobile) — slot: `topBar`
 *   - Sidebar (240px expanded / 64px collapsed) — slot: `sidebar`
 *   - Main content area scrolls independently
 *   - Optional banner slots above top bar for version / offline banners
 *
 * The shell does NOT implement top-bar or sidebar contents itself — those
 * are composed by the page using AppShell. This keeps the primitive lean
 * and migration safe.
 */

export interface AppShellProps {
  /** Rendered at the very top, above the top bar. Version/offline banners. */
  banner?: React.ReactNode;
  /** Top bar content — logo, command palette trigger, user menu. */
  topBar: React.ReactNode;
  /** Sidebar content — typically a LensNav instance. */
  sidebar: React.ReactNode;
  /** Optional bottom tab bar (mobile only — hidden ≥md). */
  bottomTabBar?: React.ReactNode;
  /**
   * Collapsed sidebar state. When true, sidebar renders at the narrow
   * width for icon-only mode. Caller owns this state.
   */
  sidebarCollapsed?: boolean;
  /** Main page content. */
  children: React.ReactNode;
  className?: string;
}

export function AppShell({
  banner,
  topBar,
  sidebar,
  bottomTabBar,
  sidebarCollapsed = false,
  children,
  className,
}: AppShellProps) {
  return (
    <div
      className={cn("ee-shell min-h-screen flex flex-col", className)}
      data-testid="app-shell"
    >
      {banner && (
        <div data-testid="app-shell-banner" className="shrink-0">
          {banner}
        </div>
      )}

      <header
        role="banner"
        data-testid="app-shell-topbar"
        className="shrink-0 border-b border-border bg-background"
        style={{ height: layoutTokens.topBarHeight }}
      >
        {topBar}
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          data-testid="app-shell-sidebar"
          aria-label="Primary"
          className={cn(
            "hidden md:flex shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex-col transition-[width] duration-150",
          )}
          style={{
            width: sidebarCollapsed
              ? layoutTokens.sidebarWidthCollapsed
              : layoutTokens.sidebarWidth,
          }}
        >
          {sidebar}
        </aside>

        <main
          role="main"
          data-testid="app-shell-main"
          className="flex-1 min-w-0 overflow-auto"
        >
          {children}
        </main>
      </div>

      {bottomTabBar && (
        <nav
          aria-label="Mobile primary navigation"
          data-testid="app-shell-bottom-tab-bar"
          className="md:hidden shrink-0 border-t border-border bg-background"
          style={{ height: layoutTokens.bottomTabBarHeight }}
        >
          {bottomTabBar}
        </nav>
      )}
    </div>
  );
}
