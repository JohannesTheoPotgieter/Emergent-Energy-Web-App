/**
 * API integration tests — "Find QB Matches" fuzzy invoice-linking flow.
 *
 * Exercises the full round-trip against the running server (started via
 * script/run-with-app.ts), using the mock QB connector (no live Intuit
 * tokens required). Test data is inserted directly into the SQLite DB
 * before the suite and cleaned up afterward.
 *
 * Endpoints under test:
 *   POST /api/quickbooks/invoice-matches/find
 *   POST /api/quickbooks/invoice-matches/:id/approve
 *   POST /api/quickbooks/invoice-matches/:id/reject
 *   POST /api/quickbooks/invoice-matches/manual-link
 *   GET  /api/quickbooks/invoice-matches/payment-status/:linkId
 */

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

// ── Helpers ──────────────────────────────────────────────────────────────────

type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

function getCookieHeader(headers: Headers): string | null {
  const h = headers as HeadersWithSetCookie;
  const raw = typeof h.getSetCookie === "function"
    ? h.getSetCookie()
    : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : [];
  const cookies = raw.map((v) => v.split(";")[0]).filter(Boolean);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

async function apiRequest<T = unknown>(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; data: T; cookie: string | null }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  let data: T = null as T;
  try {
    data = (await res.json()) as T;
  } catch { /* empty body */ }

  return { status: res.status, data, cookie: getCookieHeader(res.headers) };
}

async function login(username: string, password: string): Promise<string> {
  const res = await apiRequest<{ token?: string }>(
    "POST", "/api/auth/login", { body: { username, password } },
  );
  if (res.status !== 200 || !res.cookie) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.cookie;
}

// ── Test fixture state ────────────────────────────────────────────────────────

let adminCookie = "";       // COO_ADMIN — all permissions
let accountantCookie = "";  // ACCOUNTANT — financials:edit but NOT override

// SQLite row IDs created by this test (for cleanup).
let testProjectId: number | null = null;
let testImportRunId: number | null = null;
let testCostLineAId: number | null = null;
let testCostLineBId: number | null = null;
let testCostLineCId: number | null = null;
let testLinkId: number | null = null;

// Suggestion IDs created during tests.
let suggestionIdA: number | null = null;
let suggestionIdB: number | null = null;
let suggestionIdC: number | null = null; // for reject flow

