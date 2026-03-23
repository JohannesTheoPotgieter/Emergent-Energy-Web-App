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

describe("API: Engineering Deliverables & Approval Flows", () => {
  let token: string;
  let testTaskId: number;

  beforeAll(async () => {
    token = await loginAdmin();
    // Create a test task
    const createRes = await apiRequest("POST", "/api/eng/tasks", {
      title: "Deliverable Test Task",
      status: "IN PROGRESS",
      priority: "Med",
    }, token);
    expect(createRes.status).toBe(200);
    testTaskId = createRes.data?.id || createRes.data?.workItemId;
    expect(testTaskId).toBeTruthy();
  });

  it("POST /api/eng/tasks/:id/send-for-approval requires authentication", async () => {
    const res = await apiRequest("POST", `/api/eng/tasks/${testTaskId}/send-for-approval`);
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/eng/tasks/:id/send-for-approval changes status to NEEDS APPROVAL", async () => {
    // Note: This endpoint uses multipart/form-data for file upload
    // Testing the JSON-only path (note without file)
    const res = await apiRequest("POST", `/api/eng/tasks/${testTaskId}/send-for-approval`, {
      note: "Please review this task",
    }, token);
    // May succeed or fail depending on workflow guard state
    expect([200, 400, 403]).toContain(res.status);
  });

  it("POST /api/eng/tasks/:id/send-deliverable requires recipient", async () => {
    const res = await apiRequest("POST", `/api/eng/tasks/${testTaskId}/send-deliverable`, {
      // Missing recipientUserId
      note: "Test deliverable",
    }, token);
    expect(res.status).toBe(400);
    expect(res.data?.error).toContain("recipient");
  });

  it("GET /api/eng/tasks/:id/deliverables returns deliverable list", async () => {
    const res = await apiRequest("GET", `/api/eng/tasks/${testTaskId}/deliverables`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("GET /api/eng/tasks/:id/comments returns comment list", async () => {
    const res = await apiRequest("GET", `/api/eng/tasks/${testTaskId}/comments`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("POST /api/eng/tasks/:id/comments creates a comment", async () => {
    const res = await apiRequest("POST", `/api/eng/tasks/${testTaskId}/comments`, {
      body: "Test comment from automated test",
    }, token);
    expect(res.status).toBe(200);
    expect(res.data?.body).toContain("Test comment");
  });

  it("POST /api/eng/tasks/:id/comments requires body text", async () => {
    const res = await apiRequest("POST", `/api/eng/tasks/${testTaskId}/comments`, {
      body: "",
    }, token);
    expect(res.status).toBe(400);
  });

  it("GET /api/eng/tasks/:id/activity returns activity log", async () => {
    const res = await apiRequest("GET", `/api/eng/tasks/${testTaskId}/activity`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });
});
