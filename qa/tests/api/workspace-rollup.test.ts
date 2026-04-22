import { describe, it, expect, beforeAll } from "vitest";

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
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function loginAdmin(): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

describe("API: workspace rollup contract (Task #34)", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("requires authentication", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup");
    expect([401, 403]).toContain(res.status);
  });

  it("returns the full payload contract: generatedAt, asOf, totals, rows, lists", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    expect(res.status).toBe(200);
    expect(typeof res.data.generatedAt).toBe("string");
    expect(typeof res.data.asOf).toBe("string");
    expect(res.data.totals).toBeDefined();
    expect(res.data.lists).toBeDefined();
    for (const k of [
      "opportunities", "linkedProjects", "linkedWorkItems",
      "projects", "spineGap", "cascadeAnomalies",
      "openPdTickets", "overduePdTickets",
      "openWorkItems", "blockedWorkItems", "overdueWorkItems",
      "openRaid",
      "ticketsDueThisWeek", "tasksDueThisWeek",
      "projectsWithoutTickets", "ticketsWithoutValidLinkage", "workItemsWithInvalidLinkage",
    ]) {
      expect(typeof res.data.totals[k]).toBe("number");
    }
    for (const k of [
      "projectsWithoutTickets",
      "ticketsWithoutValidLinkage",
      "workItemsWithInvalidLinkage",
      "ticketsDueThisWeek",
      "tasksDueThisWeek",
    ]) {
      expect(Array.isArray(res.data.lists[k])).toBe(true);
    }
    expect(Array.isArray(res.data.rows)).toBe(true);
  });

  it("accepts asOf, statusFilter, phaseFilter query params", async () => {
    const res = await apiRequest(
      "GET",
      "/api/project-development/workspace/rollup?asOf=2026-04-22&statusFilter=overdue&phaseFilter=Construction",
      undefined,
      token,
    );
    expect(res.status).toBe(200);
    expect(res.data.asOf).toBe("2026-04-22");
    expect(res.data.filters.statusFilter).toBe("overdue");
    expect(res.data.filters.phaseFilter).toBe("Construction");
  });

  it("is idempotent — repeated calls return the same shape and roughly equal counts", async () => {
    const a = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    const b = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.data.totals.projects).toBe(b.data.totals.projects);
    expect(a.data.totals.openPdTickets).toBe(b.data.totals.openPdTickets);
    expect(a.data.totals.openWorkItems).toBe(b.data.totals.openWorkItems);
    expect(a.data.rows.length).toBe(b.data.rows.length);
  });

  it("cascadeAnomalies derives from work_items pointing at missing/soft-deleted PD tickets", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data.totals.cascadeAnomalies).toBe(res.data.lists.workItemsWithInvalidLinkage.length);
  });
});
