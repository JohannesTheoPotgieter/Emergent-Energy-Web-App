/**
 * VO financial-impact service — the BR-025/026 5%-of-GP gate and the per-project
 * VO impact view. All DB-free: the canonical project-GP base is derived through
 * the real § 3.3 engine (deriveFinanceLinesFromRows / aggregateLinesByMonth) and
 * the repositories are injected as fakes, so the gate logic is proven against the
 * same numbers finance reports.
 */
import { describe, expect, it } from "vitest";

import {
  VO_GP_THRESHOLD,
  evaluateVoGate,
  voGpImpact,
  voCostDelta,
  sumProjectGp,
  getProjectVoImpacts,
} from "../../../server/services/vo-impact-service";
import {
  deriveFinanceLinesFromRows,
  aggregateLinesByMonth,
  type FinanceLine,
  type FinanceLineActualsRowInput,
  type FinanceLineParentRowInput,
  type FinanceLineAllocationRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import type { ChangeRequest } from "../../../shared/schema/projects";

const R1 = 1; // RECON_R1 — one-Rand tolerance.
const P = 7777;

// Canonical single-category fixture: J (revenueAllocation) = 1,000,000;
// one actual cost of 600,000 → Σ perLineRevenue = 1,000,000, Σ perLineGp =
// 1,000,000 − 600,000 = project GP of 400,000.
const allocations: FinanceLineAllocationRowInput[] = [
  { id: 1, projectId: P, categoryKey: "1. panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "1000000.00" },
];
const parents: FinanceLineParentRowInput[] = [
  { id: 1, projectId: P, categoryAllocationId: 1, categoryKey: "1. panels", costCategory: "1. panels", description: "A", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
];
const actuals: FinanceLineActualsRowInput[] = [
  { id: 11, costLineId: 1, projectId: P, actualTotal: "600000.00", poNumber: null, invoiceNumber: "INV-A", invoiceDate: "2025-01-15", invoiceDateFontColor: "black", invoiceDateConfirmed: true, financePaymentDate: null, description: "A", qty: null, rate: null },
];
const canonicalLines: FinanceLine[] = deriveFinanceLinesFromRows(actuals, parents, allocations);
const PROJECT_GP = sumProjectGp(canonicalLines);

// A full change_request row so the fakes are type-exact (no casts).
const baseCr: ChangeRequest = {
  id: 0, projectId: P, title: "VO", description: null, changeType: "scope",
  requestedByUserId: null, ownerUserId: null, impactSummary: null,
  costImpact: null, scheduleImpact: null, status: "submitted", approvalId: null,
  createdAt: new Date(), updatedAt: new Date(), cause: null, clientLinked: false,
  revenueImpact: null, cosImpact: null, marginImpact: null, evidenceLink: null,
  finalDecision: null, submittedByUserId: null, submittedAt: null,
  reviewerUserId: null, reviewStartedAt: null, approverUserId: null,
  approvedAt: null, rejectionReason: null, rejectedAt: null,
  requiresManagementReview: null, gpImpactPctAtSubmit: null,
  deletedAt: null, deletedBy: null, deleteReason: null,
};
const makeCr = (o: Partial<ChangeRequest>): ChangeRequest => ({ ...baseCr, ...o });

describe("VO impact — canonical GP base (§3.3)", () => {
  it("project GP base ties to the canonical line engine within R1", () => {
    expect(PROJECT_GP).toBeCloseTo(400_000, 2);
    const canonicalGp = aggregateLinesByMonth(canonicalLines).total.gp;
    expect(Math.abs(PROJECT_GP - canonicalGp)).toBeLessThanOrEqual(R1);
  });
});

describe("VO impact — GP impact formula", () => {
  it("GP impact = revenue delta − COS delta (COS preferred over generic cost)", () => {
    expect(voGpImpact({ revenueImpact: "100000", cosImpact: "30000", costImpact: "99999" })).toBe(70_000);
    expect(voCostDelta({ cosImpact: "30000", costImpact: "99999" })).toBe(30_000);
  });
  it("falls back to the generic cost delta when COS is absent", () => {
    expect(voGpImpact({ revenueImpact: "100000", cosImpact: null, costImpact: "40000" })).toBe(60_000);
  });
  it("ties to stored marginImpact within R1 when both are present", () => {
    const cr = { revenueImpact: "250000", cosImpact: "180000", costImpact: null, marginImpact: "70000" };
    expect(Math.abs(voGpImpact(cr) - Number(cr.marginImpact))).toBeLessThanOrEqual(R1);
  });
});

describe("VO impact — 5%-of-GP gate (BR-025/026)", () => {
  it("threshold constant is 5%", () => expect(VO_GP_THRESHOLD).toBe(0.05));

  it("a VO at exactly 5% of GP is PM-approvable (not escalated)", () => {
    const g = evaluateVoGate(0.05 * PROJECT_GP, PROJECT_GP); // 20,000 of 400,000
    expect(g.exceedsThreshold).toBe(false);
    expect(g.gpImpactPct).toBeCloseTo(0.05, 6);
  });

  it("a VO just over 5% of GP is flagged for management review", () => {
    expect(evaluateVoGate(0.05 * PROJECT_GP + 1, PROJECT_GP).exceedsThreshold).toBe(true);
  });

  it("a large negative GP impact (>5% magnitude) is also flagged", () => {
    expect(evaluateVoGate(-0.06 * PROJECT_GP, PROJECT_GP).exceedsThreshold).toBe(true);
  });

  it("escalates conservatively when project GP is 0 (ratio undefined)", () => {
    const g = evaluateVoGate(5_000, 0);
    expect(g.exceedsThreshold).toBe(true);
    expect(g.gpImpactPct).toBeNull();
  });
});

describe("VO impact — per-project view (one source for finance + execution)", () => {
  const financeRepo = { getProjectFinanceLines: async () => canonicalLines };
  // GP impact 15,000 = 3.75% of 400,000 → PM-approvable.
  const voSmall = makeCr({ id: 1, title: "Small VO", revenueImpact: "30000", cosImpact: "15000" });
  // GP impact 70,000 = 17.5% of 400,000 → management review.
  const voBig = makeCr({ id: 2, title: "Big VO", revenueImpact: "100000", cosImpact: "30000" });
  const changeRequestsRepo = { listByProject: async () => [voBig, voSmall] };

  it("flags a >5% VO and leaves a ≤5% VO PM-approvable, off the canonical GP", async () => {
    const out = await getProjectVoImpacts(P, { financeRepo, changeRequestsRepo });
    expect(out.projectGp).toBeCloseTo(400_000, 2);

    const big = out.vos.find((v) => v.id === 2)!;
    const small = out.vos.find((v) => v.id === 1)!;
    expect(big.gpImpact).toBe(70_000);
    expect(big.exceedsThreshold).toBe(true);
    expect(small.gpImpact).toBe(15_000);
    expect(small.exceedsThreshold).toBe(false);

    expect(out.totals.flaggedCount).toBe(1);
    expect(out.totals.gpImpact).toBe(85_000);
    expect(out.totals.count).toBe(2);
  });
});
