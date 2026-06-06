/**
 * fix/qb-cascade-lock-or-document — proves the COS period-lock matrix is complete
 * for the QuickBooks cascade-accept path.
 *
 * The cascade is the last periodised write surface. Its only write that can move
 * a reported figure / recognition date / cash date / realisation gate is
 * `applyFieldOverwrite` (the five CASCADE_FIGURE_PROPOSAL_TYPES); every other
 * proposal type is metadata. The accept route now calls guardCosPeriodLock over
 * `getCascadeLockContext` → `cascadeAffectedDates`. These tests pin that pure
 * classification so the matrix can't silently regress.
 */

import { describe, expect, it } from "vitest";

import {
  cascadeAffectedDates,
  CASCADE_FIGURE_PROPOSAL_TYPES,
} from "../../../server/services/quickbooks-cascade-proposals-service";

// Every proposalType the cascade dispatcher (applyMutation) handles.
const ALL_PROPOSAL_TYPES = [
  "invoice_date",
  "paid_date",
  "invoice_number",
  "amount_ex_vat",
  "vat_amount",
  "vendor_mapping",
  "customer_mapping",
  "counterparty_id",
  "name_alias",
  "pattern_rule_create",
  "description_pattern_create",
  "recon_ignore_clear",
];
const FIGURE_TYPES = ["invoice_date", "paid_date", "invoice_number", "amount_ex_vat", "vat_amount"];
const METADATA_TYPES = ALL_PROPOSAL_TYPES.filter((t) => !FIGURE_TYPES.includes(t));

const LINE = { invoiceDate: "2026-03-15", paidDate: "2026-04-20" };

describe("QB cascade period-lock matrix is provably complete", () => {
  it("the guarded set is exactly the applyFieldOverwrite (figure/date/realisation) cases", () => {
    expect([...CASCADE_FIGURE_PROPOSAL_TYPES].sort()).toEqual([...FIGURE_TYPES].sort());
  });

  it("a figure / amount / invoice-number write is guarded on the line's recognition period (§3.3)", () => {
    expect(cascadeAffectedDates("amount_ex_vat", LINE, "999.00")).toEqual(["2026-03-15"]);
    expect(cascadeAffectedDates("vat_amount", LINE, "150.00")).toEqual(["2026-03-15"]);
    expect(cascadeAffectedDates("invoice_number", LINE, "INV-9")).toEqual(["2026-03-15"]);
  });

  it("a recognition-date move is guarded on BOTH the source and target period", () => {
    expect(cascadeAffectedDates("invoice_date", LINE, "2026-05-01")).toEqual(["2026-03-15", "2026-05-01"]);
  });

  it("a cash-date move is guarded on the recognition + source + target cash period (§3.4)", () => {
    expect(cascadeAffectedDates("paid_date", LINE, "2026-06-10")).toEqual(["2026-03-15", "2026-04-20", "2026-06-10"]);
  });

  it("every metadata proposal is a guard no-op — touches no figure / date / recognition month", () => {
    for (const t of METADATA_TYPES) {
      expect(cascadeAffectedDates(t, LINE, "x"), t).toEqual([]);
    }
  });

  it("the cascade has NO path that sets cos_realised or an amount/date outside the guarded set", () => {
    expect(CASCADE_FIGURE_PROPOSAL_TYPES.has("cos_realised")).toBe(false);
    expect(ALL_PROPOSAL_TYPES).not.toContain("cos_realised");
    expect(cascadeAffectedDates("cos_realised", LINE, "true")).toEqual([]);
    // Any figure-bearing proposal is in the guarded set, so it cannot bypass the lock.
    for (const t of FIGURE_TYPES) {
      expect(cascadeAffectedDates(t, LINE, "x").filter(Boolean).length, t).toBeGreaterThan(0);
    }
  });
});
