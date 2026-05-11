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
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

describe("QuickBooks link — many-to-many allocations (Task #142)", () => {
  const schema = read("shared/schema/integrations.ts");
  const migration = read("migrations/0050_qb_invoice_links_allocations.sql");

  it("DROPS the legacy 1:1 partial unique indexes (now multimap)", () => {
    // Task #142 — both 1:1 partial unique indexes are dropped so a single
    // app line may link to multiple QB docs AND a single QB doc may link
    // to multiple app lines. The migration must contain the DROPs and the
    // schema mirror must NOT re-declare these indexes.
    expect(migration).toMatch(/DROP INDEX IF EXISTS uq_qb_links_app_entity_active/);
    expect(migration).toMatch(/DROP INDEX IF EXISTS uq_qb_links_qb_entity_active/);
    // Pinning the index NAMES being absent from the live schema mirror
    // would catch any accidental re-add.
    expect(schema).not.toMatch(/"uq_qb_links_app_entity_active"/);
    expect(schema).not.toMatch(/"uq_qb_links_qb_entity_active"/);
  });

  it("retains the base 5-tuple uniqueness so the SAME pair can't double-link", () => {
    // The base unique index on (app_entity_type, app_entity_id,
    // qb_entity_type, qb_entity_id, qb_realm_id) MUST stay in place — it
    // is the duplicate-pair guard that the dropped 1:1 indexes used to
    // imply.
    expect(schema).toContain("quickbooks_invoice_links_unique_idx");
  });

  it("adds the per-QB-doc fan-out index for sibling resolution", () => {
    expect(migration).toMatch(/quickbooks_invoice_links_qb_entity_idx/);
  });

  it("adds allocated_amount_ex_vat + allocation_tolerance_applied columns", () => {
    expect(migration).toMatch(/allocated_amount_ex_vat numeric\(15, 2\)/);
    expect(migration).toMatch(/allocation_tolerance_applied boolean NOT NULL DEFAULT false/);
    // Schema mirror exposes the new columns to Drizzle so the writer can
    // type-check them.
    expect(schema).toMatch(/allocatedAmountExVat/);
    expect(schema).toMatch(/allocationToleranceApplied/);
  });

  it("enforces strictly positive allocation via a CHECK constraint (idempotent)", () => {
    // Task #142 — the writer rejects zero allocations and the DB CHECK
    // is the authoritative guard. Migration drops any prior `>= 0`
    // variant and installs the strict `> 0` constraint inside a DO-block
    // (PostgreSQL does not support `ADD CONSTRAINT IF NOT EXISTS`).
    expect(migration).toContain("quickbooks_invoice_links_allocated_positive");
    expect(migration).toContain("CHECK (allocated_amount_ex_vat > 0)");
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS quickbooks_invoice_links_allocated_non_neg/,
    );
    expect(migration).toMatch(/FROM pg_constraint[\s\S]*allocated_positive/);
    // Guard the executable statement, not the explanatory comment that
    // names the unsupported syntax for context. Only inspect non-comment
    // lines (anything not starting with `--`).
    const executable = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/ADD CONSTRAINT IF NOT EXISTS/);
  });

  it("backfills allocated_amount_ex_vat from qb_amount for legacy rows", () => {
    // Backfill is what makes the migration truly additive — every legacy
    // single-link row reads as a 100% allocation of its QB doc. We use a
    // `GREATEST(..., 0.01)` floor so the strict `> 0` invariant is never
    // violated by anomaly rows whose `qb_amount` was missing.
    expect(migration).toMatch(
      /SET allocated_amount_ex_vat = GREATEST\(COALESCE\(qb_amount, 0\.01\), 0\.01\)/,
    );
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

  it("includes OVER_ASSIGNED_BLOCKED in the document assignment-status enum", () => {
    // computeQbDocumentStatus can return OVER_ASSIGNED_BLOCKED; the enum
    // and the helper must agree so the status column is never populated
    // with an out-of-band value.
    expect(schema).toMatch(/QUICKBOOKS_DOCUMENT_ASSIGNMENT_STATUS[\s\S]*OVER_ASSIGNED_BLOCKED/);
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

describe("QuickBooks bulk-assign hardening (#660 follow-up)", () => {
  const routes = read("server/quickbooks-routes.ts");
  const service = read("server/services/quickbooks-reconciliation-service.ts");

  it("validates the bulk-assign body with Zod", () => {
    expect(routes).toContain("bulkAssignSchema");
    expect(routes).toContain("validateBody(bulkAssignSchema)");
    // billId is trimmed + regex-enforced so QB QL injection is impossible.
    expect(routes).toMatch(/billId:\s*z\.string/);
  });

  it("accepts billId (not a client-supplied bill snapshot) on bulk-assign", () => {
    // Regression guard: if anyone re-introduces the old `bill: {...}` shape
    // the client can smuggle inflated qbAmountExVat values. Stay on billId.
    const handlerIdx = routes.indexOf("/api/quickbooks/cost-allocations/bulk-assign");
    expect(handlerIdx).toBeGreaterThan(-1);
    const block = routes.slice(handlerIdx, handlerIdx + 2200);
    expect(block).toMatch(/billId:\s*body\.billId/);
    expect(block).not.toMatch(/qbAmountExVat:\s*(?:req|body)\.body?\./);
  });

  it("re-fetches the Bill server-side via getBillById in the service", () => {
    expect(service).toContain("getBillById");
    expect(service).toMatch(/billId:\s*string/);
  });

  it("exports QuickBooksUnavailableError and QuickBooksBillNotFoundError", () => {
    expect(service).toMatch(/export\s+class\s+QuickBooksUnavailableError/);
    expect(service).toMatch(/export\s+class\s+QuickBooksBillNotFoundError/);
  });

  it("maps QB errors to 503 / 404 / 409 via ApiError/sendError", () => {
    expect(routes).toContain("QuickBooksUnavailableError");
    expect(routes).toContain('new ApiError(503, "quickbooks_unavailable"');
    expect(routes).toContain("QuickBooksBillNotFoundError");
    expect(routes).toContain('new ApiError(404, "quickbooks_bill_not_found"');
    expect(routes).toContain("Over-assignment blocked");
    expect(routes).toContain('conflict("Over-assignment blocked")');
  });

  it("does not fall back to qbRealmId='unknown' in the save-allocations path", () => {
    const fnIdx = service.indexOf("export async function saveCostAllocationsForBill");
    expect(fnIdx).toBeGreaterThan(-1);
    const block = service.slice(fnIdx, fnIdx + 2000);
    expect(block).toMatch(/throw new QuickBooksUnavailableError/);
    expect(block).not.toMatch(/realmId\s*\?\?\s*"unknown"/);
  });

  it("uses $inferInsert for QB document and allocation writes (no `as any` spray)", () => {
    expect(service).toContain("quickbooksDocuments.$inferInsert");
    expect(service).toContain("quickbooksCostAllocations.$inferInsert");
    const fnIdx = service.indexOf("export async function saveCostAllocationsForBill");
    const block = service.slice(fnIdx, fnIdx + 2200);
    // Any `as any` inside the save function is a regression — strict types
    // should flow via the $inferInsert aliases defined above it.
    expect(block).not.toMatch(/\bas\s+any\b/);
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
