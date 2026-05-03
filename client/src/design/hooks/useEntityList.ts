/**
 * useEntityList — canonical data-access primitive for reading a list of entities.
 *
 * Adds query-param handling (pagination, filters, sort) on top of the same
 * standardised caching + retry + error surfacing as useEntity.
 *
 * Migration is opt-in per screen in Phase 3. Hand-rolled useQuery call-sites
 * remain valid while legacy screens are untouched.
 *
 * Cited: docs/overhaul/01-design-system.md §4.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface UseEntityListOptions<T> {
  /** Query params serialised to the URL (?foo=bar&baz=qux). */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Disable the query. */
  enabled?: boolean;
  /** Override default stale time (15s — lists are more volatile than single entities). */
  staleTime?: number;
  /** Transform the response before returning. */
  select?: (raw: unknown) => T[];
  /** Passed through for advanced cases. */
  queryOptions?: Partial<UseQueryOptions<T[]>>;
}

function buildUrl(url: string, params?: UseEntityListOptions<unknown>["params"]): string {
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.append(k, String(v));
  }
  const suffix = qs.toString();
  if (!suffix) return url;
  return url.includes("?") ? `${url}&${suffix}` : `${url}?${suffix}`;
}

/**
 * Fetch a list of entities from the canonical backend.
 *
 * @param url canonical list route (e.g. `/api/projects`).
 * @param options optional params + overrides.
 */
export function useEntityList<T = unknown>(
  url: string,
  options?: UseEntityListOptions<T>,
) {
  const fullUrl = buildUrl(url, options?.params);

  return useQuery<T[]>({
    queryKey: [url, options?.params],
    queryFn: async () => {
      const res = await apiRequest("GET", fullUrl);
      const json: unknown = await res.json();
      return (options?.select ? options.select(json) : (json as T[]));
    },
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 15_000,
    ...options?.queryOptions,
  });
}
