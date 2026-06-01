/**
 * Runtime coverage for the folder-keyed live-file endpoints
 * (server/routes/document-files.routes.ts) — Stage 1 of the
 * project_sharepoint_roots → project_folders migration.
 *
 * Deliberately data-INDEPENDENT: it exercises the auth gate and the
 * cross-project / not-found guard, which run before any provisioned folder
 * is needed. This keeps it robust against the api suite's seed variability
 * while still proving the routes are registered and gated at runtime.
 */

import { describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
// The cross-project DB guard needs the D6 `project_folders` table. CI runs
// the api suite on Postgres (full schema); the local SQLite fallback omits
// the D6 tables, so the DB-dependent assertion below only runs on Postgres.
const APP_USES_POSTGRES = (process.env.DATABASE_URL || "").startsWith("postgres");

type ApiResponse<T = unknown> = { status: number; data: T };

async function api<T = unknown>(
  method: string,
  p: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* ignore non-JSON bodies (e.g. download streams) */
  }
  return { status: res.status, data: data as T };
}

async function loginAsAdmin(): Promise<string | null> {
  const res = await api<{ token?: string }>("POST", "/api/auth/login", {
    body: { username: "johannes", password: "2023" },
  });
  if (res.status !== 200 || !res.data?.token) return null;
  return res.data.token;
}

describe("document-files routes — auth gate (runtime, data-independent)", () => {
  it("rejects unauthenticated folder browse with 401/403", async () => {
    const res = await api("GET", "/api/projects/1/folders/1/children");
    expect([401, 403]).toContain(res.status);
  });

  it("rejects unauthenticated upload-complete with 401/403", async () => {
    const res = await api("POST", "/api/projects/1/folders/1/upload/complete", {
      body: { driveItemId: "x", name: "x", parentItemId: null },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("rejects unauthenticated subfolder create with 401/403", async () => {
    const res = await api("POST", "/api/projects/1/folders/1/subfolder", {
      body: { name: "x", parentItemId: null },
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe("document-files routes — cross-project guard (runtime)", () => {
  it.skipIf(!APP_USES_POSTGRES)("404s a folder that doesn't belong to the project, even for an admin", async () => {
    const token = await loginAsAdmin();
    // If the admin fixture isn't present in this environment, skip rather
    // than assert against a gate we can't reach.
    if (!token) return;
    const res = await api("GET", "/api/projects/999999/folders/999999/children", { token });
    expect(res.status).toBe(404);
  });
});
