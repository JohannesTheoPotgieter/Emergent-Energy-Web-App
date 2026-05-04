/**
 * Unit tests for the "Find QB Matches" pure scorer.
 *
 * The scorer is intentionally I/O-free so these tests do not need a DB,
 * the connector, or the route layer. They pin the scoring hierarchy and
 * the per-candidate warnings, both of which the UI renders verbatim.
 */
import { describe, it, expect } from "vitest";

import {
  rankInvoiceMatches,
  scoreInvoiceMatch,
  appSideWarnings,
  confidenceBand,
  nameSimilarity,
  normalizeInvoiceNumber,
  type AppInvoiceLike,
  type QbCandidateLike,
} from "../../../server/services/quickbooks-invoice-match-service";

const baseApp: AppInvoiceLike = {
  id: 1,
  invoiceNumber: "INV-123",
  invoiceDate: "2026-03-12",
  amountExVat: 150_000,
  counterpartyName: "ABC Electrical",
  poNumber: "PO-7001",
};

function qb(partial: Partial<QbCandidateLike>): QbCandidateLike {
  return {
    qbEntityId: "qb-1",
    qbEntityType: "bill",
    qbDocNumber: null,
    qbTxnDate: null,
    qbCounterpartyName: null,
    qbCounterpartyId: null,
    qbAmountExVat: null,
    qbBalance: null,
    qbPaymentStatus: null,
    ...partial,
  };
}

// ---------- normalisation primitives ----------

describe("normalizeInvoiceNumber", () => {
  it("strips punctuation + whitespace and lowercases", () => {
    expect(normalizeInvoiceNumber(" inv-123 ")).toBe("inv123");
    expect(normalizeInvoiceNumber("INV/123")).toBe("inv123");
    expect(normalizeInvoiceNumber(null)).toBe("");
  });
});

describe("nameSimilarity", () => {
  it("matches the example: 'ABC Electrical' vs 'ABC Electrical (Pty) Ltd'", () => {
    const sim = nameSimilarity("ABC Electrical", "ABC Electrical (Pty) Ltd");
    expect(sim).toBeGreaterThan(0.4);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it("returns 0 when one side is empty", () => {
    expect(nameSimilarity("", "ABC")).toBe(0);
    expect(nameSimilarity(null, null)).toBe(0);
  });

  it("returns 1 for identical names", () => {
    expect(nameSimilarity("Solar Co", "solar co")).toBe(1);
  });
});

// ---------- per-candidate scoring ----------

describe("scoreInvoiceMatch — hierarchy", () => {
  it("Tier 2: invoice number exact + amount exact → 95", () => {
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "INV-123",
        qbAmountExVat: 150_000,
        qbCounterpartyName: "ABC Electrical (Pty) Ltd",
        qbTxnDate: "2026-03-25",
      }),
    );
    expect(result?.confidence).toBe(95);
    expect(result?.reasons).toContain("invoice number exact match");
    expect(result?.reasons).toContain("amount within R0.01");
  });

  it("Tier 3: invoice number exact only → 85 + amount_mismatch warning", () => {
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "INV-123",
        qbAmountExVat: 200_000, // way off
        qbCounterpartyName: "ABC",
      }),
    );
    expect(result?.confidence).toBe(85);
    expect(result?.warnings).toContain("amount_mismatch");
  });

  it("Tier 4: amount exact + name strong + same month → 78", () => {
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "RANDOM",
        qbAmountExVat: 150_000,
        qbCounterpartyName: "ABC Electrical Ltd",
        qbTxnDate: "2026-03-28",
      }),
    );
    expect(result?.confidence).toBe(78);
  });

  it("Tier 5: name strong + amount within 5% + ±60 days → 62", () => {
    // baseApp.counterparty = "ABC Electrical" — pair with a name that
    // has Jaccard ≥ 0.6 (token-set match on both 'abc' and 'electrical').
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "OTHER",
        qbAmountExVat: 152_000, // 1.3% off
        qbCounterpartyName: "ABC Electrical",
        qbTxnDate: "2026-04-15", // ~34 days
      }),
    );
    expect(result?.confidence).toBe(62);
  });

  it("Tier 6 fallback: any name overlap → 45 with vendor_mismatch when sim is low", () => {
    const result = scoreInvoiceMatch(
      { ...baseApp, counterpartyName: "Solar Install Co" },
      qb({
        qbDocNumber: "OTHER",
        qbAmountExVat: 999_999,
        qbCounterpartyName: "Different Vendor", // no token overlap → null
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null when there is zero overlap on any signal", () => {
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "QQQ",
        qbAmountExVat: 999,
        qbCounterpartyName: "Nothing",
      }),
    );
    expect(result).toBeNull();
  });

  it("vendor_mismatch warning appears when name overlap is < floor and amount mismatches", () => {
    const result = scoreInvoiceMatch(
      { ...baseApp, counterpartyName: "Acme Solar Pty" },
      qb({
        qbAmountExVat: 999_999,
        qbCounterpartyName: "Solar Maintenance", // shares "solar" only
      }),
    );
    expect(result?.confidence).toBe(45);
    expect(result?.warnings).toContain("vendor_mismatch");
    expect(result?.warnings).toContain("amount_mismatch");
  });
});

