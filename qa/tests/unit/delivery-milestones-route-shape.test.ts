/**
 * Wave-4 audit (2026-05-26) — Delivery Milestone Tracker route shape.
 *
 * Splits the (now revenue-only) milestone tracker. This test pins the
 * public contract of the new POST/PATCH/DELETE handlers — particularly
 * the soft-rule patterns (§ 0A / § 4A):
 *   - Evidence missing on completion → warning, not refusal.
 *   - Delete on a completed milestone → refused unless overrideReason.
 *   - Duplicate milestone_code on same project → 409.
 *
 * Reads the route source as text so a refactor that drops one of these
 * contracts fails CI.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    "../../../server/routes/delivery-milestones.routes.ts",
  ),
  "utf8",
);

describe("delivery-milestones route — public contract", () => {
  it("permission entity is pd_delivery_milestones", () => {
    expect(SOURCE).toContain('requirePermission("pd_delivery_milestones", "view")');
    expect(SOURCE).toContain('requirePermission("pd_delivery_milestones", "edit")');
    // Collapsed model: delete folds into edit, so the delete handler is now
    // gated on the same "edit" action (no separate "delete" gate exists). The
    // milestone-delete invariant — that deletes are still permission-gated on a
    // mutating capability — is preserved by the "edit" assertion above. Guard
    // that the obsolete "delete" gate is gone so a regression to it is caught.
    expect(SOURCE).not.toContain('requirePermission("pd_delivery_milestones", "delete")');
  });

  it("missing evidence on completion is a warning, not a refusal (§ 0A override)", () => {
    expect(SOURCE).toMatch(/missingEvidenceWarning/);
    expect(SOURCE).toMatch(/Marking milestone complete without an evidence link/i);
  });

  it("delete of a completed milestone requires overrideReason", () => {
    expect(SOURCE).toContain("milestone_complete");
    expect(SOURCE).toMatch(/overrideReason/);
  });

  it("duplicate milestone_code returns 409", () => {
    expect(SOURCE).toContain("duplicate_milestone_code");
    expect(SOURCE).toContain('"23505"');
  });

  it("each handler emits a project event + audit row", () => {
    expect(SOURCE).toContain("delivery_milestone.created");
    expect(SOURCE).toContain("delivery_milestone.completed");
    // Three audit rows: create, update, soft_delete
    const auditCalls = SOURCE.match(/logAuditFromReq/g) || [];
    expect(auditCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("status derivation handles overdue / blocked / complete", () => {
    expect(SOURCE).toContain('function deriveStatus');
    expect(SOURCE).toContain('"overdue"');
    expect(SOURCE).toContain('"blocked"');
    expect(SOURCE).toContain('"complete"');
  });
});
