/**
 * Program Expense Deprecation Tests
 *
 * Verifies write-authority policy blocks program_expense and program_inflow
 * writes, and that normalized tables are used by migrated services.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BLOCKED_WRITE_TARGETS,
  isWriteBlocked,
} from "../../../server/policies/write-authority";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Write-authority policy: blocked targets
// ---------------------------------------------------------------------------

describe("Write-authority policy: BLOCKED_WRITE_TARGETS", () => {
  it("BLOCKED_WRITE_TARGETS includes program_expense", () => {
    expect(BLOCKED_WRITE_TARGETS).toContain("program_expense");
  });

  it("BLOCKED_WRITE_TARGETS includes program_inflow", () => {
    expect(BLOCKED_WRITE_TARGETS).toContain("program_inflow");
  });
});

describe("Write-authority policy: isWriteBlocked", () => {
  it("returns true for program_expense", () => {
    expect(isWriteBlocked("program_expense")).toBe(true);
  });

  it("returns true for program_inflow", () => {
    expect(isWriteBlocked("program_inflow")).toBe(true);
  });

  it("returns false for normalized_cost_lines", () => {
    expect(isWriteBlocked("normalized_cost_lines")).toBe(false);
  });

  it("returns false for normalized_revenue_lines", () => {
    expect(isWriteBlocked("normalized_revenue_lines")).toBe(false);
  });

  it("returns false for an arbitrary table name", () => {
    expect(isWriteBlocked("some_other_table")).toBe(false);
  });
});

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
