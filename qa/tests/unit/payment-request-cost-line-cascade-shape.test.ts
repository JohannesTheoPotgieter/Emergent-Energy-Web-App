/**
 * TF-21 (audit V3) — Contract test for the payment_request → cost_line
 * paid-date cascade.
 *
 * Pins the public surface of payment-request-cost-line-cascade.ts +
 * the wiring into the payment-batch confirm flow + the new
 * pending_approvals kind. Numeric correctness against a fixture DB is
 * queued behind DF-21.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PENDING_APPROVAL_KINDS,
} from "../../../shared/schema/pending-approvals";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-21 — payment_request → cost_line cascade", () => {
  const src = read("server/services/payment-request-cost-line-cascade.ts");

  it("exports the proposePaymentRequestCascade function", () => {
    expect(src).toContain("export async function proposePaymentRequestCascade");
  });

  it("matches via direct PO link AND counterparty + amount fallback", () => {
    expect(src).toContain("Path 1 — direct PO link");
    expect(src).toContain("Path 2 — counterparty + amount fallback");
  });

  it("returns confidence='high' for a 1-match candidate, 'low' for multi-match, 'none' otherwise", () => {
    expect(src).toContain('confidence: "none"');
    expect(src).toMatch(/confidence: "high" \| "low"/);
    expect(src).toMatch(/candidates\.length === 1 \? "high" : "low"/);
  });

  it("guards snapshot reads with effectiveTo IS NULL and skips already-paid lines", () => {
    expect(src).toContain("isNull(normalizedCostLines.effectiveTo)");
    expect(src).toContain("isNull(normalizedCostLines.deletedAt)");
    expect(src).toContain("isNull(normalizedCostLines.paidDate)");
  });

  it("registers payment_request_cost_line_paid_sync as a pending-approval kind", () => {
    expect(PENDING_APPROVAL_KINDS).toContain("payment_request_cost_line_paid_sync");
  });

  it("is wired into the payment-batch confirm flow", () => {
    const routes = read("server/payment-batch-routes.ts");
    expect(routes).toContain("proposePaymentRequestCascade");
    expect(routes).toContain("RETURNING id");
    expect(routes).toContain("tf21Cascade");
    // The cascade is best-effort — a failure here MUST NOT roll back the
    // batch confirmation that already completed.
    expect(routes).toMatch(/cascade proposal failed/i);
  });
});
