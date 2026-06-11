/**
 * Cashflow drill invariant — week → line item → invoice.
 *
 * Acceptance criterion #3 (cashflow side): at every level, sum(children) ==
 * parent within R1. This feeds in-memory `/detail`-shaped leaves through the
 * pure grouping helper and asserts:
 *
 *   - Σ invoice amounts in a group  == group.amount
 *   - Σ group amounts (per direction) == week inflow/outflow total
 *   - group.realisedAmount + group.forecastAmount == group.amount
 *   - net == inflowTotal − outflowTotal
 *
 * Pure / no DB / no DOM — runs under `npm run test`. The cash numbers
 * themselves come from the frozen cashflow engine via the existing
 * endpoints; this only proves the grouping is a faithful partition.
 */
import { describe, it, expect } from "vitest";
import {
  buildCashflowWeekDrill,
  cashflowDrillLeaves,
  type CashInflowInput,
  type CashOutflowInput,
} from "../../../client/src/lib/cashflow-drill";

const R1 = 1;
const near = (a: number, b: number, tol = R1): boolean => Math.abs(a - b) <= tol;

const inflows: CashInflowInput[] = [
  { inflowId: 1, projectName: "Mondi", milestoneName: "Deposit", milestoneInvoiceNumber: "INV-1", paymentReceivedDate: "2026-06-02", milestoneAmount: 1_500_000.55, qbPaymentStatus: "paid" },
  { inflowId: 2, projectName: "Mondi", milestoneName: "Deposit", milestoneInvoiceNumber: "INV-2", paymentReceivedDate: "2026-06-03", milestoneAmount: 250_000.45, qbPaymentStatus: "unpaid" },
  { inflowId: 3, projectName: "De Drift", milestoneName: "Milestone 2", milestoneInvoiceNumber: "INV-9", paymentReceivedDate: "2026-06-04", milestoneAmount: 980_000.13, qbPaymentStatus: null },
];

const outflows: CashOutflowInput[] = [
  { expenseId: 11, projectName: "Mondi", expenseCategory: "Panels", expenseLineItem: "Jinko 620W", expenseInvoiceNumber: "B-100", expensePaymentDate: "2026-06-02", expenseActualTotal: 800_000.21, outflowType: "actual", rowNumber: 6 },
  { expenseId: 12, projectName: "Mondi", expenseCategory: "Panels", expenseLineItem: "Jinko 620W", expenseInvoiceNumber: "B-101", expensePaymentDate: "2026-06-05", expenseActualTotal: 120_000.79, outflowType: "forecast", rowNumber: 7 },
  { expenseId: 13, projectName: "Mondi", expenseCategory: "Inverters", expenseLineItem: "Sungrow 110kW", expenseInvoiceNumber: "B-200", expensePaymentDate: "2026-06-06", expenseActualTotal: 333_333.33, paymentStatus: "paid", rowNumber: 20 },
];

const WEEK = "2026-06-01";
const drill = buildCashflowWeekDrill(WEEK, inflows, outflows);

describe("cashflow drill grouping — week → line → invoice invariant", () => {
  it("each line-item group amount equals the sum of its invoice leaves", () => {
    for (const g of [...drill.inflowGroups, ...drill.outflowGroups]) {
      const leafSum = g.invoices.reduce((a, l) => a + l.amount, 0);
      expect(near(g.amount, leafSum), `group ${g.key}`).toBe(true);
      expect(g.count).toBe(g.invoices.length);
    }
  });

  it("realised + forecast splits sum to the group amount", () => {
    for (const g of [...drill.inflowGroups, ...drill.outflowGroups]) {
      expect(near(g.amount, g.realisedAmount + g.forecastAmount), `split ${g.key}`).toBe(true);
    }
  });

  it("week inflow/outflow totals equal the sum of their line-item groups", () => {
    const inGroups = drill.inflowGroups.reduce((a, g) => a + g.amount, 0);
    const outGroups = drill.outflowGroups.reduce((a, g) => a + g.amount, 0);
    expect(near(drill.inflowTotal, inGroups)).toBe(true);
    expect(near(drill.outflowTotal, outGroups)).toBe(true);
  });

  it("week totals equal the sum of the raw leaves (faithful partition)", () => {
    const inSum = inflows.reduce((a, i) => a + (i.milestoneAmount ?? 0), 0);
    const outSum = outflows.reduce((a, o) => a + (o.expenseActualTotal ?? 0), 0);
    expect(near(drill.inflowTotal, inSum)).toBe(true);
    expect(near(drill.outflowTotal, outSum)).toBe(true);
    expect(near(drill.net, inSum - outSum)).toBe(true);
  });

  it("groups by project + line item; Mondi Panels collapses two invoices", () => {
    const panels = drill.outflowGroups.find((g) => g.lineItem === "Jinko 620W");
    expect(panels).toBeDefined();
    expect(panels?.invoices.length).toBe(2);
    // one actual (realised) + one forecast
    expect(near(panels?.realisedAmount ?? 0, 800_000.21)).toBe(true);
    expect(near(panels?.forecastAmount ?? 0, 120_000.79)).toBe(true);
  });

  it("exposes flat leaves for CSV export with source-row provenance", () => {
    const leaves = cashflowDrillLeaves(drill);
    expect(leaves.length).toBe(inflows.length + outflows.length);
    const b100 = leaves.find((l) => l.invoiceNumber === "B-100");
    expect(b100?.sourceRow).toBe(6);
    expect(b100?.paidState).toBe("realised");
  });
});
