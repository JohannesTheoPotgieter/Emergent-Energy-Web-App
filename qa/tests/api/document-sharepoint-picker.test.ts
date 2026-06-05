/**
 * Runtime wiring check for the document SharePoint setup picker + the
 * per-project folders endpoint the connection card reads.
 *
 * Boots under the test:api harness (mock connectors), so these hit the
 * mock MS Graph fixtures. Verifies the new admin picker endpoints are
 * registered, auth-gated, and return the expected shapes.
 */
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

describe("API: SharePoint setup picker + project folders wiring", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("gates the picker endpoints behind auth", async () => {
    const res = await apiRequest("GET", "/api/admin/sharepoint/sites");
    expect([401, 403]).toContain(res.status);
  });

  it("lists SharePoint sites", async () => {
    const res = await apiRequest("GET", "/api/admin/sharepoint/sites", undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.sites)).toBe(true);
    expect(res.data.sites.length).toBeGreaterThan(0);
    expect(res.data.sites[0]).toHaveProperty("id");
    expect(res.data.sites[0]).toHaveProperty("displayName");
  });

  it("lists document libraries (drives) for a site", async () => {
    const sites = await apiRequest("GET", "/api/admin/sharepoint/sites", undefined, token);
    const siteId = sites.data.sites[0].id as string;
    const res = await apiRequest(
      "GET",
      `/api/admin/sharepoint/sites/${encodeURIComponent(siteId)}/drives`,
      undefined,
      token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.drives)).toBe(true);
    expect(res.data.drives.length).toBeGreaterThan(0);
    expect(res.data.drives[0]).toHaveProperty("id");
    expect(res.data.drives[0]).toHaveProperty("name");
  });

  it("browses folders in a drive (folders only, with id + name)", async () => {
    const drives = await apiRequest(
      "GET",
      "/api/admin/sharepoint/sites/site-ee-engineering/drives",
      undefined,
      token,
    );
    const driveId = drives.data.drives[0].id as string;
    const res = await apiRequest(
      "GET",
      `/api/admin/sharepoint/drives/${encodeURIComponent(driveId)}/folders`,
      undefined,
      token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.folders)).toBe(true);
    for (const f of res.data.folders) {
      expect(f).toHaveProperty("id");
      expect(f).toHaveProperty("name");
    }
  });

  it("serves per-project folders (the connection card data source)", async () => {
    const res = await apiRequest("GET", "/api/projects/1/folders", undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.folders)).toBe(true);
  });
});
