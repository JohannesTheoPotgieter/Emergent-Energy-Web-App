/**
 * fix/bucket-invoice-date-only — COS/REV RECOGNITION buckets strictly on the
 * invoice-raised date (AGENT_GUARDRAILS § 3.3); never the payment/forecast date,
 * never budget-for-actual. CASH bucketing (§ 3.4) is a separate path that keeps
 * using the payment date — proven unchanged here.
 */

import { describe, expect, it } from "vitest";

import { computeMonthlyBuckets } from "../../../server/lib/calculations/monthlyBuckets";
import { computeWeeklyCashflow, type CashflowLineItem } from "../../../server/lib/calculations/cashflow";
import { recognitionActualAmount, cashOutflowAmount } from "../../../server/routes/cos-control-routes";
import type { COSLineItem } from "../../../server/lib/calculations/cosAggregator";

function cosLine(o: Partial<COSLineItem> & { id: number }): COSLineItem {
  return {
    id: o.id,
    projectName: o.projectName ?? "P",
    expenseCategory: o.expenseCategory ?? null,
    expenseLineItem: o.expenseLineItem ?? null,
    amount: o.amount ?? 1000,
    state: o.state ?? "Invoiced",
    invoiceNumber: o.invoiceNumber ?? "INV-1",
    poNumber: o.poNumber ?? null,
    invoicedDate: o.invoicedDate ?? null,
    paymentDate: o.paymentDate ?? null,
    forecastPaymentDate: o.forecastPaymentDate ?? null,
    supplierName: o.supplierName ?? null,
    confidence: o.confidence ?? "High",
    assumptionDriver: o.assumptionDriver ?? "",
  };
}

describe("computeMonthlyBuckets — recognition buckets on invoice date only (§3.3)", () => {
  it("blank invoice date → flagged MISSING_INVOICE_DATE, NOT bucketed by payment/forecast date", () => {
    const result = computeMonthlyBuckets([
      cosLine({ id: 1, invoicedDate: "2026-03-15", state: "Invoiced", amount: 1000 }),
      // blank invoice date but HAS payment + forecast dates — must NOT be bucketed by them.
      cosLine({ id: 2, invoicedDate: null, paymentDate: "2026-04-10", forecastPaymentDate: "2026-05-01", state: "Invoiced", amount: 500 }),
    ]);

    expect(result.missingInvoiceDate).toEqual([2]);
    expect(result.buckets.get("2026-03")?.invoiced).toBe(1000);
    expect(result.buckets.has("2026-04")).toBe(false); // not on payment date
    expect(result.buckets.has("2026-05")).toBe(false); // not on forecast date
  });

  it("buckets on the invoice month even when a later payment date exists", () => {
    const result = computeMonthlyBuckets([
      cosLine({ id: 3, invoicedDate: "2026-03-20", paymentDate: "2026-06-01", state: "Paid", amount: 2000 }),
    ]);
    expect(result.buckets.get("2026-03")?.paid).toBe(2000); // invoice month, not June
    expect(result.buckets.has("2026-06")).toBe(false);
    expect(result.missingInvoiceDate).toEqual([]);
  });

  it("an unparseable invoice date is flagged, not bucketed", () => {
    const result = computeMonthlyBuckets([cosLine({ id: 4, invoicedDate: "not-a-date", amount: 99 })]);
    expect(result.missingInvoiceDate).toEqual([4]);
    expect(result.buckets.size).toBe(0);
  });
});

describe("recognition amount never substitutes budget for actual (§3.3)", () => {
  it("recognition uses actual ONLY — budget is never substituted", () => {
    expect(recognitionActualAmount({ expenseActualTotal: "50", budgetTotal: "100" })).toBe(50);
    expect(recognitionActualAmount({ expenseActualTotal: null, budgetTotal: "100" })).toBe(0);
    expect(recognitionActualAmount({ expenseActualTotal: "", budgetTotal: "100" })).toBe(0);
  });

  it("cash outflow keeps its own (actual-else-budget) amount — cash logic unchanged (§3.4)", () => {
    expect(cashOutflowAmount({ expenseActualTotal: "50", budgetTotal: "100" })).toBe(50);
    expect(cashOutflowAmount({ expenseActualTotal: null, budgetTotal: "100" })).toBe(100);
  });
});

describe("cashflow still buckets cash on payment date — unchanged (§3.4)", () => {
  const outflow = (o: Partial<CashflowLineItem> & { id: number }): CashflowLineItem => ({
    id: o.id,
    projectName: "P",
    type: "outflow",
    amount: o.amount ?? 300,
    actualDate: o.actualDate ?? null,
    forecastDate: o.forecastDate ?? null,
    confidence: "High",
    assumptionDriver: "",
    description: "x",
    invoiceNumber: null,
    poNumber: null,
    category: null,
    supplierName: null,
  });

  it("an outflow is bucketed by its payment (actual) date; a dateless line is not", () => {
    const weeks = computeWeeklyCashflow(
      [],
      [outflow({ id: 1, actualDate: "2026-03-04", amount: 300 }), outflow({ id: 2, actualDate: null, forecastDate: null, amount: 999 })],
      "2026-03-01",
      6,
      0,
    );
    const totalOutflowActual = weeks.reduce((s, w) => s + w.outflowsActual, 0);
    expect(totalOutflowActual).toBe(300); // only the payment-dated line buckets; cash uses payment date
  });
});