describe("scoreInvoiceMatch — universal warnings", () => {
  it("flags qb_payment_inconsistent when status=paid but balance>0", () => {
    const r = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "INV-123",
        qbAmountExVat: 150_000,
        qbBalance: 50_000,
        qbPaymentStatus: "paid",
      }),
    );
    expect(r?.warnings).toContain("qb_payment_inconsistent");
  });

  it("flags qb_amount_unknown when QB has no amount", () => {
    const r = scoreInvoiceMatch(
      baseApp,
      qb({
        qbDocNumber: "INV-123",
        qbAmountExVat: null,
      }),
    );
    expect(r?.warnings).toContain("qb_amount_unknown");
  });
});

// ---------- ranker ----------

describe("rankInvoiceMatches", () => {
  it("orders by confidence desc and respects topN", () => {
    const candidates = [
      qb({ qbEntityId: "low", qbAmountExVat: 200_000, qbCounterpartyName: "ABC", qbTxnDate: "2026-03-05" }),
      qb({ qbEntityId: "high", qbDocNumber: "INV-123", qbAmountExVat: 150_000 }),
      qb({ qbEntityId: "mid", qbDocNumber: "INV-123" }),
    ];
    const ranked = rankInvoiceMatches(baseApp, candidates, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].qbEntityId).toBe("high");
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });

  it("filters out candidates with zero overlap", () => {
    const candidates = [
      qb({ qbEntityId: "no-overlap", qbDocNumber: "ZZZ", qbAmountExVat: 1, qbCounterpartyName: "Nothing" }),
      qb({ qbEntityId: "match", qbDocNumber: "INV-123", qbAmountExVat: 150_000 }),
    ];
    const ranked = rankInvoiceMatches(baseApp, candidates, 5);
    expect(ranked.map((r) => r.qbEntityId)).toEqual(["match"]);
  });
});

// ---------- app-side warnings ----------

describe("appSideWarnings", () => {
  it("flags no_po only on cost scope when poNumber is missing", () => {
    const cost = appSideWarnings({ ...baseApp, poNumber: null }, "cost", false);
    expect(cost.no_po).toBe(true);
    const revenue = appSideWarnings({ ...baseApp, poNumber: null }, "revenue", false);
    expect(revenue.no_po).toBe(false);
  });

  it("flags already_linked when caller signals an active link exists", () => {
    const w = appSideWarnings(baseApp, "cost", true);
    expect(w.already_linked).toBe(true);
  });
});

// ---------- band thresholds ----------

describe("confidenceBand", () => {
  it("maps thresholds 90/70 correctly", () => {
    expect(confidenceBand(95)).toBe("high");
    expect(confidenceBand(90)).toBe("high");
    expect(confidenceBand(85)).toBe("medium");
    expect(confidenceBand(70)).toBe("medium");
    expect(confidenceBand(69)).toBe("low");
    expect(confidenceBand(0)).toBe("low");
  });
});

// ---------- task examples ----------

describe("end-to-end examples from the brief", () => {
  it("Example 1 — INV-123 / ABC Electrical / R150 000 + paid → high-confidence with vendor fuzzy match reason", () => {
    const result = scoreInvoiceMatch(
      baseApp,
      qb({
        qbEntityId: "qb-1",
        qbDocNumber: "INV-123",
        qbAmountExVat: 150_000,
        qbCounterpartyName: "ABC Electrical (Pty) Ltd",
        qbTxnDate: "2026-03-25",
        qbBalance: 0,
        qbPaymentStatus: "paid",
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(90);
    expect(result!.warnings).not.toContain("qb_payment_inconsistent");
  });

  it("Example 2 — INV-555 / Solar Install Co vs Different Vendor / same amount → vendor mismatch warning still surfaces", () => {
    const r = scoreInvoiceMatch(
      {
        id: 99,
        invoiceNumber: "INV-555",
        invoiceDate: "2026-03-10",
        amountExVat: 98_000,
        counterpartyName: "Solar Install Co",
        poNumber: "PO-X",
      },
      qb({
        qbDocNumber: "INV-555",
        qbAmountExVat: 98_000,
        qbCounterpartyName: "Different Vendor",
        qbTxnDate: "2026-03-10",
      }),
    );
    // Invoice number matches → at least Tier 3 (85+).
    expect(r?.confidence).toBeGreaterThanOrEqual(85);
  });
});
