import { describe, expect, it } from "vitest";
import {
  matchQbDocsToTrackerLines,
  computeProjectAttribution,
  computeUnattributed,
  tallyMatches,
  matchedConfidence,
  DEFAULT_NORMALIZER,
  type QbDocInput,
  type TrackerLineInput,
} from "../../../server/lib/finance/qb-project-matcher";
import { NORMALIZERS } from "../../../server/lib/finance/qb-match-rate";

/**
 * G2 per-project QB auto-matcher — pure logic.
 *
 * Attribution comes ONLY from a tracker line's project_id, reached via an
 * (invoice number + ex-VAT amount within tolerance) match. Wrong matches and
 * forced attribution are the failure modes these tests pin shut.
 */

const qb = (docNumber: string, amountExVat: number, qbDocId = `q-${docNumber}`): QbDocInput => ({
  qbDocId,
  docNumber,
  amountExVat,
  date: "2026-01-15",
});
const line = (
  trackerLineId: number,
  projectId: number,
  invoiceNumber: string | null,
  amountExVat: number,
): TrackerLineInput => ({ trackerLineId, projectId, invoiceNumber, amountExVat });

describe("matchQbDocsToTrackerLines", () => {
  it("attributes a QB invoice to the right project via its matching tracker line", () => {
    const tracker = [line(1, 100, "INV-001", 1000), line(2, 200, "INV-002", 2000)];
    const [m] = matchQbDocsToTrackerLines("REV", [qb("INV-001", 1000)], tracker);
    expect(m.matchType).toBe("matched");
    expect(m.projectId).toBe(100);
    expect(m.trackerLineId).toBe(1);
    expect(m.candidateCount).toBe(1);
    expect(m.confidence).toBe(1); // exact amount
  });

  it("matches within tolerance but never beyond it (amount mismatch → UNMATCHED, not a wrong match)", () => {
    const tracker = [line(1, 100, "INV-001", 1000)];
    // R50 out → must NOT attribute to project 100.
    const [miss] = matchQbDocsToTrackerLines("REV", [qb("INV-001", 1050)], tracker, { tolerance: 1 });
    expect(miss.matchType).toBe("unmatched");
    expect(miss.projectId).toBeNull();
    expect(miss.trackerLineId).toBeNull();
    expect(miss.candidateCount).toBe(0);

    // R0.50 out → within R1 → matched.
    const [hit] = matchQbDocsToTrackerLines("REV", [qb("INV-001", 1000.5)], tracker, { tolerance: 1 });
    expect(hit.matchType).toBe("matched");
    expect(hit.projectId).toBe(100);
  });

  it("flags a duplicate invoice number as AMBIGUOUS (never silently picks one project)", () => {
    const tracker = [line(1, 100, "INV-001", 1000), line(2, 200, "INV-001", 1000)];
    const [m] = matchQbDocsToTrackerLines("REV", [qb("INV-001", 1000)], tracker);
    expect(m.matchType).toBe("ambiguous");
    expect(m.projectId).toBeNull();
    expect(m.trackerLineId).toBeNull();
    expect(m.candidateCount).toBe(2);
    expect(m.candidateLineIds.sort()).toEqual([1, 2]);
  });

  it("treats two tracker lines on the SAME project as ambiguous too (no forced line pick)", () => {
    const tracker = [line(1, 100, "INV-009", 500), line(2, 100, "INV-009", 500)];
    const [m] = matchQbDocsToTrackerLines("COS", [qb("INV-009", 500)], tracker);
    expect(m.matchType).toBe("ambiguous");
    expect(m.projectId).toBeNull();
  });

  it("a QB doc with no usable number is unmatched (cannot match on number)", () => {
    const tracker = [line(1, 100, "INV-001", 1000)];
    const [m] = matchQbDocsToTrackerLines("REV", [qb("", 1000, "blank")], tracker);
    expect(m.matchType).toBe("unmatched");
  });

  it("uses the same normalizer as the company engine — supplier prefix + leading zeros", () => {
    // digits_no_leading_zeros: 'INV-007' → '7', QB '7' → '7' → match.
    expect(DEFAULT_NORMALIZER).toBe(NORMALIZERS.digits_no_leading_zeros);
    const tracker = [line(1, 300, "INV-007", 4200)];
    const [m] = matchQbDocsToTrackerLines("REV", [qb("7", 4200)], tracker);
    expect(m.matchType).toBe("matched");
    expect(m.projectId).toBe(300);
  });
});

