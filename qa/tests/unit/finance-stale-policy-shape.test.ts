/**
 * TF-18 / TF-19 (audit V3) — Contract tests for the canonical
 * TanStack-Query stale-time policy and the drill-down reconciliation
 * footer component.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FINANCE_QUERY_VOLATILE,
  FINANCE_QUERY_STABLE,
  FINANCE_QUERY_REALTIME,
} from "../../../client/src/lib/finance-stale-policy";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-18 — FINANCE_QUERY_* stale-time policies", () => {
  it("VOLATILE: 30s + refetch on focus", () => {
    expect(FINANCE_QUERY_VOLATILE.staleTime).toBe(30 * 1000);
    expect(FINANCE_QUERY_VOLATILE.refetchOnWindowFocus).toBe(true);
    expect(FINANCE_QUERY_VOLATILE.refetchOnReconnect).toBe(true);
  });

  it("STABLE: 5min + refetch on focus", () => {
    expect(FINANCE_QUERY_STABLE.staleTime).toBe(5 * 60 * 1000);
    expect(FINANCE_QUERY_STABLE.refetchOnWindowFocus).toBe(true);
  });

  it("REALTIME: 10s polling + refetch on focus", () => {
    expect(FINANCE_QUERY_REALTIME.staleTime).toBe(10 * 1000);
    expect(FINANCE_QUERY_REALTIME.refetchInterval).toBe(10 * 1000);
    expect(FINANCE_QUERY_REALTIME.refetchOnWindowFocus).toBe(true);
  });

  it("is applied on the cashflow + cos pages", () => {
    expect(read("client/src/pages/cashflow.tsx")).toContain("...FINANCE_QUERY_STABLE");
    expect(read("client/src/pages/cos.tsx")).toContain("...FINANCE_QUERY_VOLATILE");
  });
});

describe("TF-19 — DrillReconciliationFooter component", () => {
  const src = read("client/src/components/finance/DrillReconciliationFooter.tsx");

  it("exports the component with the documented prop shape", () => {
    expect(src).toContain("export function DrillReconciliationFooter");
    expect(src).toContain("sourceLabel");
    expect(src).toContain("sourceValue");
    expect(src).toContain("drilldownLabel");
    expect(src).toContain("drilldownValue");
    expect(src).toContain("tolerance");
  });

  it("shows reconciles vs off-by based on tolerance", () => {
    expect(src).toContain("Reconciles");
    expect(src).toContain("Off by");
    // The tolerance default lives in the prop signature.
    expect(src).toMatch(/tolerance = 1,/);
  });

  it("uses the Money component so the spoken aria-label rides along", () => {
    expect(src).toContain('from "@/components/ui/money"');
  });
});
