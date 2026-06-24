import { describe, it, expect } from "vitest";

import { outflowState } from "../../../server/services/milestone-tracker-service";

// Owner rule 2026-06 (outflow side, mirroring the inflow rule) — a cost line's
// "paid" state is read from the tracker's "Paid date" FONT COLOUR (black =
// confirmed actual payment, red = forecast), combined with past/future. The
// importer marks a line PAID whenever any paid date exists (even a red forecast
// in the future), so the Activity-Planning view must re-read the colour: a
// future/forecast (red) payment date must NOT show as Paid.

const TODAY = "2026-06-23";

function c(o: Partial<Parameters<typeof outflowState>[0]>): Parameters<typeof outflowState>[0] {
  return {
    status: "paid",
    paidDate: null,
    paidDateConfirmed: null,
    forecastPaymentDate: null,
    ...o,
  };
}

describe("outflowState — Paid-date colour rules", () => {
  it("black (confirmed) payment in the past → paid", () => {
    expect(outflowState(c({ paidDate: "2026-06-11", paidDateConfirmed: true }), TODAY)).toBe("paid");
  });
  it("black (confirmed) payment today → paid", () => {
    expect(outflowState(c({ paidDate: TODAY, paidDateConfirmed: true }), TODAY)).toBe("paid");
  });
  it("black (confirmed) payment in the FUTURE → flagged (can't be paid ahead of time)", () => {
    expect(outflowState(c({ paidDate: "2026-08-18", paidDateConfirmed: true }), TODAY)).toBe("flagged");
  });
  it("red (forecast) payment in the future → NOT paid (outstanding/planned)", () => {
    // The 12 Nourse case: PAID status, red paid date dated in the future.
    expect(outflowState(c({ status: "paid", paidDate: "2026-08-18", paidDateConfirmed: false }), TODAY)).toBe("outstanding");
  });
  it("red (forecast) payment date in the past → overdue (forecast lapsed, unpaid)", () => {
    expect(outflowState(c({ status: "paid", paidDate: "2026-05-01", paidDateConfirmed: false }), TODAY)).toBe("overdue");
  });
  it("null colour with a paid date is treated as forecast (not confirmed) → not paid", () => {
    // Unknown colour must not silently pass as a real payment.
    expect(outflowState(c({ status: "paid", paidDate: "2026-08-01", paidDateConfirmed: null }), TODAY)).toBe("outstanding");
  });
  it("no paid date, invoiced status, forecast in future → invoiced", () => {
    expect(outflowState(c({ status: "invoiced", paidDate: null, forecastPaymentDate: "2026-07-15" }), TODAY)).toBe("invoiced");
  });
  it("no paid date, forecast date lapsed → overdue", () => {
    expect(outflowState(c({ status: "approved", paidDate: null, forecastPaymentDate: "2026-05-01" }), TODAY)).toBe("overdue");
  });
  it("disputed → flagged regardless of dates", () => {
    expect(outflowState(c({ status: "disputed", paidDate: "2026-05-01", paidDateConfirmed: true }), TODAY)).toBe("flagged");
  });
  it("planned, no dates → outstanding", () => {
    expect(outflowState(c({ status: "planned" }), TODAY)).toBe("outstanding");
  });
});
