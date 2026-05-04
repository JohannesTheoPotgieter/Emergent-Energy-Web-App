/**
 * Pure unit tests for qb-matching-workbench-logic.ts
 * No React, no DOM, no mocks needed — all functions are pure.
 */
import { describe, it, expect } from "vitest";
import {
  classifyLane,
  buildBulkApproveItems,
  buildExceptionsCSV,
  counterpartyNameMatch,
  confidenceBadge,
  laneBadge,
  EXCEPTION_CANDIDATE_WARNINGS,
} from "@/components/quickbooks/qb-matching-workbench-logic";
import type {
  FindResponse,
  WorkbenchRow,
} from "@/components/quickbooks/qb-matching-workbench-logic";

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    qbEntityId: "qb-42",
    qbEntityType: "bill" as const,
    qbDocNumber: "INV-001",
    qbTxnDate: "2025-01-01",
    qbCounterpartyName: "Acme Corp",
    qbCounterpartyId: "v1",
    qbAmountExVat: 10000,
    qbBalance: 0,
    qbPaymentStatus: "paid",
    confidence: 95,
    reasons: ["exact match"],
    warnings: [] as string[],
    qbAlreadyLinkedElsewhere: false,
    ...overrides,
  };
}

function makeFindResponse(overrides: Partial<FindResponse> = {}): FindResponse {
  return {
    suggestionId: 1,
    scope: "cost",
    app: {
      id: 1,
      invoiceNumber: "INV-001",
      invoiceDate: "2025-01-01",
      amountExVat: 10000,
      counterpartyName: "Acme Corp",
      poNumber: "PO-001",
      projectId: 1,
    },
    warnings: { no_po: false, already_linked: false },
    candidates: [makeCandidate()],
    ...overrides,
  };
}

function makeRow(overrides: Partial<WorkbenchRow> = {}): WorkbenchRow {
  return {
    id: 1,
    appLine: {
      id: 1,
      projectId: 1,
      projectName: "Proj A",
      invoiceNumber: "INV-001",
      invoiceDate: "2025-01-01",
      amountExVat: 10000,
      counterpartyName: "Acme Corp",
    },
    findResult: null,
    status: "idle",
    lane: null,
    errorMessage: null,
    ...overrides,
  };
}

// ─── classifyLane ─────────────────────────────────────────────────────────────

describe("classifyLane", () => {
  it("returns safe for confidence ≥ 90 with no warnings", () => {
    expect(classifyLane(makeFindResponse())).toBe("safe");
  });

  it("returns review for confidence 90 exactly with no warnings", () => {
    expect(classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 90 })] }))).toBe("safe");
  });

  it("returns review for confidence 70–89 with no warnings", () => {
    expect(classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 85 })] }))).toBe("review");
    expect(classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 70 })] }))).toBe("review");
  });

  it("returns exception for confidence below 70", () => {
    expect(classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 69 })] }))).toBe("exception");
    expect(classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 0 })] }))).toBe("exception");
  });

  it("returns exception when no_po is true even if confidence is high", () => {
    expect(
      classifyLane(makeFindResponse({ warnings: { no_po: true, already_linked: false } })),
    ).toBe("exception");
  });

  it("returns exception when already_linked is true", () => {
    expect(
      classifyLane(makeFindResponse({ warnings: { no_po: false, already_linked: true } })),
    ).toBe("exception");
  });

  it("returns exception when candidate has no results", () => {
    expect(classifyLane(makeFindResponse({ candidates: [] }))).toBe("exception");
  });

  it("returns exception when candidate is already linked elsewhere", () => {
    expect(
      classifyLane(makeFindResponse({ candidates: [makeCandidate({ qbAlreadyLinkedElsewhere: true })] })),
    ).toBe("exception");
  });

  it("returns exception when candidate has amount_mismatch warning", () => {
    expect(
      classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 92, warnings: ["amount_mismatch"] })] })),
    ).toBe("exception");
  });

  it("returns exception when candidate has vendor_mismatch warning", () => {
    expect(
      classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 92, warnings: ["vendor_mismatch"] })] })),
    ).toBe("exception");
  });

  it("returns exception when candidate has qb_already_linked_elsewhere warning", () => {
    expect(
      classifyLane(
        makeFindResponse({ candidates: [makeCandidate({ confidence: 92, warnings: ["qb_already_linked_elsewhere"] })] }),
      ),
    ).toBe("exception");
  });

  it("returns exception when candidate has qb_payment_inconsistent warning", () => {
    expect(
      classifyLane(
        makeFindResponse({ candidates: [makeCandidate({ confidence: 92, warnings: ["qb_payment_inconsistent"] })] }),
      ),
    ).toBe("exception");
  });

  it("returns review (not exception) when candidate has non-exception warning like qb_amount_unknown", () => {
    expect(
      classifyLane(makeFindResponse({ candidates: [makeCandidate({ confidence: 80, warnings: ["qb_amount_unknown"] })] })),
    ).toBe("review");
  });

  it("EXCEPTION_CANDIDATE_WARNINGS set contains exactly the four blocking warnings", () => {
    expect(EXCEPTION_CANDIDATE_WARNINGS.has("amount_mismatch")).toBe(true);
    expect(EXCEPTION_CANDIDATE_WARNINGS.has("vendor_mismatch")).toBe(true);
    expect(EXCEPTION_CANDIDATE_WARNINGS.has("qb_already_linked_elsewhere")).toBe(true);
    expect(EXCEPTION_CANDIDATE_WARNINGS.has("qb_payment_inconsistent")).toBe(true);
    expect(EXCEPTION_CANDIDATE_WARNINGS.size).toBe(4);
  });
});

