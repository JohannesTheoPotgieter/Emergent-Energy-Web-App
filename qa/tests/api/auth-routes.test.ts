import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const SQLITE_DB_PATH = path.join(REPO_ROOT, "data", "app.sqlite");

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

type ApiRequestOptions = {
  body?: unknown;
  token?: string;
  cookie?: string;
};

type ApiResponse<T = any> = {
  status: number;
  data: T;
  cookie: string | null;
};

type AdminAuthResult = {
  status: 200;
  token: string;
  cookie: string;
  user?: { role?: string };
  data: { token?: string; user?: { role?: string } };
};

let cachedAdminAuth: AdminAuthResult | null = null;
let cachedRestrictedAuth: AdminAuthResult | null = null;

function ensureSqliteAuthFixtures(): void {
  if (!fs.existsSync(SQLITE_DB_PATH)) {
    return;
  }

  const db = new Database(SQLITE_DB_PATH);

  try {
    const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has("username")) {
      db.exec("ALTER TABLE users ADD COLUMN username TEXT");
    }
    if (!columnNames.has("microsoft_id")) {
      db.exec("ALTER TABLE users ADD COLUMN microsoft_id TEXT");
    }
    if (!columnNames.has("token_version")) {
      db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
    }

    const upsertUser = db.transaction((user: { username: string; email: string; password: string; name: string; role: string }) => {
      const existing = db
        .prepare("SELECT id FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?) LIMIT 1")
        .get(user.email, user.username) as { id?: number } | undefined;

      const passwordHash = bcrypt.hashSync(user.password, 10);

      if (existing?.id) {
        db.prepare(
          `
            UPDATE users
            SET email = ?, username = ?, password = ?, name = ?, role = ?, token_version = COALESCE(token_version, 0)
            WHERE id = ?
          `,
        ).run(user.email, user.username, passwordHash, user.name, user.role, existing.id);
        return;
      }

      db.prepare(
        `
          INSERT INTO users (email, username, password, name, role, token_version)
          VALUES (?, ?, ?, ?, ?, 0)
        `,
      ).run(user.email, user.username, passwordHash, user.name, user.role);
    });

    upsertUser({
      username: "johannes",
      email: "johannes@emergent.energy",
      password: "2023",
      name: "Johannes Potgieter",
      role: "COO_ADMIN",
    });

    upsertUser({
      username: "eon",
      email: "eon@emergent.energy",
      password: "2035",
      name: "Eon Van Rensburg",
      role: "PROJECT_MANAGER_SITE",
    });

    const passwordHash = bcrypt.hashSync("2035", 10);
    const existingRestricted = db
      .prepare("SELECT id FROM users WHERE id = 31 LIMIT 1")
      .get() as { id?: number } | undefined;

    if (existingRestricted?.id) {
      db.prepare(
        `
          UPDATE users
          SET email = ?, username = ?, password = ?, name = ?, role = ?, token_version = COALESCE(token_version, 0)
          WHERE id = 31
        `,
      ).run("opsmanager31@emergent.energy", "opsmanager31", passwordHash, "Restricted Ops Manager", "PROJECT_MANAGER_SITE");
    } else {
      db.prepare(
        `
          INSERT INTO users (id, email, username, password, name, role, token_version)
          VALUES (31, ?, ?, ?, ?, ?, 0)
        `,
      ).run("opsmanager31@emergent.energy", "opsmanager31", passwordHash, "Restricted Ops Manager", "PROJECT_MANAGER_SITE");
    }
  } finally {
    db.close();
  }
}

function getCookieHeader(headers: Headers): string | null {
  const withSetCookie = headers as HeadersWithSetCookie;
  const setCookieHeaders =
    typeof withSetCookie.getSetCookie === "function"
      ? withSetCookie.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];

  const cookies = setCookieHeaders.map((value) => value.split(";")[0]).filter(Boolean);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

async function apiRequest<T = any>(method: string, path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  let data: T = null as T;
  try {
    data = (await res.json()) as T;
  } catch {
    // Some routes may return empty or non-JSON bodies.
  }

  return {
    status: res.status,
    data,
    cookie: getCookieHeader(res.headers),
  };
}

async function login(username: string, password: string) {
  const res = await apiRequest<{ token?: string; user?: { role?: string }; code?: string }>("POST", "/api/auth/login", {
    body: { username, password },
  });

  return {
    status: res.status,
    token: res.data?.token,
    user: res.data?.user,
    cookie: res.cookie,
    data: res.data,
  };
}

