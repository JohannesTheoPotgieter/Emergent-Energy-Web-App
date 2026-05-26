/**
 * Project Delivery deep audit (2026-05-26) — Hold/Blocked six-field rule.
 *
 * Per AGENT_GUARDRAILS.md § 4A and the C&I Solar Delivery Playbook v2.0,
 * placing a project on Hold/Blocked must capture six fields:
 *   reason, owner, review_date, dependency, decision_owner, evidence_link
 *
 * This test pins the pure helper `computeMissingHoldFields` to that list
 * so any future drift (renaming a field, removing one, or accepting
 * a falsy value where a real value is needed) is caught in CI.
 */

import { describe, expect, it } from "vitest";
import {
  HOLD_METADATA_FIELDS,
  computeMissingHoldFields,
} from "../../../server/services/stage-lifecycle-service";

describe("Hold/Blocked six-field rule (§ 4A)", () => {
  it("HOLD_METADATA_FIELDS lists exactly the six playbook fields", () => {
    expect([...HOLD_METADATA_FIELDS].sort()).toEqual(
      [
        "decisionOwnerUserId",
        "dependency",
        "evidenceLink",
        "ownerUserId",
        "reason",
        "reviewDate",
      ].sort(),
    );
    expect(HOLD_METADATA_FIELDS.length).toBe(6);
  });

  it("returns all six when nothing is supplied", () => {
    expect(new Set(computeMissingHoldFields({}))).toEqual(
      new Set(HOLD_METADATA_FIELDS),
    );
  });

  it("returns no missing fields when every field has a real value", () => {
    expect(
      computeMissingHoldFields({
        reason: "Awaiting municipal meter installation",
        metadata: {
          ownerUserId: 42,
          reviewDate: "2026-06-15",
          dependency: "City of Cape Town meter approval",
          decisionOwnerUserId: 7,
          evidenceLink: "https://sharepoint/site/project/evidence",
        },
      }),
    ).toEqual([]);
  });

  it("treats whitespace-only strings as missing (reason / dependency / evidenceLink)", () => {
    expect(
      computeMissingHoldFields({
        reason: "   ",
        metadata: {
          ownerUserId: 1,
          reviewDate: "2026-06-15",
          dependency: "",
          decisionOwnerUserId: 1,
          evidenceLink: "\t  ",
        },
      }),
    ).toEqual(["reason", "dependency", "evidenceLink"]);
  });

  it("flags ownerUserId / decisionOwnerUserId when null or undefined", () => {
    expect(
      computeMissingHoldFields({
        reason: "x",
        metadata: {
          ownerUserId: null,
          reviewDate: "2026-06-15",
          dependency: "x",
          decisionOwnerUserId: undefined as unknown as number,
          evidenceLink: "x",
        },
      }),
    ).toEqual(["ownerUserId", "decisionOwnerUserId"]);
  });
});
