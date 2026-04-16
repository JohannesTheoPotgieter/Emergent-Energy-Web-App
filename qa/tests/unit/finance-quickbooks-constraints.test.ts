/**
 * QuickBooks structural constraint pins.
 *
 * These tests guard the data-integrity invariants on the QuickBooks link
 * and customer-mapping tables. They are source-text pins (fast, no DB
 * round-trip) that will fail loudly if someone weakens the partial unique
 * indexes or removes the conflict-handling error class.
 *
 * Invariants covered:
 *   1. One active QB link per (app_entity_type, app_entity_id, realm).
 *   2. One active QB link per (qb_entity_type, qb_entity_id, realm).
 *   3. One active customer mapping per (project_id, realm).
 *   4. Link-write conflict error class is exported + 409-mapped in the
 *      QB routes handler.
 *   5. Duplicate-candidate counting is present in the exceptions helper.
 *   6. The `bill_number` vs `invoice_number` naming contract is respected
 *      in the reconciliation service (bill summaries must not leak the
 *      "invoice" term and vice versa).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("QuickBooks link — partial unique indexes on active rows", () => {
  const schema = read("shared/schema/integrations.ts");

  it("enforces ONE active link per app-entity tuple (by realm)", () => {
    expect(schema).toContain('"uq_qb_links_app_entity_active"');
    // Partial index MUST be restricted to non-soft-deleted rows so
    // re-linking after unlink still works.
    const idx = schema.indexOf('"uq_qb_links_app_entity_active"');
    const block = schema.slice(idx, idx + 300);
    expect(block).toMatch(/deletedAt.*IS NULL/);
  });

  it("enforces ONE active link per QB-entity tuple (by realm)", () => {
    expect(schema).toContain('"uq_qb_links_qb_entity_active"');
    const idx = schema.indexOf('"uq_qb_links_qb_entity_active"');
    const block = schema.slice(idx, idx + 300);
    expect(block).toMatch(/deletedAt.*IS NULL/);
  });

  it("enforces ONE customer mapping per (project, realm)", () => {
    expect(schema).toContain('"quickbooks_customer_mappings_project_idx"');
  });
});

describe("QuickBooks allocation-aware evidence model", () => {
  const schema = read("shared/schema/integrations.ts");
  const allocationLib = read("server/lib/finance/qb-allocation.ts");

  it("defines canonical quickbooks_documents and quickbooks_cost_allocations tables", () => {
    expect(schema).toContain('pgTable(\n  "quickbooks_documents"');
    expect(schema).toContain('pgTable(\n  "quickbooks_cost_allocations"');
  });

  it("stores VAT-decomposed document amounts (inc_vat, tax, ex_vat)", () => {
    expect(schema).toContain("qb_amount_inc_vat");
    expect(schema).toContain("qb_tax_amount");
    expect(schema).toContain("qb_amount_ex_vat");
  });

  it("contains explicit over-assignment guard and tiny tolerance", () => {
    expect(allocationLib).toContain("QB_ASSIGNMENT_TOLERANCE_EX_VAT = 0.01");
    expect(allocationLib).toContain("Over-assignment blocked");
  });

  it("computes realised amount from min(line amount, assigned evidence)", () => {
    expect(allocationLib).toContain("Math.min(lineAmountExVat, assignedQbExVat)");
    expect(allocationLib).toContain("Math.max(0, lineAmountExVat - assignedQbExVat)");
  });
});

describe("QuickBooks link — conflict handling", () => {
  const service = read("server/services/quickbooks-reconciliation-service.ts");
  const routes = read("server/quickbooks-routes.ts");

  it("exports QuickBooksLinkConflictError from the reconciliation service", () => {
    expect(service).toMatch(/export\s+class\s+QuickBooksLinkConflictError/);
  });

  it("maps a link conflict to HTTP 409 in the QB routes", () => {
    expect(routes).toContain("handleLinkConflict");
    const handlerIdx = routes.indexOf("function handleLinkConflict");
    expect(handlerIdx).toBeGreaterThan(-1);
    const block = routes.slice(handlerIdx, handlerIdx + 1200);
    expect(block).toContain("QuickBooksLinkConflictError");
    expect(block).toContain("res.status(409)");
    expect(block).toContain('"conflict"');
  });

  it("logs a link.conflict audit entry when a POST /links conflict fires", () => {
    expect(routes).toContain('"quickbooks.link.conflict"');
  });
});

describe("QuickBooks reconciliation service — mark-realised hardening", () => {
  const service = read("server/services/quickbooks-reconciliation-service.ts");
  const routes = read("server/quickbooks-routes.ts");

  it("does not export any markCostLineRealised helper", () => {
    expect(service).not.toMatch(/export\s+async\s+function\s+markCostLineRealised/);
    expect(service).not.toMatch(/export\s+function\s+markCostLineRealised/);
  });

  it("never writes cosRealised = true in the QB reconciliation service", () => {
    expect(service).not.toMatch(/cosRealised:\s*true/);
  });

  it("retains the 410 Gone shell on /api/quickbooks/cost-lines/:id/mark-realised", () => {
    const anchor = '"/api/quickbooks/cost-lines/:id/mark-realised"';
    expect(routes).toContain(anchor);
    const idx = routes.indexOf(anchor);
    const block = routes.slice(idx, idx + 1000);
    expect(block).toContain("410");
    expect(block).toContain("quickbooks_mark_realised_disabled");
    expect(block).toContain("/api/cos-tracker/toggle-realised/:id");
  });
});

describe("QuickBooks reconciliation service — bill vs invoice naming", () => {
  const service = read("server/services/quickbooks-reconciliation-service.ts");

  it("exports a billRawToSummary AND invoiceRawToSummary helper", () => {
    // Both helpers should exist and be named distinctly so callers can't
    // accidentally cross-wire a bill into an invoice code path.
    expect(service).toMatch(/export\s+function\s+billRawToSummary/);
    expect(service).toMatch(/export\s+function\s+invoiceRawToSummary/);
  });

  it("exports distinct QuickBooksBillSummary and QuickBooksInvoiceSummary types", () => {
    expect(service).toMatch(/QuickBooksBillSummary/);
    expect(service).toMatch(/QuickBooksInvoiceSummary/);
  });
});

describe("finance exception summary — duplicate link candidates", () => {
  const exceptions = read("server/lib/finance-trust/exceptions.ts");

  it("includes a duplicate-link-candidate query in the summary", () => {
    expect(exceptions).toContain("duplicateLinkCandidates");
    // Must inspect both active and soft-deleted rows on the same tuple.
    expect(exceptions).toMatch(/FILTER \(WHERE deleted_at IS NULL\)/);
    expect(exceptions).toMatch(/FILTER \(WHERE deleted_at IS NOT NULL\)/);
  });

  it("counts unmatched cost invoices via a NOT EXISTS against the link table", () => {
    expect(exceptions).toContain("unmatchedCostInvoices");
    expect(exceptions).toContain("NOT EXISTS");
    expect(exceptions).toMatch(/app_entity_type\s*=\s*'cost_line'/);
  });

  it("counts unmatched revenue payments via a NOT EXISTS against the link table", () => {
    expect(exceptions).toContain("unmatchedRevenuePayments");
    expect(exceptions).toMatch(/app_entity_type\s*=\s*'revenue_line'/);
  });

  it("uses the snapshot effective_to IS NULL guard on every canonical read", () => {
    // Every canonical-table query in this file MUST filter out history.
    const queryCount = (exceptions.match(/FROM normalized_cost_lines/g) ?? []).length;
    const guardCount = (exceptions.match(/effective_to IS NULL/g) ?? []).length;
    expect(queryCount).toBeGreaterThan(0);
    // Each cost-line query should have at least one effective_to guard.
    expect(guardCount).toBeGreaterThanOrEqual(queryCount);
  });
});
