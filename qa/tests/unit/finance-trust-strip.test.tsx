import { describe, it, expect, vi } from "vitest";
import { buildTrustStripState, isStaleImport } from "@/components/finance/FinanceTrustStrip";

describe("FinanceTrustStrip trust signals", () => {
  it("stale import badge detection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00Z"));
    expect(isStaleImport("2026-04-20T00:00:00Z")).toBe(true);
    vi.useRealTimers();
  });

  it("drift and missing po counters", () => {
    const state = buildTrustStripState({
      lastImportDate: "2026-05-04T00:00:00Z",
      quickBooksLinkStatus: "unmatched",
      metrics: [
        { label: "Unresolved drift", value: 4 },
        { label: "Missing PO", value: 2 },
      ],
    });
    expect(state.driftCount).toBe(4);
    expect(state.missingPoCount).toBe(2);
  });

  it("qb linked state and permission-limited read-only state", () => {
    const state = buildTrustStripState({
      lastImportDate: "2026-05-04T00:00:00Z",
      quickBooksLinkStatus: "linked",
      readOnly: true,
      metrics: [],
    });
    expect(state.qbLinked).toBe(true);
    expect(state.qbUnmatched).toBe(false);
    expect(state.readOnly).toBe(true);
  });
});