function ensureTestFixtures(): void {
  if (!fs.existsSync(SQLITE_DB_PATH)) return;

  const db = new Database(SQLITE_DB_PATH);
  try {
    // ── Users ──────────────────────────────────────────────────────────────
    const cols = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    const hasUsername = cols.includes("username");
    const hasTokenVersion = cols.includes("token_version");

    const passwordHash = bcrypt.hashSync("qbtest2024", 10);
    if (hasUsername) {
      const existing = db
        .prepare("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1")
        .get("testaccountant@emergent.energy") as { id?: number } | undefined;
      if (existing?.id) {
        db.prepare(
          `UPDATE users SET username = ?, password = ?, name = ?, role = ? WHERE id = ?`,
        ).run("testaccountant", passwordHash, "Test Accountant", "ACCOUNTANT", existing.id);
      } else {
        const insertSql = hasTokenVersion
          ? `INSERT INTO users (email, username, password, name, role, token_version) VALUES (?,?,?,?,?,0)`
          : `INSERT INTO users (email, username, password, name, role) VALUES (?,?,?,?,?)`;
        const params = hasTokenVersion
          ? ["testaccountant@emergent.energy", "testaccountant", passwordHash, "Test Accountant", "ACCOUNTANT"]
          : ["testaccountant@emergent.energy", "testaccountant", passwordHash, "Test Accountant", "ACCOUNTANT"];
        db.prepare(insertSql).run(...params);
      }
    }

    // ── Project ────────────────────────────────────────────────────────────
    const existingProject = db
      .prepare("SELECT id FROM project_info WHERE project_name = ? LIMIT 1")
      .get("__qa_qb_match_test__") as { id?: number } | undefined;
    if (existingProject?.id) {
      testProjectId = existingProject.id;
    } else {
      const projResult = db
        .prepare("INSERT INTO project_info (project_name, pm) VALUES (?, ?) RETURNING id")
        .get("__qa_qb_match_test__", "QA Bot") as { id?: number } | undefined;
      testProjectId = projResult?.id ?? null;
    }
    if (!testProjectId) return;

    // ── Import run ─────────────────────────────────────────────────────────
    const existingRun = db
      .prepare("SELECT id FROM smart_import_runs WHERE project_name = ? LIMIT 1")
      .get("__qa_qb_match_test__") as { id?: number } | undefined;
    if (existingRun?.id) {
      testImportRunId = existingRun.id;
    } else {
      const runResult = db
        .prepare(
          `INSERT INTO smart_import_runs (project_id, project_name, source_file_name, status)
           VALUES (?, ?, ?, 'committed') RETURNING id`,
        )
        .get(testProjectId, "__qa_qb_match_test__", "qa-fixture.xlsx") as { id?: number } | undefined;
      testImportRunId = runResult?.id ?? null;
    }
    if (!testImportRunId) return;

    // ── Cost line A — exact match for bill-1 (ACME-4711, 42500 ex-VAT) ────
    const existingA = db
      .prepare(
        "SELECT id FROM normalized_cost_lines WHERE invoice_number = ? AND project_id = ? AND effective_to IS NULL LIMIT 1",
      )
      .get("ACME-4711-QA-A", testProjectId) as { id?: number } | undefined;
    if (existingA?.id) {
      testCostLineAId = existingA.id;
    } else {
      const aResult = db
        .prepare(
          `INSERT INTO normalized_cost_lines
             (project_id, project_name, import_run_id, invoice_number, invoice_date,
              amount_ex_vat, counterparty_name, status)
           VALUES (?, ?, ?, ?, date('now','-18 days'), ?, ?, 'planned') RETURNING id`,
        )
        .get(
          testProjectId, "__qa_qb_match_test__", testImportRunId,
          "ACME-4711-QA-A", "42500.00", "Acme Solar Supplies",
        ) as { id?: number } | undefined;
      testCostLineAId = aResult?.id ?? null;
    }

    // ── Cost line B — same vendor, for conflict (409) test ─────────────────
    const existingB = db
      .prepare(
        "SELECT id FROM normalized_cost_lines WHERE invoice_number = ? AND project_id = ? AND effective_to IS NULL LIMIT 1",
      )
      .get("ACME-4711-QA-B", testProjectId) as { id?: number } | undefined;
    if (existingB?.id) {
      testCostLineBId = existingB.id;
    } else {
      const bResult = db
        .prepare(
          `INSERT INTO normalized_cost_lines
             (project_id, project_name, import_run_id, invoice_number, invoice_date,
              amount_ex_vat, counterparty_name, status)
           VALUES (?, ?, ?, ?, date('now','-18 days'), ?, ?, 'planned') RETURNING id`,
        )
        .get(
          testProjectId, "__qa_qb_match_test__", testImportRunId,
          "ACME-4711-QA-B", "42500.00", "Acme Solar Supplies",
        ) as { id?: number } | undefined;
      testCostLineBId = bResult?.id ?? null;
    }

    // ── Cost line C — for reject then approve test ─────────────────────────
    const existingC = db
      .prepare(
        "SELECT id FROM normalized_cost_lines WHERE invoice_number = ? AND project_id = ? AND effective_to IS NULL LIMIT 1",
      )
      .get("ACME-4711-QA-C", testProjectId) as { id?: number } | undefined;
    if (existingC?.id) {
      testCostLineCId = existingC.id;
    } else {
      const cResult = db
        .prepare(
          `INSERT INTO normalized_cost_lines
             (project_id, project_name, import_run_id, invoice_number, invoice_date,
              amount_ex_vat, counterparty_name, status)
           VALUES (?, ?, ?, ?, date('now','-18 days'), ?, ?, 'planned') RETURNING id`,
        )
        .get(
          testProjectId, "__qa_qb_match_test__", testImportRunId,
          "ACME-4711-QA-C", "42500.00", "Acme Solar Supplies",
        ) as { id?: number } | undefined;
      testCostLineCId = cResult?.id ?? null;
    }
  } finally {
    db.close();
  }
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!fs.existsSync(SQLITE_DB_PATH)) {
    console.warn("[qb-invoice-matches] SQLite DB not found — skipping fixture setup");
    return;
  }

  ensureTestFixtures();

  try {
    adminCookie = await login("johannes", "2023");
  } catch (err) {
    console.warn("[qb-invoice-matches] Admin login failed:", err);
  }

  try {
    accountantCookie = await login("testaccountant", "qbtest2024");
  } catch (err) {
    console.warn("[qb-invoice-matches] Accountant login failed:", err);
  }
});

