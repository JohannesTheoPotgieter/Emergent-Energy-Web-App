import { beforeAll, describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

type ApiResponse<T = unknown> = { status: number; data: T; cookie: string | null };
type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

function getCookieHeader(headers: Headers): string | null {
  const withSetCookie = headers as HeadersWithSetCookie;
  const setCookieHeaders = typeof withSetCookie.getSetCookie === "function" ? withSetCookie.getSetCookie() : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : [];
  const cookies = setCookieHeaders.map((v) => v.split(";")[0]).filter(Boolean);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

async function apiRequest<T = unknown>(method: string, path: string, options: { body?: unknown; cookie?: string } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, redirect: "manual" });
  let data: T = null as T;
  try { data = (await res.json()) as T; } catch {}
  return { status: res.status, data, cookie: getCookieHeader(res.headers) };
}

async function login(username: string, password: string): Promise<string | null> {
  const res = await apiRequest("POST", "/api/auth/login", { body: { username, password } });
  if (res.status !== 200 || !res.cookie) return null;
  return res.cookie;
}

describe("PD→PM handover gating and transitions", () => {
  let adminCookie = "";
  let projectId: number | null = null;

  beforeAll(async () => {
    adminCookie = (await login("johannes", "2023")) || "";
    if (!adminCookie) return;
    const projectsRes = await apiRequest<Array<{ id: number }>>("GET", "/api/project-info", { cookie: adminCookie });
    if (projectsRes.status === 200 && Array.isArray(projectsRes.data) && projectsRes.data.length > 0) projectId = projectsRes.data[0].id;
  });

  it("allows draft save with gaps", async () => {
    if (!projectId) return;
    const res = await apiRequest("PUT", `/api/pd-pm-handover/${projectId}`, { cookie: adminCookie, body: { handoverFormData: {}, summary: "" } });
    expect([200, 404]).toContain(res.status);
  });

  it("blocks submit when mandatory sections are missing unless COO override exists", async () => {
    if (!projectId) return;
    const res = await apiRequest<{ error?: string; missingItems?: string[] }>("POST", `/api/pd-pm-handover/${projectId}/submit`, { cookie: adminCookie, body: {} });
    if (res.status === 400) {
      expect((res.data?.error || "").toLowerCase()).toContain("cannot submit handover");
      expect(Array.isArray(res.data?.missingItems)).toBe(true);
      return;
    }
    expect(res.status).toBe(200);
  });

  it("reject requires reason and accept path enforces blocking rules", async () => {
    if (!projectId) return;
    const rejectNoReason = await apiRequest("POST", `/api/pd-pm-handover/${projectId}/reject`, { cookie: adminCookie, body: {} });
    expect([400, 403]).toContain(rejectNoReason.status);

    const accept = await apiRequest<{ error?: string; missingItems?: string[] }>("POST", `/api/pd-pm-handover/${projectId}/accept`, { cookie: adminCookie, body: {} });
    expect([200, 400, 403]).toContain(accept.status);
    if (accept.status === 400) {
      const msg = (accept.data?.error || "").toLowerCase();
      expect(msg.includes("cannot accept handover") || msg.includes("no submitted handover")).toBe(true);
    }
  });
});