async function loginAsAdmin() {
  if (cachedAdminAuth) {
    return cachedAdminAuth;
  }

  const result = await login("johannes", "2023");
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.token, JSON.stringify(result.data)).toBeTruthy();
  expect(result.cookie, JSON.stringify(result.data)).toBeTruthy();
  cachedAdminAuth = result as {
    status: 200;
    token: string;
    cookie: string;
    user?: { role?: string };
    data: { token?: string; user?: { role?: string } };
  };
  return cachedAdminAuth;
}

async function loginAsRestrictedProjectManager() {
  if (cachedRestrictedAuth) {
    return cachedRestrictedAuth;
  }

  const result = await login("opsmanager31", "2035");
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.token, JSON.stringify(result.data)).toBeTruthy();
  expect(result.cookie, JSON.stringify(result.data)).toBeTruthy();
  expect(result.user?.role).toBe("PROJECT_MANAGER_SITE");
  cachedRestrictedAuth = result as {
    status: 200;
    token: string;
    cookie: string;
    user?: { role?: string };
    data: { token?: string; user?: { role?: string } };
  };
  return cachedRestrictedAuth;
}

async function expectAuthParity(
  method: string,
  path: string,
  options: {
    body?: unknown;
    expectedStatus: number;
    assertData?: (data: any) => void;
  },
) {
  const auth = await loginAsAdmin();

  const [bearerRes, sessionRes] = await Promise.all([
    apiRequest(method, path, { body: options.body, token: auth.token }),
    apiRequest(method, path, { body: options.body, cookie: auth.cookie }),
  ]);

  expect(bearerRes.status).toBe(options.expectedStatus);
  expect(sessionRes.status).toBe(options.expectedStatus);

  options.assertData?.(bearerRes.data);
  options.assertData?.(sessionRes.data);
}

beforeAll(() => {
  ensureSqliteAuthFixtures();
});

describe("API: Authentication", () => {
  it("GET /api/health returns startup raw flags and derived modes", async () => {
    const res = await apiRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    expect(res.data.startupFlagsRaw).toBeTruthy();
    expect(res.data.startupModes).toBeTruthy();
    expect(typeof res.data.startupModes.startupReadOnlyByDefault).toBe("boolean");
    expect(typeof res.data.startupMutationClassification).toBe("string");
  });

  it("POST /api/auth/login succeeds with valid credentials and establishes both auth mechanisms", async () => {
    const res = await loginAsAdmin();
    expect(res.user?.role).toBe("COO_ADMIN");
  });

  it("POST /api/auth/login fails with invalid credentials", async () => {
    const res = await login("johannes", "wrongpassword");
    expect([400, 401]).toContain(res.status);
  });

  it("POST /api/auth/login blocks non-approved password accounts in the active auth route owner", async () => {
    const res = await login("eon", "2035");
    expect(res.status).toBe(403);
    expect(res.data?.code).toBe("PASSWORD_LOGIN_RESTRICTED");
  });

  it("GET /api/auth/me returns 401 when not authenticated", async () => {
    const res = await apiRequest("GET", "/api/auth/me");
    expect([401, 403]).toContain(res.status);
  });

  it("keeps /api/auth/me parity between bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/auth/me", {
      expectedStatus: 200,
      assertData: (data) => {
        const user = data?.user || data;
        expect(user?.role).toBe("COO_ADMIN");
      },
    });
  });

  it("revokes both the active session and the active bearer token on logout", async () => {
    const auth = await loginAsAdmin();

    const logoutRes = await apiRequest("POST", "/api/auth/logout", {
      token: auth.token,
      cookie: auth.cookie,
    });
    expect(logoutRes.status).toBe(200);
    cachedAdminAuth = null;

    const [bearerRes, sessionRes] = await Promise.all([
      apiRequest("GET", "/api/auth/me", { token: auth.token }),
      apiRequest("GET", "/api/auth/me", { cookie: auth.cookie }),
    ]);

    expect([401, 403]).toContain(bearerRes.status);
    expect([401, 403]).toContain(sessionRes.status);
  });
});