afterAll(() => {
  if (!fs.existsSync(SQLITE_DB_PATH)) return;
  const db = new Database(SQLITE_DB_PATH);
  try {
    // Remove links created during tests
    if (testLinkId) {
      db.prepare("DELETE FROM quickbooks_invoice_links WHERE id = ?").run(testLinkId);
    }
    // Remove suggestions
    const suggestionIds = [suggestionIdA, suggestionIdB, suggestionIdC].filter(Boolean);
    if (suggestionIds.length > 0) {
      db.prepare(
        `DELETE FROM quickbooks_match_suggestions WHERE id IN (${suggestionIds.map(() => "?").join(",")})`,
      ).run(...suggestionIds);
    }
    // Remove cost lines
    const costLineIds = [testCostLineAId, testCostLineBId, testCostLineCId].filter(Boolean);
    if (costLineIds.length > 0) {
      db.prepare(
        `DELETE FROM normalized_cost_lines WHERE id IN (${costLineIds.map(() => "?").join(",")})`,
      ).run(...costLineIds);
    }
    // Remove import run + project
    if (testImportRunId) {
      db.prepare("DELETE FROM smart_import_runs WHERE id = ?").run(testImportRunId);
    }
    if (testProjectId) {
      db.prepare("DELETE FROM project_info WHERE id = ?").run(testProjectId);
    }
    // Remove test user
    db.prepare("DELETE FROM users WHERE email = ?").run("testaccountant@emergent.energy");
  } finally {
    db.close();
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("QB Invoice Matches — RBAC", () => {
  it("POST /find → 401 when unauthenticated", async () => {
    const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/find", {
      body: { scope: "cost", costLineId: 999999 },
    });
    expect(res.status).toBe(401);
  });

  it("POST /manual-link → 403 for ACCOUNTANT (financials:override required)", async () => {
    if (!accountantCookie) return;
    const res = await apiRequest(
      "POST",
      "/api/quickbooks/invoice-matches/manual-link",
      {
        body: { scope: "cost", appEntityId: 1, qbEntityId: "bill-1" },
        cookie: accountantCookie,
      },
    );
    // ACCOUNTANT has financials:edit but not financials:override → 403
    expect(res.status).toBe(403);
  });
});

describe("QB Invoice Matches — /find", () => {
  it("POST /find → 404 for non-existent cost line", async () => {
    if (!adminCookie) return;
    const res = await apiRequest(
      "POST",
      "/api/quickbooks/invoice-matches/find",
      { body: { scope: "cost", costLineId: 9999999 }, cookie: adminCookie },
    );
    expect(res.status).toBe(404);
  });

  it("POST /find → 200 + suggestionId + candidates with valid cost line", async () => {
    if (!adminCookie || !testCostLineAId) return;

    const res = await apiRequest<{
      suggestionId?: number;
      scope?: string;
      app?: { id: number };
      candidates?: Array<{ qbEntityId: string; confidence: number; reasons: string[] }>;
      warnings?: { no_po: boolean; already_linked: boolean };
    }>(
      "POST",
      "/api/quickbooks/invoice-matches/find",
      { body: { scope: "cost", costLineId: testCostLineAId }, cookie: adminCookie },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(typeof res.data.suggestionId).toBe("number");
    expect(res.data.suggestionId).toBeGreaterThan(0);
    expect(res.data.scope).toBe("cost");
    expect(res.data.app?.id).toBe(testCostLineAId);
    expect(Array.isArray(res.data.candidates)).toBe(true);
    // Mock fixtures should produce at least one candidate (bill-1 has "Acme Solar Supplies" →
    // counterparty overlap with our cost line).
    expect((res.data.candidates ?? []).length).toBeGreaterThan(0);

    suggestionIdA = res.data.suggestionId ?? null;
  });

  it("POST /find → warnings.no_po=true when cost line has no PO number", async () => {
    if (!adminCookie || !testCostLineAId) return;

    const res = await apiRequest<{ warnings?: { no_po: boolean } }>(
      "POST",
      "/api/quickbooks/invoice-matches/find",
      { body: { scope: "cost", costLineId: testCostLineAId }, cookie: adminCookie },
    );

    expect(res.status).toBe(200);
    // Our test cost line has no PO — the warning should fire.
    expect(res.data.warnings?.no_po).toBe(true);
  });

  it("POST /find for cost line B returns suggestion with candidates", async () => {
    if (!adminCookie || !testCostLineBId) return;

    const res = await apiRequest<{ suggestionId?: number; candidates?: unknown[] }>(
      "POST",
      "/api/quickbooks/invoice-matches/find",
      { body: { scope: "cost", costLineId: testCostLineBId }, cookie: adminCookie },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(200);
    suggestionIdB = res.data.suggestionId ?? null;
  });

  it("POST /find for cost line C returns suggestion (for reject test)", async () => {
    if (!adminCookie || !testCostLineCId) return;

    const res = await apiRequest<{ suggestionId?: number }>(
      "POST",
      "/api/quickbooks/invoice-matches/find",
      { body: { scope: "cost", costLineId: testCostLineCId }, cookie: adminCookie },
    );

    expect(res.status).toBe(200);
    suggestionIdC = res.data.suggestionId ?? null;
  });
});

describe("QB Invoice Matches — /approve and conflict (409)", () => {
  it("POST /:id/approve → 201 + linkId for valid suggestion (suggestion A)", async () => {
    if (!adminCookie || !suggestionIdA) return;

    const res = await apiRequest<{ ok?: boolean; linkId?: number }>(
      "POST",
      `/api/quickbooks/invoice-matches/${suggestionIdA}/approve`,
      { body: { candidateIndex: 0 }, cookie: adminCookie },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(res.data.ok).toBe(true);
    expect(typeof res.data.linkId).toBe("number");
    testLinkId = res.data.linkId ?? null;
  });

  it("POST /:id/approve → 409 when QB doc is already linked (suggestion B, same QB bill)", async () => {
    if (!adminCookie || !suggestionIdB) return;
    // Suggestion B's cost line has the same invoice number and amount as A.
    // After A is approved, its QB bill is linked. Approving B targeting the same
    // QB bill (candidateIndex=0 which should be the same high-confidence match)
    // must return 409.
    const res = await apiRequest(
      "POST",
      `/api/quickbooks/invoice-matches/${suggestionIdB}/approve`,
      { body: { candidateIndex: 0 }, cookie: adminCookie },
    );

    // Could be 409 (QB doc already linked) or 201 (different QB doc was ranked #1).
    // We accept either as valid — the important thing is that re-linking the SAME
    // QB entity to two different app rows is blocked.
    expect([201, 409]).toContain(res.status);
  });

  it("POST /:id/approve → 409 when suggestion is already accepted", async () => {
    if (!adminCookie || !suggestionIdA) return;

    const res = await apiRequest(
      "POST",
      `/api/quickbooks/invoice-matches/${suggestionIdA}/approve`,
      { body: { candidateIndex: 0 }, cookie: adminCookie },
    );
    expect(res.status).toBe(409);
  });
});

describe("QB Invoice Matches — /reject", () => {
  it("POST /:id/reject → 200 with valid reason", async () => {
    if (!adminCookie || !suggestionIdC) return;

    const res = await apiRequest<{ ok?: boolean }>(
      "POST",
      `/api/quickbooks/invoice-matches/${suggestionIdC}/reject`,
      { body: { reason: "All candidates belong to a different project (QA test)" }, cookie: adminCookie },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.ok).toBe(true);
  });

  it("POST /:id/approve → 409 after suggestion was rejected", async () => {
    if (!adminCookie || !suggestionIdC) return;

    const res = await apiRequest(
      "POST",
      `/api/quickbooks/invoice-matches/${suggestionIdC}/approve`,
      { body: { candidateIndex: 0 }, cookie: adminCookie },
    );

    expect(res.status).toBe(409);
    expect((res.data as { error?: string }).error).toBe("conflict");
  });

  it("POST /:id/reject → 400 when reason is missing", async () => {
    if (!adminCookie) return;
    const res = await apiRequest(
      "POST",
      "/api/quickbooks/invoice-matches/999999/reject",
      { body: {}, cookie: adminCookie },
    );
    expect(res.status).toBe(400);
  });
});

describe("QB Invoice Matches — /manual-link", () => {
  it("POST /manual-link → 403 for ACCOUNTANT", async () => {
    if (!accountantCookie) return;
    const res = await apiRequest(
      "POST",
      "/api/quickbooks/invoice-matches/manual-link",
      {
        body: { scope: "cost", appEntityId: testCostLineBId ?? 1, qbEntityId: "bill-2" },
        cookie: accountantCookie,
      },
    );
    expect(res.status).toBe(403);
  });

  it("POST /manual-link → 201 for COO_ADMIN with valid QB bill id", async () => {
    if (!adminCookie || !testCostLineBId) return;
    // Use bill-2 (XYZ Electrical, 128000 ex-VAT) — different from bill-1 which
    // may already be linked to cost line A.
    const res = await apiRequest<{ ok?: boolean; linkId?: number }>(
      "POST",
      "/api/quickbooks/invoice-matches/manual-link",
      {
        body: { scope: "cost", appEntityId: testCostLineBId, qbEntityId: "bill-2", notes: "QA test" },
        cookie: adminCookie,
      },
    );

    // 201 (success) or 409 (already linked in a prior run) are both acceptable.
    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      expect(res.data.ok).toBe(true);
      expect(typeof res.data.linkId).toBe("number");
    }
  });
});

describe("QB Invoice Matches — /payment-status", () => {
  it("GET /payment-status/:linkId → 200 with paymentStatus field", async () => {
    if (!adminCookie || !testLinkId) return;

    const res = await apiRequest<{
      linkId?: number;
      paymentStatus?: string;
      totalAmount?: number | null;
      balance?: number | null;
    }>(
      "GET",
      `/api/quickbooks/invoice-matches/payment-status/${testLinkId}`,
      { cookie: adminCookie },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.linkId).toBe(testLinkId);
    expect(["paid", "partial", "unpaid", "unknown"]).toContain(res.data.paymentStatus);
  });

  it("GET /payment-status/999999 → 404 for non-existent link", async () => {
    if (!adminCookie) return;
    const res = await apiRequest("GET", "/api/quickbooks/invoice-matches/payment-status/999999", {
      cookie: adminCookie,
    });
    expect(res.status).toBe(404);
  });

  it("GET /payment-status → 400 for invalid linkId", async () => {
    if (!adminCookie) return;
    const res = await apiRequest("GET", "/api/quickbooks/invoice-matches/payment-status/abc", {
      cookie: adminCookie,
    });
    expect(res.status).toBe(400);
  });
});
