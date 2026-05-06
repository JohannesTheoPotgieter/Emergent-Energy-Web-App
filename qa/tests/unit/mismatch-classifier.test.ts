/**
 * Unit tests for server/lib/reconciliation/mismatch-classifier.ts
 *
 * Tests:
 *  - classifyDriftField returns correct type and risk per field/section
 *  - invoice_without_po is HIGH risk
 *  - duplicate_invoice is HIGH risk
 *  - status_mismatch is HIGH risk
 *  - amount_mismatch in finance section is HIGH risk
 *  - date_mismatch in plan section is LOW risk
 *  - high-risk items require owner note and block bulk close
 *  - low-risk items allow bulk close
 *  - classifyFinanceException maps all categories
 *  - classifyStaleData returns medium/high by age
 */
import { describe, it, expect } from "vitest";
import {
  classifyDriftField,
  classifyFinanceException,
  classifyStaleData,
  classifyUnmapped,
  STALE_EXCEL_THRESHOLD_DAYS,
  STALE_APP_THRESHOLD_DAYS,
} from "../../../server/lib/reconciliation/mismatch-classifier";

describe("classifyDriftField", () => {
  describe("amount fields in finance sections", () => {
    it("amountExVat in REVENUE section → amount_mismatch HIGH", () => {
      const r = classifyDriftField("amountExVat", "REVENUE", 100, 200);
      expect(r.type).toBe("amount_mismatch");
      expect(r.risk).toBe("high");
      expect(r.requireOwnerNote).toBe(true);
      expect(r.allowBulkClose).toBe(false);
    });

    it("amountExVat in EXPENDITURE section → amount_mismatch HIGH", () => {
      const r = classifyDriftField("amountExVat", "EXPENDITURE", 50, 60);
      expect(r.type).toBe("amount_mismatch");
      expect(r.risk).toBe("high");
    });

    it("amountExVat in PLAN section → amount_mismatch MEDIUM (non-finance)", () => {
      const r = classifyDriftField("amountExVat", "PLAN", 10, 20);
      expect(r.type).toBe("amount_mismatch");
      expect(r.risk).toBe("medium");
      expect(r.allowBulkClose).toBe(true);
    });
  });

  describe("date fields", () => {
    it("invoiceDate in REVENUE section → date_mismatch MEDIUM or HIGH", () => {
      const r = classifyDriftField("invoiceDate", "REVENUE", "2026-01-01", "2026-03-01");
      expect(r.type).toBe("date_mismatch");
      // 59-day gap in finance section → HIGH
      expect(r.risk).toBe("high");
    });

    it("startDate in PLAN section with small gap → date_mismatch LOW", () => {
      const r = classifyDriftField("startDate", "PLAN", "2026-01-01", "2026-01-03");
      expect(r.type).toBe("date_mismatch");
      // 2-day gap in non-finance → LOW
      expect(r.risk).toBe("low");
    });

    it("paidDate in EXPENDITURE with >7 day gap → date_mismatch MEDIUM or HIGH", () => {
      const r = classifyDriftField("paidDate", "EXPENDITURE", "2026-01-01", "2026-01-15");
      expect(r.type).toBe("date_mismatch");
      expect(["high", "medium"]).toContain(r.risk);
    });
  });

  describe("status field", () => {
    it("status in any section → status_mismatch HIGH", () => {
      const planResult = classifyDriftField("status", "PLAN", "active", "completed");
      const revResult = classifyDriftField("status", "REVENUE", "planned", "invoiced");
      expect(planResult.type).toBe("status_mismatch");
      expect(planResult.risk).toBe("high");
      expect(planResult.requireOwnerNote).toBe(true);
      expect(planResult.allowBulkClose).toBe(false);
      expect(revResult.risk).toBe("high");
    });
  });

  describe("metadata / other fields", () => {
    it("description in PLAN section → value_mismatch LOW", () => {
      const r = classifyDriftField("description", "PLAN", "old desc", "new desc");
      expect(r.type).toBe("value_mismatch");
      expect(r.risk).toBe("low");
      expect(r.allowBulkClose).toBe(true);
    });

    it("non-tracked field in REVENUE section → value_mismatch MEDIUM", () => {
      const r = classifyDriftField("milestoneNotes", "REVENUE", "note A", "note B");
      expect(r.type).toBe("value_mismatch");
      expect(r.risk).toBe("medium");
    });
  });
});

