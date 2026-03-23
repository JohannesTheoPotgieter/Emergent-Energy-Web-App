import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Budget data import and costed summary capture", () => {
  describe("CostedSummary interface includes actual values", () => {
    it("NormalizationResult costedSummary has actual fields", () => {
      const source = read("server/lib/import/normalizer.ts");
      const csBlock = source.substring(
        source.indexOf("costedSummary: {"),
        source.indexOf("} | null;", source.indexOf("costedSummary: {")) + 9
      );
      expect(csBlock).toContain("actualRevenue: number | null");
      expect(csBlock).toContain("actualExpenditure: number | null");
      expect(csBlock).toContain("actualProfit: number | null");
      expect(csBlock).toContain("actualMargin: number | null");
    });

    it("still has planned fields", () => {
      const source = read("server/lib/import/normalizer.ts");
      const csBlock = source.substring(
        source.indexOf("costedSummary: {"),
        source.indexOf("} | null;", source.indexOf("costedSummary: {")) + 9
      );
      expect(csBlock).toContain("plannedRevenue: number | null");
      expect(csBlock).toContain("plannedExpenditure: number | null");
      expect(csBlock).toContain("plannedProfit: number | null");
      expect(csBlock).toContain("plannedMargin: number | null");
    });
  });

  describe("extractCostedSummary captures actual values", () => {
    it("function scans for actual values further right in the row", () => {
      const source = read("server/lib/import/normalizer.ts");
      const fnBlock = source.substring(
        source.indexOf("function extractCostedSummary"),
        source.indexOf("}\n\n", source.indexOf("function extractCostedSummary")) + 1
      );
      expect(fnBlock).toContain("actualRevenue");
      expect(fnBlock).toContain("actualExpenditure");
      expect(fnBlock).toContain("actualProfit");
      expect(fnBlock).toContain("actualMargin");
    });

    it("derives actual profit and margin when both revenue and expenditure exist", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("actualProfit = actualRevenue - actualExpenditure");
      expect(source).toContain("actualMargin = (actualRevenue - actualExpenditure) / actualRevenue");
    });

    it("matches bare labels like 'revenue' and 'expenditure' without 'planned' prefix", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain('cellVal === "revenue"');
      expect(source).toContain('cellVal === "expenditure"');
      expect(source).toContain('cellVal === "profit"');
      expect(source).toContain('cellVal === "margin"');
    });
  });

  describe("Commit logic saves actual values to project_revenue_summary", () => {
    it("writes actualRevenue to project_revenue_summary", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("vals.actualRevenue = String(cs.actualRevenue)");
    });

    it("writes actualExpenditure to project_revenue_summary", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("vals.actualExpenditure = String(cs.actualExpenditure)");
    });

    it("writes actualProfit and actualMargin", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("vals.actualProfit = String(cs.actualProfit)");
      expect(source).toContain("vals.actualMargin = String(cs.actualMargin)");
    });
  });

  describe("project_revenue_summary schema has actual columns", () => {
    it("schema defines actual revenue/expenditure/profit/margin columns", () => {
      const source = read("shared/schema.ts");
      const prsBlock = source.substring(
        source.indexOf('pgTable("project_revenue_summary"'),
        source.indexOf("});", source.indexOf('pgTable("project_revenue_summary"')) + 3
      );
      expect(prsBlock).toContain("actual_revenue");
      expect(prsBlock).toContain("actual_expenditure");
      expect(prsBlock).toContain("actual_profit");
      expect(prsBlock).toContain("actual_margin");
    });
  });

  describe("Budget fields stored in normalized_cost_lines", () => {
    it("schema has budget columns on normalized_cost_lines", () => {
      const source = read("shared/schema.ts");
      const clBlock = source.substring(
        source.indexOf('pgTable("normalized_cost_lines"'),
        source.indexOf("});", source.indexOf('pgTable("normalized_cost_lines"')) + 3
      );
      expect(clBlock).toContain("budget_qty");
      expect(clBlock).toContain("budget_rate");
      expect(clBlock).toContain("budget_total");
      expect(clBlock).toContain("budget_cos");
    });

    it("commit endpoint includes budget fields in cost insert", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("budgetQty: merged.budgetQty");
      expect(source).toContain("budgetRate: merged.budgetRate");
      expect(source).toContain("budgetTotal: merged.budgetTotal");
      expect(source).toContain("budgetCos: merged.budgetCos");
    });
  });

  describe("Budget fields stored in program_expense", () => {
    it("program_expense insert includes budget fields from cost lines", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("budgetQty: toStr(m.budgetQty)");
      expect(source).toContain("budgetRateUnit: toStr(m.budgetRate)");
      expect(source).toContain("budgetTotal: toStr(m.budgetTotal)");
      expect(source).toContain("budgetCosTotal: toStr(m.budgetCos)");
    });
  });

  describe("Frontend budget display", () => {
    it("shows costed summary card with budget vs actual", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain("budget-actual-summary");
      expect(source).toContain("Costed Summary");
    });

    it("shows expenditure budget vs actual totals card", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain("budget-line-summary");
      expect(source).toContain("Budget vs Actual");
      expect(source).toContain("Total Budget");
      expect(source).toContain("Total Actual");
      expect(source).toContain("Variance");
    });

    it("budget columns have grey visual distinction in preview", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain("isBudgetCol");
      expect(source).toContain("isBudgetCell");
      expect(source).toContain("bg-slate-100");
      expect(source).toContain("bg-slate-50");
    });

    it("FIELD_LABELS has camelCase budget labels for preview", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain('budgetQty: "Budget Qty"');
      expect(source).toContain('budgetRate: "Budget Rate"');
      expect(source).toContain('budgetTotal: "Budget Total"');
      expect(source).toContain('budgetCos: "Budget COS"');
    });
  });
});
