import { describe, expect, it } from "vitest";
import {
  DELIVERABLE_REQUIRED_TAG,
  hasDeliverableRequirementFlag,
  hasDeliverableRequirementTag,
  withDeliverableRequirementTag,
} from "@shared/task-deliverable-requirement";

describe("deliverable requirement tag helper", () => {
  it("detects explicit deliverable requirement tags", () => {
    expect(hasDeliverableRequirementTag(["foo", DELIVERABLE_REQUIRED_TAG])).toBe(true);
    expect(hasDeliverableRequirementTag(["foo", "bar"])).toBe(false);
  });

  it("treats linked deliverables and task-type tags as deliverable-required", () => {
    expect(hasDeliverableRequirementFlag({ linkedDeliverableId: 10 })).toBe(true);
    expect(hasDeliverableRequirementFlag({ taskTypeTag: "site_deliverable" })).toBe(true);
    expect(hasDeliverableRequirementFlag({ tags: [DELIVERABLE_REQUIRED_TAG] })).toBe(true);
    expect(hasDeliverableRequirementFlag({ tags: ["GENERAL"] })).toBe(false);
  });

  it("adds and removes the explicit requirement flag without duplicating tags", () => {
    expect(withDeliverableRequirementTag(["GENERAL"], true)).toEqual(["GENERAL", DELIVERABLE_REQUIRED_TAG]);
    expect(withDeliverableRequirementTag(["GENERAL", DELIVERABLE_REQUIRED_TAG], true)).toEqual(["GENERAL", DELIVERABLE_REQUIRED_TAG]);
    expect(withDeliverableRequirementTag(["GENERAL", DELIVERABLE_REQUIRED_TAG], false)).toEqual(["GENERAL"]);
    expect(withDeliverableRequirementTag([DELIVERABLE_REQUIRED_TAG], false)).toBeNull();
  });
});