describe("classifyFinanceException", () => {
  it("missing_po → invoice_without_po HIGH", () => {
    const r = classifyFinanceException("missing_po");
    expect(r.type).toBe("invoice_without_po");
    expect(r.risk).toBe("high");
    expect(r.allowBulkClose).toBe(false);
    expect(r.requireOwnerNote).toBe(true);
  });

  it("unmatched_cost_invoice → amount_mismatch HIGH", () => {
    const r = classifyFinanceException("unmatched_cost_invoice");
    expect(r.type).toBe("amount_mismatch");
    expect(r.risk).toBe("high");
    expect(r.allowBulkClose).toBe(false);
  });

  it("unmatched_revenue_payment → amount_mismatch HIGH", () => {
    const r = classifyFinanceException("unmatched_revenue_payment");
    expect(r.risk).toBe("high");
    expect(r.allowBulkClose).toBe(false);
  });

  it("duplicate_link_candidate → duplicate_invoice HIGH", () => {
    const r = classifyFinanceException("duplicate_link_candidate");
    expect(r.type).toBe("duplicate_invoice");
    expect(r.risk).toBe("high");
    expect(r.allowBulkClose).toBe(false);
  });

  it("cost_override → value_mismatch MEDIUM", () => {
    const r = classifyFinanceException("cost_override");
    expect(r.type).toBe("value_mismatch");
    expect(r.risk).toBe("medium");
  });

  it("revenue_override → value_mismatch MEDIUM", () => {
    const r = classifyFinanceException("revenue_override");
    expect(r.type).toBe("value_mismatch");
    expect(r.risk).toBe("medium");
  });
});

describe("classifyStaleData", () => {
  it("excel stale 45 days → stale_excel_data MEDIUM", () => {
    const r = classifyStaleData("excel", 45);
    expect(r.type).toBe("stale_excel_data");
    expect(r.risk).toBe("medium");
    expect(r.allowBulkClose).toBe(true);
  });

  it("excel stale 70 days → stale_excel_data HIGH", () => {
    const r = classifyStaleData("excel", 70);
    expect(r.risk).toBe("high");
    expect(r.requireOwnerNote).toBe(true);
  });

  it("app stale 20 days → stale_app_data MEDIUM", () => {
    const r = classifyStaleData("app", 20);
    expect(r.type).toBe("stale_app_data");
    expect(r.risk).toBe("medium");
  });

  it("STALE_EXCEL_THRESHOLD_DAYS is 30", () => {
    expect(STALE_EXCEL_THRESHOLD_DAYS).toBe(30);
  });

  it("STALE_APP_THRESHOLD_DAYS is 14", () => {
    expect(STALE_APP_THRESHOLD_DAYS).toBe(14);
  });
});

describe("classifyUnmapped", () => {
  it("project → unmapped_project MEDIUM", () => {
    const r = classifyUnmapped("project");
    expect(r.type).toBe("unmapped_project");
    expect(r.risk).toBe("medium");
    expect(r.allowBulkClose).toBe(false);
  });

  it("vendor_or_customer → unmapped_vendor_or_customer MEDIUM", () => {
    const r = classifyUnmapped("vendor_or_customer");
    expect(r.type).toBe("unmapped_vendor_or_customer");
    expect(r.risk).toBe("medium");
  });
});

describe("guardrail invariants", () => {
  it("all HIGH risk items block bulk close", () => {
    const highRiskItems = [
      classifyDriftField("status", "PLAN", "a", "b"),
      classifyDriftField("amountExVat", "REVENUE", 100, 200),
      classifyFinanceException("missing_po"),
      classifyFinanceException("unmatched_cost_invoice"),
      classifyFinanceException("duplicate_link_candidate"),
    ];
    for (const item of highRiskItems) {
      expect(item.risk).toBe("high");
      expect(item.allowBulkClose).toBe(false);
    }
  });

  it("LOW risk metadata items allow bulk close", () => {
    const lowRiskItems = [
      classifyDriftField("description", "PLAN", "a", "b"),
      classifyDriftField("startDate", "PLAN", "2026-01-01", "2026-01-02"),
    ];
    for (const item of lowRiskItems) {
      expect(item.risk).toBe("low");
      expect(item.allowBulkClose).toBe(true);
    }
  });
});
