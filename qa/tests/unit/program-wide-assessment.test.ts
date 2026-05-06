/**
 * Unit tests for Program-wide Assessment infrastructure.
 *
 * Tests:
 *  - Selected Truth Registry has required fields on every entry
 *  - All MISMATCH_TYPES are covered in the classifier
 *  - Program assessment route is registered (contract test)
 *  - Finance exception category→mismatch mappings are stable
 *  - KPI registry: management-ready entries have no known gaps
 *  - KPI registry: drilldownRoute is a valid path string
 *  - KPI registry: no duplicate kpiKeys
 */
import { describe, it, expect } from "vitest";
import {
  KPI_REGISTRY,
  getKpiEntry,
  kpiTrustLabel,
  isManagementReady,
} from "../../../server/lib/reconciliation/selected-truth-registry";
import {
  MISMATCH_TYPES,
  classifyDriftField,
  classifyFinanceException,
} from "../../../server/lib/reconciliation/mismatch-classifier";

describe("Selected Truth Registry", () => {
  it("has at least 10 entries", () => {
    expect(KPI_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });

  it("every entry has required string fields", () => {
    for (const entry of KPI_REGISTRY) {
      expect(entry.kpiKey, `${entry.kpiKey} missing kpiKey`).toBeTruthy();
      expect(entry.displayName, `${entry.kpiKey} missing displayName`).toBeTruthy();
      expect(entry.businessDefinition, `${entry.kpiKey} missing businessDefinition`).toBeTruthy();
      expect(entry.formula, `${entry.kpiKey} missing formula`).toBeTruthy();
      expect(entry.selectedTruthSource, `${entry.kpiKey} missing selectedTruthSource`).toBeTruthy();
      expect(entry.dataOwner, `${entry.kpiKey} missing dataOwner`).toBeTruthy();
      expect(entry.formulaOwner, `${entry.kpiKey} missing formulaOwner`).toBeTruthy();
      expect(entry.updateFrequency, `${entry.kpiKey} missing updateFrequency`).toBeTruthy();
      expect(entry.confidence, `${entry.kpiKey} missing confidence`).toBeTruthy();
      expect(entry.drilldownRoute, `${entry.kpiKey} missing drilldownRoute`).toBeTruthy();
      expect(entry.canonicalTable, `${entry.kpiKey} missing canonicalTable`).toBeTruthy();
    }
  });

  it("drilldownRoute starts with /", () => {
    for (const entry of KPI_REGISTRY) {
      expect(entry.drilldownRoute, `${entry.kpiKey} drilldownRoute invalid`).toMatch(/^\//);
    }
  });

  it("no duplicate kpiKeys", () => {
    const keys = KPI_REGISTRY.map((e) => e.kpiKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("getKpiEntry returns the correct entry", () => {
    const entry = getKpiEntry("revenue_realised");
    expect(entry).toBeDefined();
    expect(entry?.kpiKey).toBe("revenue_realised");
    expect(entry?.selectedTruthSource).toBe("canonical");
  });

  it("getKpiEntry returns undefined for unknown key", () => {
    expect(getKpiEntry("nonexistent_kpi")).toBeUndefined();
  });

  it("kpiTrustLabel returns Low trust for entries with hasKnownGaps", () => {
    const gappy = KPI_REGISTRY.filter((e) => e.hasKnownGaps);
    for (const entry of gappy) {
      expect(kpiTrustLabel(entry)).toBe("Low trust");
    }
  });

  it("isManagementReady is false for entries with hasKnownGaps", () => {
    const gappy = KPI_REGISTRY.filter((e) => e.hasKnownGaps);
    for (const entry of gappy) {
      expect(isManagementReady(entry)).toBe(false);
    }
  });

  it("management-ready entries have high or medium confidence", () => {
    const ready = KPI_REGISTRY.filter(isManagementReady);
    for (const entry of ready) {
      expect(["high", "medium"]).toContain(entry.confidence);
    }
  });

  it("invoice_without_po KPI exists and drills into assessment", () => {
    const entry = getKpiEntry("invoice_without_po");
    expect(entry).toBeDefined();
    expect(entry?.drilldownRoute).toBe("/reports/program-wide-assessment");
    expect(entry?.confidence).toBe("high");
  });

  it("tracker_vs_app_drift KPI exists and drills into excel-vs-app", () => {
    const entry = getKpiEntry("tracker_vs_app_drift");
    expect(entry).toBeDefined();
    expect(entry?.drilldownRoute).toBe("/program/excel-vs-app");
  });
});

describe("MISMATCH_TYPES coverage", () => {
  it("all 14 expected types are present", () => {
    const expected = [
      "value_mismatch",
      "date_mismatch",
      "amount_mismatch",
      "status_mismatch",
      "missing_in_app",
      "missing_in_excel",
      "duplicate_project",
      "duplicate_invoice",
      "invoice_without_po",
      "stale_excel_data",
      "stale_app_data",
      "formula_or_calculation_difference",
      "unmapped_project",
      "unmapped_vendor_or_customer",
    ];
    for (const t of expected) {
      expect(MISMATCH_TYPES as readonly string[]).toContain(t);
    }
    expect(MISMATCH_TYPES.length).toBe(expected.length);
  });
});

describe("Finance exception → mismatch mapping stability", () => {
  const cases: Array<[Parameters<typeof classifyFinanceException>[0], string, string]> = [
    ["missing_po", "invoice_without_po", "high"],
    ["unmatched_cost_invoice", "amount_mismatch", "high"],
    ["unmatched_revenue_payment", "amount_mismatch", "high"],
    ["duplicate_link_candidate", "duplicate_invoice", "high"],
    ["cost_override", "value_mismatch", "medium"],
    ["revenue_override", "value_mismatch", "medium"],
  ];

  for (const [cat, expectedType, expectedRisk] of cases) {
    it(`${cat} → ${expectedType} / ${expectedRisk}`, () => {
      const r = classifyFinanceException(cat);
      expect(r.type).toBe(expectedType);
      expect(r.risk).toBe(expectedRisk);
    });
  }
});

describe("Program assessment route contract", () => {
  it("registerReconciliationRoutes export exists", async () => {
    const mod = await import("../../../server/routes/reconciliation.routes");
    expect(typeof mod.registerReconciliationRoutes).toBe("function");
  });
});

describe("Drift field classification — drilldown URLs", () => {
  it("program-wide-assessment drilldownRoute is in the KPI registry for invoice_without_po", () => {
    const entry = getKpiEntry("invoice_without_po");
    expect(entry?.drilldownRoute).toBe("/reports/program-wide-assessment");
  });

  it("classifyDriftField result always has suggestedOwner", () => {
    const fields = ["amountExVat", "status", "startDate", "description", "invoiceDate"];
    const sections = ["PLAN", "REVENUE", "EXPENDITURE"] as const;
    for (const field of fields) {
      for (const section of sections) {
        const r = classifyDriftField(field, section, "a", "b");
        expect(r.suggestedOwner).toBeTruthy();
        expect(r.displayLabel).toBeTruthy();
        expect(r.businessImpact).toBeTruthy();
      }
    }
  });
});
