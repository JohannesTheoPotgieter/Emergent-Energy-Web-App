import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageLayout — canonical page content wrapper.
 *
 * Additive Phase 1 primitive. Wraps children in the existing `.ee-page`
 * container (max-width 1440px, vertical spacing). Use this for any new
 * page migration to guarantee consistent max-width and gap rhythm.
 *
 * See docs/overhaul/01-design-system.md §3 (L4).
 */

export interface PageLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Optional sub-nav pill row rendered immediately after the page heading.
   * Uses existing `.ee-subnav-pill` class family in index.css.
   */
  subNav?: React.ReactNode;
  /**
   * Content rendered above the main content area (e.g. PageHeader).
   * Kept as a separate slot so sticky behaviour on PageHeader is preserved
   * by the layout's scroll container.
   */
  header?: React.ReactNode;
}

export function PageLayout({
  header,
  subNav,
  className,
  children,
  ...rest
}: PageLayoutProps) {
  return (
    <div
      className={cn("ee-page", className)}
      data-testid="page-layout"
      {...rest}
    >
      {header}
      {subNav && (
        <nav
          aria-label="Sub-navigation"
          data-testid="page-layout-subnav"
          className="ee-context-row"
        >
          {subNav}
        </nav>
      )}
      <div data-testid="page-layout-content" className="space-y-4">
        {children}
      </div>
    </div>
  );
}
