/**
 * Wave-5 audit (2026-05-26) — coverage for the deeper-audit additions
 * from PRs #944 / #947 / #949 / #951 that previously lacked tests.
 *
 * Targets:
 *   1. O&M handover acceptance — Six Rule #6 fix that populates
 *      acceptedByUserId / acceptedAt on a dedicated /accept endpoint.
 *   2. project_hold_metadata — § 4A six-field rule; schema must keep
 *      the six required columns + the override-reason field.
 *   3. post_handover_reviews — § 4 / Six Rule #6 fix for stage S10
 *      (3-month review); schema must keep PM + COO sign-off columns.
 *   4. change_requests actor columns — wave-2 fix; schema must keep
 *      submitted_by_user_id, reviewer_user_id, approver_user_id +
 *      timestamps + rejection_reason.
 *
 * These are pure schema-export / source-text assertions so the test
 * runs without a DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const OM_HANDOVER_ROUTES = fs.readFileSync(
  path.join(__dirname, "../../../server/departments/om-handover-routes.ts"),
  "utf8",
);

const OM_HANDOVER_SERVICE = fs.readFileSync(
  path.join(__dirname, "../../../server/services/om-handover-service.ts"),
  "utf8",
);

describe("O&M handover /accept endpoint (Six Rule #6)", () => {
  it("exposes POST /api/om-handovers/:id/accept", () => {
    expect(OM_HANDOVER_ROUTES).toMatch(
      /router\.post\(\s*"\/api\/om-handovers\/:id\/accept"/,
    );
  });

  it("populates acceptedByUserId + acceptedAt via acceptOmHandover service", () => {
    expect(OM_HANDOVER_SERVICE).toContain("export async function acceptOmHandover");
    expect(OM_HANDOVER_SERVICE).toContain("acceptedByUserId:");
    expect(OM_HANDOVER_SERVICE).toContain("acceptedAt:");
  });

  it("emits an audit row + history entry on acceptance", () => {
    expect(OM_HANDOVER_SERVICE).toContain('action: "ACCEPT"');
    expect(OM_HANDOVER_SERVICE).toContain("omHandoverHistory");
  });
});

// Schema-shape assertions — import the schema directly so the test
// catches any future rename / column drop.

import {
  projectHoldMetadata,
  postHandoverReviews,
  changeRequests,
} from "../../../shared/schema";

describe("project_hold_metadata — § 4A six-field rule", () => {
  it("keeps the six playbook fields", () => {
    // Drizzle exposes each column as a property of the table object.
    const t = projectHoldMetadata as any;
    for (const required of [
      "reason",
      "ownerUserId",
      "reviewDate",
      "dependency",
      "decisionOwnerUserId",
      "evidenceLink",
    ]) {
      expect(t[required], `missing column: ${required}`).toBeDefined();
    }
  });

  it("keeps the override-reason field for § 0A authorised overrides", () => {
    expect((projectHoldMetadata as any).overrideReason).toBeDefined();
  });

  it("keeps the resolution timestamps (resolvedAt / resolvedByUserId)", () => {
    expect((projectHoldMetadata as any).resolvedAt).toBeDefined();
    expect((projectHoldMetadata as any).resolvedByUserId).toBeDefined();
  });
});

describe("post_handover_reviews — stage S10 sign-off (Six Rule #6)", () => {
  it("keeps PM + COO sign-off columns", () => {
    expect((postHandoverReviews as any).pmSignOffUserId).toBeDefined();
    expect((postHandoverReviews as any).pmSignOffAt).toBeDefined();
    expect((postHandoverReviews as any).cooSignOffUserId).toBeDefined();
    expect((postHandoverReviews as any).cooSignOffAt).toBeDefined();
  });

  it("keeps the lessons_captured jsonb + scheduled/actual dates", () => {
    expect((postHandoverReviews as any).lessonsCaptured).toBeDefined();
    expect((postHandoverReviews as any).scheduledDate).toBeDefined();
    expect((postHandoverReviews as any).actualReviewDate).toBeDefined();
  });
});

describe("change_requests — actor columns per VO workflow audit", () => {
  it("keeps submitted_by_user_id + submitted_at", () => {
    expect((changeRequests as any).submittedByUserId).toBeDefined();
    expect((changeRequests as any).submittedAt).toBeDefined();
  });

  it("keeps reviewer_user_id + review_started_at", () => {
    expect((changeRequests as any).reviewerUserId).toBeDefined();
    expect((changeRequests as any).reviewStartedAt).toBeDefined();
  });

  it("keeps approver_user_id + approved_at", () => {
    expect((changeRequests as any).approverUserId).toBeDefined();
    expect((changeRequests as any).approvedAt).toBeDefined();
  });

  it("keeps rejection_reason + rejected_at", () => {
    expect((changeRequests as any).rejectionReason).toBeDefined();
    expect((changeRequests as any).rejectedAt).toBeDefined();
  });
});
