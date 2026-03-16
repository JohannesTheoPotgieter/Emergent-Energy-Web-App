import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  selectQueue: [] as any[],
  inserts: [] as Array<{ table: any; values: any }>,
};

function nextSelect() {
  const value = state.selectQueue.shift();
  return value ?? [];
}

vi.mock("../../../server/db", () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => nextSelect()),
      })),
    })),
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: any) => {
        state.inserts.push({ table, values });
        return {
          returning: vi.fn(async () => [Array.isArray(values) ? values[0] : { id: 9001, ...(values || {}) }]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
  };
  return { db };
});

describe("project linking microsoft follow-ups", () => {
  beforeEach(() => {
    state.selectQueue = [];
    state.inserts = [];
  });

  it("builds stable dedupe key", async () => {
    const mod = await import("../../../server/project-linking-service");
    expect(mod.buildFollowUpDedupeKey(10, 20, "  Review Client Email ")).toBe("10:20:review client email");
  });

  it("prevents duplicate follow-up creation", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 1, userId: 7, linkedProjectId: 2, subjectOrTitle: "Kickoff", webLink: null, senderOrOrganizer: null }]);
    state.selectQueue.push([{ id: 77, dedupeKey: "existing" }]);

    await expect(mod.createFollowUpTaskFromCommunication({ msObjectId: 1, userId: 7 })).rejects.toThrow(
      "Follow-up already exists for this communication",
    );
  });

  it("enforces user scoping when creating follow-up", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 1, userId: 42, linkedProjectId: 2, subjectOrTitle: "Kickoff", webLink: null, senderOrOrganizer: null }]);

    await expect(mod.createFollowUpTaskFromCommunication({ msObjectId: 1, userId: 7 })).rejects.toThrow(
      "You can only create follow-up tasks from your own items",
    );
  });



  it("links an email to project and writes timeline event", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 1, userId: 7, type: "email", subjectOrTitle: "Client update" }]);
    state.selectQueue.push([{ role: "PROGRAM_MANAGER", name: "Alex" }]);
    state.selectQueue.push([{ pm: "Alex", pd: "Taylor", pmUserId: 7, pdUserId: 8 }]);
    state.selectQueue.push([{ id: 55 }]);

    await mod.tagToProject(1, 55, 7, "Important thread");

    const linkInsert = state.inserts.find((i) => (i.values as any)?.projectId === 55 && (i.values as any)?.msObjectId === 1);
    const timelineInsert = state.inserts.find((i) => (i.values as any)?.eventType === "email_linked");
    expect(linkInsert).toBeTruthy();
    expect(timelineInsert).toBeTruthy();
  });

  it("links a meeting to project and writes meeting timeline event", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 2, userId: 7, type: "event", subjectOrTitle: "Weekly review" }]);
    state.selectQueue.push([{ role: "PROGRAM_MANAGER", name: "Alex" }]);
    state.selectQueue.push([{ pm: "Alex", pd: "Taylor", pmUserId: 7, pdUserId: 8 }]);
    state.selectQueue.push([{ id: 55 }]);

    await mod.tagToProject(2, 55, 7);

    const timelineInsert = state.inserts.find((i) => (i.values as any)?.eventType === "meeting_linked");
    expect(timelineInsert).toBeTruthy();
  });

  it("blocks linking when user lacks project access", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 2, userId: 7, type: "event", subjectOrTitle: "Weekly review" }]);
    state.selectQueue.push([{ role: "USER", name: "Sam" }]);
    state.selectQueue.push([{ pm: "Alex", pd: "Taylor", pmUserId: 17, pdUserId: 18 }]);

    await expect(mod.tagToProject(2, 55, 7)).rejects.toThrow("You don't have access to this project");
  });

  it("creates project timeline event when follow-up is created", async () => {
    const mod = await import("../../../server/project-linking-service");
    state.selectQueue.push([{ id: 3, userId: 7, linkedProjectId: 55, subjectOrTitle: "Design review", webLink: "https://outlook", senderOrOrganizer: "PM" }]);
    state.selectQueue.push([]);
    state.selectQueue.push([{ projectName: "Apollo" }]);

    await mod.createFollowUpTaskFromCommunication({ msObjectId: 3, userId: 7, title: "Review actions" });

    const timelineInsert = state.inserts.find((i) => (i.values as any)?.eventType === "follow_up_created");
    expect(timelineInsert).toBeTruthy();
  });
});
