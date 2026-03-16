import { describe, it, expect } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function loginAdmin() {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  expect(res.data?.token).toBeTruthy();
  return res.data.token as string;
}

describe("API: Engineering tasks canonical work_items source", () => {
  it("GET /api/eng/dashboard/standup loads current standup dashboard data", async () => {
    const token = await loginAdmin();

    const res = await apiRequest("GET", "/api/eng/dashboard/standup", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data?.summary).toBeTruthy();
    expect(typeof res.data?.summary?.totalTasks).toBe("number");
    expect(Array.isArray(res.data?.blockers?.hold)).toBe(true);
    expect(Array.isArray(res.data?.blockers?.overdue)).toBe(true);
    expect(Array.isArray(res.data?.workload)).toBe(true);
    expect(res.data?.statusPipeline).toBeTruthy();
  });

  it("POST/PATCH/DELETE /api/eng/tasks operates with canonical identifiers", async () => {
    const token = await loginAdmin();

    const projects = await apiRequest("GET", "/api/projects", undefined, token);
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.data)).toBe(true);
    const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
    expect(projectId).toBeTruthy();

    const title = `Canonical eng task ${Date.now()}`;
    const created = await apiRequest("POST", "/api/eng/tasks", {
      title,
      projectId,
      status: "TO DO",
      priority: "Med",
    }, token);
    expect(created.status).toBe(200);
    expect(created.data?.workItemId || created.data?.id).toBeTruthy();
    const taskId = created.data.workItemId || created.data.id;

    const patched = await apiRequest("PATCH", `/api/eng/tasks/${taskId}`, {
      status: "IN PROGRESS",
      priority: "High",
    }, token);
    expect(patched.status).toBe(200);

    const listing = await apiRequest("GET", `/api/eng/tasks?projectId=${projectId}`, undefined, token);
    expect(listing.status).toBe(200);
    const matches = (listing.data || []).filter((t: any) => t.title === title);
    expect(matches.length).toBe(1);

    const deleted = await apiRequest("DELETE", `/api/eng/tasks/${taskId}`, undefined, token);
    expect(deleted.status).toBe(200);
  });

  it("GET /api/eng/tasks resolves canonical assignment and traceability context", async () => {
    const token = await loginAdmin();

    const projects = await apiRequest("GET", "/api/projects", undefined, token);
    expect(projects.status).toBe(200);
    const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
    expect(projectId).toBeTruthy();

    const title = `Engineering traceability ${Date.now()}`;
    const created = await apiRequest("POST", "/api/eng/tasks", {
      title,
      projectId,
      status: "IN PROGRESS",
      priority: "High",
    }, token);
    expect(created.status).toBe(200);
    const taskId = created.data?.workItemId || created.data?.id;
    expect(taskId).toBeTruthy();

    try {
      const assignable = await apiRequest("GET", "/api/users/assignable", undefined, token);
      expect(assignable.status).toBe(200);
      const target = (assignable.data || []).find((user: any) => user.username === "eon") || (assignable.data || [])[0];
      expect(target?.id).toBeTruthy();

      const reassigned = await apiRequest(
        "PATCH",
        "/api/tasks/reassign",
        { taskId, taskSource: "plan", assigneeType: "internal_user", assigneeId: target.id },
        token,
      );
      expect(reassigned.status).toBe(200);

      const listing = await apiRequest("GET", `/api/eng/tasks?projectId=${projectId}`, undefined, token);
      expect(listing.status).toBe(200);
      const match = (listing.data || []).find((task: any) => (task.workItemId || task.id) === taskId);

      expect(match).toBeTruthy();
      expect(match.projectId).toBe(projectId);
      expect(match.assigneeUserIds).toContain(target.id);
      expect(Array.isArray(match.assignees)).toBe(true);
      expect(match.assignees.length).toBeGreaterThan(0);
      expect(Array.isArray(match.resolvedAssignees)).toBe(true);
      expect(match.resolvedAssignees.some((user: any) => user.id === target.id)).toBe(true);
      expect(typeof match.isUnassigned).toBe("boolean");
      expect(typeof match.isBlocked).toBe("boolean");
      expect(typeof match.isReviewNeeded).toBe("boolean");
      expect(typeof match.isApprovalPending).toBe("boolean");
      expect(match.projectHref).toBeTruthy();
      expect(match.sourceHref).toBeTruthy();
      expect(typeof match.sourceContextLabel).toBe("string");
      expect(Array.isArray(match.projectLinkedDeliverables)).toBe(true);
      expect("deliverableContextHref" in match).toBe(true);
      expect(typeof match.hasMicrosoftContext).toBe("boolean");
      expect(typeof match.microsoftActionRequiredCount).toBe("number");
      expect(Array.isArray(match.relatedMicrosoftItems)).toBe(true);
    } finally {
      await apiRequest("DELETE", `/api/eng/tasks/${taskId}`, undefined, token);
    }
  });

  it("GET /api/projects/:projectId/eng-tasks returns project engineering tasks without duplicate merge behavior", async () => {
    const token = await loginAdmin();
    const projects = await apiRequest("GET", "/api/projects", undefined, token);
    const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;

    const res = await apiRequest("GET", `/api/projects/${projectId}/eng-tasks`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.tasks)).toBe(true);

    const ids = (res.data.tasks || []).map((t: any) => t.workItemId || t.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("POST /api/projects/:projectId/generate-eng-tasks writes canonical engineering task records", async () => {
    const token = await loginAdmin();
    const projects = await apiRequest("GET", "/api/projects", undefined, token);
    const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;

    const generated = await apiRequest("POST", `/api/projects/${projectId}/generate-eng-tasks`, {}, token);
    expect([200, 400]).toContain(generated.status);

    const listed = await apiRequest("GET", `/api/projects/${projectId}/eng-tasks`, undefined, token);
    expect(listed.status).toBe(200);
    for (const task of listed.data.tasks || []) {
      expect(task.workItemId || task.id).toBeTruthy();
    }
  });
});
