import { describe, expect, it } from "vitest";
import {
  deriveInflowsQbStatus,
  deriveOutflowsQbStatus,
  resolveQbMatch,
  type QbTxnCandidate,
} from "../../../server/lib/quickbooks-status";

const billCandidates: QbTxnCandidate[] = [
  {
    id: "b1",
    docNumber: "INV-100",
    totalAmount: 1000,
    balance: 0,
    counterpartyName: "ACME Supplies",
    txnDate: "2026-03-10",
    statusDate: "2026-03-10",
  },
  {
    id: "b2",
    docNumber: "INV-200",
    totalAmount: 1000,
    balance: 400,
    counterpartyName: "ACME Supplies",
    txnDate: "2026-03-12",
    statusDate: "2026-03-12",
  },
];

describe("quickbooks status matching", () => {
  it("prefers linked transaction id over fallback matching", () => {
    const match = resolveQbMatch({
      linkedTransactionId: "b2",
      invoiceNumber: "INV-100",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(match.qbTransactionId).toBe("b2");
    expect(match.qbMatchType).toBe("linked_txn_id");
    expect(match.qbMatchConfidence).toBe("high");
  });

  it("matched paid outflow", () => {
    const match = resolveQbMatch({
      invoiceNumber: "INV-100",
      projectName: "Project A",
      counterpartyName: "ACME Supplies",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(match.qbTransactionId).toBe("b1");
    expect(deriveOutflowsQbStatus(match.matched?.balance ?? null, true, 1000)).toBe("Paid");
  });

  it("unmatched outflow", () => {
    const match = resolveQbMatch({
      invoiceNumber: "INV-404",
      amount: 999,
      candidates: billCandidates,
    });
    expect(match.qbMatchType).toBe("unmatched");
    expect(deriveOutflowsQbStatus(null, false, 999)).toBe("Unknown");
  });

  it("matched received inflow", () => {
    const match = resolveQbMatch({
      invoiceNumber: "INV-100",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(deriveInflowsQbStatus(match.matched?.balance ?? null, true, 1000)).toBe("Received");
  });

  it("unmatched inflow", () => {
    const match = resolveQbMatch({
      invoiceNumber: "NOPE",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(match.matched).toBeNull();
    expect(deriveInflowsQbStatus(null, false, 1000)).toBe("Unknown");
  });

  it("not received inflow (balance equals amount)", () => {
    // balance === totalAmount means nothing has been received yet
    expect(deriveInflowsQbStatus(1000, true, 1000)).toBe("Not received");
  });

  it("partial payment case", () => {
    const match = resolveQbMatch({
      invoiceNumber: "INV-200",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(deriveOutflowsQbStatus(match.matched?.balance ?? null, true, 1000)).toBe("Partially paid");
  });

  it("invoice+amount fallback returns medium confidence", () => {
    const match = resolveQbMatch({
      invoiceNumber: "INV-200",
      amount: 1000,
      candidates: billCandidates,
    });
    expect(match.qbMatchType).toBe("invoice_amount");
    expect(match.qbMatchConfidence).toBe("medium");
  });
});
