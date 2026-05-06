import { describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function login(username: string, password: string) {
  const res = await apiRequest("POST", "/api/auth/login", { username, password });
  return { status: res.status, token: res.data?.token, data: res.data };
}

describe("API: my-work task assignment", () => {
  it("reassigns a personal task and persists to assignee inbox", async () => {
    const admin = await login("johannes", "2023");
    expect(admin.status).toBe(200);

    const stamp = Date.now();
    const created = await apiRequest("POST", "/api/mytool/tasks", { title: `Assignment E2E ${stamp}`, priority: "normal", status: "todo" }, admin.token);
    expect(created.status).toBe(201);
    const taskId = created.data?.id;
    expect(taskId).toBeTruthy();

    const assignable = await apiRequest("GET", "/api/users/assignable", undefined, admin.token);
    expect(assignable.status).toBe(200);
    const target = (assignable.data || []).find((u: any) => u.username === "eon");
    expect(target?.id).toBeTruthy();

    const reassign = await apiRequest("PATCH", "/api/tasks/reassign", { taskId, taskSource: "personal", userId: target.id }, admin.token);
    expect(reassign.status).toBe(200);

    const targetLogin = await login("eon", "2035");
    expect(targetLogin.status).toBe(200);
    const myTasks = await apiRequest("GET", "/api/my-work/all-tasks", undefined, targetLogin.token);
    expect(myTasks.status).toBe(200);

    const found = (myTasks.data?.personal || []).some((t: any) => t.id === taskId && (t.title || "").includes("Assignment E2E"));
    expect(found).toBe(true);
  });

  it("accepts canonical internal assignment payload and returns normalized assignment", async () => {
    const admin = await login("johannes", "2023");
    expect(admin.status).toBe(200);

    const created = await apiRequest("POST", "/api/mytool/tasks", { title: `Canonical Assignment ${Date.now()}`, priority: "normal", status: "todo" }, admin.token);
    expect(created.status).toBe(201);

    const assignable = await apiRequest("GET", "/api/users/assignable", undefined, admin.token);
    expect(assignable.status).toBe(200);
    const target = (assignable.data || []).find((u: any) => u.username === "eon") || (assignable.data || [])[0];
    expect(target?.id).toBeTruthy();

    const reassign = await apiRequest(
      "PATCH",
      "/api/tasks/reassign",
      { taskId: created.data.id, taskSource: "personal", assigneeType: "internal_user", assigneeId: target.id },
      admin.token,
    );

    expect(reassign.status).toBe(200);
    expect(reassign.data?.assignment?.assigneeType).toBe("internal_user");
    expect(reassign.data?.assignment?.assigneeId).toBe(target.id);
    expect(reassign.data?.assignment?.source).toBe("internal");
  });

  it("rejects invalid assignee type", async () => {
    const admin = await login("johannes", "2023");
    expect(admin.status).toBe(200);

    const created = await apiRequest("POST", "/api/mytool/tasks", { title: `Invalid Assignment ${Date.now()}`, priority: "normal", status: "todo" }, admin.token);
    expect(created.status).toBe(201);

    const reassign = await apiRequest(
      "PATCH",
      "/api/tasks/reassign",
      { taskId: created.data.id, taskSource: "personal", assigneeType: "invalid_type", assigneeId: 1 },
      admin.token,
    );

    expect(reassign.status).toBe(400);
  });

});