describe("API: Protected route auth parity", () => {
  it("keeps the roles control center populated for both bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/roles/control-center", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(Array.isArray(data?.roles)).toBe(true);
        expect(data?.roles.some((role: any) => role?.role === "COO_ADMIN")).toBe(true);
        expect(Array.isArray(data?.entities)).toBe(true);
      },
    });
  });

  it("keeps sync status reachable for both bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/sp-sync/status", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(typeof data?.configured).toBe("boolean");
        expect(typeof data?.connectorAvailable).toBe("boolean");
      },
    });
  });

  it("keeps pending approvals reachable for both bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/approvals/pending", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(Array.isArray(data?.items)).toBe(true);
        expect(data?.counts).toBeTruthy();
      },
    });
  });

  it("keeps template constants reachable for both bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/template-constants", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(Array.isArray(data?.projectPhases)).toBe(true);
        expect(Array.isArray(data?.itemTypes)).toBe(true);
      },
    });
  });

  it("keeps project creation auth parity without creating data", async () => {
    await expectAuthParity("POST", "/api/projects", {
      body: {},
      expectedStatus: 400,
      assertData: (data) => {
        expect(data?.error).toBe("projectName is required");
      },
    });
  });

  it("rejects restricted direct API edits for a non-authorized project manager", async () => {
    const restricted = await loginAsRestrictedProjectManager();

    const [bearerRes, sessionRes] = await Promise.all([
      apiRequest("PATCH", "/api/counterparties/999999", {
        token: restricted.token,
        body: { notes: "forbidden" },
      }),
      apiRequest("PATCH", "/api/counterparties/999999", {
        cookie: restricted.cookie,
        body: { notes: "forbidden" },
      }),
    ]);

    expect(bearerRes.status).toBe(403);
    expect(sessionRes.status).toBe(403);
    expect(bearerRes.data?.error).toBe("forbidden");
    expect(sessionRes.data?.error).toBe("forbidden");
  });
});

describe("API: Platform foundation", () => {
  it("keeps platform contracts reachable for both bearer and session auth", async () => {
    await expectAuthParity("GET", "/api/platform/contracts", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(Array.isArray(data?.contracts?.departments)).toBe(true);
        expect(Array.isArray(data?.contracts?.roles)).toBe(true);
        expect(data?.authoritativeSources?.projectSpine?.table).toBe("project_info");
        expect(Array.isArray(data?.routeOwnership)).toBe(true);
        expect(Array.isArray(data?.extensionRules)).toBe(true);
      },
    });
  });

  it("attaches canonical shared summaries to the legacy projects summary payload", async () => {
    await expectAuthParity("GET", "/api/projects-summary", {
      expectedStatus: 200,
      assertData: (data) => {
        expect(Array.isArray(data)).toBe(true);

        const projectWithSharedSummary = Array.isArray(data)
          ? data.find((project: any) => Number.isFinite(Number(project?.project_info_id)) && project?.shared_summary)
          : null;

        if (!projectWithSharedSummary) {
          return;
        }

        expect(projectWithSharedSummary.shared_summary?.project?.projectInfoId).toBe(Number(projectWithSharedSummary.project_info_id));
        expect(projectWithSharedSummary.shared_summary?.project?.authoritativeTable).toBe("project_info");
        expect(projectWithSharedSummary.shared_summary?.latestUpdate?.sourceTable).toBe("project_editable_fields");
        expect(Array.isArray(projectWithSharedSummary.shared_summary?.workspaces)).toBe(true);
      },
    });
  });

  it("serves canonical platform project summaries for real project ids", async () => {
    const auth = await loginAsAdmin();
    const projectsRes = await apiRequest<any[]>("GET", "/api/projects-summary", { token: auth.token });

    expect(projectsRes.status).toBe(200);
    expect(Array.isArray(projectsRes.data)).toBe(true);

    const candidateProject = projectsRes.data.find((project) => Number.isFinite(Number(project?.project_info_id)));
    if (!candidateProject) {
      return;
    }

    await expectAuthParity("GET", `/api/platform/projects/${candidateProject.project_info_id}/summary`, {
      expectedStatus: 200,
      assertData: (data) => {
        expect(data?.project?.projectInfoId).toBe(Number(candidateProject.project_info_id));
        expect(data?.project?.authoritativeTable).toBe("project_info");
        expect(Array.isArray(data?.workspaces)).toBe(true);
        expect(Array.isArray(data?.assignees)).toBe(true);
        expect(Array.isArray(data?.kpis)).toBe(true);
      },
    });
  });
});
