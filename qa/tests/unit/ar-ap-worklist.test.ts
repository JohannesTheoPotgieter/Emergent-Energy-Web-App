import { describe, expect, it } from "vitest";
import {
  ageBucket,
  buildMissingInvoices,
  buildPayables,
  buildReceivables,
  daysBetween,
  type CostWorklistInput,
  type RevenueWorklistInput,
  type WorklistSourceRef,
} from "../../../server/lib/finance/ar-ap-worklist";

const AS_OF = "2026-06-11";

const src = (over: Partial<WorklistSourceRef> = {}): WorklistSourceRef => ({
  sourceSheet: "Expenditure Breakdown",
  sourceRow: 42,
  sourceCell: "S42",
  ...over,
});

// Default revenue line: invoiced to the client, not yet received.
const rev = (over: Partial<RevenueWorklistInput> = {}): RevenueWorklistInput => ({
  lineId: 1,
  projectId: 10,
  projectName: "Mondi",
  label: "Milestone 1",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-05-01",
  amountExVat: "1000.00",
  paidDate: null,
  paidDateFontColor: null,
  paidDateConfirmed: null,
  inBankDate: null,
  status: "invoiced",
  disputeOpenedAt: null,
  disputeResolvedAt: null,
  writeOffAuthorisedAt: null,
  source: src({ sourceSheet: "Revenue Tracking" }),
  ...over,
});

// Default cost line: supplier invoice captured, not yet paid.
const cost = (over: Partial<CostWorklistInput> = {}): CostWorklistInput => ({
  lineId: 1,
  projectId: 10,
  projectName: "Mondi",
  supplierName: "JA Solar",
  label: "Panels",
  invoiceNumber: "SUP-1",
  invoiceDate: "2026-05-01",
  amountExVat: "2000.00",
  paidDate: null,
  paidDateFontColor: null,
  paidDateConfirmed: null,
  status: "invoiced",
  disputeOpenedAt: null,
  disputeResolvedAt: null,
  source: src(),
  ...over,
});

describe("ar-ap-worklist — aging helpers", () => {
  it("buckets on the 30/60/90 boundaries (inclusive lower bucket)", () => {
    expect(ageBucket(0)).toBe("0-30");
    expect(ageBucket(30)).toBe("0-30");
    expect(ageBucket(31)).toBe("31-60");
    expect(ageBucket(60)).toBe("31-60");
    expect(ageBucket(61)).toBe("61-90");
    expect(ageBucket(90)).toBe("61-90");
    expect(ageBucket(91)).toBe("90+");
  });

  it("daysBetween counts whole UTC days", () => {
    expect(daysBetween("2026-05-12", AS_OF)).toBe(30);
    expect(daysBetween("2026-03-12", AS_OF)).toBe(91);
  });
});

describe("buildReceivables (AR)", () => {
  it("ages each invoiced-unpaid line from the invoice-raised date (T)", () => {
    const rows = [
      rev({ lineId: 1, invoiceDate: "2026-05-12" }), // 30 → 0-30
      rev({ lineId: 2, invoiceDate: "2026-05-11" }), // 31 → 31-60
      rev({ lineId: 3, invoiceDate: "2026-04-11" }), // 61 → 61-90
      rev({ lineId: 4, invoiceDate: "2026-03-12" }), // 91 → 90+
    ];
    const ar = buildReceivables(rows, AS_OF);
    const byId = new Map(ar.rows.map((r) => [r.lineId, r]));
    expect(byId.get(1)!.ageBucket).toBe("0-30");
    expect(byId.get(2)!.ageBucket).toBe("31-60");
    expect(byId.get(3)!.ageBucket).toBe("61-90");
    expect(byId.get(4)!.ageBucket).toBe("90+");
    // Bucket totals tie to the row set.
    expect(ar.buckets["0-30"].count).toBe(1);
    expect(ar.buckets.total.count).toBe(4);
    expect(ar.buckets.total.amount).toBe(4000);
    const summed =
      ar.buckets["0-30"].amount +
      ar.buckets["31-60"].amount +
      ar.buckets["61-90"].amount +
      ar.buckets["90+"].amount;
    expect(summed).toBe(ar.buckets.total.amount);
  });

  it("excludes received lines (col-W BLACK or already in bank)", () => {
    const rows = [
      rev({ lineId: 1, paidDate: "2026-05-20", paidDateFontColor: "black" }), // received
      rev({ lineId: 2, paidDate: "2026-05-20", paidDateConfirmed: true }), // received (confirmed)
      rev({ lineId: 3, inBankDate: "2026-05-22" }), // money in bank
    ];
    expect(buildReceivables(rows, AS_OF).rows).toHaveLength(0);
  });

  it("keeps lines whose col-W signal is RED, future-dated, or absent", () => {
    const rows = [
      rev({ lineId: 1, paidDate: "2026-05-20", paidDateFontColor: "red" }), // RED = not received
      rev({ lineId: 2, paidDate: "2026-12-01", paidDateFontColor: "black" }), // future BLACK = not yet
      rev({ lineId: 3, paidDate: null }), // no receipt at all
      // RED overrides a stale confirmed=true flag (canonical precedence).
      rev({ lineId: 4, paidDate: "2026-05-20", paidDateFontColor: "red", paidDateConfirmed: true }),
    ];
    expect(buildReceivables(rows, AS_OF).rows.map((r) => r.lineId).sort()).toEqual([1, 2, 3, 4]);
  });

  it("requires S present and T set", () => {
    const rows = [
      rev({ lineId: 1, invoiceNumber: null }), // no invoice number
      rev({ lineId: 2, invoiceNumber: "  " }), // blank
      rev({ lineId: 3, invoiceDate: null }), // no invoice date to age on
    ];
    expect(buildReceivables(rows, AS_OF).rows).toHaveLength(0);
  });

  it("excludes disputed and written-off lines", () => {
    const rows = [
      rev({ lineId: 1, status: "disputed" }),
      rev({ lineId: 2, status: "written_off" }),
      rev({ lineId: 3, disputeOpenedAt: "2026-05-02", disputeResolvedAt: null }),
      rev({ lineId: 4, writeOffAuthorisedAt: "2026-05-03" }),
    ];
    expect(buildReceivables(rows, AS_OF).rows).toHaveLength(0);
  });

  it("surfaces ex-VAT amount, source ref, and sorts most-overdue first", () => {
    const rows = [
      rev({ lineId: 1, invoiceDate: "2026-05-12", amountExVat: "1000" }), // 30d
      rev({ lineId: 2, invoiceDate: "2026-03-12", amountExVat: "2500.50" }), // 91d
    ];
    const ar = buildReceivables(rows, AS_OF);
    expect(ar.rows[0].lineId).toBe(2); // oldest first
    expect(ar.rows[0].amountExVat).toBe(2500.5);
    expect(ar.rows[0].source.sourceSheet).toBe("Revenue Tracking");
  });
});

