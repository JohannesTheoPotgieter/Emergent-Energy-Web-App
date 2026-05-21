/**
 * Integration test for the COS account-name whitelist as it flows
 * through the reconciliation matcher. The pure classifier is covered
 * separately in qb-account-classification.test.ts; this test proves the
 * wiring through matchCostLinesToBills + buildSummary works end-to-end.
 */
import { describe, expect, it } from "vitest";
import {
  matchCostLinesToBills,
  matchCostLinesToBillsWithDiagnostics,
  buildSummary,
  type AppCostLineSummary,
  type QuickBooksBillSummary,
} from "../../../server/services/quickbooks-reconciliation-service";

const baseCostLine: Omit<AppCostLineSummary, "id" | "invoiceNumber" | "amountExVat" | "counterpartyName"> = {
  projectId: 1,
  projectName: "Sandton Solar",
  invoiceDate: "2026-04-15",
  paidDate: null,
  cosRealised: null,
  paidDateConfirmed: null,
  status: "invoiced",
  description: null,
  poNumber: null,
};

function bill(
  id: string,
  docNumber: string,
  amount: number,
  accountNames: string[],
  vendorName = "Acme Solar Supplies",
): QuickBooksBillSummary {
  return {
    id,
    docNumber,
    txnDate: "2026-04-15",
    dueDate: null,
    totalAmount: amount,
    qbAmountIncVat: amount * 1.15,
    qbTaxAmount: amount * 0.15,
    qbAmountExVat: amount,
    taxUncertain: false,
    balance: 0,
    vendorName,
    vendorId: "vend-1",
    accountNames,
  };
}

function costLine(id: number, invoiceNumber: string, amountExVat: number, vendor = "Acme Solar Supplies"): AppCostLineSummary {
  return { ...baseCostLine, id, invoiceNumber, amountExVat, counterpartyName: vendor };
}

describe("matchCostLinesToBills — COS account-name whitelist (integration)", () => {
  it("default (no patterns) keeps all bills — non-breaking with pre-whitelist behaviour", () => {
    const cost = costLine(101, "ACME-4711", 42500);
    const cosBill = bill("bill-1", "ACME-4711", 42500, ["Cost of Sales — Materials"]);
    const rentBill = bill("bill-7", "RENT-2026-04", 25000, ["Rent & Site Office"]);

    const rows = matchCostLinesToBills([cost], [cosBill, rentBill], []);
    const summary = buildSummary(rows);

    expect(rows.find((r) => r.matchType === "auto_exact")?.bill?.id).toBe("bill-1");
    expect(rows.some((r) => r.matchType === "qb_only" && r.bill?.id === "bill-7")).toBe(true);
    expect(summary.cosAccountFilter).toBeUndefined();
  });

  it("active whitelist drops non-COS bills from auto-matching and the qb_only bucket", () => {
    const cost = costLine(101, "ACME-4711", 42500);
    const cosBill = bill("bill-1", "ACME-4711", 42500, ["Cost of Sales — Materials"]);
    const rentBill = bill("bill-7", "RENT-2026-04", 25000, ["Rent & Site Office"]);

    const result = matchCostLinesToBillsWithDiagnostics(
      [cost],
      [cosBill, rentBill],
      [],
      { cosAccountPatterns: ["cost of sales"] },
    );
    const summary = buildSummary(result.rows, {
      cosAccountPatterns: ["cost of sales"],
      excludedNonCosBills: result.excludedNonCosBills,
    });

    expect(result.rows.find((r) => r.matchType === "auto_exact")?.bill?.id).toBe("bill-1");
    expect(result.rows.some((r) => r.bill?.id === "bill-7")).toBe(false);
    expect(result.excludedNonCosBills.map((b) => b.id)).toEqual(["bill-7"]);
    expect(summary.cosAccountFilter).toEqual({
      enabled: true,
      patterns: ["cost of sales"],
      excludedNonCosBillCount: 1,
      excludedNonCosAccountNames: ["Rent & Site Office"],
      linkedNonCosBillCount: 0,
      linkedNonCosAccountNames: [],
    });
  });

  it("linked operator overrides bypass the whitelist", () => {
    const cost = costLine(101, "RENT-2026-04", 25000);
    const rentBill = bill("bill-7", "RENT-2026-04", 25000, ["Rent & Site Office"]);

    const result = matchCostLinesToBillsWithDiagnostics(
      [cost],
      [rentBill],
      [
        {
          id: 1,
          appEntityType: "cost_line",
          appEntityId: 101,
          qbEntityType: "bill",
          qbEntityId: "bill-7",
          qbDocNumber: "RENT-2026-04",
          qbTxnDate: "2026-04-15",
          qbAmount: 25000,
          qbCounterpartyName: "Acme Solar Supplies",
          matchType: "manual",
        } as any,
      ],
      { cosAccountPatterns: ["cost of sales"] },
    );

    const linked = result.rows.find((r) => r.matchType === "linked");
    expect(linked?.bill?.id).toBe("bill-7");
    // The bill IS still classified as non-COS — but the operator override
    // wins, so it surfaces on the linked path. excludedNonCosBills tracks
    // the auto-match exclusion separately.
    expect(result.excludedNonCosBills.map((b) => b.id)).toEqual(["bill-7"]);
  });

  it("synthetic header-only bills (no accountNames) survive the filter", () => {
    const cost = costLine(101, "ACME-4711", 42500);
    const headerOnlyBill = bill("bill-9", "ACME-4711", 42500, []); // no lines parsed

    const result = matchCostLinesToBillsWithDiagnostics(
      [cost],
      [headerOnlyBill],
      [],
      { cosAccountPatterns: ["cost of sales"] },
    );

    expect(result.rows.find((r) => r.matchType === "auto_exact")?.bill?.id).toBe("bill-9");
    expect(result.excludedNonCosBills).toHaveLength(0);
  });

  it("mixed-account bills (at least one COS line) pass the filter", () => {
    const cost = costLine(101, "MIX-001", 100000);
    const mixedBill = bill("bill-10", "MIX-001", 100000, [
      "Cost of Sales — Materials",
      "Office Stationery",
    ]);

    const result = matchCostLinesToBillsWithDiagnostics(
      [cost],
      [mixedBill],
      [],
      { cosAccountPatterns: ["cost of sales"] },
    );

    expect(result.rows.find((r) => r.matchType === "auto_exact")?.bill?.id).toBe("bill-10");
    expect(result.excludedNonCosBills).toHaveLength(0);
  });
});
