import { describe, expect, it } from "vitest";
import {
  cashEventOutflowDate,
  cashEventOutflowDateAndSource,
} from "../../../server/lib/finance/weekly-cashflow-engine";

// Finding A from the T1.x reporting trust audit, now enforced on the ONE cash
// engine (server/lib/finance/weekly-cashflow-engine.ts):
//
// The weekly cash bucket dates an outflow by its PAYMENT date, never its
// invoice date. Per § 3.4 the invoice date is a recognition event, not a cash
// event — including it conflates the two and pushes invoiced-but-unscheduled
// rows into the week of the invoice. The cash-event chain is:
//   admin schedule-override → actual payment → computed forecast → forecast.
// A row with only an invoice date is NOT a cash event (returns null).
describe("weekly-cashflow-engine cash-event date — no invoice-date fallback (§ 3.4)", () => {
  it("dates by actual payment date when present", () => {
    expect(cashEventOutflowDate({ expensePaymentDate: "2026-01-10" })).toBe("2026-01-10");
  });

  it("honours the admin schedule-override first (planner moves re-bucket)", () => {
    const r = cashEventOutflowDateAndSource({
      adminDateOverride: "2026-02-01",
      expensePaymentDate: "2026-01-10",
    });
    expect(r.date).toBe("2026-02-01");
    expect(r.source).toBe("adminDateOverride");
  });

  it("falls back actual → computed forecast → forecast", () => {
    expect(cashEventOutflowDate({ computedForecastPaymentDate: "2026-03-03" })).toBe("2026-03-03");
    expect(cashEventOutflowDate({ forecastPaymentDate: "2026-04-04" })).toBe("2026-04-04");
  });

  it("does NOT fall back to the invoice date (recognition ≠ cash)", () => {
    // Only an invoice date present → not a cash event → excluded from the bucket.
    expect(cashEventOutflowDate({ expenseInvoicedDate: "2026-01-15" })).toBeNull();
    expect(cashEventOutflowDateAndSource({ expenseInvoicedDate: "2026-01-15" }).source).toBeNull();
  });

  it("a payment date wins even when an invoice date is also present", () => {
    expect(
      cashEventOutflowDate({ expensePaymentDate: "2026-01-10", expenseInvoicedDate: "2026-01-15" }),
    ).toBe("2026-01-10");
  });
});
