import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("project header kpi query guards", () => {
  it("queries canonical NRL/NCL by projectId and filters current/active rows", () => {
    const source = fs.readFileSync("server/services/project-header-kpi-service.ts", "utf8");
    expect(source).toContain("eq(normalizedRevenueLines.projectId, projectId)");
    expect(source).toContain("isNull(normalizedRevenueLines.effectiveTo)");
    expect(source).toContain("eq(normalizedCostLines.projectId, projectId)");
    expect(source).toContain("isNull(normalizedCostLines.effectiveTo)");
  });

  it("does NOT fall back to the retired program_inflows / program_expense tables", () => {
    // The PE/PI fallback chain was removed in commit 76e666f. project-header-kpi-service
    // is now canonical-only; if these strings reappear it is a regression.
    const source = fs.readFileSync("server/services/project-header-kpi-service.ts", "utf8");
    expect(source).not.toContain("programInflows");
    expect(source).not.toContain("programExpense");
  });
});
