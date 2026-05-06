/**
 * Smart Import — value-normalization & 3-way merge tolerance tests.
 *
 * Covers Option 3 (reduce conflict noise at source):
 *   - Numeric tolerance: |a - b| < 0.005 on Rand / quantity / pct fields.
 *   - Date normalisation: YYYY-MM-DD only — drop time-of-day & timezone.
 *   - Currency-symbol stripping: "R 1,234.50" == 1234.5.
 *   - Unknown fields fall back to legacy basic normalisation.
 *
 * Plus an integration assertion through `classifyField` so the conflict
 * engine downgrades trivial drift from CONFLICT → UNCHANGED end-to-end.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeBasic,
  normalizeWithFieldType,
  getFieldType,
  NUMERIC_FIELDS,
  DATE_FIELDS,
} from "../../../server/lib/import/value-normalization";
import { classifyField } from "../../../server/lib/import/conflict-engine";

describe("value-normalization — getFieldType", () => {
  it("classifies known numeric fields", () => {
    expect(getFieldType("amountExVat")).toBe("numeric");
    expect(getFieldType("budgetTotal")).toBe("numeric");
    expect(getFieldType("pctComplete")).toBe("numeric");
    expect(getFieldType("usdExchangeRate")).toBe("numeric");
  });
  it("classifies known date fields", () => {
    expect(getFieldType("startDate")).toBe("date");
    expect(getFieldType("invoiceDate")).toBe("date");
    expect(getFieldType("paidDate")).toBe("date");
  });
  it("falls back to text for everything else", () => {
    expect(getFieldType("status")).toBe("text");
    expect(getFieldType("counterpartyName")).toBe("text");
    expect(getFieldType("comment")).toBe("text");
  });
});

describe("value-normalization — numeric tolerance", () => {
  it("treats sub-half-cent drift as equal", () => {
    // 1234.5 vs 1234.5001 — float recalc drift in Excel formulas.
    expect(normalizeWithFieldType(1234.5, "amountExVat")).toBe(
      normalizeWithFieldType(1234.5001, "amountExVat"),
    );
  });
  it("treats 1234.5 and 1234.50 as equal", () => {
    expect(normalizeWithFieldType("1234.5", "budgetTotal")).toBe(
      normalizeWithFieldType("1234.50", "budgetTotal"),
    );
  });
  it("strips the R / ZAR / $ prefix and commas", () => {
    expect(normalizeWithFieldType("R 1,234.50", "amountExVat")).toBe(
      normalizeWithFieldType(1234.5, "amountExVat"),
    );
    expect(normalizeWithFieldType("ZAR 100", "amountExVat")).toBe(
      normalizeWithFieldType(100, "amountExVat"),
    );
    expect(normalizeWithFieldType("$ 1,000.00", "amountExVat")).toBe(
      normalizeWithFieldType(1000, "amountExVat"),
    );
  });
  it("treats 0 and 0.00 and blank as equal-empty", () => {
    expect(normalizeWithFieldType(0, "amountExVat")).toBe("");
    expect(normalizeWithFieldType("0.00", "amountExVat")).toBe("");
    expect(normalizeWithFieldType("", "amountExVat")).toBe("");
    expect(normalizeWithFieldType(null, "amountExVat")).toBe("");
  });
  it("still flags genuinely different values", () => {
    expect(normalizeWithFieldType(100, "amountExVat")).not.toBe(
      normalizeWithFieldType(101, "amountExVat"),
    );
    expect(normalizeWithFieldType(100, "amountExVat")).not.toBe(
      normalizeWithFieldType(100.5, "amountExVat"),
    );
  });
  it("falls back to basic normalisation for non-numeric strings", () => {
    expect(normalizeWithFieldType("draft", "status")).toBe("draft");
  });
});

describe("value-normalization — date normalisation", () => {
  it("treats ISO-with-time and date-only as equal", () => {
    expect(normalizeWithFieldType("2026-05-01", "startDate")).toBe(
      normalizeWithFieldType("2026-05-01T00:00:00.000Z", "startDate"),
    );
    expect(normalizeWithFieldType("2026-05-01", "invoiceDate")).toBe(
      normalizeWithFieldType("2026-05-01T15:30:00+02:00", "invoiceDate"),
    );
  });
  it("treats slash-delimited and dash-delimited dates as equal", () => {
    expect(normalizeWithFieldType("2026/05/01", "endDate")).toBe(
      normalizeWithFieldType("2026-05-01", "endDate"),
    );
  });
  it("accepts a Date instance", () => {
    expect(normalizeWithFieldType(new Date("2026-05-01T00:00:00Z"), "startDate")).toBe(
      "2026-05-01",
    );
  });
  it("flags genuinely different dates", () => {
    expect(normalizeWithFieldType("2026-05-01", "startDate")).not.toBe(
      normalizeWithFieldType("2026-05-02", "startDate"),
    );
  });
});

describe("value-normalization — basic fallback", () => {
  it("matches legacy normalizeBasic semantics for unknown fields", () => {
    expect(normalizeBasic(0)).toBe("");
    expect(normalizeBasic("0")).toBe("");
    expect(normalizeBasic(false)).toBe("");
    expect(normalizeBasic(null)).toBe("");
    expect(normalizeBasic(undefined)).toBe("");
    expect(normalizeBasic("  hello  ")).toBe("hello");
    expect(normalizeBasic(true)).toBe("true");
  });
  it("normalizeWithFieldType without fieldName == normalizeBasic", () => {
    expect(normalizeWithFieldType(1234.5001)).toBe(normalizeBasic(1234.5001));
  });
});

describe("conflict-engine — classifyField uses field-aware normalisation", () => {
  it("treats float-drift on Rand fields as UNCHANGED, not CONFLICT", () => {
    // Baseline: 1234.50  App: 1234.5001 (formula recalc)  File: 1234.5
    // Without tolerance this is CONFLICT (B≠C, B≠F, C≠F all because of
    // float printout). With tolerance all three collapse to the same
    // 2dp value so the merge becomes UNCHANGED.
    const result = classifyField("amountExVat", 1234.5, 1234.5001, 1234.5);
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  it("treats Excel ISO date drift on date fields as UNCHANGED", () => {
    const result = classifyField(
      "startDate",
      "2026-05-01",
      "2026-05-01T00:00:00.000Z",
      "2026/05/01",
    );
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  it("still flags a real conflict on Rand fields", () => {
    // Baseline 1000, app edited to 1100, file changed to 1200.
    const result = classifyField("amountExVat", 1000, 1100, 1200);
    expect(result.mergeCase).toBe("CONFLICT");
    expect(result.requiresDecision).toBe(true);
  });

  it("still flags a real date conflict", () => {
    const result = classifyField(
      "startDate",
      "2026-05-01",
      "2026-05-08",
      "2026-05-15",
    );
    expect(result.mergeCase).toBe("CONFLICT");
    expect(result.requiresDecision).toBe(true);
  });

  it("auto-accepts the file when only the file changed (within tolerance is a no-op)", () => {
    // Baseline 100, app unchanged at 100, file changed to 200.
    const result = classifyField("amountExVat", 100, 100, 200);
    expect(result.mergeCase).toBe("AUTO_ACCEPT_FILE");
  });

  it("preserves UNCHANGED behaviour for unknown field types", () => {
    // owner is text — basic normalisation still applies.
    const same = classifyField("owner", "Alice", "Alice", "Alice");
    expect(same.mergeCase).toBe("UNCHANGED");
    const conflict = classifyField("owner", "Alice", "Bob", "Charlie");
    expect(conflict.mergeCase).toBe("CONFLICT");
  });
});

describe("value-normalization — registry sanity", () => {
  it("includes the headline Rand fields", () => {
    expect(NUMERIC_FIELDS.has("amountExVat")).toBe(true);
    expect(NUMERIC_FIELDS.has("budgetTotal")).toBe(true);
    expect(NUMERIC_FIELDS.has("budgetCos")).toBe(true);
    expect(NUMERIC_FIELDS.has("savingOverrun")).toBe(true);
  });
  it("includes the headline date fields", () => {
    expect(DATE_FIELDS.has("startDate")).toBe(true);
    expect(DATE_FIELDS.has("endDate")).toBe(true);
    expect(DATE_FIELDS.has("invoiceDate")).toBe(true);
    expect(DATE_FIELDS.has("paidDate")).toBe(true);
  });
});
