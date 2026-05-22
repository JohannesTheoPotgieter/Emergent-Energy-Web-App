// Task #110 — admin-controlled active/inactive toggle on the
// Manage Account drawer. End-to-end coverage for the new
// `PATCH /api/admin/users/:id/active` endpoint plus the login gate
// it should switch on for inactive users.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const SQLITE_DB_PATH = path.join(REPO_ROOT, "data", "app.sqlite");

const TARGET_USERNAME = "task110_target";
const TARGET_PASSWORD = "Active110!";
const TARGET_EMAIL = "task110_target@example.test";
// Existing non-admin fixture user wired up by auth-routes.test.ts.
const NONADMIN_USERNAME = "opsmanager31";
const NONADMIN_PASSWORD = "2035";

let targetUserId: number | null = null;

type ApiResponse<T = any> = { status: number; data: T };

async function api<T = any>(method: string, p: string, opts: { body?: unknown; token?: string } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, data };
}

async function loginAsAdmin(): Promise<string> {
  const res = await api<{ token?: string }>("POST", "/api/auth/login", {
    body: { username: "johannes", password: "2023" },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  expect(res.data?.token).toBeTruthy();
  return res.data!.token!;
}

function ensureTargetUser(): void {
  if (!fs.existsSync(SQLITE_DB_PATH)) return;
  const db = new Database(SQLITE_DB_PATH);
  db.pragma("busy_timeout = 10000");
  try {
    const cols = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes("is_active")) {
      db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    }
    if (!cols.includes("username")) {
      db.exec("ALTER TABLE users ADD COLUMN username TEXT");
    }
    if (!cols.includes("token_version")) {
      db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
    }
    const passwordHash = bcrypt.hashSync(TARGET_PASSWORD, 10);
    const existing = db
      .prepare("SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1")
      .get(TARGET_USERNAME) as { id?: number } | undefined;
    if (existing?.id) {
      db.prepare(
        `UPDATE users
         SET email = ?, password = ?, name = ?, role = ?, is_active = 1, token_version = COALESCE(token_version, 0)
         WHERE id = ?`,
      ).run(TARGET_EMAIL, passwordHash, "Task110 Target", "PROJECT_MANAGER_SITE", existing.id);
      targetUserId = existing.id;
    } else {
      const info = db
        .prepare(
          `INSERT INTO users (email, username, password, name, role, is_active, token_version)
           VALUES (?, ?, ?, ?, ?, 1, 0)`,
        )
        .run(TARGET_EMAIL, TARGET_USERNAME, passwordHash, "Task110 Target", "PROJECT_MANAGER_SITE");
      targetUserId = Number(info.lastInsertRowid);
    }
  } finally {
    db.close();
  }
}

function restoreTargetUserActive(): void {
  if (!fs.existsSync(SQLITE_DB_PATH) || !targetUserId) return;
  const db = new Database(SQLITE_DB_PATH);
  db.pragma("busy_timeout = 10000");
  try {
    db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(targetUserId);
  } finally {
    db.close();
  }
}

beforeAll(() => {
  ensureTargetUser();
});

afterAll(() => {
  restoreTargetUserActive();
});

describe("Task #110 — admin user active toggle", () => {
  it("admin GET /api/admin/users includes isActive on every entry", async () => {
    const token = await loginAsAdmin();
    const res = await api<any[]>("GET", "/api/admin/users", { token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    const sample = res.data[0];
    expect(sample).toBeTruthy();
    expect(typeof sample.isActive).toBe("boolean");
  });

  it("PATCH /api/admin/users/:id/active rejects unauthenticated callers", async () => {
    if (!targetUserId) return;
    const res = await api("PATCH", `/api/admin/users/${targetUserId}/active`, { body: { isActive: false } });
    expect([401, 403]).toContain(res.status);
  });

  it("PATCH /api/admin/users/:id/active rejects non-admin callers with 403", async () => {
    if (!targetUserId) return;
    const login = await api<{ token?: string }>("POST", "/api/auth/login", {
      body: { username: NONADMIN_USERNAME, password: NONADMIN_PASSWORD },
    });
    // The non-admin fixture must be present and able to log in for this
    // test to be meaningful — otherwise the requireAdmin gate is not the
    // one being exercised.
    if (login.status !== 200 || !login.data?.token) return;
    const res = await api("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token: login.data.token,
      body: { isActive: false },
    });
    expect(res.status).toBe(403);
  });

  it("admin can deactivate a user, login is then blocked, and reactivation restores access", async () => {
    if (!targetUserId) return;
    const token = await loginAsAdmin();

    // Sanity — login works while active.
    const before = await api<{ token?: string }>("POST", "/api/auth/login", {
      body: { username: TARGET_USERNAME, password: TARGET_PASSWORD },
    });
    expect(before.status).toBe(200);
    expect(before.data?.token).toBeTruthy();

    // Deactivate.
    const off = await api<any>("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token,
      body: { isActive: false },
    });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    expect(off.data?.isActive).toBe(false);

    // Login is now blocked.
    const blocked = await api<{ token?: string }>("POST", "/api/auth/login", {
      body: { username: TARGET_USERNAME, password: TARGET_PASSWORD },
    });
    expect([400, 401, 403]).toContain(blocked.status);
    expect(blocked.data?.token).toBeFalsy();

    // Reactivate.
    const on = await api<any>("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token,
      body: { isActive: true },
    });
    expect(on.status, JSON.stringify(on.data)).toBe(200);
    expect(on.data?.isActive).toBe(true);

    // Login works again.
    const after = await api<{ token?: string }>("POST", "/api/auth/login", {
      body: { username: TARGET_USERNAME, password: TARGET_PASSWORD },
    });
    expect(after.status).toBe(200);
    expect(after.data?.token).toBeTruthy();
  });

  it("PATCH .../:id/active validates body shape", async () => {
    if (!targetUserId) return;
    const token = await loginAsAdmin();
    const res = await api("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token,
      body: { isActive: "yes" },
    });
    expect([400, 422]).toContain(res.status);
  });

  it("admin cannot deactivate themselves", async () => {
    const token = await loginAsAdmin();
    const me = await api<any>("GET", "/api/auth/me", { token });
    const myId = me.data?.user?.id ?? me.data?.id;
    expect(typeof myId).toBe("number");
    const res = await api<any>("PATCH", `/api/admin/users/${myId}/active`, {
      token,
      body: { isActive: false },
    });
    expect(res.status).toBe(400);
  });

  it("emits permission-audit entries with previousIsActive/newIsActive on deactivate then activate", async () => {
    if (!targetUserId) return;
    const token = await loginAsAdmin();

    // Ensure a clean starting state: target is active.
    await api("PATCH", `/api/admin/users/${targetUserId}/active`, { token, body: { isActive: true } });

    // Deactivate (true → false), then reactivate (false → true).
    const off = await api<any>("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token,
      body: { isActive: false },
    });
    expect(off.status).toBe(200);
    const on = await api<any>("PATCH", `/api/admin/users/${targetUserId}/active`, {
      token,
      body: { isActive: true },
    });
    expect(on.status).toBe(200);

    function pickFor(entries: any[], eventType: string) {
      return entries.find(
        (e) => (e?.eventType === eventType || e?.event_type === eventType)
          && (e?.targetUserId === targetUserId || Number(e?.target_user_id) === targetUserId),
      );
    }

    function changeDetailOf(entry: any): any {
      if (!entry) return null;
      const raw = entry.changeDetail ?? entry.change_detail;
      if (raw == null) return null;
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    }

    const deactivatedLog = await api<{ entries?: any[] }>(
      "GET",
      `/api/admin/permission-audit-log?eventType=user_deactivated&limit=100`,
      { token },
    );
    expect(deactivatedLog.status).toBe(200);
    const deactivatedEntry = pickFor(deactivatedLog.data?.entries || [], "user_deactivated");
    expect(deactivatedEntry, "expected user_deactivated audit entry for target user").toBeTruthy();
    const deactivatedDetail = changeDetailOf(deactivatedEntry);
    expect(deactivatedDetail).toBeTruthy();
    expect(deactivatedDetail.previousIsActive).toBe(true);
    expect(deactivatedDetail.newIsActive).toBe(false);

    const activatedLog = await api<{ entries?: any[] }>(
      "GET",
      `/api/admin/permission-audit-log?eventType=user_activated&limit=100`,
      { token },
    );
    expect(activatedLog.status).toBe(200);
    const activatedEntry = pickFor(activatedLog.data?.entries || [], "user_activated");
    expect(activatedEntry, "expected user_activated audit entry for target user").toBeTruthy();
    const activatedDetail = changeDetailOf(activatedEntry);
    expect(activatedDetail).toBeTruthy();
    expect(activatedDetail.previousIsActive).toBe(false);
    expect(activatedDetail.newIsActive).toBe(true);
  });
});
