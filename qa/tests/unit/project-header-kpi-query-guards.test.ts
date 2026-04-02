import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("project header kpi query guards", () => {
  it("queries by projectId and filters current/active rows", () => {
    const source = fs.readFileSync("server/services/project-header-kpi-service.ts", "utf8");
    expect(source).toContain("eq(normalizedRevenueLines.projectId, projectId)");
    expect(source).toContain("isNull(normalizedRevenueLines.effectiveTo)");
    expect(source).toContain("eq(normalizedCostLines.projectId, projectId)");
    expect(source).toContain("isNull(normalizedCostLines.effectiveTo)");
    expect(source).toContain("eq(programInflows.projectId, projectId)");
    expect(source).toContain("isNull(programInflows.effectiveTo)");
    expect(source).toContain("eq(programExpense.projectId, projectId)");
    expect(source).toContain("isNull(programExpense.deletedAt)");
  });
});
