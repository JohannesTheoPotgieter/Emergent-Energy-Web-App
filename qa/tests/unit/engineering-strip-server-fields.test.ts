/**
 * Unit tests for the `stripServerFields` mass-assignment guard introduced
 * in PR #906 (`server/engineering-routes.ts`). The function lives on the
 * file's hot path: every PATCH/POST that previously did
 * `{ ...req.body, ... }` now goes through `stripServerFields(req.body)`.
 *
 * A regression that removes "approvedBy" / "isApproved" / "ownerUserId"
 * etc. from the deny set would silently allow workflow bypass. These
 * tests pin the contract.
 */

import { describe, expect, it } from "vitest";
import { FORBIDDEN_BODY_KEYS, stripServerFields } from "../../../server/engineering-routes";

describe("stripServerFields — mass-assignment guard", () => {
  describe("input validation", () => {
    it("returns {} for null", () => {
      expect(stripServerFields(null)).toEqual({});
    });

    it("returns {} for undefined", () => {
      expect(stripServerFields(undefined)).toEqual({});
    });

    it("returns {} for primitives", () => {
      expect(stripServerFields(42)).toEqual({});
      expect(stripServerFields("hello")).toEqual({});
      expect(stripServerFields(true)).toEqual({});
    });

    it("returns {} for arrays (not object-shaped bodies)", () => {
      expect(stripServerFields([1, 2, 3])).toEqual({});
    });

    it("returns {} for empty object", () => {
      expect(stripServerFields({})).toEqual({});
    });
  });

  describe("FORBIDDEN_BODY_KEYS — every protected key is stripped", () => {
    // Lock-in test: every key in FORBIDDEN_BODY_KEYS is silently removed
    // even if the client tries to set it. If this test fails, the deny set
    // shrank — which means a previously-protected field is now writable
    // via mass-assignment.
    const REQUIRED_PROTECTIONS = [
      "id",
      "createdAt",
      "createdBy",
      "updatedAt",
      "deletedAt",
      "deletedBy",
      "projectId",
      "clientId",
      "ownerUserId",
      "uploadedByUserId",
      "cpSignedByUserId",
      "source",
      "sourceRow",
      "sourceSheet",
      "importRunId",
      "legacyTable",
      "legacyId",
      "externalRef",
      "approvedBy",
      "approvedAt",
      "isApproved",
      "completedAt",
      "isShared",
    ];

    it.each(REQUIRED_PROTECTIONS)("strips %s", (key) => {
      const body = { [key]: "attacker-set-value", title: "kept" };
      const result = stripServerFields(body);
      expect(result).not.toHaveProperty(key);
      expect(result.title).toBe("kept");
    });

    it("FORBIDDEN_BODY_KEYS exports every protected name", () => {
      // Symmetric check — if someone adds a key to the test list above but
      // forgets to add it to FORBIDDEN_BODY_KEYS, this surfaces the gap.
      for (const key of REQUIRED_PROTECTIONS) {
        expect(FORBIDDEN_BODY_KEYS.has(key), `${key} must be in FORBIDDEN_BODY_KEYS`).toBe(true);
      }
    });
  });

  describe("legitimate keys pass through", () => {
    it("preserves user-editable task fields", () => {
      const body = {
        title: "Design review",
        description: "Review the IFC drawings",
        status: "in_progress",
        priority: "high",
        startDate: "2026-05-12",
        endDate: "2026-05-20",
        percentComplete: 50,
        comment: "Looking good",
        trackingRag: "amber",
        holdReason: null,
      };
      const result = stripServerFields(body);
      expect(result).toEqual(body);
    });

    it("preserves unknown future keys (the deny set is exhaustive, not the allow set)", () => {
      const body = { someFutureField: "value", title: "x" };
      const result = stripServerFields(body);
      expect(result).toHaveProperty("someFutureField", "value");
      expect(result).toHaveProperty("title", "x");
    });
  });

  describe("mixed input", () => {
    it("strips forbidden + keeps everything else in a realistic mass-assignment attack", () => {
      // Simulates a malicious PATCH body that tries to reparent a task to
      // another project AND mark it as imported by a legacy script.
      const body = {
        // Attack — should all be dropped
        id: 9999,
        projectId: 1234,
        ownerUserId: 1,
        createdBy: 1,
        importRunId: 666,
        legacyTable: "old_tasks",
        isApproved: true,
        approvedBy: 1,
        approvedAt: "2025-01-01",
        // Legit — should pass through
        title: "Stealth task",
        status: "complete",
        comment: "shipped",
      };
      const result = stripServerFields(body);
      expect(result).toEqual({
        title: "Stealth task",
        status: "complete",
        comment: "shipped",
      });
    });
  });
});
