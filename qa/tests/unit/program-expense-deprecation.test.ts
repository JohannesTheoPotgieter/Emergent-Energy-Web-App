/**
 * Program Expense Deprecation Tests
 *
 * Anti-regression checks that the finance services no longer call the
 * retired program_expense / program_inflows tables. The tables themselves
 * are dropped in the Wave 2 cutover; these assertions prevent anyone from
 * re-introducing a legacy read path by mistake.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Services successfully migrated to normalized tables
// ---------------------------------------------------------------------------

describe("Screens successfully migrated OFF program_expense", () => {
  it("company-overview reads normalizedCostLines directly", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("getAllProgramExpenses");
  });

  it("dashboard-metrics reads normalizedCostLines directly", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain(".from(normalizedCostLines)");
    expect(service).not.toContain("getAllProgramExpenses");
  });

  it("project-header-kpi-service reads normalizedCostLines", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain("normalizedCostLines");
  });
});
