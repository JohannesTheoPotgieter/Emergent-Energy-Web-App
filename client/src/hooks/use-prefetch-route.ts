import { useCallback, useRef } from "react";

/**
 * Map of route paths to their dynamic import functions.
 * When a user hovers over a nav link, we trigger the import
 * to preload the chunk before they click.
 */
const PREFETCH_MAP: Record<string, () => Promise<unknown>> = {
  "/company-overview": () => import("@/pages/company-overview"),
  "/dashboard": () => import("@/pages/dashboard"),
  "/project-lifecycle": () => import("@/pages/project-lifecycle"),
  "/projects": () => import("@/pages/projects"),
  "/cashflow": () => import("@/pages/cashflow"),
  "/revenue-tracker": () => import("@/pages/revenue-tracker"),
  "/cos": () => import("@/pages/cos"),
  "/gp-tracker": () => import("@/pages/gp-tracker"),
  "/engineering-tasks": () => import("@/pages/engineering-tasks"),
  "/engineering-dashboard": () => import("@/pages/engineering-dashboard"),
  "/pm-dashboard": () => import("@/pages/pm-dashboard"),
  "/execution-board": () => import("@/pages/execution-board"),
  "/lifecycle-board": () => import("@/pages/lifecycle-board"),
  "/qm-dashboard": () => import("@/pages/qm-dashboard"),
  "/my-work/tasks": () => import("@/pages/my-work-tasks"),
  "/my-work/calendar": () => import("@/pages/my-work-calendar"),
  "/my-work/meetings": () => import("@/pages/my-work-meetings"),
  "/inbox": () => import("@/pages/inbox"),
  "/approvals": () => import("@/pages/admin-approvals"),
  "/portfolios": () => import("@/pages/portfolios"),
  "/admin/settings": () => import("@/pages/admin-settings"),
  "/leaderboard": () => import("@/pages/leaderboard"),
  "/report-center": () => import("@/pages/reports/report-center"),
  "/gates": () => import("@/pages/gates/gates-pipeline"),
};

const prefetched = new Set<string>();

/**
 * Returns an onPointerEnter handler that prefetches the route chunk.
 * Call once per link — deduplicates automatically.
 */
export function usePrefetchRoute() {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  return useCallback((path: string) => {
    return {
      onPointerEnter: () => {
        if (prefetched.has(path)) return;
        // Small delay to avoid prefetching on accidental hover-through
        timerRef.current = setTimeout(() => {
          const loader = PREFETCH_MAP[path];
          if (loader) {
            prefetched.add(path);
            loader().catch(() => {
              // Silently fail — user will load on click instead
              prefetched.delete(path);
            });
          }
        }, 75);
      },
      onPointerLeave: () => {
        clearTimeout(timerRef.current);
      },
    };
  }, []);
}
