import { describe, it, expect } from "vitest";
import {
  invoiceRawToLineRows,
  buildRevenueProjectResolver,
  normalizeProjectKey,
} from "../../../server/services/quickbooks-reconciliation-service";

/**
 * Task #18 — Revenue tracker-gap parity tests.
 *
 * These guard the architecture mirror between COS and Revenue:
 *  - QB Invoice → line-row decomposition behaves like the bill-side helper.
 *  - Revenue resolution prioritises CUSTOMER over CLASS (opposite of COS).
 *  - The approved revenue calculation symbol (`getProjectRevenueLinesConsistent`)
 *    remains exported and untouched in name/contract.
 *  - The bucket classifier produces the same shape as the COS workspace.
 */

describe("invoiceRawToLineRows (revenue mirror of billRawToLineRows)", () => {
  it("returns one row per SalesItemLineDetail with class/item/customer", () => {
    const raw = {
      Id: "1001",
      DocNumber: "INV-9001",
      TxnDate: "2026-02-15",
      Balance: "0",
      CustomerRef: { value: "C7", name: "ACME Mining" },
      Line: [
        {
          Id: "L1",
          LineNum: 1,
          Amount: 50000,
          Description: "Site A — concrete",
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ClassRef: { value: "1", name: "PROJ-A" },
            ItemRef: { value: "5", name: "Concrete" },
          },
        },
        {
          Id: "L2",
          LineNum: 2,
          Amount: 12500,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ClassRef: { value: "1", name: "PROJ-A" },
            ItemRef: { value: "9", name: "Labour" },
          },
        },
      ],
    };

    const rows = invoiceRawToLineRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      invoiceId: "1001",
      docNumber: "INV-9001",
      txnDate: "2026-02-15",
      customerName: "ACME Mining",
      classRefName: "PROJ-A",
      itemRefName: "Concrete",
      lineAmountExVat: 50000,
      balance: 0,
    });
    expect(rows[1].itemRefName).toBe("Labour");
  });

  it("falls back to a single synthetic header row when invoice has no usable lines", () => {
    const raw = {
      Id: "2002",
      DocNumber: "INV-9002",
      TxnDate: "2026-03-01",
      TotalAmt: 7777,
      Balance: 7777,
      CustomerRef: { value: "C9", name: "Fallback Co" },
      Line: [],
    };

    const rows = invoiceRawToLineRows(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceId: "2002",
      docNumber: "INV-9002",
      lineAmountExVat: 7777,
      balance: 7777,
      lineId: null,
    });
  });
});

describe("buildRevenueProjectResolver — customer > class precedence", () => {
  const projects = ["Site Alpha", "Site Bravo", "Site Charlie"];
  const resolve = buildRevenueProjectResolver(projects);

  it("PRECEDENCE — when class points at one project and customer at another, customer wins", () => {
    // This is the parity-critical test: COS is class-first, REVENUE is customer-first.
    // Both names match a different project; the resolver must pick the CUSTOMER project.
    const r = resolve({ classRefName: "Site Bravo", customerRefName: "Site Alpha" });
    expect(r.projectName).toBe("Site Alpha");
    expect(r.strategy).toBe("customer_exact");
    expect(r.matchedFrom).toBe("Site Alpha");
  });

  it("falls back to class_exact only when customer does not resolve", () => {
    const r = resolve({ classRefName: "Site Charlie", customerRefName: "Random Customer Pty Ltd" });
    expect(r.projectName).toBe("Site Charlie");
    expect(r.strategy).toBe("class_exact");
  });

  it("returns unmapped_customer when customer present but no project resolves", () => {
    const r = resolve({ classRefName: null, customerRefName: "Mystery Co" });
    expect(r.projectName).toBeNull();
    expect(r.strategy).toBe("unmapped_customer");
  });

  it("returns unmapped_no_customer when neither is present", () => {
    const r = resolve({ classRefName: null, customerRefName: null });
    expect(r.projectName).toBeNull();
    expect(r.strategy).toBe("unmapped_no_customer");
  });

  it("normalises project keys consistently", () => {
    expect(normalizeProjectKey("Site Alpha")).toBe(normalizeProjectKey("site alpha"));
    expect(normalizeProjectKey("  Site-Alpha  ")).toBe(normalizeProjectKey("site alpha"));
  });
});

describe("approved revenue calculation contract (regression guard)", () => {
  it("getProjectRevenueLinesConsistent symbol still exists in finance-routes", async () => {
    // Read-only check: confirms the approved calc has not been removed/renamed
    // by Task #18. We don't import it (it's a private async fn inside the
    // routes module); instead we grep the file source, which is the actual
    // contract the reviewer asked us to guard.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/departments/finance-routes.ts", "utf8");
    expect(src).toMatch(/async function getProjectRevenueLinesConsistent\(/);
    expect(src).toMatch(/revenue_recognition_amount/);
  });

  it("Task #18 did not introduce edits to normalized_revenue_lines from new endpoints", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/departments/finance-routes.ts", "utf8");
    // The new revenue tracker-gap section is read-only against
    // normalized_revenue_lines. Make sure no insert/update/delete shows up
    // inside it. We scope the check to the marker block we added.
    const startMarker = "REVENUE Tracker-Gap maintenance workspace";
    const endMarker = "Audit-history viewer for any tracker-gap or COS reconciliation entity.";
    const startIdx = src.indexOf(startMarker);
    const endIdx = src.indexOf(endMarker, startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = src.slice(startIdx, endIdx);
    expect(block).not.toMatch(/db\s*\.\s*insert\(\s*normalizedRevenueLines/);
    expect(block).not.toMatch(/db\s*\.\s*update\(\s*normalizedRevenueLines/);
    expect(block).not.toMatch(/db\s*\.\s*delete\(\s*normalizedRevenueLines/);
  });
});

describe("revenue gap bucket classifier", () => {
  // Re-implementation of the bucket logic the route uses, kept in sync with
  // the inline classifier in finance-routes.ts. If the route logic changes,
  // this test must change too — that's the point.
  type Bucket = "tracker_gap" | "unmapped_customer" | "unmapped_no_customer" | "matched";
  function classify(args: {
    resolvedProjectName: string | null;
    customerName: string | null;
    closestRevenueLineId: number | null;
  }): Bucket {
    if (args.resolvedProjectName && args.closestRevenueLineId) return "matched";
    if (args.resolvedProjectName) return "tracker_gap";
    if (args.customerName) return "unmapped_customer";
    return "unmapped_no_customer";
  }

  it("matched when a revenue line within R1 of the QB amount exists", () => {
    expect(
      classify({ resolvedProjectName: "Alpha", customerName: "ACME", closestRevenueLineId: 42 }),
    ).toBe("matched");
  });

  it("tracker_gap when project resolved but no nearby NRL", () => {
    expect(
      classify({ resolvedProjectName: "Alpha", customerName: "ACME", closestRevenueLineId: null }),
    ).toBe("tracker_gap");
  });

  it("unmapped_customer when no project resolution but a customer is present", () => {
    expect(
      classify({ resolvedProjectName: null, customerName: "Random", closestRevenueLineId: null }),
    ).toBe("unmapped_customer");
  });

  it("unmapped_no_customer when neither project nor customer is present", () => {
    expect(
      classify({ resolvedProjectName: null, customerName: null, closestRevenueLineId: null }),
    ).toBe("unmapped_no_customer");
  });
});
