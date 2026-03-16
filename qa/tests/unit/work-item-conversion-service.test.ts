import { describe, expect, it } from "vitest";
import {
  convertWorkItemTypeInPlace,
  type WorkItemRecord,
  type WorkItemConversionRepo,
} from "../../../server/services/work-item-conversion-service";

function createRepo(seed: WorkItemRecord[]): WorkItemConversionRepo & { rows: WorkItemRecord[] } {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    async getById(id: number) {
      const found = rows.find((r) => r.id === id);
      return found ? { ...found } : null;
    },
    async listByIds(ids: number[]) {
      return rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r }));
    },
    async patchById(id: number, patch: Partial<WorkItemRecord>) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error("missing row");
      rows[idx] = { ...rows[idx], ...patch };
    },
  };
}

function row(overrides: Partial<WorkItemRecord>): WorkItemRecord {
  return {
    id: overrides.id ?? 1,
    projectId: Object.prototype.hasOwnProperty.call(overrides, "projectId") ? (overrides.projectId as number | null) : 100,
    title: overrides.title ?? "Task",
    isMilestone: overrides.isMilestone ?? false,
    duration: overrides.duration ?? 3,
    indentLevel: overrides.indentLevel ?? 0,
    parentId: overrides.parentId ?? null,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-02T00:00:00.000Z"),
  };
}

describe("work-item conversion service", () => {
  it("converts task to milestone successfully in-place", async () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const repo = createRepo([
      row({ id: 11, title: "Parent task", isMilestone: false, duration: 5, indentLevel: 1 }),
      row({ id: 12, title: "Child A", indentLevel: 0 }),
      row({ id: 13, title: "Child B", indentLevel: 0 }),
    ]);

    const result = await convertWorkItemTypeInPlace({
      repo,
      workItemId: 11,
      target: "milestone",
      projectId: 100,
      subtaskWorkItemIds: [12, 13, 12],
      now,
    });

    expect(result.message).toBe("Converted to milestone");
    expect(repo.rows).toHaveLength(3);
    expect(repo.rows.find((r) => r.id === 11)?.isMilestone).toBe(true);
    expect(repo.rows.find((r) => r.id === 11)?.duration).toBe(0);
    expect(repo.rows.find((r) => r.id === 12)?.parentId).toBe(11);
    expect(repo.rows.find((r) => r.id === 12)?.indentLevel).toBe(2);
    expect(repo.rows.find((r) => r.id === 13)?.parentId).toBe(11);

    // Existing linked metadata remains intact on in-place conversion.
    expect(repo.rows.find((r) => r.id === 11)?.projectId).toBe(100);
    expect(repo.rows.find((r) => r.id === 11)?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("blocks conversion with clear reason when milestone fields are missing", async () => {
    const repo = createRepo([
      row({ id: 21, projectId: null, title: "", isMilestone: false }),
    ]);

    await expect(convertWorkItemTypeInPlace({
      repo,
      workItemId: 21,
      target: "milestone",
    })).rejects.toThrowError("Cannot convert to milestone: projectId is required, title is required");
  });

  it("preserves linked records and avoids duplicate records", async () => {
    const repo = createRepo([
      row({ id: 31, title: "Task before conversion", projectId: 222 }),
      row({ id: 32, title: "Linked item", projectId: 222 }),
    ]);

    const beforeIds = repo.rows.map((r) => r.id);
    await convertWorkItemTypeInPlace({
      repo,
      workItemId: 31,
      target: "milestone",
      projectId: 222,
      subtaskWorkItemIds: [32],
    });

    const afterIds = repo.rows.map((r) => r.id);
    expect(afterIds).toEqual(beforeIds);
    expect(new Set(afterIds).size).toBe(afterIds.length);
    expect(repo.rows.find((r) => r.id === 32)?.parentId).toBe(31);
  });
});