// ─── buildBulkApproveItems ────────────────────────────────────────────────────

describe("buildBulkApproveItems", () => {
  it("returns empty array for empty input", () => {
    expect(buildBulkApproveItems([])).toEqual([]);
  });

  it("maps safe rows to { suggestionId, candidateIndex: 0 }", () => {
    const rows: WorkbenchRow[] = [
      makeRow({ id: 1, findResult: makeFindResponse({ suggestionId: 101 }), status: "found", lane: "safe" }),
      makeRow({ id: 2, findResult: makeFindResponse({ suggestionId: 102 }), status: "found", lane: "safe" }),
    ];
    expect(buildBulkApproveItems(rows)).toEqual([
      { suggestionId: 101, candidateIndex: 0 },
      { suggestionId: 102, candidateIndex: 0 },
    ]);
  });

  it("excludes rows with null findResult", () => {
    const rows: WorkbenchRow[] = [
      makeRow({ id: 1, findResult: null, status: "idle", lane: null }),
      makeRow({ id: 2, findResult: makeFindResponse({ suggestionId: 102 }), status: "found", lane: "safe" }),
    ];
    const result = buildBulkApproveItems(rows);
    expect(result).toHaveLength(1);
    expect(result[0].suggestionId).toBe(102);
  });

  it("always uses candidateIndex 0 regardless of candidates length", () => {
    const row = makeRow({
      findResult: makeFindResponse({
        suggestionId: 200,
        candidates: [makeCandidate(), makeCandidate({ qbEntityId: "qb-43" })],
      }),
      status: "found",
      lane: "safe",
    });
    expect(buildBulkApproveItems([row])[0].candidateIndex).toBe(0);
  });
});

// ─── buildExceptionsCSV ───────────────────────────────────────────────────────

