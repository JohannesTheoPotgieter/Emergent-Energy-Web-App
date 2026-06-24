import { describe, it, expect } from "vitest";
import {
  buildEngineeringTaskInsert,
  buildBulkEngineeringTaskInserts,
  buildSeamHandoffInsert,
  buildStatusHistoryInsert,
  DEFAULT_TASK_STATUS,
} from "../../../server/lib/engineering/task-builders";
import { ENGINEERING_TASK_TYPE_LABELS } from "@shared/engineering/delivery-task-catalog";

describe("engineering task builders", () => {
  it("builds a spine ENG work-item insert with sane defaults", () => {
    const insert = buildEngineeringTaskInsert({ title: "  Issue IFC pack  ", taskTypeTag: "ifc_pack" }, 42);
    expect(insert).toMatchObject({
      workstream: "ENG",
      source: "UI",
      title: "Issue IFC pack", // trimmed
      taskTypeTag: "ifc_pack",
      status: DEFAULT_TASK_STATUS,
      createdBy: 42,
      ownerUserId: null,
      projectId: null,
    });
  });

  it("bulk builds one task per catalog type, titled from the catalog label", () => {
    const inserts = buildBulkEngineeringTaskInserts(
      { projectId: 7, taskTypeTags: ["ifc_pack", "as_built"], ownerUserId: 9, dueDate: "2026-07-01" },
      42,
    );
    expect(inserts).toHaveLength(2);
    expect(inserts.map((i) => i.taskTypeTag)).toEqual(["ifc_pack", "as_built"]);
    expect(inserts[0].title).toBe(ENGINEERING_TASK_TYPE_LABELS.ifc_pack);
    expect(inserts.every((i) => i.projectId === 7 && i.ownerUserId === 9 && i.endDate === "2026-07-01")).toBe(true);
    expect(inserts.every((i) => i.workstream === "ENG" && i.createdBy === 42)).toBe(true);
  });

  it("builds a seam handoff as a tracked ENG item owned by the recipient", () => {
    const insert = buildSeamHandoffInsert(
      { seamType: "compliance_input", toOwnerUserId: 5, title: "SSEG input for Site A", note: "Need grid form", projectId: 3, dueDate: "2026-07-10" },
      42,
    );
    expect(insert).toMatchObject({
      workstream: "ENG",
      taskTypeTag: "compliance_input",
      ownerUserId: 5, // the recipient owns it
      projectId: 3,
      endDate: "2026-07-10",
      description: "Need grid form",
      createdBy: 42,
    });
  });

  it("builds a status-history record", () => {
    expect(buildStatusHistoryInsert(11, "in_progress", "complete", 42, "done")).toEqual({
      workItemId: 11,
      oldStatus: "in_progress",
      newStatus: "complete",
      changedBy: 42,
      reason: "done",
    });
    expect(buildStatusHistoryInsert(11, null, "not_started", 42).reason).toBeNull();
  });
});
