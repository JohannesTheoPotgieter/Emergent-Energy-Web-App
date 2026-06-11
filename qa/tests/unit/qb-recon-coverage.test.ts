/**
 * Match-coverage logic for the company tracker-vs-QuickBooks month table.
 *
 * Pure tests: coverage = matched ÷ tracker-invoiced (by value), the low-coverage
 * flag, and the integrity rule that a no-invoiced-value period reads "—" not
 * "100%" (never imply completeness — AGENT_GUARDRAILS S5). No DB / no QB.
 */
import { describe, expect, it } from "vitest";

import {
  coveragePct,
  coverageLabel,
  variance,
  monthCoverage,
  LOW_COVERAGE_THRESHOLD,
  type PeriodSummaryLike,
  type SummaryRowLike,
} from "../../../client/src/lib/finance/qb-recon-coverage";

const row = (over: Partial<SummaryRowLike>): SummaryRowLike => ({
  trackerTotal: 0,
  qbTotal: 0,
  matchedTotal: 0,
  varianceTotal: 0,
  trackerOnlyTotal: 0,
  qbOnlyTotal: 0,
  ...over,
});

describe("coveragePct", () => {
  it("matched ÷ tracker as a percentage", () => {
    expect(coveragePct(900, 1000)).toBe(90);
    expect(coveragePct(250, 1000)).toBe(25);
  });
  it("is null when there is no tracker-invoiced value (never 100%)", () => {
    expect(coveragePct(0, 0)).toBeNull();
    expect(coverageLabel(coveragePct(0, 0))).toBe("—");
  });
});

describe("variance", () => {
  it("is tracker − qb, rounded to cents", () => {
    expect(variance(1000, 950)).toBe(50);
    expect(variance(1000.004, 1000)).toBe(0);
  });
});

describe("monthCoverage", () => {
  const period: PeriodSummaryLike = {
    periodKey: "2026-06",
    rev: row({ trackerTotal: 1000, qbTotal: 1000, matchedTotal: 1000 }), // 100%
    cos: row({ trackerTotal: 1000, qbTotal: 600, matchedTotal: 600 }), // 60%
    gpTracker: 0,
    gpQb: 400,
    gpDelta: -400,
  };

  it("computes per-stream and overall coverage by value", () => {
    const cov = monthCoverage(period);
    expect(cov.rev).toBe(100);
    expect(cov.cos).toBe(60);
    // overall = (1000 + 600) / (1000 + 1000) = 80%
    expect(cov.overall).toBe(80);
    expect(cov.hasInvoicedValue).toBe(true);
  });

  it("flags low coverage below the threshold (not fully reconciled)", () => {
    const cov = monthCoverage(period); // 80% < 90
    expect(LOW_COVERAGE_THRESHOLD).toBe(90);
    expect(cov.low).toBe(true);
  });

  it("does not flag a fully-matched month", () => {
    const full: PeriodSummaryLike = {
      periodKey: "2026-07",
      rev: row({ trackerTotal: 500, qbTotal: 500, matchedTotal: 500 }),
      cos: row({ trackerTotal: 500, qbTotal: 500, matchedTotal: 500 }),
      gpTracker: 0,
      gpQb: 0,
      gpDelta: 0,
    };
    const cov = monthCoverage(full);
    expect(cov.overall).toBe(100);
    expect(cov.low).toBe(false);
  });

  it("a period with no invoiced value reads — and is not low (nothing to reconcile)", () => {
    const empty: PeriodSummaryLike = { periodKey: "2026-08", rev: null, cos: null, gpTracker: 0, gpQb: 0, gpDelta: 0 };
    const cov = monthCoverage(empty);
    expect(cov.overall).toBeNull();
    expect(cov.low).toBe(false);
    expect(cov.hasInvoicedValue).toBe(false);
  });
});
