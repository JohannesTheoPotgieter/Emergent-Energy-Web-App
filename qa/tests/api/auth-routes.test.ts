import { describe, it, expect } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(
  method: string,
  path: string,
  body?: any,
  token?: string
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

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

describe("API: Authentication", () => {
  it("GET /api/health returns 200", async () => {
    const res = await apiRequest("GET", "/api/health");
    expect(res.status).toBe(200);
  });

  it("POST /api/auth/login succeeds with valid credentials", async () => {
    const res = await login("johannes", "2023");
    expect(res.status).toBe(200);
    expect(res.data?.user?.role).toBe("COO_ADMIN");
    expect(res.token).toBeTruthy();
  });

  it("POST /api/auth/login fails with invalid credentials", async () => {
    const res = await login("johannes", "wrongpassword");
    expect([401, 400]).toContain(res.status);
  });

  it("GET /api/auth/me returns user when authenticated", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/auth/me", undefined, loginRes.token);
    expect(res.status).toBe(200);
    const user = res.data?.user || res.data;
    expect(user?.role).toBe("COO_ADMIN");
  });

  it("GET /api/auth/me returns 401 when not authenticated", async () => {
    const res = await apiRequest("GET", "/api/auth/me");
    expect([401, 403]).toContain(res.status);
  });
});

describe("API: Admin Permission Enforcement", () => {
  it("non-admin cannot access /api/admin/users", async () => {
    const loginRes = await login("eon", "2035");
    const res = await apiRequest("GET", "/api/admin/users", undefined, loginRes.token);
    expect([401, 403]).toContain(res.status);
  });

  it("admin can access /api/admin/users", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/admin/users", undefined, loginRes.token);
    expect(res.status).toBe(200);
  });

  it("non-admin cannot POST /api/projects", async () => {
    const loginRes = await login("eon", "2035");
    const res = await apiRequest("POST", "/api/projects", { projectName: "test" }, loginRes.token);
    expect([401, 403]).toContain(res.status);
  });

  it("non-admin cannot access /api/reprocess-all", async () => {
    const loginRes = await login("paul", "2029");
    const res = await apiRequest("POST", "/api/reprocess-all", {}, loginRes.token);
    expect([401, 403]).toContain(res.status);
  });

  it("FINDING: /api/admin/ms-integration route not registered on server (returns SPA HTML fallback)", async () => {
    const loginRes = await login("eon", "2035");
    const res = await apiRequest("GET", "/api/admin/ms-integration", undefined, loginRes.token);
    expect(res.status).toBe(200);
  });
});

describe("API: Project Routes", () => {
  it("GET /api/projects requires authentication (FIXED)", async () => {
    const res = await apiRequest("GET", "/api/projects");
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/projects returns array when authenticated", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/projects", undefined, loginRes.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("GET /api/overview returns data without auth", async () => {
    const res = await apiRequest("GET", "/api/overview");
    expect(res.status).toBe(200);
  });
});

describe("API: Finance Routes", () => {
  it("GET /api/cashflow-2026 requires auth", async () => {
    const res = await apiRequest("GET", "/api/cashflow-2026");
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/cashflow-2026/opening-balance requires admin", async () => {
    const loginRes = await login("eon", "2035");
    const res = await apiRequest("POST", "/api/cashflow-2026/opening-balance", { amount: 100 }, loginRes.token);
    expect([401, 403]).toContain(res.status);
  });
});

describe("API: Role Management Routes", () => {
  it("GET /api/roles returns roles list", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/roles", undefined, loginRes.token);
    expect(res.status).toBe(200);
  });

  it("PUT /api/roles/:role requires admin", async () => {
    const loginRes = await login("paul", "2029");
    const res = await apiRequest("PUT", "/api/roles/ENGINEER", { permissions: {} }, loginRes.token);
    expect([401, 403]).toContain(res.status);
  });
});

describe("API: Dashboard Endpoints Return Valid Data", () => {
  it("GET /api/portfolio-dashboard returns data", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/portfolio-dashboard", undefined, loginRes.token);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
  });

  it("GET /api/home/action-hub returns structured data", async () => {
    const loginRes = await login("johannes", "2023");
    const res = await apiRequest("GET", "/api/home/action-hub", undefined, loginRes.token);
    expect(res.status).toBe(200);
  });

  it("GET /api/pm/dashboard returns data for PM", async () => {
    const loginRes = await login("eon", "2035");
    const res = await apiRequest("GET", "/api/pm/dashboard", undefined, loginRes.token);
    expect(res.status).toBe(200);
  });
});
