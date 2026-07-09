/**
 * Task 3.4 — Action-Centre count vs drill-down reconciliation.
 *
 * The chip drill-down (drillDownInstances) used an incomplete filter predicate
 * that returned false for overdue / fail / unassigned, while the in-phase item
 * list used a complete `shouldShowItem`. A card could therefore show a count
 * the drill-down couldn't reproduce. Both now delegate to one shared
 * `matchesQualityFilter` predicate.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), "client/src/components/tabs/QualityTab.tsx"),
  "utf8",
);

describe("quality filter predicate is unified", () => {
  it("defines a single matchesQualityFilter predicate", () => {
    expect(SOURCE).toContain("const matchesQualityFilter = (instance: any, filter: string): boolean =>");
  });

  it("the drill-down uses the shared predicate (no incomplete inline copy)", () => {
    expect(SOURCE).toContain("allInst.filter((instance: any) => matchesQualityFilter(instance, chipConfig.filter))");
    // The old drill-down's incomplete branch (only handled review, returned
    // false otherwise) is gone.
    expect(SOURCE).not.toContain('if (filterValue === "review") {');
  });

  it("shouldShowItem delegates to the shared predicate", () => {
    expect(SOURCE).toContain("const shouldShowItem = (instance: any) => matchesQualityFilter(instance, statusFilter)");
  });

  it("the shared predicate handles every filter the item list supported", () => {
    for (const filter of ["unassigned", "overdue", "evidence_gap", "handover_blocking", "critical_contributors", "actionable_for_approval"]) {
      expect(SOURCE).toContain(`filter === "${filter}"`);
    }
    // status fallback (pass/fail/na/review) via getItemQmStatus.
    expect(SOURCE).toContain("return getItemQmStatus(instance) === filter;");
  });
});