describe("buildPayables (AP)", () => {
  it("ages invoiced-unpaid cost lines and excludes paid/disputed", () => {
    const rows = [
      cost({ lineId: 1, invoiceDate: "2026-05-12" }), // 30 → 0-30, unpaid
      cost({ lineId: 2, invoiceDate: "2026-03-12" }), // 91 → 90+, unpaid
      cost({ lineId: 3, paidDate: "2026-05-15", paidDateFontColor: "black" }), // paid → excluded
      cost({ lineId: 4, status: "disputed" }), // disputed → excluded
      cost({ lineId: 5, invoiceNumber: null }), // no supplier invoice → excluded
    ];
    const ap = buildPayables(rows, AS_OF);
    expect(ap.rows.map((r) => r.lineId).sort()).toEqual([1, 2]);
    expect(ap.rows[0].lineId).toBe(2); // oldest first
    expect(ap.rows[0].counterpartyName).toBe("JA Solar");
    expect(ap.rows[0].source.sourceCell).toBe("S42");
    expect(ap.buckets.total.count).toBe(2);
    expect(ap.buckets.total.amount).toBe(4000);
  });
});

describe("buildMissingInvoices", () => {
  it("lists past-dated lines with no invoice number on both sides, most-overdue first", () => {
    const revenue = [
      rev({ lineId: 11, invoiceNumber: null, invoiceDate: "2026-05-01", amountExVat: "500" }), // overdue 41d
      rev({ lineId: 12, invoiceNumber: null, invoiceDate: "2026-12-01" }), // future → excluded
      rev({ lineId: 13, invoiceNumber: "INV-9", invoiceDate: "2026-05-01" }), // has invoice → excluded
      rev({ lineId: 14, invoiceNumber: null, invoiceDate: null }), // no expected date → excluded
    ];
    const costs = [
      cost({ lineId: 21, invoiceNumber: null, invoiceDate: "2026-03-01", amountExVat: "900" }), // overdue 102d
      cost({ lineId: 22, invoiceNumber: null, invoiceDate: "2026-06-20" }), // future → excluded
    ];
    const out = buildMissingInvoices(revenue, costs, AS_OF);
    expect(out.rows.map((r) => r.lineId)).toEqual([21, 11]); // 102d before 41d
    expect(out.rows[0].side).toBe("cost");
    expect(out.rows[1].side).toBe("revenue");
    expect(out.rows[0].daysOverdue).toBe(daysBetween("2026-03-01", AS_OF));
    expect(out.summary.revenue.count).toBe(1);
    expect(out.summary.revenue.amount).toBe(500);
    expect(out.summary.cost.count).toBe(1);
    expect(out.summary.cost.amount).toBe(900);
    expect(out.summary.total.count).toBe(2);
    expect(out.summary.total.amount).toBe(1400);
  });

  it("excludes disputed/written-off even when the invoice is missing", () => {
    const revenue = [
      rev({ lineId: 1, invoiceNumber: null, invoiceDate: "2026-05-01", status: "written_off" }),
    ];
    const costs = [
      cost({ lineId: 2, invoiceNumber: null, invoiceDate: "2026-05-01", status: "disputed" }),
    ];
    expect(buildMissingInvoices(revenue, costs, AS_OF).rows).toHaveLength(0);
  });
});
