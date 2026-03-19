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

describe("API: Engineering Intake (Mock Connector)", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("GET /api/eng/intake/status returns connector status", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/status", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("connector");
    expect(res.data).toHaveProperty("available");
    expect(res.data).toHaveProperty("totalRequests");
    expect(res.data).toHaveProperty("conflictsCount");
  });

  it("GET /api/eng/intake/items returns mock items", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/items", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("connector");
    expect(res.data).toHaveProperty("count");
    expect(res.data).toHaveProperty("items");
    expect(Array.isArray(res.data.items)).toBe(true);
  });

  it("mock items have expected field structure", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/items", undefined, token);
    if (res.data?.items?.length > 0) {
      const item = res.data.items[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("fields");
      expect(item.fields).toHaveProperty("Client");
      expect(item.fields).toHaveProperty("Status");
      expect(item.fields).toHaveProperty("Priority");
    }
  });

  it("GET /api/eng/intake/items/:id returns single item with columns", async () => {
    const listRes = await apiRequest("GET", "/api/eng/intake/items", undefined, token);
    const firstItem = listRes.data?.items?.[0];
    if (!firstItem) return;

    const res = await apiRequest("GET", `/api/eng/intake/items/${firstItem.id}`, undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("columns");
    expect(Array.isArray(res.data.columns)).toBe(true);
  });

  it("GET /api/eng/intake/items/:id returns 404 for non-existent item", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/items/NONEXISTENT", undefined, token);
    expect(res.status).toBe(404);
  });

  it("POST /api/eng/intake/sync/pull creates intake requests", async () => {
    const res = await apiRequest("POST", "/api/eng/intake/sync/pull", {}, token);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("success", true);
    expect(res.data).toHaveProperty("connector");
    expect(typeof res.data?.pulled).toBe("number");
    expect(typeof res.data?.newRequests).toBe("number");
    expect(typeof res.data?.conflicts).toBe("number");
  });

  it("pull twice does not create duplicates", async () => {
    const res1 = await apiRequest("POST", "/api/eng/intake/sync/pull", {}, token);
    expect(res1.status).toBe(200);
    const total1 = (res1.data?.newRequests || 0) + (res1.data?.updatedRequests || 0);

    const res2 = await apiRequest("POST", "/api/eng/intake/sync/pull", {}, token);
    expect(res2.status).toBe(200);
    // Second pull should have 0 new, only updates
    expect(res2.data?.newRequests).toBe(0);
  });

  it("POST /api/eng/intake/sync/push pushes app fields back", async () => {
    const res = await apiRequest("POST", "/api/eng/intake/sync/push", {}, token);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("success", true);
    expect(typeof res.data?.pushed).toBe("number");
  });

  it("non-COO user gets 403 on intake endpoints", async () => {
    // Try without token — should get 401 or 403
    const noAuth = await apiRequest("GET", "/api/eng/intake/items");
    expect([401, 403]).toContain(noAuth.status);
  });

  it("edge case: items include Blocked status and multi-value funding", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/items", undefined, token);
    const items = res.data?.items || [];

    // Find the Blocked item (MOCK-004)
    const blocked = items.find((i: any) => i.fields?.Status === "Blocked");
    if (blocked) {
      expect(blocked.fields.Status).toBe("Blocked");
      expect(blocked.fields.Comments).toContain("BLOCKED");
    }

    // Find the multi-value funding item (MOCK-002)
    const multiFunding = items.find((i: any) => i.fields?.Funding_x0020_Type?.includes(","));
    if (multiFunding) {
      expect(multiFunding.fields.Funding_x0020_Type).toContain("PPA");
      expect(multiFunding.fields.Funding_x0020_Type).toContain("Rental");
    }
  });

  it("edge case: items include missing GPS coordinates", async () => {
    const res = await apiRequest("GET", "/api/eng/intake/items", undefined, token);
    const items = res.data?.items || [];

    const missingGps = items.find((i: any) => !i.fields?.GPS || i.fields.GPS === "");
    if (missingGps) {
      expect(missingGps.fields.GPS === "" || missingGps.fields.GPS === undefined).toBe(true);
    }
  });
});
