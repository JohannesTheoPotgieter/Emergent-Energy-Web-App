/**
 * Static-source policy tests for the new /api/quickbooks/invoice-matches/*
 * route family. Mirrors the convention established by
 * quickbooks-cascade-policy.test.ts — no DB, no HTTP, just contract pins.
 *
 * What we lock down:
 *   - All four mutate endpoints require requireAuth.
 *   - Find / payment-status are gated to financials:view.
 *   - Approve / reject are gated to financials:edit.
 *   - Manual link is gated to financials:override (the highest tier).
 *   - Matcher service has no auto-approve path (no insertion into
 *     quickbooks_invoice_links unless triggered by an /approve or
 *     /manual-link route handler).
 *   - The cascade-policy contract ('z.enum(["customer", "vendor"])') is
 *     untouched on the legacy /suggest-matches endpoint.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

const ROUTES = read("server/routes/quickbooks-invoice-matches.routes.ts");
const SERVICE = read("server/services/quickbooks-invoice-match-service.ts");
const LEGACY = read("server/quickbooks-routes.ts");

describe("invoice-matches route hardening — auth + permissions", () => {
  it("POST /find requires requireAuth + financials:view", () => {
    expect(ROUTES).toMatch(
      /app\.post\(\s*"\/api\/quickbooks\/invoice-matches\/find"[\s\S]{0,200}requireAuth[\s\S]{0,80}requirePermission\("financials",\s*"view"\)/,
    );
  });

  it("POST /:id/approve requires requireAuth + financials:edit", () => {
    expect(ROUTES).toMatch(
      /app\.post\(\s*"\/api\/quickbooks\/invoice-matches\/:suggestionId\/approve"[\s\S]{0,200}requireAuth[\s\S]{0,80}requirePermission\("financials",\s*"edit"\)/,
    );
  });

  it("POST /:id/reject requires requireAuth + financials:edit", () => {
    expect(ROUTES).toMatch(
      /app\.post\(\s*"\/api\/quickbooks\/invoice-matches\/:suggestionId\/reject"[\s\S]{0,200}requireAuth[\s\S]{0,80}requirePermission\("financials",\s*"edit"\)/,
    );
  });

  it("POST /manual-link requires requireAuth + financials:override (highest tier)", () => {
    expect(ROUTES).toMatch(
      /app\.post\(\s*"\/api\/quickbooks\/invoice-matches\/manual-link"[\s\S]{0,200}requireAuth[\s\S]{0,80}requirePermission\("financials",\s*"override"\)/,
    );
  });

  it("GET /payment-status/:linkId requires requireAuth + financials:view", () => {
    expect(ROUTES).toMatch(
      /app\.get\(\s*"\/api\/quickbooks\/invoice-matches\/payment-status\/:linkId"[\s\S]{0,200}requireAuth[\s\S]{0,80}requirePermission\("financials",\s*"view"\)/,
    );
  });
});

describe("invoice-matches — no auto-approve contract", () => {
  it("matcher service does NOT write to quickbooks_invoice_links (pure scorer)", () => {
    expect(SERVICE).not.toMatch(/quickbooksInvoiceLinks/);
    expect(SERVICE).not.toMatch(/db\.insert/);
    expect(SERVICE).not.toMatch(/db\.update/);
  });

  it("/find handler creates a suggestion row but never inserts an active link", () => {
    // Find handler section: between the find route registration and the next route.
    const findSection = ROUTES.split("/api/quickbooks/invoice-matches/find")[1] ?? "";
    const beforeApprove = findSection.split("/api/quickbooks/invoice-matches/:suggestionId/approve")[0] ?? "";
    expect(beforeApprove).toContain("quickbooksMatchSuggestions");
    expect(beforeApprove).not.toMatch(/db\.insert\(quickbooksInvoiceLinks\)/);
    expect(beforeApprove).not.toMatch(/confirmCostLineLink/);
    expect(beforeApprove).not.toMatch(/confirmRevenueLineLink/);
  });
});

describe("invoice-matches — approve / reject preconditions", () => {
  it("approve refuses when suggestion is already accepted", () => {
    expect(ROUTES).toMatch(/suggestion\.acceptedAt[\s\S]{0,80}Suggestion already accepted/);
  });

  it("approve refuses when suggestion is already rejected", () => {
    expect(ROUTES).toMatch(/suggestion\.rejectedAt[\s\S]{0,80}Suggestion was already rejected/);
  });

  it("reject refuses when suggestion is already accepted", () => {
    expect(ROUTES).toMatch(/already accepted; cannot reject/);
  });

  it("approve uses confirmCostLineLink / confirmRevenueLineLink (no direct link insert)", () => {
    const approveSection = ROUTES.split("/api/quickbooks/invoice-matches/:suggestionId/approve")[1] ?? "";
    const beforeReject = approveSection.split("/api/quickbooks/invoice-matches/:suggestionId/reject")[0] ?? "";
    expect(
      /confirmCostLineLink/.test(beforeReject) && /confirmRevenueLineLink/.test(beforeReject),
    ).toBe(true);
  });

  it("approve handler propagates QuickBooksLinkConflictError as HTTP 409", () => {
    expect(ROUTES).toMatch(/QuickBooksLinkConflictError[\s\S]{0,200}409/);
  });
});

describe("invoice-matches — every mutating endpoint writes audit", () => {
  it.each([
    ["qb.invoice_match.find"],
    ["qb.invoice_match.approve"],
    ["qb.invoice_match.reject"],
    ["qb.invoice_match.manual_link"],
  ])("emits audit action %s", (action) => {
    expect(ROUTES).toContain(`action: "${action}"`);
  });
});

describe("invoice-matches — cascade policy untouched", () => {
  it("legacy /suggest-matches endpoint still pins scope to customer + vendor only", () => {
    expect(LEGACY).toContain('z.enum(["customer", "vendor"])');
    expect(LEGACY).not.toContain(
      'z.enum(["customer", "vendor", "expense_invoice", "incoming_invoice"])',
    );
  });
});
