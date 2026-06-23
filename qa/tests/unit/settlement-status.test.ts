import { describe, expect, it } from "vitest";
import { deriveSettlementStatus } from "@/lib/finance/settlement-status";

/**
 * Settlement status mirrors the frozen realisation rules (§3.2 / §3.4 / §3.7)
 * as a read-only presentation: a confirmed (BLACK) payment date = Paid, an
 * unconfirmed (RED) one = pending; likewise for the invoice date; no invoice =
 * Planned.
 */
describe("deriveSettlementStatus", () => {
  it("Paid when a confirmed payment date is present", () => {
    const s = deriveSettlementStatus({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-10",
      paidDate: "2026-02-01",
      paidDateConfirmed: true,
    });
    expect(s.key).toBe("paid");
    expect(s.tone).toBe("paid");
  });

  it("Paid · unconfirmed when the payment date is RED", () => {
    const s = deriveSettlementStatus({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-10",
      paidDate: "2026-02-01",
      paidDateConfirmed: false,
    });
    expect(s.key).toBe("paid_unconfirmed");
    expect(s.tone).toBe("pending");
  });

  it("infers confirmation from font colour when the flag is absent", () => {
    expect(
      deriveSettlementStatus({ paidDate: "2026-02-01", paidDateFontColor: "red" }).key,
    ).toBe("paid_unconfirmed");
    expect(
      deriveSettlementStatus({ paidDate: "2026-02-01", paidDateFontColor: "black" }).key,
    ).toBe("paid");
    // No colour at all = default black = confirmed.
    expect(deriveSettlementStatus({ paidDate: "2026-02-01" }).key).toBe("paid");
  });

  it("Invoiced when an invoice is raised but not yet paid", () => {
    const s = deriveSettlementStatus({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-10",
      invoiceDateConfirmed: true,
      paidDate: null,
    });
    expect(s.key).toBe("invoiced");
    expect(s.tone).toBe("invoiced");
  });

  it("Invoiced · unconfirmed when the invoice date is RED", () => {
    const s = deriveSettlementStatus({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-10",
      invoiceDateConfirmed: false,
    });
    expect(s.key).toBe("invoiced_unconfirmed");
    expect(s.tone).toBe("pending");
  });

  it("Planned when there is no invoice or payment", () => {
    expect(deriveSettlementStatus({}).key).toBe("planned");
    expect(deriveSettlementStatus({ invoiceNumber: "  " }).key).toBe("planned");
  });

  it("payment status takes precedence over invoice status", () => {
    const s = deriveSettlementStatus({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-10",
      invoiceDateConfirmed: true,
      paidDate: "2026-02-01",
      paidDateConfirmed: true,
    });
    expect(s.key).toBe("paid");
  });
});
