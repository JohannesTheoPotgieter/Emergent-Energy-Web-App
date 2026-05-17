import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dedupeCurrentLineage, toCanonicalKey, toCanonicalUiRow } from "../../../server/services/project-cost-line-read-service";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Quote-insensitive view — route files are auto-formatted to single quotes.
function norm(s: string) {
  return s.replace(/['"]/g, '"');
}

describe("project-cost-line-read-service identity", () => {
  it("builds imported canonical key as projectId|sourceSheet|sourceRow", () => {
    const result = toCanonicalKey({
      id: 101,
      projectId: 77,
      sourceSheet: "Expenditure Breakdown",
      sourceRow: 222,
      idempotencyKey: null,
    });
    expect(result.key).toBe("77|Expenditure Breakdown|222");
    expect(result.lineageType).toBe("IMPORTED");
  });

  it("marks manual idempotent rows explicitly", () => {
    const result = toCanonicalKey({
      id: 102,
      projectId: 77,
      sourceSheet: null,
      sourceRow: null,
      idempotencyKey: "manual-abc",
    });
    expect(result.key).toBe("77|manual|manual-abc");
    expect(result.lineageType).toBe("MANUAL_IDEMPOTENT");
  });

  it("dedupes duplicate lineage keys to the most recent row", () => {
    const rows = dedupeCurrentLineage([
      { id: 10, projectId: 7, sourceSheet: "SheetA", sourceRow: 12, updatedAt: "2026-01-01T00:00:00Z" },
      { id: 11, projectId: 7, sourceSheet: "SheetA", sourceRow: 12, updatedAt: "2026-02-01T00:00:00Z" },
      { id: 12, projectId: 7, sourceSheet: "SheetA", sourceRow: 13, updatedAt: "2026-01-01T00:00:00Z" },
    ]);
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([11, 12]);
  });

  it("returns canonical UI row contract metadata", () => {
    const mapped = toCanonicalUiRow({
      id: 200,
      projectId: 9,
      projectName: "Alpha",
      sourceSheet: "Expenditure Breakdown",
      sourceRow: 55,
      importRunId: 999,
      effectiveFrom: new Date("2026-03-10T00:00:00Z"),
      idempotencyKey: null,
      amountExVat: "1234",
      invoiceNumber: "INV-1",
      invoiceDate: null,
      paidDate: null,
      paidDateConfirmed: false,
      paidDateFontColor: "red",
      invoiceDateConfirmed: false,
      invoiceDateFontColor: "red",
      poNumber: null,
      costCategory: "General",
      description: "Item",
      noRevenueLinked: false,
      approvedDate: null,
      status: "PLANNED",
      counterpartyName: null,
      updatedAt: new Date("2026-03-10T00:00:00Z"),
    }, "Alpha");

    expect(mapped.projectId).toBe(9);
    expect(mapped.canonicalLineKey).toBe("9|Expenditure Breakdown|55");
    expect(mapped.lineageType).toBe("IMPORTED");
    expect(mapped.isCurrent).toBe(true);
    expect(mapped.importRunId).toBe(999);
  });
});

describe("finance routes delegate project expenditure reads to canonical service", () => {
  const routes = norm(read("server/departments/finance-routes.ts"));

  it("program-expenses route reads canonical cost line service unconditionally", () => {
    const block = routes.substring(
      routes.indexOf('"/api/program-expenses"'),
      routes.indexOf('"/api/program-expenses/:projectName"')
    );
    expect(block).toContain("resolveProjectIdByName(projectName)");
    expect(block).toContain("getCanonicalProjectCostLines(");
    expect(block).toContain("getCanonicalAllCurrentCostLines()");
    expect(block).not.toContain("storage.getProgramExpensesByProject(projectName)");
    expect(block).not.toContain("storage.getAllProgramExpenses()");
  });

  it("project-name expenditure routes use scoped high-risk reader helper", () => {
    const expenditureBlock = routes.substring(
      routes.indexOf('"/api/expenditure-breakdown/:projectName"'),
      routes.indexOf('"/api/finance/revenue/overrides"')
    );
    expect(expenditureBlock).toContain("getHighRiskProjectCostReadRows(projectName, projectIdParam)");
  });
});
