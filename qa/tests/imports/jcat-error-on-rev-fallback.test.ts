/**
 * Regression: J_cat ("Total Revenue") recovery on broken-header layouts.
 *
 * A large class of trackers carry the category revenue-allocation column (col-J,
 * the "Total Revenue" used by the §3.3 (Q/X)×J formula) under a CORRUPTED header
 * — literally "ERROR on REV" — and the adjacent "Total COS" header maps to
 * `actual_cos` in the budget pane (its synonym is shared with
 * `category_cos_total`). That combination defeated both the synonym match AND
 * the positional fallback, so `revenueAllocation` came through null for ~34
 * projects → `(Q/X)×J = 0` → those projects recognised ZERO revenue (GP shown
 * as −COS). See server/lib/import/normalizer.ts (positional J_cat fallback).
 *
 * This pins the fix using a real production tracker (Coega Steels Ph2) that
 * exhibits the layout: the importer must recover the J column positionally
 * (column right of "Total COS") and populate the per-category allocation.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSmartImportPreview } from "../../../server/lib/import/index";

const FIXTURE = path.join(
  process.cwd(),
  "attached_assets",
  "Coega_Steels_Ph2_Tracker_1779108373976.xlsx",
);

describe("J_cat positional recovery for 'ERROR on REV' broken headers", () => {
  it("populates revenueAllocation via the positional fallback (was ZERO_J)", async () => {
    if (!fs.existsSync(FIXTURE)) {
      // The regression fixture is a committed production tracker; if it is ever
      // pruned, fail loudly rather than silently passing on a missing file.
      throw new Error(`Regression fixture missing: ${FIXTURE}`);
    }
    const buf = fs.readFileSync(FIXTURE);
    const pv = await runSmartImportPreview(buf, "Coega_Steels_Ph2_Tracker.xlsx");

    // The Expenditure Breakdown sheet (not "Expenditure Tracking") is selected.
    const exp = pv.detection.sections.find((s) => s.section === "EXPENDITURE");
    expect(exp?.sheetName).toBe("Expenditure Breakdown");

    const issueTypes = pv.normalization.issues.map((i) => i.issueType);
    // The column is recovered positionally, NOT reported missing.
    expect(issueTypes).toContain("JCAT_POSITIONAL_FALLBACK");
    expect(issueTypes).not.toContain("JCAT_COLUMN_MISSING");

    const allocs = (pv.normalization as unknown as {
      categoryAllocations: Array<{ revenueAllocation: number | null; allocationSource?: string }>;
    }).categoryAllocations;
    expect(allocs.length).toBeGreaterThan(0);

    const withJ = allocs.filter((a) => a.revenueAllocation != null && Number(a.revenueAllocation) !== 0);
    expect(withJ.length).toBeGreaterThan(0); // not ZERO_J anymore

    // Coega's category revenue allocations sum to the workbook grand total ≈ R60m.
    const sumJ = allocs.reduce((s, a) => s + (Number(a.revenueAllocation) || 0), 0);
    expect(sumJ).toBeGreaterThan(55_000_000);
    expect(sumJ).toBeLessThan(65_000_000);

    // Recovered lines are tagged as positional (broken-header) recovery.
    expect(withJ.every((a) => a.allocationSource === "HEADER_ERROR_POSITIONAL")).toBe(true);
  });
});
