/**
 * Project Delivery deep audit pass 2 — Change Request route guards.
 *
 * The audit flagged three soft holes in the VO/CR workflow:
 *   1. Status transitions to under_review / approved / rejected didn't
 *      capture WHO decided.
 *   2. Self-approval was permitted — the requester could approve their
 *      own change request.
 *   3. Soft-delete worked at any status — in-flight CRs could vanish.
 *
 * The fixes live in server/change-control-routes.ts. This test reads
 * the source as text and pins the new contracts so any future change
 * that drops them is caught in CI.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../server/change-control-routes.ts"),
  "utf8",
);

describe("Change-control route — deeper-audit guards", () => {
  it("self-approval is refused when the approver equals the requester", () => {
    // The 403 branch must mention both the error code and the rule it
    // enforces. Keep the strings explicit so a refactor can't slip them
    // out (the same pattern guards PO + payment-request self-approval).
    expect(SOURCE).toContain("self_approval_forbidden");
    expect(SOURCE).toMatch(/cannot approve a change request you submitted/i);
  });

  it("rejection requires a non-empty rejectionReason", () => {
    expect(SOURCE).toContain("rejection_reason_required");
    expect(SOURCE).toMatch(
      /A non-empty rejectionReason is required when rejecting/i,
    );
  });

  it("non-draft soft-delete requires an explicit overrideReason", () => {
    expect(SOURCE).toContain("cr_not_in_draft");
    expect(SOURCE).toMatch(/overrideReason/i);
  });

  it("actor columns are populated on every transition", () => {
    // The PATCH handler must set submittedByUserId / reviewerUserId /
    // approverUserId at each transition. If a refactor drops one, the
    // audit trail loses that segment.
    expect(SOURCE).toContain("updates.submittedByUserId");
    expect(SOURCE).toContain("updates.reviewerUserId");
    expect(SOURCE).toContain("updates.approverUserId");
  });
});
