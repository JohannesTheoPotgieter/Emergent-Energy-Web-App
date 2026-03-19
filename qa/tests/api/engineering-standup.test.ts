import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function loginAdmin() {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

describe("API: Engineering Standup Dashboard", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("GET /api/eng/dashboard/standup returns correct response shape", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    expect(res.status).toBe(200);

    // Top-level keys
    expect(res.data).toHaveProperty("date");
    expect(res.data).toHaveProperty("summary");
    expect(res.data).toHaveProperty("recentlyCompleted");
    expect(res.data).toHaveProperty("blockers");
    expect(res.data).toHaveProperty("upcomingThisWeek");
    expect(res.data).toHaveProperty("needsApproval");
    expect(res.data).toHaveProperty("inProgressHighlights");
    expect(res.data).toHaveProperty("workload");
    expect(res.data).toHaveProperty("projectHealth");
    expect(res.data).toHaveProperty("statusPipeline");
  });

  it("summary contains all required counts", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    const summary = res.data?.summary;

    expect(typeof summary?.totalProjects).toBe("number");
    expect(typeof summary?.totalTasks).toBe("number");
    expect(typeof summary?.activeTasks).toBe("number");
    expect(typeof summary?.completedTasks).toBe("number");
    expect(typeof summary?.overdueTasks).toBe("number");
    expect(typeof summary?.holdTasks).toBe("number");
    expect(typeof summary?.recentlyCompletedCount).toBe("number");
    expect(typeof summary?.upcomingThisWeekCount).toBe("number");
    expect(typeof summary?.needsApprovalCount).toBe("number");
  });

  it("blockers has hold and overdue arrays", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    expect(Array.isArray(res.data?.blockers?.hold)).toBe(true);
    expect(Array.isArray(res.data?.blockers?.overdue)).toBe(true);
  });

  it("projectHealth entries have required fields", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    const health = res.data?.projectHealth;
    if (health && health.length > 0) {
      const first = health[0];
      expect(first).toHaveProperty("projectName");
      expect(first).toHaveProperty("phase");
      expect(first).toHaveProperty("total");
      expect(first).toHaveProperty("completed");
      expect(first).toHaveProperty("overdue");
      expect(first).toHaveProperty("rag");
      expect(["GREEN", "AMBER", "RED"]).toContain(first.rag);
    }
  });

  it("statusPipeline is an object mapping status to count", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    const pipeline = res.data?.statusPipeline;
    expect(typeof pipeline).toBe("object");
    for (const [key, value] of Object.entries(pipeline || {})) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
    }
  });

  it("supports assignee query filter", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup?assignee=Johannes", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data?.summary).toBeTruthy();
  });

  it("overdue/hold counts match actual items", async () => {
    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    const summary = res.data?.summary;
    const blockers = res.data?.blockers;

    if (summary && blockers) {
      expect(summary.holdTasks).toBe(blockers.hold.length);
      // Overdue count in summary matches overdue items (max 20 shown)
      expect(summary.overdueTasks).toBeGreaterThanOrEqual(blockers.overdue.length);
    }
  });

  it("data comes from work_items (canonical flag present on task list)", async () => {
    const tasks = await apiRequest("GET", "/api/eng/tasks", undefined, token);
    expect(tasks.status).toBe(200);
    if (tasks.data && tasks.data.length > 0) {
      // After migration, all tasks should have canonical: true
      expect(tasks.data[0]).toHaveProperty("canonical");
      expect(tasks.data[0].canonical).toBe(true);
    }
  });
});
