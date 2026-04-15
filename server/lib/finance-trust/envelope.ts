/**
 * Finance trust envelope — shared helpers for provenance / refresh-age
 * signalling on every finance API response.
 *
 * These helpers produce a consistent set of `X-Finance-*` response headers
 * so clients can display trust metadata (source layer, canonical vs legacy,
 * refresh timestamp, exception counts) without changing existing response
 * bodies. Routes that already return structured JSON can additionally embed
 * the same metadata via {@link buildTrustMeta}.
 *
 * This module MUST NOT touch business calculations or mutate data. It is a
 * pure metadata + reporting layer.
 */
import type { Response } from "express";

/**
 * Source-layer classification — matches FinanceLayerClass in
 * finance-core-trust-service.ts.
 */
export type FinanceSourceLayer =
  | "canonical"
  | "derived"
  | "cache"
  | "legacy"
  | "override";

export interface FinanceTrustHeaderParams {
  /** Primary source layer this response was read from. */
  sourceLayer: FinanceSourceLayer;
  /** Canonical table(s) that the response can be traced back to. */
  canonicalTable?: string;
  /** Derived / snapshot table(s) the response reads from (if any). */
  derivedTable?: string;
  /** Cache layer identifier (e.g. compatibility cache name + TTL). */
  cacheLayer?: string;
  /**
   * Human-readable uncertainty / fallback signal. When a route silently falls
   * back from canonical to legacy this MUST be populated so the UI can warn.
   */
  uncertainty?: string | null;
  /**
   * ISO-8601 timestamp of when the underlying data was last refreshed. For
   * live queries this should be the response-build time. For cached /
   * snapshot reads it should be the snapshot timestamp.
   */
  refreshedAt?: string;
  /**
   * When the data becomes stale (seconds). Clients should show a stale badge
   * if `now - refreshedAt > staleAfterSeconds`.
   */
  staleAfterSeconds?: number;
  /**
   * Count of known exceptions affecting this response. Surfaces red-flags
   * without forcing the client to issue a separate exception-summary call.
   */
  exceptionCount?: number;
  /**
   * Whether an override is currently in effect for this response (admin
   * date/value override, manual tracker, etc.).
   */
  overrideInEffect?: boolean;
  /**
   * Feature flag name + state when a silent canonical/legacy switch is
   * controlled by a flag.
   */
  featureFlag?: { name: string; enabled: boolean };
}

/**
 * Default staleness threshold for finance reads (15 minutes). Individual
 * routes can override per-request.
 */
export const DEFAULT_FINANCE_STALE_SECONDS = 15 * 60;

/**
 * Set the standard X-Finance-* headers on a response. Safe to call multiple
 * times — later calls overwrite earlier ones. Missing fields are omitted
 * rather than emitted as empty strings.
 */
export function setFinanceTrustHeaders(
  res: Response,
  params: FinanceTrustHeaderParams,
): void {
  res.setHeader("X-Finance-Source-Layer", params.sourceLayer);
  if (params.canonicalTable) {
    res.setHeader("X-Finance-Canonical-Table", params.canonicalTable);
  }
  if (params.derivedTable) {
    res.setHeader("X-Finance-Derived-Table", params.derivedTable);
  }
  if (params.cacheLayer) {
    res.setHeader("X-Finance-Cache-Layer", params.cacheLayer);
  }
  if (params.uncertainty) {
    res.setHeader("X-Finance-Trust-Uncertainty", params.uncertainty);
  }
  const refreshedAt = params.refreshedAt ?? new Date().toISOString();
  res.setHeader("X-Finance-Refreshed-At", refreshedAt);
  const staleAfter = params.staleAfterSeconds ?? DEFAULT_FINANCE_STALE_SECONDS;
  res.setHeader("X-Finance-Stale-After-Seconds", String(staleAfter));
  if (typeof params.exceptionCount === "number" && Number.isFinite(params.exceptionCount)) {
    res.setHeader("X-Finance-Exception-Count", String(Math.max(0, Math.trunc(params.exceptionCount))));
  }
  if (params.overrideInEffect === true) {
    res.setHeader("X-Finance-Override-In-Effect", "1");
  }
  if (params.featureFlag) {
    res.setHeader(
      "X-Finance-Feature-Flag",
      `${params.featureFlag.name}=${params.featureFlag.enabled ? "on" : "off"}`,
    );
  }
}

/**
 * Build a JSON-serialisable trust meta object with the same fields that
 * {@link setFinanceTrustHeaders} emits. New endpoints should embed this as
 * `{ data, trust }` so clients that cannot read custom headers (e.g. chart
 * libraries that strip them) still see the provenance signal.
 */
export function buildTrustMeta(params: FinanceTrustHeaderParams): Record<string, unknown> {
  return {
    sourceLayer: params.sourceLayer,
    canonicalTable: params.canonicalTable ?? null,
    derivedTable: params.derivedTable ?? null,
    cacheLayer: params.cacheLayer ?? null,
    uncertainty: params.uncertainty ?? null,
    refreshedAt: params.refreshedAt ?? new Date().toISOString(),
    staleAfterSeconds: params.staleAfterSeconds ?? DEFAULT_FINANCE_STALE_SECONDS,
    exceptionCount:
      typeof params.exceptionCount === "number" && Number.isFinite(params.exceptionCount)
        ? Math.max(0, Math.trunc(params.exceptionCount))
        : null,
    overrideInEffect: params.overrideInEffect === true,
    featureFlag: params.featureFlag ?? null,
  };
}

/**
 * Convenience: set both headers and return the JSON trust meta so a route
 * can say `res.json({ ...data, trust: withTrust(res, { ... }) })`.
 */
export function withTrust(
  res: Response,
  params: FinanceTrustHeaderParams,
): Record<string, unknown> {
  setFinanceTrustHeaders(res, params);
  return buildTrustMeta(params);
}

/** Names of the response headers emitted by {@link setFinanceTrustHeaders}. */
export const FINANCE_TRUST_HEADER_NAMES = [
  "X-Finance-Source-Layer",
  "X-Finance-Canonical-Table",
  "X-Finance-Derived-Table",
  "X-Finance-Cache-Layer",
  "X-Finance-Trust-Uncertainty",
  "X-Finance-Refreshed-At",
  "X-Finance-Stale-After-Seconds",
  "X-Finance-Exception-Count",
  "X-Finance-Override-In-Effect",
  "X-Finance-Feature-Flag",
] as const;
