import { describe, it, expect } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string, headers?: Record<string, string>) {
  const mergedHeaders: Record<string, string> = { "Content-Type": "application/json", ...(headers || {}) };
  if (token) mergedHeaders["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: mergedHeaders,
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

async function listTasks(token: string) {
  const res = await apiRequest("GET", "/api/mytool/tasks", undefined, token);
  expect(res.status).toBe(200);
  return Array.isArray(res.data) ? res.data : [];
}

describe("API: MyTool task create idempotency", () => {
  it("prevents duplicate create from double click, enter spam, retry, and impatient clicks", async () => {
    const loginRes = await login("johannes", "2023");
    expect(loginRes.status).toBe(200);
    const token = loginRes.token as string;

    const key = `it-mytool-${Date.now()}`;
    const title = `Idempotent task ${Date.now()}`;

    const before = await listTasks(token);

    const body = {
      title,
      status: "todo",
      priority: "normal",
      clientRequestId: key,
    };

    const [doubleClickA, doubleClickB, enterPressA, enterPressB, retry, impatientClick] = await Promise.all([
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
      apiRequest("POST", "/api/mytool/tasks", body, token, { "x-idempotency-key": key }),
    ]);

    const all = [doubleClickA, doubleClickB, enterPressA, enterPressB, retry, impatientClick];

    const acceptable = new Set([200, 409]);
    all.forEach((r) => expect(acceptable.has(r.status)).toBe(true));

    const successful = all.filter((r) => r.status === 200);
    expect(successful.length).toBeGreaterThan(0);

    const returnedIds = successful.map((r) => r.data?.id).filter((id) => typeof id === "number");
    const uniqueIds = Array.from(new Set(returnedIds));
    expect(uniqueIds.length).toBe(1);

    const after = await listTasks(token);
    const matching = after.filter((t: any) => t.title === title);

    expect(matching.length).toBe(1);
    expect(after.length).toBe(before.length + 1);
  });
});
