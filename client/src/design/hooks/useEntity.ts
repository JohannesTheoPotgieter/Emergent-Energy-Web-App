/**
 * useEntity — canonical data-access primitive for reading a single entity.
 *
 * Thin wrapper over TanStack Query + apiRequest with the platform's agreed
 * defaults (stale-time, retry policy, error handling). Use this instead of
 * hand-rolling useQuery in components. Migration is opt-in per screen in
 * Phase 3 — existing useQuery call-sites remain valid.
 *
 * Philosophy:
 *   - The hook does NOT know about specific entity shapes. Caller supplies
 *     the URL and the expected type.
 *   - The hook standardises caching + retry + error surfacing ONLY.
 *   - Trust-envelope metadata (source, freshness, scope) is consumed via
 *     response headers by useEntityTrust (sibling primitive) — this hook
 *     stays focused on data.
 *
 * Cited: docs/overhaul/01-design-system.md §4.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface UseEntityOptions<T> {
  /** Disable the query. Useful when the URL depends on props that might be missing. */
  enabled?: boolean;
  /** Override default stale time (30s). */
  staleTime?: number;
  /** Transform the response before returning. Runs outside query key — stable references required. */
  select?: (raw: unknown) => T;
  /** Passed through to useQuery for advanced cases. */
  queryOptions?: Partial<UseQueryOptions<T>>;
}

/**
 * Fetch a single entity from the canonical backend.
 *
 * @param url absolute URL (e.g. `/api/projects/P-0041`). Must be the canonical
 *            route per docs/overhaul/00c-source-of-truth-audit.md.
 * @param options optional overrides.
 */
export function useEntity<T = unknown>(
  url: string,
  options?: UseEntityOptions<T>,
) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      const json: unknown = await res.json();
      return (options?.select ? options.select(json) : (json as T));
    },
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 30_000,
    ...options?.queryOptions,
  });
}
