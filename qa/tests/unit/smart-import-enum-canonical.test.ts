/**
 * Enum canonical hardening tests.
 *
 * Purpose: prevent a recurrence of the 22P02 / enum_in failures that took
 * out Smart Import commit and the admin recent-import-failures route in
 * April 2026. There were three classes of bug at the time:
 *
 *   1. `shared/schema/finance.ts` declared `allocation_confidence` with
 *      UPPERCASE pgEnum values while the live PostgreSQL enum had always
 *      been lowercase — write-time drift.
 *   2. `server/smart-import-routes.ts` wrote hardcoded UPPERCASE literals
 *      ("DIRECT", "PROVISIONAL") into category_revenue_allocations.
 *   3. `server/lib/import/commit-executor.ts` forwarded the raw uppercase
 *      normalizer output into `normalized_cost_lines.status` and
 *      `normalized_revenue_lines.status` without going through the
 *      canonical normalizer.
 *   4. `server/admin-control-routes.ts` filtered smart_import_runs by the
 *      uppercase literal 'FAILED' which no longer exists in the enum.
 *
 * These tests assert structural invariants that would have caught every
 * one of those bugs at PR time.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeAllocationConfidence,
  normalizeCostLineStatus,
  normalizeRevenueLineStatus,
  normalizeSmartImportStatus,
  ALLOCATION_CONFIDENCE_VALUES,
  COST_LINE_STATUS_VALUES,
  REVENUE_LINE_STATUS_VALUES,
  SMART_IMPORT_STATUS_VALUES,
} from "../../../server/lib/import/utils";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

// ---------------------------------------------------------------------------
// Invariant: canonical values in helper code match the pgEnum declarations
// ---------------------------------------------------------------------------
describe("enum invariants: helper constants match pgEnum declarations", () => {
  const financeSchema = read("shared/schema/finance.ts");
  const importsSchema = read("shared/schema/imports.ts");

  it("ALLOCATION_CONFIDENCE_VALUES matches allocationConfidenceEnum in finance.ts", () => {
    // Expect every canonical value to appear in the pgEnum tuple.
    const enumLine = financeSchema
      .split("\n")
      .find((l) => l.includes("pgEnum('allocation_confidence'"));
    expect(enumLine).toBeTruthy();
    for (const v of ALLOCATION_CONFIDENCE_VALUES) {
      expect(enumLine!).toContain(`'${v}'`);
    }
    // No uppercase drift allowed.
    expect(enumLine!).not.toMatch(/'DIRECT'|'PROVISIONAL'|'MANUAL'|'HEADER_ERROR_POSITIONAL'/);
  });

  it("COST_LINE_STATUS_VALUES matches costLineStatusEnum in finance.ts", () => {
    const enumLine = financeSchema
      .split("\n")
      .find((l) => l.includes("pgEnum('cost_line_status'"));
    expect(enumLine).toBeTruthy();
    for (const v of COST_LINE_STATUS_VALUES) {
      expect(enumLine!).toContain(`'${v}'`);
    }
    expect(enumLine!).not.toMatch(/'PLANNED'|'INVOICED'|'APPROVED'|'PAID'/);
  });

  it("REVENUE_LINE_STATUS_VALUES matches revenueLineStatusEnum in finance.ts", () => {
    const enumLine = financeSchema
      .split("\n")
      .find((l) => l.includes("pgEnum('revenue_line_status'"));
    expect(enumLine).toBeTruthy();
    for (const v of REVENUE_LINE_STATUS_VALUES) {
      expect(enumLine!).toContain(`'${v}'`);
    }
  });

  it("SMART_IMPORT_STATUS_VALUES matches smartImportStatusEnum in imports.ts", () => {
    const enumLine = importsSchema
      .split("\n")
      .find((l) => l.includes("pgEnum('smart_import_status'"));
    expect(enumLine).toBeTruthy();
    for (const v of SMART_IMPORT_STATUS_VALUES) {
      expect(enumLine!).toContain(`'${v}'`);
    }
    expect(enumLine!).not.toMatch(/'PREVIEW'|'COMMITTED'|'FAILED'|'AWAITING_REVIEW'/);
  });

  it("allocationConfidenceEnum default in finance.ts is the canonical lowercase 'provisional'", () => {
    // Must not drift back to 'PROVISIONAL' — the live enum has no such label.
    expect(financeSchema).toContain(".default('provisional')");
    expect(financeSchema).not.toContain(".default('PROVISIONAL')");
  });
});

// ---------------------------------------------------------------------------
// Regression: normalizer behavior for every legacy input
// ---------------------------------------------------------------------------
describe("normalizeAllocationConfidence", () => {
  it("maps UPPERCASE legacy values to canonical lowercase", () => {
    expect(normalizeAllocationConfidence("DIRECT")).toBe("direct");
    expect(normalizeAllocationConfidence("HEADER_ERROR_POSITIONAL")).toBe(
      "header_error_positional",
    );
    expect(normalizeAllocationConfidence("PROVISIONAL")).toBe("provisional");
    expect(normalizeAllocationConfidence("MANUAL")).toBe("manual");
  });

  it("maps mixed-case values", () => {
    expect(normalizeAllocationConfidence("Direct")).toBe("direct");
    expect(normalizeAllocationConfidence("Provisional")).toBe("provisional");
  });

  it("maps the historical DIRECT_EXTRACTION source tag from the normalizer", () => {
    // smart-import-routes used to pass ca.allocationSource directly; the
    // normalizer emits "DIRECT_EXTRACTION" for synonym-matched columns.
    expect(normalizeAllocationConfidence("DIRECT_EXTRACTION")).toBe("direct");
  });

  it("defaults unknown / blank to provisional", () => {
    expect(normalizeAllocationConfidence("")).toBe("provisional");
    expect(normalizeAllocationConfidence(null)).toBe("provisional");
    expect(normalizeAllocationConfidence(undefined)).toBe("provisional");
    expect(normalizeAllocationConfidence("unknown")).toBe("provisional");
  });
});

describe("normalizeCostLineStatus (mixed-case regression)", () => {
  it("handles every casing that has ever been seen in the wild", () => {
    const inputs = ["PAID", "Paid", "paid", "APPROVED", "Approved", "approved", "INVOICED", "Invoice", "invoice", "invoiced", "PLANNED", "planned"];
    const expected = ["paid", "paid", "paid", "approved", "approved", "approved", "invoiced", "invoiced", "invoiced", "invoiced", "planned", "planned"];
    for (let i = 0; i < inputs.length; i++) {
      expect(normalizeCostLineStatus(inputs[i])).toBe(expected[i]);
    }
  });

  it("never returns anything outside the canonical set", () => {
    const sample = ["", " ", "nonsense", null, undefined, "something-weird", 42, true];
    for (const s of sample) {
      expect(COST_LINE_STATUS_VALUES).toContain(normalizeCostLineStatus(s));
    }
  });
});

describe("normalizeRevenueLineStatus", () => {
  it("handles uppercase legacy inputs", () => {
    expect(normalizeRevenueLineStatus("PAID")).toBe("paid");
    expect(normalizeRevenueLineStatus("INVOICED")).toBe("invoiced");
    expect(normalizeRevenueLineStatus("IN_BANK")).toBe("in_bank");
    expect(normalizeRevenueLineStatus("REALISED")).toBe("realised");
    expect(normalizeRevenueLineStatus("PLANNED")).toBe("planned");
  });

  it("never returns anything outside the canonical set", () => {
    for (const s of [null, undefined, "", "invalid", "garbage"]) {
      expect(REVENUE_LINE_STATUS_VALUES).toContain(normalizeRevenueLineStatus(s));
    }
  });
});

describe("normalizeSmartImportStatus", () => {
  it("handles uppercase legacy literals", () => {
    expect(normalizeSmartImportStatus("FAILED")).toBe("failed");
    expect(normalizeSmartImportStatus("COMMITTED")).toBe("committed");
    expect(normalizeSmartImportStatus("PREVIEW")).toBe("preview");
  });

  it("returns null for unrecognised values rather than silently returning a default", () => {
    // Unlike the cost/revenue helpers, smart_import_status has no safe
    // default — callers that want one must pick it explicitly.
    expect(normalizeSmartImportStatus("")).toBeNull();
    expect(normalizeSmartImportStatus("garbage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: Smart Import commit / admin route source sites
// ---------------------------------------------------------------------------
describe("smart-import commit write sites never use raw uppercase enum literals", () => {
  const smartImportRoutes = read("server/smart-import-routes.ts");
  const commitExecutor = read("server/lib/import/commit-executor.ts");
  const adminControl = read("server/admin-control-routes.ts");

  it("smart-import-routes.ts does not hardcode UPPERCASE allocation_confidence literals", () => {
    // The specific block that writes to categoryRevenueAllocations must go
    // through the normalizer, not a string literal.
    expect(smartImportRoutes).toContain("normalizeAllocationConfidence(ca.allocationSource)");
    expect(smartImportRoutes).not.toMatch(/"DIRECT"\s*as\s*const/);
    expect(smartImportRoutes).not.toMatch(/"PROVISIONAL"\s*as\s*const/);
    expect(smartImportRoutes).not.toMatch(/"HEADER_ERROR_POSITIONAL"\s*as\s*const/);
  });

  it("commit-executor.ts normalizes status on every cost / revenue write", () => {
    // Direct forwarding of the raw normalizer output into the DB is the bug
    // that produced the April-2026 PAID / PLANNED failure. Every insert /
    // update into normalized_cost_lines and normalized_revenue_lines must
    // go through the canonical lowercase normalizer. These are the four
    // specific sites that must stay normalized. Any future write that adds
    // a status field to either table should reuse the same helper.
    expect(commitExecutor).toContain("status: normalizeCostLineStatus(f.status)");
    expect(commitExecutor).toContain("status: normalizeRevenueLineStatus(f.status)");
    expect(commitExecutor).toContain(
      "status: normalizeRevenueLineStatus(fieldUpdates.status ?? existingRow.status)",
    );
    expect(commitExecutor).toContain(
      "status: normalizeCostLineStatus(fieldUpdates.status ?? existing.status)",
    );

    // Guard: no raw "status: f.status" or "status: fileRow.status" left
    // in the cost/revenue section writers — every occurrence must be
    // wrapped in a normalizer call.
    expect(commitExecutor).not.toContain("status: f.status,");
    // PLAN section still uses fileRow.status || 'Not Started' because
    // work_items.status is a text column, not a pgEnum. That write is
    // exempt by design and is covered by the plan tests.
  });

  it("admin recent-import-failures route does not use the uppercase 'FAILED' literal", () => {
    // Extract the specific recent-import-failures handler body.
    const start = adminControl.indexOf('"/api/admin/control-center/recent-import-failures"');
    expect(start).toBeGreaterThan(-1);
    const end = adminControl.indexOf('router.', start + 20);
    const block = adminControl.slice(start, end > 0 ? end : start + 4000);
    expect(block).not.toContain("'FAILED'");
    expect(block).toContain("failedStatus");
    // Must be resilient to casing drift via LOWER() cast.
    expect(block).toContain("LOWER(sir.status::text)");
  });
});
