/**
 * Company-level Tracker vs QuickBooks (feat/qb-recon-grain-reframe).
 *
 * QB cost bills aren't project-tagged, so COS/GP only reconcile to QuickBooks at
 * the COMPANY level. These tests pin the pure pieces of that comparison:
 *   - parsePnLCompanyTotals: company Revenue / COS / GP out of a QB P&L report;
 *   - classifyCompanyMetric: tie (green) within tolerance, drift (amber) beyond,
 *     unknown when QB is unavailable;
 *   - rollupCompanyStatus + composition: tracker totals == QB P&L → tie; differ →
 *     drift (the Finance Home tile / board company card acceptance).
 *
 * The app COMPARES and flags; it never adjusts a tracker (§ 3.4).
 */
import { describe, expect, it } from "vitest";

import { parsePnLCompanyTotals } from "../../../server/services/qb-pnl-totals";
import {
  classifyCompanyMetric,
  rollupCompanyStatus,
  COMPANY_QB_TOLERANCE,
} from "../../../server/services/reconciliation-service";
import { mockProfitAndLossReport } from "../../../server/mocks/quickbooks-fixtures";

const REPORT = mockProfitAndLossReport("2025-09-01", "2026-08-31");

describe("parsePnLCompanyTotals", () => {
  it("extracts company Revenue / COS / GP from a QB P&L report", () => {
    const totals = parsePnLCompanyTotals(REPORT);
    expect(totals.revenue).toBe(805000);
    expect(totals.cos).toBe(541075);
    expect(totals.gp).toBe(263925);
  });

  it("returns null for sections the report omits", () => {
    const totals = parsePnLCompanyTotals({
      Rows: { Row: [{ group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: "100" }] } }] },
    });
    expect(totals.revenue).toBe(100);
    expect(totals.cos).toBeNull();
    expect(totals.gp).toBeNull();
  });

  it("is null-safe on a malformed / empty report", () => {
    expect(parsePnLCompanyTotals(null)).toEqual({ revenue: null, cos: null, gp: null });
    expect(parsePnLCompanyTotals({})).toEqual({ revenue: null, cos: null, gp: null });
  });
});

describe("classifyCompanyMetric — company-level tie/drift", () => {
  it("ties (green) when tracker equals QB", () => {
    const r = classifyCompanyMetric("revenue", 805000, 805000);
    expect(r.status).toBe("green");
    expect(r.delta).toBe(0);
    expect(r.qb).toBe(805000);
  });

  it("ties within the R1 tolerance", () => {
    expect(classifyCompanyMetric("cos", 541075.5, 541075).status).toBe("green");
    expect(COMPANY_QB_TOLERANCE).toBe(1);
  });

  it("drifts (amber) beyond tolerance, with the signed delta", () => {
    const r = classifyCompanyMetric("gp", 300000, 263925);
    expect(r.status).toBe("amber");
    expect(r.delta).toBeCloseTo(36075, 2);
  });

  it("is 'unknown' when QuickBooks is unavailable (qb null) — never a false drift", () => {
    const r = classifyCompanyMetric("revenue", 805000, null);
    expect(r.status).toBe("unknown");
    expect(r.qb).toBeNull();
    expect(r.delta).toBe(0);
  });
});

describe("rollupCompanyStatus", () => {
  it("green only when all metrics tie", () => {
    expect(rollupCompanyStatus(["green", "green", "green"])).toBe("green");
  });
  it("amber when any metric drifts", () => {
    expect(rollupCompanyStatus(["green", "amber", "green"])).toBe("amber");
  });
  it("unknown only when every metric is unknown", () => {
    expect(rollupCompanyStatus(["unknown", "unknown", "unknown"])).toBe("unknown");
    expect(rollupCompanyStatus(["green", "unknown", "unknown"])).toBe("green");
  });
});

describe("company tile composition — tie when tracker == QB, drift otherwise", () => {
  const qb = parsePnLCompanyTotals(REPORT);

  it("tracker totals == QB P&L → ties (green)", () => {
    const revenue = classifyCompanyMetric("revenue", qb.revenue!, qb.revenue);
    const cos = classifyCompanyMetric("cos", qb.cos!, qb.cos);
    const gp = classifyCompanyMetric("gp", qb.gp!, qb.gp);
    expect(rollupCompanyStatus([revenue.status, cos.status, gp.status])).toBe("green");
  });

  it("tracker total drifts from QB → drift (amber)", () => {
    const revenue = classifyCompanyMetric("revenue", qb.revenue! + 50_000, qb.revenue);
    const cos = classifyCompanyMetric("cos", qb.cos!, qb.cos);
    const gp = classifyCompanyMetric("gp", qb.gp!, qb.gp);
    expect(rollupCompanyStatus([revenue.status, cos.status, gp.status])).toBe("amber");
  });
});

