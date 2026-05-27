/**
 * TF-18 (audit V3) — Canonical TanStack Query stale-time policy for the
 * finance surface.
 *
 * Different finance pages historically picked their own `staleTime`
 * (30s here, 5min there, 2min polling on the dashboard). Operators
 * leaving a tab idle for 10 minutes would see stale data on focus
 * because `refetchOnWindowFocus: false` is the default — and the
 * staleness varied by page, so the UX felt arbitrary.
 *
 * Apply one of these three policies to every finance-related useQuery:
 *
 *   FINANCE_QUERY_VOLATILE     30s + refetch on focus
 *                               — Use for fast-moving operator
 *                                 surfaces: cashflow week edits,
 *                                 COS budget drilldowns, the trust
 *                                 strip.
 *
 *   FINANCE_QUERY_STABLE       5min + refetch on focus
 *                               — Use for derived rollups that don't
 *                                 mutate often: GP company tile,
 *                                 portfolio totals, FY-scope KPIs.
 *
 *   FINANCE_QUERY_REALTIME     10s polling + refetch on focus
 *                               — Reserve for live-monitoring views:
 *                                 sync-health, the QB integration
 *                                 status tile.
 *
 * Spread the object into the query options:
 *
 *   useQuery({
 *     queryKey: [...],
 *     queryFn: ...,
 *     ...FINANCE_QUERY_STABLE,
 *   });
 */

export const FINANCE_QUERY_VOLATILE = {
  staleTime: 30 * 1000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export const FINANCE_QUERY_STABLE = {
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export const FINANCE_QUERY_REALTIME = {
  staleTime: 10 * 1000,
  refetchInterval: 10 * 1000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export type FinanceStalePolicy =
  | typeof FINANCE_QUERY_VOLATILE
  | typeof FINANCE_QUERY_STABLE
  | typeof FINANCE_QUERY_REALTIME;
