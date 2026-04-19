/**
 * Unit tests for the shared finance-trust envelope helper.
 *
 * These tests pin down the headers, defaults, and meta-object shape so
 * every finance route that adopts the helper gets a consistent trust
 * envelope. Regressions here would silently break report-trust signalling.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  setFinanceTrustHeaders,
  buildTrustMeta,
  withTrust,
  FINANCE_TRUST_HEADER_NAMES,
  DEFAULT_FINANCE_STALE_SECONDS,
} from "../../../server/lib/finance-trust/envelope";

interface FakeRes {
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

function makeRes(): FakeRes {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = String(value);
    },
  };
}

describe("finance trust envelope — header emission", () => {
  it("emits source layer, refreshedAt, and stale-after by default", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, { sourceLayer: "canonical" });
    expect(res.headers["X-Finance-Source-Layer"]).toBe("canonical");
    expect(res.headers["X-Finance-Refreshed-At"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(res.headers["X-Finance-Stale-After-Seconds"]).toBe(
      String(DEFAULT_FINANCE_STALE_SECONDS),
    );
  });

  it("emits canonical/derived/cache/uncertainty headers when provided", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, {
      sourceLayer: "legacy",
      canonicalTable: "normalized_cost_lines",
      derivedTable: "finance_cos_monthly",
      cacheLayer: "db_expense_cache_30s",
      uncertainty: "compatibility_route_legacy_fallback",
    });
    expect(res.headers["X-Finance-Canonical-Table"]).toBe(
      "normalized_cost_lines",
    );
    expect(res.headers["X-Finance-Derived-Table"]).toBe("finance_cos_monthly");
    expect(res.headers["X-Finance-Cache-Layer"]).toBe("db_expense_cache_30s");
    expect(res.headers["X-Finance-Trust-Uncertainty"]).toBe(
      "compatibility_route_legacy_fallback",
    );
  });

  it("emits exception-count and override-in-effect when set", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, {
      sourceLayer: "canonical",
      exceptionCount: 42,
      overrideInEffect: true,
    });
    expect(res.headers["X-Finance-Exception-Count"]).toBe("42");
    expect(res.headers["X-Finance-Override-In-Effect"]).toBe("1");
  });

  it("omits exception-count when unset and never emits empty string", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, { sourceLayer: "canonical" });
    expect(res.headers["X-Finance-Exception-Count"]).toBeUndefined();
    expect(res.headers["X-Finance-Override-In-Effect"]).toBeUndefined();
    for (const value of Object.values(res.headers)) {
      expect(value).not.toBe("");
    }
  });

  it("clamps negative or NaN exception counts to zero", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, {
      sourceLayer: "canonical",
      exceptionCount: -7,
    });
    expect(res.headers["X-Finance-Exception-Count"]).toBe("0");

    const res2 = makeRes();
    setFinanceTrustHeaders(res2 as any, {
      sourceLayer: "canonical",
      exceptionCount: Number.NaN,
    });
    expect(res2.headers["X-Finance-Exception-Count"]).toBeUndefined();
  });

  it("emits the feature-flag header when provided", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, {
      sourceLayer: "canonical",
      featureFlag: { name: "example_finance_flag_v1", enabled: true },
    });
    expect(res.headers["X-Finance-Feature-Flag"]).toBe(
      "example_finance_flag_v1=on",
    );
  });

  it("exposes the canonical list of header names", () => {
    expect(FINANCE_TRUST_HEADER_NAMES).toContain("X-Finance-Source-Layer");
    expect(FINANCE_TRUST_HEADER_NAMES).toContain("X-Finance-Refreshed-At");
    expect(FINANCE_TRUST_HEADER_NAMES).toContain("X-Finance-Stale-After-Seconds");
    expect(FINANCE_TRUST_HEADER_NAMES).toContain("X-Finance-Exception-Count");
    expect(FINANCE_TRUST_HEADER_NAMES).toContain("X-Finance-Override-In-Effect");
  });
});

describe("finance trust envelope — JSON meta", () => {
  it("buildTrustMeta returns the same sourceLayer as the header", () => {
    const meta = buildTrustMeta({ sourceLayer: "derived" });
    expect(meta.sourceLayer).toBe("derived");
    expect(meta.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.staleAfterSeconds).toBe(DEFAULT_FINANCE_STALE_SECONDS);
    expect(meta.exceptionCount).toBeNull();
    expect(meta.overrideInEffect).toBe(false);
  });

  it("buildTrustMeta preserves refreshedAt when explicitly set", () => {
    const ts = "2026-04-15T10:00:00.000Z";
    const meta = buildTrustMeta({ sourceLayer: "canonical", refreshedAt: ts });
    expect(meta.refreshedAt).toBe(ts);
  });

  it("withTrust sets headers AND returns the meta payload", () => {
    const res = makeRes();
    const meta = withTrust(res as any, {
      sourceLayer: "legacy",
      canonicalTable: "normalized_cost_lines",
      exceptionCount: 3,
    });
    expect(res.headers["X-Finance-Source-Layer"]).toBe("legacy");
    expect(res.headers["X-Finance-Exception-Count"]).toBe("3");
    expect(meta.sourceLayer).toBe("legacy");
    expect(meta.exceptionCount).toBe(3);
  });
});

describe("finance trust envelope — stale signalling", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("sets refreshedAt to the current time when not supplied", () => {
    const res = makeRes();
    const before = Date.now();
    setFinanceTrustHeaders(res as any, { sourceLayer: "canonical" });
    const value = res.headers["X-Finance-Refreshed-At"];
    const after = Date.now();
    const t = new Date(value).getTime();
    expect(t).toBeGreaterThanOrEqual(before - 10);
    expect(t).toBeLessThanOrEqual(after + 10);
  });

  it("honours a caller-supplied stale window", () => {
    const res = makeRes();
    setFinanceTrustHeaders(res as any, {
      sourceLayer: "canonical",
      staleAfterSeconds: 30,
    });
    expect(res.headers["X-Finance-Stale-After-Seconds"]).toBe("30");
  });
});
