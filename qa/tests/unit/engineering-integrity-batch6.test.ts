import { describe, it, expect } from "vitest";
import { buildEngineeringTaskInsert } from "../../../server/lib/engineering/task-builders";

/**
 * Batch 6 — data-model integrity: the shared write-helper enforces the
 * task_type_tag catalog for every engineering task insert.
 */
describe("task_type_tag write-helper guard", () => {
  it("accepts a valid delivery tag, a valid seam tag, and null", () => {
    expect(buildEngineeringTaskInsert({ title: "x", taskTypeTag: "ifc_pack" }, 1).taskTypeTag).toBe("ifc_pack");
    expect(buildEngineeringTaskInsert({ title: "x", taskTypeTag: "compliance_input" }, 1).taskTypeTag).toBe("compliance_input");
    expect(buildEngineeringTaskInsert({ title: "x" }, 1).taskTypeTag).toBeNull();
  });

  it("rejects an unknown task_type_tag", () => {
    expect(() => buildEngineeringTaskInsert({ title: "x", taskTypeTag: "bogus_tag" }, 1)).toThrow(/task type/i);
  });
});
