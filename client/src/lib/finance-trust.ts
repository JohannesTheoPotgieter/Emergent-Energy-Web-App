/**
 * Client-side helpers for reading the X-Finance-* response envelope emitted by
 * `server/lib/finance-trust/envelope.ts`. The server emits trust metadata on
 * every finance response; this module surfaces it to the UI.
 *
 * Import {@link useFinanceQuery} to get `{ data, trust, ... }` in React pages,
 * or {@link extractTrustHeaders} directly when you already have a Response.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { networkError } from "./api-error";

export type FinanceSourceLayer =
  | "canonical"
  | "derived"
  | "cache"
  | "legacy"
  | "override";

export interface FinanceTrustMeta {
  sourceLayer: FinanceSourceLayer;
  canonicalTable: string | null;
  derivedTable: string | null;
  cacheLayer: string | null;
  uncertainty: string | null;
  refreshedAt: string | null;
  staleAfterSeconds: number | null;
  exceptionCount: number | null;
  overrideInEffect: boolean;
  featureFlag: { name: string; enabled: boolean } | null;
  nullCount: number | null;
}

function parseFeatureFlag(raw: string | null): FinanceTrustMeta["featureFlag"] {
  if (!raw) return null;
  const [name, state] = raw.split("=");
  if (!name) return null;
  return { name, enabled: state === "on" };
}

function parseNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the X-Finance-* headers off a Response object. Returns null when the
 * response did not carry a source-layer header (i.e. the endpoint hasn't been
 * enveloped yet).
 */
export function extractTrustHeaders(res: Response): FinanceTrustMeta | null {
  const sourceLayer = res.headers.get("x-finance-source-layer");
  if (!sourceLayer) return null;
  return {
    sourceLayer: sourceLayer as FinanceSourceLayer,
    canonicalTable: res.headers.get("x-finance-canonical-table"),
    derivedTable: res.headers.get("x-finance-derived-table"),
    cacheLayer: res.headers.get("x-finance-cache-layer"),
    uncertainty: res.headers.get("x-finance-trust-uncertainty"),
    refreshedAt: res.headers.get("x-finance-refreshed-at"),
    staleAfterSeconds: parseNumber(res.headers.get("x-finance-stale-after-seconds")),
    exceptionCount: parseNumber(res.headers.get("x-finance-exception-count")),
    overrideInEffect: res.headers.get("x-finance-override-in-effect") === "1",
    featureFlag: parseFeatureFlag(res.headers.get("x-finance-feature-flag")),
    nullCount: parseNumber(res.headers.get("x-finance-null-count")),
  };
}

/**
 * Some endpoints also embed the envelope in the response body under `trust`.
 * Prefer the header (authoritative), fall back to the body.
 */
export function resolveTrust<T extends { trust?: unknown } | unknown>(
  fromHeaders: FinanceTrustMeta | null,
  body: T,
): FinanceTrustMeta | null {
  if (fromHeaders) return fromHeaders;
  if (body && typeof body === "object" && "trust" in body && body.trust) {
    return body.trust as FinanceTrustMeta;
  }
  return null;
}

export interface FinanceQueryResult<T> {
  data: T | undefined;
  trust: FinanceTrustMeta | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: UseQueryResult<{ data: T; trust: FinanceTrustMeta | null }>["refetch"];
}

async function fetchWithTrust<T>(
  url: string,
  signal?: AbortSignal,
): Promise<{ data: T; trust: FinanceTrustMeta | null }> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: "include", headers });
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const body = await res.clone().json();
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const headerTrust = extractTrustHeaders(res);
  const body = (await res.json()) as T;
  return { data: body, trust: resolveTrust(headerTrust, body) };
}

/**
 * React Query hook that fetches a finance endpoint and exposes the trust
 * envelope alongside the payload. Use instead of `useQuery` on any finance
 * page that should render a {@link DataTrustBadge}.
 */
export function useFinanceQuery<T>(params: {
  queryKey: readonly unknown[];
  url: string;
  enabled?: boolean;
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
}): FinanceQueryResult<T> {
  const q = useQuery<{ data: T; trust: FinanceTrustMeta | null }>({
    queryKey: params.queryKey,
    queryFn: ({ signal }) => fetchWithTrust<T>(params.url, signal),
    enabled: params.enabled,
    staleTime: params.staleTime,
    refetchOnWindowFocus: params.refetchOnWindowFocus,
  });
  return {
    data: q.data?.data,
    trust: q.data?.trust ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