describe("buildExceptionsCSV", () => {
  function makeExceptionRow(id: number, suggestionId: number): WorkbenchRow {
    return makeRow({
      id,
      appLine: {
        id,
        projectId: 1,
        projectName: "Alpha",
        invoiceNumber: `INV-00${id}`,
        invoiceDate: "2025-03-01",
        amountExVat: 5000,
        counterpartyName: "Vendor X",
      },
      findResult: makeFindResponse({
        suggestionId,
        warnings: { no_po: true, already_linked: false },
        candidates: [makeCandidate({ confidence: 65, warnings: ["amount_mismatch"] })],
      }),
      status: "found",
      lane: "exception",
    });
  }

  it("returns empty string when no exception rows", () => {
    const rows: WorkbenchRow[] = [
      makeRow({ lane: "safe", findResult: makeFindResponse(), status: "found" }),
    ];
    expect(buildExceptionsCSV(rows, "cost")).toBe("");
  });

  it("returns empty string when exception rows have no findResult", () => {
    const rows: WorkbenchRow[] = [makeRow({ lane: "exception", findResult: null, status: "idle" })];
    expect(buildExceptionsCSV(rows, "cost")).toBe("");
  });

  it("produces correct CSV headers for cost scope", () => {
    const rows = [makeExceptionRow(1, 101)];
    const csv = buildExceptionsCSV(rows, "cost");
    const headers = csv.split("\n")[0];
    expect(headers).toContain('"App Line ID"');
    expect(headers).toContain('"Supplier"');
    expect(headers).not.toContain('"Milestone"');
  });

  it("produces correct CSV headers for revenue scope", () => {
    const rows = [makeExceptionRow(1, 101)];
    const csv = buildExceptionsCSV(rows, "revenue");
    const headers = csv.split("\n")[0];
    expect(headers).toContain('"Milestone"');
    expect(headers).not.toContain('"Supplier"');
  });

  it("includes app warning codes in the App Warnings column", () => {
    const rows = [makeExceptionRow(1, 101)];
    const csv = buildExceptionsCSV(rows, "cost");
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain("no_po");
  });

  it("includes candidate warning codes in the Candidate Warnings column", () => {
    const rows = [makeExceptionRow(1, 101)];
    const csv = buildExceptionsCSV(rows, "cost");
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain("amount_mismatch");
  });

  it("escapes double-quotes inside cell values", () => {
    const row = makeRow({
      lane: "exception",
      appLine: {
        id: 99,
        projectId: 1,
        projectName: 'Project "Alpha"',
        invoiceNumber: "INV-99",
        invoiceDate: "2025-03-01",
        amountExVat: 1000,
        counterpartyName: "Vendor",
      },
      findResult: makeFindResponse({ warnings: { no_po: false, already_linked: true } }),
      status: "found",
    });
    const csv = buildExceptionsCSV([row], "cost");
    expect(csv).toContain('Project ""Alpha""');
  });

  it("produces one header row plus N data rows", () => {
    const rows = [makeExceptionRow(1, 101), makeExceptionRow(2, 102)];
    const lines = buildExceptionsCSV(rows, "cost").split("\n");
    expect(lines).toHaveLength(3);
  });
});

// ─── counterpartyNameMatch ────────────────────────────────────────────────────

describe("counterpartyNameMatch", () => {
  it("returns undefined for null/empty inputs", () => {
    expect(counterpartyNameMatch(null, "Acme Corp")).toBeUndefined();
    expect(counterpartyNameMatch("Acme Corp", null)).toBeUndefined();
    expect(counterpartyNameMatch("", "Acme Corp")).toBeUndefined();
    expect(counterpartyNameMatch(null, null)).toBeUndefined();
  });

  it("returns true for identical names", () => {
    expect(counterpartyNameMatch("Acme Solar", "Acme Solar")).toBe(true);
  });

  it("returns true for names with sufficient token overlap", () => {
    expect(counterpartyNameMatch("Acme Solar Supplies", "Acme Solar Ltd")).toBe(true);
  });

  it("returns false for names sharing only a short prefix (Riverdale vs Riverton)", () => {
    // The old prefix-contains logic would falsely match these
    expect(counterpartyNameMatch("Riverdale Construction", "Riverton Electrical")).toBe(false);
  });

  it("returns false for completely different names", () => {
    expect(counterpartyNameMatch("Acme Corp", "Beta Industries")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(counterpartyNameMatch("ACME SOLAR", "acme solar")).toBe(true);
  });
});

// ─── confidenceBadge ─────────────────────────────────────────────────────────

describe("confidenceBadge", () => {
  it("returns emerald classes for score >= 90", () => {
    const b = confidenceBadge(95);
    expect(b.label).toBe("95%");
    expect(b.cls).toContain("emerald");
  });

  it("returns amber classes for score 70–89", () => {
    const b = confidenceBadge(80);
    expect(b.cls).toContain("amber");
  });

  it("returns rose classes for score < 70", () => {
    const b = confidenceBadge(60);
    expect(b.cls).toContain("rose");
  });

  it("boundary: 90 is emerald", () => {
    expect(confidenceBadge(90).cls).toContain("emerald");
  });

  it("boundary: 70 is amber", () => {
    expect(confidenceBadge(70).cls).toContain("amber");
  });
});

// ─── laneBadge ───────────────────────────────────────────────────────────────

describe("laneBadge", () => {
  it("returns Safe label and emerald classes for safe lane", () => {
    const b = laneBadge("safe");
    expect(b.label).toBe("Safe");
    expect(b.cls).toContain("emerald");
  });

  it("returns Review label and amber classes for review lane", () => {
    const b = laneBadge("review");
    expect(b.label).toBe("Review");
    expect(b.cls).toContain("amber");
  });

  it("returns Exception label and rose classes for exception lane", () => {
    const b = laneBadge("exception");
    expect(b.label).toBe("Exception");
    expect(b.cls).toContain("rose");
  });

  it("returns dash label for null lane", () => {
    const b = laneBadge(null);
    expect(b.label).toBe("—");
  });
});
