/**
 * Invoice-number canonicalisation + residual reasons (G7 — hardening the
 * tracker↔QuickBooks match key). Pure tests: no DB / no QuickBooks.
 *
 *  1. DEFAULT config == today's live engine key (digits_no_leading_zeros) — the
 *     hardening must not silently move the live numbers (finance key is frozen).
 *  2. A real→canonical table of realistic SA invoice formats (prefixes,
 *     separators, leading zeros, year segments, credit-note markers). The owner
 *     will append ~12 real examples here; the structure is ready for them.
 *  3. before/after match rate — the hardened key recovers a near-miss the
 *     default key drops, lifting coverage by value.
 *  4. residual-unmatched reasons make the coverage gap explainable.
 */
import { describe, expect, it } from "vitest";

import { NORMALIZERS } from "../../../server/lib/finance/qb-match-rate";
import {
  canonicalizeInvoiceNumber,
  canonicalKey,
  classifyUnmatchedReason,
  matchWithReasons,
  DEFAULT_INVOICE_NORM_CONFIG,
  HARDENED_INVOICE_NORM_CONFIG,
  type InvoiceLike,
} from "../../../server/lib/finance/invoice-normalization";

describe("DEFAULT config reproduces the live engine key exactly", () => {
  // The engine uses NORMALIZERS.digits_no_leading_zeros as QB_RECON_NORMALIZER.
  const samples = ["ACME-00123", "INV/2025/0042", "000123", "EE-2026-013", "abc/007", "", null];
  it("canonicalKey(default) === digits_no_leading_zeros for every sample", () => {
    for (const s of samples) {
      expect(canonicalKey(s, DEFAULT_INVOICE_NORM_CONFIG)).toBe(NORMALIZERS.digits_no_leading_zeros(s));
    }
  });
});

describe("real → canonical table (catalogue of formats; extend with owner examples)", () => {
  // [raw, canonical-under-DEFAULT, canonical-under-HARDENED]
  const TABLE: Array<[string, string, string]> = [
    // supplier alpha prefix + leading zeros
    ["ACME-00123", "123", "123"],
    ["Eskom 000045", "45", "45"],
    // separators / spacing
    ["INV 0001", "1", "1"],
    ["INV#0001", "1", "1"],
    ["EE/2026/0013", "20260013", "13"], // hardened drops the 2026 year segment
    // year segment, no separators
    ["20250042", "20250042", "42"],
    // pure numeric, leading zeros
    ["000123", "123", "123"],
    // credit-note markers — default keeps the digits, hardened flags + strips marker
    ["CN-000123", "123", "123"],
    ["CR/2025/0042", "20250042", "42"],
    ["Credit Note 77", "77", "77"],
  ];

  for (const [raw, def, hard] of TABLE) {
    it(`${raw} → "${def}" (default) / "${hard}" (hardened)`, () => {
      expect(canonicalizeInvoiceNumber(raw, DEFAULT_INVOICE_NORM_CONFIG).canonical).toBe(def);
      expect(canonicalizeInvoiceNumber(raw, HARDENED_INVOICE_NORM_CONFIG).canonical).toBe(hard);
    });
  }

  it("hardened config detects + records credit-note markers", () => {
    const r = canonicalizeInvoiceNumber("CN-000123", HARDENED_INVOICE_NORM_CONFIG);
    expect(r.isCreditNote).toBe(true);
    expect(r.applied).toContain("strip_credit_note_marker");
    const plain = canonicalizeInvoiceNumber("INV-000123", HARDENED_INVOICE_NORM_CONFIG);
    expect(plain.isCreditNote).toBe(false);
  });

  it("records which steps fired, for explainability", () => {
    const r = canonicalizeInvoiceNumber("ACME/2025/00042-CN", HARDENED_INVOICE_NORM_CONFIG);
    expect(r.applied).toContain("digits_only");
    expect(r.applied).toContain("strip_leading_zeros");
  });
});

describe("classifyUnmatchedReason", () => {
  it("blank when there is no usable number", () => {
    expect(classifyUnmatchedReason({ rawNumber: null, canonical: "", hasCounterpart: false, amountMatched: null, collision: false, isCreditNote: false })).toBe("blank_number");
  });
  it("ambiguous when the canonical key folded several raw numbers", () => {
    expect(classifyUnmatchedReason({ rawNumber: "INV-1", canonical: "1", hasCounterpart: true, amountMatched: true, collision: true, isCreditNote: false })).toBe("ambiguous_collision");
  });
  it("credit_note flagged before no_counterpart", () => {
    expect(classifyUnmatchedReason({ rawNumber: "CN-1", canonical: "1", hasCounterpart: false, amountMatched: null, collision: false, isCreditNote: true })).toBe("credit_note");
  });
  it("no_counterpart when the other side lacks the key", () => {
    expect(classifyUnmatchedReason({ rawNumber: "INV-9", canonical: "9", hasCounterpart: false, amountMatched: null, collision: false, isCreditNote: false })).toBe("no_counterpart");
  });
  it("amount_variance when number matched but amount differs", () => {
    expect(classifyUnmatchedReason({ rawNumber: "INV-3", canonical: "3", hasCounterpart: true, amountMatched: false, collision: false, isCreditNote: false })).toBe("amount_variance");
  });
});

describe("matchWithReasons — before/after match rate + residual reasons", () => {
  // QB carries a supplier prefix + year segment the DEFAULT key can't fold to
  // the tracker's short serials; the HARDENED key recovers them.
  const QB: InvoiceLike[] = [
    { number: "ACME-2025-0500", amountExVat: 5000 }, // default→202505000 ; hardened→500
    { number: "INV-100", amountExVat: 1000 }, // matches both keys
    { number: "QB-ONLY-1", amountExVat: 7000 }, // qb only
  ];
  const TRACKER: InvoiceLike[] = [
    { number: "500", amountExVat: 5000 }, // pairs with ACME-2025-0500 only under hardened
    { number: "100", amountExVat: 1000 }, // pairs with INV-100
    { number: "TRK-ONLY-1", amountExVat: 4000 }, // tracker only
    { number: null, amountExVat: 999 }, // blank number
  ];

  it("hardened key lifts the tracker match rate by value", () => {
    const before = matchWithReasons(QB, TRACKER, DEFAULT_INVOICE_NORM_CONFIG, 1);
    const after = matchWithReasons(QB, TRACKER, HARDENED_INVOICE_NORM_CONFIG, 1);
    expect(after.matchRateByValue).toBeGreaterThan(before.matchRateByValue);
  });

  it("explains the residuals: blank number + no-counterpart are counted on the tracker side", () => {
    const before = matchWithReasons(QB, TRACKER, DEFAULT_INVOICE_NORM_CONFIG, 1);
    expect(before.trackerResiduals.blank_number.count).toBe(1);
    expect(before.trackerResiduals.blank_number.value).toBe(999);
    // "500" has no counterpart under the default key.
    expect(before.trackerResiduals.no_counterpart.count).toBeGreaterThanOrEqual(1);
    // QB-ONLY-1 is a qb-side residual.
    expect(before.qbResiduals.no_counterpart.count).toBeGreaterThanOrEqual(1);
  });
});
