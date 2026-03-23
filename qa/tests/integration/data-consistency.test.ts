import { describe, it, expect, beforeAll, afterAll } from "vitest";

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

describe("Integration: Data Consistency Across Views", () => {
  let token: string;
  let createdTaskId: number;
  let createdWorkItemId: number;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  afterAll(async () => {
    // Cleanup: delete the test task
    if (createdTaskId && token) {
      await apiRequest("DELETE", `/api/eng/tasks/${createdTaskId}`, undefined, token);
    }
  });

  it("creating a task via API makes it appear in task list", async () => {
    const createRes = await apiRequest("POST", "/api/eng/tasks", {
      title: "Integration Test Task — Data Consistency",
      status: "TO DO",
      priority: "Med",
    }, token);
    expect(createRes.status).toBe(200);
    createdTaskId = createRes.data?.id || createRes.data?.workItemId;
    createdWorkItemId = createRes.data?.workItemId || createRes.data?.id;
    expect(createdTaskId).toBeTruthy();

    // Verify it appears in task list
    const listRes = await apiRequest("GET", "/api/eng/tasks", undefined, token);
    expect(listRes.status).toBe(200);
    const found = listRes.data?.find((t: any) => t.id === createdTaskId || t.workItemId === createdWorkItemId);
    expect(found).toBeTruthy();
    expect(found?.title).toContain("Integration Test Task");
  });

  it("created task appears in standup dashboard data", async () => {
    const standupRes = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    expect(standupRes.status).toBe(200);
    // The task should contribute to total count
    expect(standupRes.data?.summary?.totalTasks).toBeGreaterThan(0);
  });

  it("updating status via API reflects in task detail", async () => {
    const patchRes = await apiRequest("PATCH", `/api/eng/tasks/${createdTaskId}`, {
      status: "IN PROGRESS",
    }, token);
    expect(patchRes.status).toBe(200);

    // Verify detail shows updated status
    const detailRes = await apiRequest("GET", `/api/eng/tasks/${createdTaskId}`, undefined, token);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data?.status).toBe("IN PROGRESS");
  });

  it("adding a comment to the task can be retrieved", async () => {
    const commentRes = await apiRequest("POST", `/api/eng/tasks/${createdTaskId}/comments`, {
      body: "Integration test comment",
    }, token);
    expect(commentRes.status).toBe(200);

    const commentsRes = await apiRequest("GET", `/api/eng/tasks/${createdTaskId}/comments`, undefined, token);
    expect(commentsRes.status).toBe(200);
    expect(commentsRes.data?.length).toBeGreaterThan(0);
    expect(commentsRes.data?.some((c: any) => c.body.includes("Integration test comment"))).toBe(true);
  });

  it("activity log records the status change", async () => {
    const activityRes = await apiRequest("GET", `/api/eng/tasks/${createdTaskId}/activity`, undefined, token);
    expect(activityRes.status).toBe(200);
    expect(activityRes.data?.length).toBeGreaterThan(0);
  });

  it("deleting the task removes it from task list", async () => {
    const deleteRes = await apiRequest("DELETE", `/api/eng/tasks/${createdTaskId}`, undefined, token);
    expect(deleteRes.status).toBe(200);

    const listRes = await apiRequest("GET", "/api/eng/tasks", undefined, token);
    expect(listRes.status).toBe(200);
    const found = listRes.data?.find((t: any) => t.id === createdTaskId || t.workItemId === createdWorkItemId);
    expect(found).toBeFalsy();

    // Mark as already deleted so afterAll doesn't try again
    createdTaskId = 0;
  });
});