describe("matchedConfidence", () => {
  it("is 1.0 at an exact amount and 0.5 at the tolerance edge", () => {
    expect(matchedConfidence(0, 1)).toBe(1);
    expect(matchedConfidence(1, 1)).toBe(0.5);
    expect(matchedConfidence(0.5, 1)).toBe(0.75);
  });
});

describe("computeProjectAttribution — explicit coverage", () => {
  it("computes coverage, attributed QB, and variance on a known set", () => {
    const tracker = [
      line(1, 100, "INV-100", 1000), // matched
      line(2, 100, "INV-101", 500), // matched
      line(3, 100, "INV-102", 300), // no QB doc → unmatched tracker value
      line(4, 100, null, 999), // no invoice number → excluded from the denominator
    ];
    const qbDocs = [qb("INV-100", 1000), qb("INV-101", 500)];
    const matches = matchQbDocsToTrackerLines("REV", qbDocs, tracker);
    const [attr] = computeProjectAttribution("REV", matches, tracker);

    expect(attr.projectId).toBe(100);
    expect(attr.trackerInvoicedExVat).toBe(1800); // 1000+500+300 (line 4 has no number)
    expect(attr.trackerMatchedExVat).toBe(1500); // 1000+500
    expect(attr.qbAttributedExVat).toBe(1500);
    expect(attr.coveragePct).toBe(83.33); // 1500/1800
    expect(attr.varianceExVat).toBe(0);
    expect(attr.matchedDocCount).toBe(2);
    expect(attr.complete).toBe(false); // < 100% → "matched portion only"
  });

  it("reports variance on matched lines and 100% coverage as complete", () => {
    const tracker = [line(1, 7, "A1", 1000.4)];
    const matches = matchQbDocsToTrackerLines("COS", [qb("A1", 1000)], tracker, { tolerance: 1 });
    const [attr] = computeProjectAttribution("COS", matches, tracker);
    expect(attr.coveragePct).toBe(100);
    expect(attr.complete).toBe(true);
    expect(attr.trackerMatchedExVat).toBe(1000.4);
    expect(attr.qbAttributedExVat).toBe(1000);
    expect(attr.varianceExVat).toBe(0.4); // tracker − qb, within tolerance
  });

  it("never lets coverage exceed 100% when two QB docs hit one tracker line", () => {
    const tracker = [line(1, 5, "INV-77", 200)];
    // Two distinct QB docs, same number + amount → both match the one line.
    const matches = matchQbDocsToTrackerLines("REV", [qb("INV-77", 200, "qa"), qb("INV-77", 200, "qb")], tracker);
    // Both are 1:1 against the single tracker line (one candidate each).
    expect(matches.every((m) => m.matchType === "matched")).toBe(true);
    const [attr] = computeProjectAttribution("REV", matches, tracker);
    expect(attr.trackerMatchedExVat).toBe(200); // counted once
    expect(attr.coveragePct).toBe(100);
    expect(attr.qbAttributedExVat).toBe(400); // both QB docs attributed
  });
});

describe("computeUnattributed — nothing silently dropped", () => {
  it("rolls unmatched + ambiguous QB docs to the company bucket", () => {
    const tracker = [line(1, 100, "INV-1", 1000), line(2, 200, "INV-55", 50), line(3, 300, "INV-55", 50)];
    const qbDocs = [
      qb("INV-1", 1000), // matched → not in bucket
      qb("INV-900", 800), // unmatched (no tracker counterpart)
      qb("INV-55", 50), // ambiguous (two tracker lines)
    ];
    const matches = matchQbDocsToTrackerLines("COS", qbDocs, tracker);
    const bucket = computeUnattributed("COS", matches);
    expect(bucket.unmatchedExVat).toBe(800);
    expect(bucket.unmatchedCount).toBe(1);
    expect(bucket.ambiguousExVat).toBe(50);
    expect(bucket.ambiguousCount).toBe(1);

    const counts = tallyMatches(matches);
    expect(counts).toEqual({ matched: 1, ambiguous: 1, unmatched: 1, total: 3 });
  });
});
