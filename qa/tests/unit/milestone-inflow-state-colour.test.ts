import { describe, it, expect } from "vitest";

import { inflowState } from "../../../server/services/milestone-tracker-service";

// Owner rule 2026-06 — a milestone's "paid" state is read from the tracker's
// "Payment Received Date" FONT COLOUR (black = confirmed actual receipt, red =
// forecast), combined with whether that date is past or future. A future
// forecast (red) receipt date must NOT show as paid; a confirmed (black) date in
// the future is impossible and is flagged.

const TODAY = "2026-06-23";

function ms(o: Partial<Parameters<typeof inflowState>[0]>): Parameters<typeof inflowState>[0] {
  return {
    status: "paid",
    paidDate: null,
    paidDateConfirmed: null,
    inBankDate: null,
    invoiceNumber: null,
    invoiceDate: null,
    expectedPaymentDate: null,
    ...o,
  };
}

describe("inflowState — Payment-Received-Date colour rules", () => {
  it("black (confirmed) receipt in the past → paid", () => {
    expect(inflowState(ms({ paidDate: "2026-05-29", paidDateConfirmed: true }), TODAY)).toBe("paid");
  });
  it("black (confirmed) receipt today → paid", () => {
    expect(inflowState(ms({ paidDate: TODAY, paidDateConfirmed: true }), TODAY)).toBe("paid");
  });
  it("black (confirmed) receipt in the FUTURE → flagged (a paid date can't be future)", () => {
    expect(inflowState(ms({ paidDate: "2026-08-01", paidDateConfirmed: true }), TODAY)).toBe("flagged");
  });
  it("red (forecast) receipt in the future → NOT paid (invoiced when invoiced)", () => {
    expect(inflowState(ms({ paidDate: "2026-06-30", paidDateConfirmed: false, invoiceNumber: "INV-1" }), TODAY)).toBe("invoiced");
  });
  it("red (forecast) receipt in the future, no invoice → outstanding (still to collect)", () => {
    expect(inflowState(ms({ paidDate: "2026-07-01", paidDateConfirmed: false }), TODAY)).toBe("outstanding");
  });
  it("red (forecast) receipt date in the past → overdue (forecast lapsed, uncollected)", () => {
    expect(inflowState(ms({ paidDate: "2026-06-01", paidDateConfirmed: false }), TODAY)).toBe("overdue");
  });
  it("no receipt date, invoiced, expected date passed → overdue", () => {
    expect(inflowState(ms({ status: "invoiced", invoiceNumber: "INV-2", expectedPaymentDate: "2026-06-01" }), TODAY)).toBe("overdue");
  });
  it("no receipt date, invoiced, expected date in future → invoiced", () => {
    expect(inflowState(ms({ status: "invoiced", invoiceNumber: "INV-3", expectedPaymentDate: "2026-07-15" }), TODAY)).toBe("invoiced");
  });
  it("no dates, planned → outstanding", () => {
    expect(inflowState(ms({ status: "planned" }), TODAY)).toBe("outstanding");
  });
  it("written off → flagged regardless of dates", () => {
    expect(inflowState(ms({ status: "written_off", paidDate: "2026-05-01", paidDateConfirmed: true }), TODAY)).toBe("flagged");
  });
  it("in-bank date (no colour captured) in the past → paid", () => {
    expect(inflowState(ms({ status: "in_bank", paidDate: null, inBankDate: "2026-05-10" }), TODAY)).toBe("paid");
  });
});
