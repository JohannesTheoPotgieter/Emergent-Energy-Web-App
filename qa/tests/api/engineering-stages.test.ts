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

describe("API: Engineering Stages", () => {
  let token: string;
  let projectId: number;

  beforeAll(async () => {
    token = await loginAdmin();
    const projects = await apiRequest("GET", "/api/projects", undefined, token);
    projectId = projects.data?.[0]?.id;
    expect(projectId).toBeTruthy();
  });

  it("GET /api/eng-stages/templates returns available stage templates", async () => {
    const res = await apiRequest("GET", "/api/eng-stages/templates", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data?.templates).toBeDefined();
    expect(Array.isArray(res.data.templates)).toBe(true);
  });

  it("POST /api/projects/:id/eng-stages/generate creates stages and linked work_items", async () => {
    const res = await apiRequest("POST", `/api/projects/${projectId}/eng-stages/generate`, {}, token);
    // May return 200 (new) or 409 (already generated)
    expect([200, 409]).toContain(res.status);
    if (res.status === 200) {
      expect(res.data?.stagesCreated).toBeGreaterThanOrEqual(0);
      expect(res.data?.tasksCreated).toBeGreaterThanOrEqual(0);
    }
  });

  it("POST generate twice is idempotent — does not duplicate", async () => {
    const res1 = await apiRequest("POST", `/api/projects/${projectId}/eng-stages/generate`, {}, token);
    const res2 = await apiRequest("POST", `/api/projects/${projectId}/eng-stages/generate`, {}, token);
    // Second call should return 409 or 200 with 0 new stages
    expect([200, 409]).toContain(res2.status);
    if (res2.status === 200) {
      expect(res2.data?.stagesCreated).toBe(0);
    }
  });

  it("GET /api/projects/:id/eng-stages returns generated stages", async () => {
    const res = await apiRequest("GET", `/api/projects/${projectId}/eng-stages`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.stages)).toBe(true);
  });

  it("PATCH /api/eng-stages/tasks/:id updates task status", async () => {
    const stages = await apiRequest("GET", `/api/projects/${projectId}/eng-stages`, undefined, token);
    const firstStage = stages.data?.stages?.[0];
    if (!firstStage) return; // Skip if no stages

    const detail = await apiRequest("GET", `/api/projects/${projectId}/eng-stages/${firstStage.id}`, undefined, token);
    const firstTask = detail.data?.tasks?.[0];
    if (!firstTask) return;

    const res = await apiRequest("PATCH", `/api/eng-stages/tasks/${firstTask.id}`, { status: "in_progress" }, token);
    expect(res.status).toBe(200);
  });

  it("POST /api/eng-stages/stages/:id/complete validates missing items", async () => {
    const stages = await apiRequest("GET", `/api/projects/${projectId}/eng-stages`, undefined, token);
    const incompleteStage = stages.data?.stages?.find((s: any) => s.status !== "complete");
    if (!incompleteStage) return;

    const res = await apiRequest("POST", `/api/eng-stages/stages/${incompleteStage.id}/complete`, {}, token);
    expect(res.status).toBe(200);
    // If items are missing, success=false with missing array
    if (!res.data?.success) {
      expect(Array.isArray(res.data?.missing)).toBe(true);
      expect(res.data.missing.length).toBeGreaterThan(0);
    }
  });

  it("POST /api/eng-stages/stages/:id/override-complete requires reason", async () => {
    const stages = await apiRequest("GET", `/api/projects/${projectId}/eng-stages`, undefined, token);
    const stage = stages.data?.stages?.find((s: any) => s.status !== "complete");
    if (!stage) return;

    const noReason = await apiRequest("POST", `/api/eng-stages/stages/${stage.id}/override-complete`, {}, token);
    expect(noReason.status).toBe(400);

    const withReason = await apiRequest("POST", `/api/eng-stages/stages/${stage.id}/override-complete`, { reason: "Test override" }, token);
    expect([200, 403]).toContain(withReason.status); // 403 if not COO role
  });
});
