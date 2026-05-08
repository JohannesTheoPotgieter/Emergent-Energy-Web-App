import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Finding A from the T1.x reporting trust audit:
// `register-cashflow-2026-routes.ts` was bucketing weekly outflows by a
// fallback chain that ended in `expenseInvoicedDate`. Per § 3.4 the invoice
// date is a recognition event, not a cash event — including it in the cash
// week-bucket conflates the two and pushes invoiced-but-unscheduled rows
// into the week of the invoice.
//
// The fix drops `expenseInvoicedDate` from the cash-event fallback chain.
// Rows with no payment-class date (actual, computed forecast, or forecast)
// are excluded from the weekly cash bucket. This test pins the structural
// invariant.
describe("cashflow-2026 outflow window — no invoice-date fallback (T1.x Finding A)", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/register-cashflow-2026-routes.ts"),
    "utf8",
  );

  it("does not fall back to expenseInvoicedDate for cash-week bucketing", () => {
    // The outflow loop's date-pivot expression must not contain
    // `expenseInvoicedDate` as part of the `||` fallback chain.
    const fallbackPattern =
      /\|\|\s*\(expense as any\)\.expenseInvoicedDate/;
    expect(source).not.toMatch(fallbackPattern);
  });

  it("documents the § 3.4 cash-event rule at the date-pivot site", () => {
    expect(source).toContain("Cash-event date per § 3.4");
    expect(source).toContain("Invoice date is recognition, not cash");
  });

  it("retains the payment-class fallback (actual → computed → forecast)", () => {
    expect(source).toContain(
      "expense.expensePaymentDate || (expense as any).computedForecastPaymentDate || (expense as any).forecastPaymentDate || null",
    );
  });

  it("expenseInvoicedDate is still allowed elsewhere (status classification, not cash bucket)", () => {
    // Sanity: the test above is scoped to the date-pivot. The status
    // classifier may still use `expenseInvoiceNumber` etc. for "outOfBank
    // / outstanding / risk / planned" labels. We only forbid it from the
    // CASH week-bucket date-pivot itself.
    expect(source).toContain("expenseInvoiceNumber");
  });
});
