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

const ADMIN_USERNAME = process.env.ADMIN_TEST_USERNAME || "dayne";
const ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD || "TestPassword123!";

describe("API: Plan tab inline link unlinked operational tasks", () => {
  it("returns unlinkedOperationalTasks and decrements count after linking", async () => {
    const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    if (admin.status !== 200 || !admin.token) {
      console.warn("[plan-link-unlinked-ops] admin login unavailable; skipping");
      return;
    }

    const projectsRes = await apiRequest("GET", "/api/projects", undefined, admin.token);
    expect(projectsRes.status).toBe(200);
    const projects: any[] = projectsRes.data || [];
    expect(projects.length).toBeGreaterThan(0);

    let projectName: string | null = null;
    let initialCount = 0;
    let initialUnlinked: any[] = [];
    let planRowId: number | null = null;

    for (const p of projects) {
      const name = p.projectName || p.name;
      if (!name) continue;
      const planRes = await apiRequest("GET", `/api/planning-tasks/${encodeURIComponent(name)}`, undefined, admin.token);
      if (planRes.status !== 200) continue;
      const unlinked: any[] = planRes.data?.unlinkedOperationalTasks || [];
      const planTasks: any[] = planRes.data?.planTasks || planRes.data?.tasks || [];
      const baselinePlanRows = planTasks.filter((t: any) => !t.isVirtualMilestone && (t.workItemId || t.id));
      if (unlinked.length > 0 && baselinePlanRows.length > 0) {
        projectName = name;
        initialUnlinked = unlinked;
        initialCount = planRes.data?.unlinkedOperationalCount ?? unlinked.length;
        planRowId = baselinePlanRows[0].workItemId ?? baselinePlanRows[0].id;
        break;
      }
    }

    if (!projectName || planRowId == null || initialUnlinked.length === 0) {
      console.warn("[plan-link-unlinked-ops] no eligible project with unlinked tasks; skipping live assertions");
      return;
    }

    const target = initialUnlinked[0];
    expect(target.workItemId).toBeTruthy();
    expect(target.title).toBeTruthy();

    const patchRes = await apiRequest(
      "PATCH",
      `/api/operational-tasks/${target.workItemId}`,
      { importedTaskId: planRowId },
      admin.token,
    );
    expect(patchRes.status).toBe(200);

    const after = await apiRequest("GET", `/api/planning-tasks/${encodeURIComponent(projectName)}`, undefined, admin.token);
    expect(after.status).toBe(200);
    const newCount = after.data?.unlinkedOperationalCount ?? 0;
    const newUnlinked: any[] = after.data?.unlinkedOperationalTasks || [];

    expect(newCount).toBe(initialCount - 1);
    expect(newUnlinked.find((u: any) => u.workItemId === target.workItemId)).toBeUndefined();
  });

  it("rejects link request from non-admin user", async () => {
    const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    if (admin.status !== 200 || !admin.token) {
      console.warn("[plan-link-unlinked-ops] admin login unavailable; skipping");
      return;
    }

    const projectsRes = await apiRequest("GET", "/api/projects", undefined, admin.token);
    const projects: any[] = projectsRes.data || [];
    let target: any = null;
    let planRowId: number | null = null;
    for (const p of projects) {
      const name = p.projectName || p.name;
      if (!name) continue;
      const planRes = await apiRequest("GET", `/api/planning-tasks/${encodeURIComponent(name)}`, undefined, admin.token);
      if (planRes.status !== 200) continue;
      const unlinked: any[] = planRes.data?.unlinkedOperationalTasks || [];
      const planTasks: any[] = planRes.data?.planTasks || planRes.data?.tasks || [];
      const baselinePlanRows = planTasks.filter((t: any) => !t.isVirtualMilestone);
      if (unlinked.length > 0 && baselinePlanRows.length > 0) {
        target = unlinked[0];
        planRowId = baselinePlanRows[0].id ?? baselinePlanRows[0].workItemId;
        break;
      }
    }
    if (!target || planRowId == null) {
      console.warn("[plan-link-unlinked-ops] no eligible task for non-admin assertion; skipping");
      return;
    }

    const eng = await login("paul", "2029");
    if (eng.status !== 200 || !eng.token) {
      console.warn("[plan-link-unlinked-ops] non-admin login unavailable; skipping");
      return;
    }

    const patchRes = await apiRequest(
      "PATCH",
      `/api/operational-tasks/${target.workItemId}`,
      { importedTaskId: planRowId },
      eng.token,
    );
    expect([401, 403]).toContain(patchRes.status);
  });
});
