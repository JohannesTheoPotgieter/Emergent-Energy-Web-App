import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

/**
 * DetailLayout — canonical W4 Detail archetype composition.
 *
 * Additive Phase 1 primitive. Composes a sticky summary header with tab
 * navigation and per-tab content.
 *
 * Contract (docs/overhaul/01-design-system.md §3 L6, wireframe W4):
 *   - summary: sticky composite (title + sub-line + KPI strip + actions)
 *   - tabs: ordered list of { key, label, count?, content }
 *   - defaultTab / activeTab: URL-reflective tab state (caller owns
 *     persistence — use wouter / searchParams)
 *   - Caller decides which archetype each tab's content uses (TableLayout
 *     for list tabs, plain Card for overview, etc.)
 */

export interface DetailLayoutTab {
  /** Stable key — used for URL ?tab= persistence. */
  key: string;
  /** Visible label. */
  label: string;
  /** Optional count badge shown next to the label. */
  count?: number;
  /** Tab body content. */
  content: React.ReactNode;
  /** Disable this tab (e.g. user lacks permission for its data). */
  disabled?: boolean;
}

export interface DetailLayoutProps {
  /**
   * Summary block pinned to the top — typically a PageHeader with
   * `status`, `kpiStrip`, and `sticky` props set per wireframe W4.
   */
  summary: React.ReactNode;
  /** Tabs configuration. */
  tabs: DetailLayoutTab[];
  /**
   * Controlled active tab key. If omitted, the primitive falls back to
   * uncontrolled state using `defaultTab`.
   */
  activeTab?: string;
  /** Default tab when uncontrolled. Defaults to the first tab's key. */
  defaultTab?: string;
  /** Called when the user selects a different tab. */
  onTabChange?: (key: string) => void;
  className?: string;
}

export function DetailLayout({
  summary,
  tabs,
  activeTab,
  defaultTab,
  onTabChange,
  className,
}: DetailLayoutProps) {
  if (tabs.length === 0) {
    throw new Error("DetailLayout: `tabs` must contain at least one entry.");
  }

  const initial = defaultTab ?? tabs[0].key;

  return (
    <div
      data-testid="detail-layout"
      className={cn("flex flex-col gap-4", className)}
    >
      <div
        data-testid="detail-layout-summary"
        className="sticky top-0 z-[10] bg-background border-b border-border pb-3"
      >
        {summary}
      </div>

      <Tabs
        value={activeTab}
        defaultValue={initial}
        onValueChange={onTabChange}
        data-testid="detail-layout-tabs"
        className="w-full"
      >
        <TabsList
          data-testid="detail-layout-tabs-list"
          className="sticky top-[calc(var(--detail-summary-height,64px))] z-[9] justify-start w-full overflow-x-auto"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              disabled={tab.disabled}
              data-testid={`detail-layout-tab-${tab.key}`}
              className="gap-2"
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-[1.25rem] px-1.5 text-[11px]"
                  data-testid={`detail-layout-tab-count-${tab.key}`}
                >
                  {tab.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            data-testid={`detail-layout-tab-content-${tab.key}`}
            className="mt-4 focus-visible:outline-none"
          >
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
