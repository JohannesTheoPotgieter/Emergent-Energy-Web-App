/**
 * DF-27 — Unit tests for `summariseProposalAges` (the pure aggregator
 * behind `getProposalAgeSummary` exposed via GET
 * /api/quickbooks/cascade-proposals/summary in PR #943).
 *
 * The summary drives the colour-graded banner on the admin-quickbooks
 * page (sky / amber / rose by oldest pending age) so QB ↔ app drift
 * doesn't silently accumulate. Tests pin the bucket boundaries (> 7d,
 * > 14d, > 30d), the oldest-age calculation, and the null-input
 * handling.
 */
import { describe, it, expect } from "vitest";
import { summariseProposalAges } from "../../../server/services/quickbooks-cascade-proposals-service";

const NOW = new Date("2026-05-26T12:00:00.000Z").getTime();

function daysAgo(d: number): Date {
  return new Date(NOW - d * 24 * 60 * 60 * 1000);
}

describe("summariseProposalAges — DF-27 age bucket aggregator", () => {
  it("returns zero counts for empty input", () => {
    const result = summariseProposalAges([], NOW);
    expect(result).toEqual({
      pending: 0,
      agedOver7Days: 0,
      agedOver14Days: 0,
      agedOver30Days: 0,
      oldestAgeDays: null,
      oldestCreatedAt: null,
    });
  });

  it("counts pending proposals", () => {
    const result = summariseProposalAges(
      [daysAgo(1), daysAgo(5), daysAgo(20)],
      NOW,
    );
    expect(result.pending).toBe(3);
  });

  it("flags > 7 days (strict inequality)", () => {
    const result = summariseProposalAges(
      [daysAgo(6), daysAgo(7), daysAgo(7.5), daysAgo(10), daysAgo(100)],
      NOW,
    );
    // 6d, 7d → not > 7. 7.5d, 10d, 100d → all > 7.
    expect(result.agedOver7Days).toBe(3);
  });

  it("flags > 14 days (strict inequality)", () => {
    const result = summariseProposalAges(
      [daysAgo(13), daysAgo(14), daysAgo(15), daysAgo(40)],
      NOW,
    );
    expect(result.agedOver14Days).toBe(2);
  });

  it("flags > 30 days (strict inequality)", () => {
    const result = summariseProposalAges(
      [daysAgo(29), daysAgo(30), daysAgo(31), daysAgo(365)],
      NOW,
    );
    expect(result.agedOver30Days).toBe(2);
  });

  it("computes oldestAgeDays from the oldest createdAt", () => {
    const result = summariseProposalAges(
      [daysAgo(1), daysAgo(45), daysAgo(10)],
      NOW,
    );
    expect(result.oldestAgeDays).toBe(45);
  });

  it("returns the oldest createdAt as an ISO string", () => {
    const oldest = daysAgo(20);
    const result = summariseProposalAges(
      [daysAgo(5), oldest, daysAgo(2)],
      NOW,
    );
    expect(result.oldestCreatedAt).toBe(oldest.toISOString());
  });

  it("accepts Date / string / number / null inputs and skips invalid", () => {
    const result = summariseProposalAges(
      [
        daysAgo(10),                          // Date
        daysAgo(10).toISOString(),            // ISO string
        daysAgo(10).getTime(),                // number (ms)
        null,                                 // skip
        undefined,                            // skip
        "not-a-date",                         // skip
      ],
      NOW,
    );
    // Three valid 10d-ago entries, all > 7d not > 14d.
    expect(result.pending).toBe(3);
    expect(result.agedOver7Days).toBe(3);
    expect(result.agedOver14Days).toBe(0);
  });

  it("buckets are inclusive (a proposal at 15d is counted in BOTH >7d and >14d)", () => {
    const result = summariseProposalAges([daysAgo(15)], NOW);
    expect(result.agedOver7Days).toBe(1);
    expect(result.agedOver14Days).toBe(1);
    expect(result.agedOver30Days).toBe(0);
  });

  it("uses provided asOfMs to make the calculation deterministic for tests", () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z").getTime();
    const result = summariseProposalAges(
      [new Date("2025-12-25T00:00:00.000Z")], // 7 days before cutoff
      cutoff,
    );
    // 7d exactly = NOT > 7
    expect(result.agedOver7Days).toBe(0);
    expect(result.oldestAgeDays).toBe(7);
  });
});
