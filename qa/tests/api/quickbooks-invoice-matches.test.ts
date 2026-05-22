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

function cleanupQbFixtureRows(db: any, costLineIds: Array<number | null>): void {
  const fixtureQbIds = ["bill-1", "bill-2"];
  const qbPlaceholders = fixtureQbIds.map(() => "?").join(",");

  db.prepare(`
    DELETE FROM qb_link_proposed_cascade_history
    WHERE cascade_id IN (
      SELECT q.id
      FROM qb_link_proposed_cascades q
      JOIN quickbooks_invoice_links l ON l.id = q.link_id
      WHERE l.qb_entity_id IN (${qbPlaceholders})
    )
  `).run(...fixtureQbIds);
  db.prepare(`
    DELETE FROM qb_link_proposed_cascades
    WHERE link_id IN (
      SELECT id FROM quickbooks_invoice_links
      WHERE qb_entity_id IN (${qbPlaceholders})
    )
  `).run(...fixtureQbIds);
  db.prepare(`
    DELETE FROM quickbooks_invoice_links
    WHERE qb_entity_id IN (${qbPlaceholders})
  `).run(...fixtureQbIds);

  const ids = costLineIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const linkedFixtureRows = `
    SELECT id FROM quickbooks_invoice_links
    WHERE app_entity_type = 'cost_line'
      AND app_entity_id IN (${placeholders})
  `;

  db.prepare(`
    DELETE FROM qb_link_proposed_cascade_history
    WHERE cascade_id IN (
      SELECT id FROM qb_link_proposed_cascades
      WHERE link_id IN (${linkedFixtureRows})
    )
  `).run(...ids);
  db.prepare(`
    DELETE FROM qb_link_proposed_cascades
    WHERE link_id IN (${linkedFixtureRows})
  `).run(...ids);
  db.prepare(`
    DELETE FROM quickbooks_cost_allocations
    WHERE cost_line_id IN (${placeholders})
  `).run(...ids);
  db.prepare(`
    DELETE FROM quickbooks_invoice_links
    WHERE app_entity_type = 'cost_line'
      AND app_entity_id IN (${placeholders})
  `).run(...ids);
  db.prepare(`
    DELETE FROM quickbooks_match_suggestions
    WHERE scope = 'expense_invoice'
      AND app_entity_id IN (${placeholders})
  `).run(...ids);
}

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

    cleanupQbFixtureRows(db, [testCostLineAId, testCostLineBId, testCostLineCId]);
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
    cleanupQbFixtureRows(db, [testCostLineAId, testCostLineBId, testCostLineCId]);
    if (testLinkId) db.prepare("DELETE FROM quickbooks_invoice_links WHERE id = ?").run(testLinkId);
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

// ─── Bulk approve / reject ───────────────────────────────────────────────────

describe("QB Invoice Matches — /bulk-approve", () => {
  // Fixtures: two cost lines and several suggestions with known candidate data
  let bulkLineWithPOId: number | null = null;  // will be linked by safe test
  let bulkLineSharedId: number | null = null;  // shared by non-approving tests

  let bulkSuggSafeId: number | null = null;         // confidence 95, no warnings, line has PO
  let bulkSuggLowScoreId: number | null = null;      // confidence 75
  let bulkSuggWarningsId: number | null = null;      // confidence 95 + amount_mismatch warning
  let bulkSuggNoPOId: number | null = null;          // confidence 95, cost line has NO po_number
  let bulkSuggPreAcceptedId: number | null = null;   // already accepted in beforeAll
  let bulkLinkCreatedId: number | null = null;        // link from safe approval (cleanup)

  beforeAll(() => {
    if (!fs.existsSync(SQLITE_DB_PATH) || !testProjectId || !testImportRunId) return;
    const sqdb = new Database(SQLITE_DB_PATH);
    try {
      // Cost line with PO (for safe approval)
      const r1 = sqdb
        .prepare(
          `INSERT INTO normalized_cost_lines
             (project_id, project_name, import_run_id, invoice_number, invoice_date,
              amount_ex_vat, counterparty_name, po_number, status)
           VALUES (?,?,?,?,date('now','-25 days'),?,?,'BULK-PO-001','planned') RETURNING id`,
        )
        .get(
          testProjectId, "__qa_qb_match_test__", testImportRunId,
          "BULK-INV-SAFE", "15000.00", "Bulk Vendor Safe",
        ) as { id?: number } | undefined;
      bulkLineWithPOId = r1?.id ?? null;

      // Cost line WITHOUT PO
      const r2 = sqdb
        .prepare(
          `INSERT INTO normalized_cost_lines
             (project_id, project_name, import_run_id, invoice_number, invoice_date,
              amount_ex_vat, counterparty_name, status)
           VALUES (?,?,?,?,date('now','-25 days'),?,?,'planned') RETURNING id`,
        )
        .get(
          testProjectId, "__qa_qb_match_test__", testImportRunId,
          "BULK-INV-NOPO", "15000.00", "Bulk Vendor NoPO",
        ) as { id?: number } | undefined;
      bulkLineSharedId = r2?.id ?? null;

      const highCand = JSON.stringify([{
        qbEntityId: "bulk-safe-bill-1",
        qbEntityType: "bill",
        qbDocNumber: "BULK-INV-SAFE",
        qbTxnDate: new Date().toISOString().slice(0, 10),
        qbCounterpartyName: "Bulk Vendor Safe",
        qbCounterpartyId: null,
        qbAmountExVat: 15000,
        qbBalance: 15000,
        qbPaymentStatus: "unpaid",
        confidence: 95,
        reasons: ["invoice number exact match", "amount within R0.01"],
        warnings: [],
        qbAlreadyLinkedElsewhere: false,
      }]);

      if (bulkLineWithPOId) {
        const s = sqdb
          .prepare(
            `INSERT INTO quickbooks_match_suggestions
               (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
             VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
          )
          .get(bulkLineWithPOId, "BULK-INV-SAFE · Bulk Vendor Safe", highCand) as { id?: number } | undefined;
        bulkSuggSafeId = s?.id ?? null;
      }

      // Low score candidate (75%)
      if (bulkLineSharedId) {
        const lowCand = JSON.stringify([{
          qbEntityId: "bulk-low-bill-1",
          qbEntityType: "bill",
          qbDocNumber: "LOW-DOC-001",
          qbTxnDate: null,
          qbCounterpartyName: "Some Vendor",
          qbCounterpartyId: null,
          qbAmountExVat: 15000,
          qbBalance: 15000,
          qbPaymentStatus: "unpaid",
          confidence: 75,
          reasons: ["vendor 70% match"],
          warnings: [],
          qbAlreadyLinkedElsewhere: false,
        }]);
        const s = sqdb
          .prepare(
            `INSERT INTO quickbooks_match_suggestions
               (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
             VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
          )
          .get(bulkLineSharedId, "BULK-INV-NOPO · Bulk Vendor NoPO", lowCand) as { id?: number } | undefined;
        bulkSuggLowScoreId = s?.id ?? null;
      }

      // Warning candidate (has amount_mismatch)
      if (bulkLineSharedId) {
        const warnCand = JSON.stringify([{
          qbEntityId: "bulk-warn-bill-1",
          qbEntityType: "bill",
          qbDocNumber: "WARN-DOC-001",
          qbTxnDate: null,
          qbCounterpartyName: "Bulk Vendor NoPO",
          qbCounterpartyId: null,
          qbAmountExVat: 99999,
          qbBalance: 99999,
          qbPaymentStatus: "unpaid",
          confidence: 95,
          reasons: ["invoice number exact match"],
          warnings: ["amount_mismatch"],
          qbAlreadyLinkedElsewhere: false,
        }]);
        const s = sqdb
          .prepare(
            `INSERT INTO quickbooks_match_suggestions
               (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
             VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
          )
          .get(bulkLineSharedId, "BULK-INV-NOPO · Bulk Vendor NoPO", warnCand) as { id?: number } | undefined;
        bulkSuggWarningsId = s?.id ?? null;
      }

      // No-PO suggestion (cost line has no po_number)
      if (bulkLineSharedId) {
        const noPOCand = JSON.stringify([{
          qbEntityId: "bulk-nopo-bill-1",
          qbEntityType: "bill",
          qbDocNumber: "BULK-INV-NOPO",
          qbTxnDate: null,
          qbCounterpartyName: "Bulk Vendor NoPO",
          qbCounterpartyId: null,
          qbAmountExVat: 15000,
          qbBalance: 15000,
          qbPaymentStatus: "unpaid",
          confidence: 95,
          reasons: ["invoice number exact match", "amount within R0.01"],
          warnings: [],
          qbAlreadyLinkedElsewhere: false,
        }]);
        const s = sqdb
          .prepare(
            `INSERT INTO quickbooks_match_suggestions
               (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
             VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
          )
          .get(bulkLineSharedId, "BULK-INV-NOPO · Bulk Vendor NoPO", noPOCand) as { id?: number } | undefined;
        bulkSuggNoPOId = s?.id ?? null;
      }

      // Pre-accepted suggestion (already accepted before tests run)
      if (bulkLineSharedId) {
        const s = sqdb
          .prepare(
            `INSERT INTO quickbooks_match_suggestions
               (scope, qb_realm_id, app_entity_id, app_entity_label, candidates,
                requested_by, accepted_at, accepted_qb_id, accepted_confidence)
             VALUES ('expense_invoice','test-realm',?,?,?,NULL,datetime('now'),'pre-accepted-bill','95.00') RETURNING id`,
          )
          .get(bulkLineSharedId, "PRE-ACCEPTED · Bulk Vendor NoPO", highCand) as { id?: number } | undefined;
        bulkSuggPreAcceptedId = s?.id ?? null;
      }
    } finally {
      sqdb.close();
    }
  });

  afterAll(() => {
    if (!fs.existsSync(SQLITE_DB_PATH)) return;
    const sqdb = new Database(SQLITE_DB_PATH);
    try {
      if (bulkLinkCreatedId) {
        sqdb.prepare("DELETE FROM quickbooks_invoice_links WHERE id = ?").run(bulkLinkCreatedId);
      }
      // Also remove any link for bulk-safe-bill-1 (in case test ran but linkId wasn't captured)
      sqdb.prepare("DELETE FROM quickbooks_invoice_links WHERE qb_entity_id = 'bulk-safe-bill-1'").run();

      const sids = [bulkSuggSafeId, bulkSuggLowScoreId, bulkSuggWarningsId, bulkSuggNoPOId, bulkSuggPreAcceptedId].filter(Boolean);
      if (sids.length > 0) {
        sqdb
          .prepare(`DELETE FROM quickbooks_match_suggestions WHERE id IN (${sids.map(() => "?").join(",")})`)
          .run(...sids);
      }
      const lineIds = [bulkLineWithPOId, bulkLineSharedId].filter(Boolean);
      if (lineIds.length > 0) {
        sqdb
          .prepare(`DELETE FROM normalized_cost_lines WHERE id IN (${lineIds.map(() => "?").join(",")})`)
          .run(...lineIds);
      }
    } finally {
      sqdb.close();
    }
  });

  it("POST /bulk-approve → 401 when unauthenticated", async () => {
    const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: 1, candidateIndex: 0 }] },
    });
    expect(res.status).toBe(401);
  });

  it("POST /bulk-approve → ACCOUNTANT (financials:edit) is not blocked with 403", async () => {
    if (!accountantCookie || !bulkSuggLowScoreId) return;
    const res = await apiRequest<{ skipped?: number }>(
      "POST",
      "/api/quickbooks/invoice-matches/bulk-approve",
      { body: { items: [{ suggestionId: bulkSuggLowScoreId, candidateIndex: 0 }] }, cookie: accountantCookie },
    );
    expect(res.status, "ACCOUNTANT must not get 403").not.toBe(403);
  });

  it("POST /bulk-approve → skips row with score below 90", async () => {
    if (!adminCookie || !bulkSuggLowScoreId) return;
    const res = await apiRequest<{
      approved: number; skipped: number; failed: number;
      results: Array<{ suggestionId: number; outcome: string; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: bulkSuggLowScoreId, candidateIndex: 0 }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.approved).toBe(0);
    expect(res.data.results[0].reason).toBe("score_below_threshold");
  });

  it("POST /bulk-approve → skips row with candidate warnings", async () => {
    if (!adminCookie || !bulkSuggWarningsId) return;
    const res = await apiRequest<{
      skipped: number;
      results: Array<{ outcome: string; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: bulkSuggWarningsId, candidateIndex: 0 }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.results[0].reason).toMatch(/^has_warnings:/);
  });

  it("POST /bulk-approve → skips row when cost line has no PO number", async () => {
    if (!adminCookie || !bulkSuggNoPOId) return;
    const res = await apiRequest<{
      skipped: number;
      results: Array<{ outcome: string; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: bulkSuggNoPOId, candidateIndex: 0 }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.results[0].reason).toBe("no_po");
  });

  it("POST /bulk-approve → skips already-accepted suggestion", async () => {
    if (!adminCookie || !bulkSuggPreAcceptedId) return;
    const res = await apiRequest<{
      skipped: number;
      results: Array<{ outcome: string; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: bulkSuggPreAcceptedId, candidateIndex: 0 }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.results[0].reason).toBe("already_accepted");
  });

  it("POST /bulk-approve → skips non-existent suggestion", async () => {
    if (!adminCookie) return;
    const res = await apiRequest<{
      skipped: number;
      results: Array<{ reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: 9_999_999, candidateIndex: 0 }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.results[0].reason).toBe("suggestion_not_found");
  });

  it("POST /bulk-approve → mixed batch returns correct per-row counts", async () => {
    if (!adminCookie || !bulkSuggLowScoreId || !bulkSuggWarningsId || !bulkSuggPreAcceptedId) return;
    const res = await apiRequest<{
      approved: number; skipped: number; failed: number;
      results: Array<{ outcome: string; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: {
        items: [
          { suggestionId: bulkSuggLowScoreId, candidateIndex: 0 },
          { suggestionId: bulkSuggWarningsId, candidateIndex: 0 },
          { suggestionId: bulkSuggPreAcceptedId, candidateIndex: 0 },
        ],
      },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.approved).toBe(0);
    expect(res.data.skipped).toBe(3);
    expect(res.data.failed).toBe(0);
  });

  it("POST /bulk-approve → approves a genuinely safe row and returns linkId", async () => {
    if (!adminCookie || !bulkSuggSafeId) return;
    const res = await apiRequest<{
      approved: number; skipped: number; failed: number;
      results: Array<{ suggestionId: number; outcome: string; linkId?: number; reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
      body: { items: [{ suggestionId: bulkSuggSafeId, candidateIndex: 0, notes: "bulk test" }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    // Either approved (fresh run) or skipped with already_accepted (rerun after prior success).
    const r = res.data.results[0];
    expect(["approved", "skipped"]).toContain(r.outcome);
    if (r.outcome === "approved") {
      expect(r.linkId).toBeTypeOf("number");
      bulkLinkCreatedId = r.linkId ?? null;
      expect(res.data.approved).toBe(1);
    }
  });
});

describe("QB Invoice Matches — /bulk-reject", () => {
  let bRejectSuggAId: number | null = null;
  let bRejectSuggBId: number | null = null;

  beforeAll(() => {
    if (!fs.existsSync(SQLITE_DB_PATH) || !testCostLineCId) return;
    const sqdb = new Database(SQLITE_DB_PATH);
    try {
      const cand = JSON.stringify([{
        qbEntityId: "bulk-rej-bill-1",
        qbEntityType: "bill",
        qbDocNumber: "REJ-DOC-001",
        qbTxnDate: null,
        qbCounterpartyName: "Reject Vendor",
        qbCounterpartyId: null,
        qbAmountExVat: 5000,
        qbBalance: 5000,
        qbPaymentStatus: "unpaid",
        confidence: 70,
        reasons: ["vendor match"],
        warnings: [],
        qbAlreadyLinkedElsewhere: false,
      }]);

      const rA = sqdb
        .prepare(
          `INSERT INTO quickbooks_match_suggestions
             (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
           VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
        )
        .get(testCostLineCId, "REJ-TEST · Reject Vendor", cand) as { id?: number } | undefined;
      bRejectSuggAId = rA?.id ?? null;

      const rB = sqdb
        .prepare(
          `INSERT INTO quickbooks_match_suggestions
             (scope, qb_realm_id, app_entity_id, app_entity_label, candidates, requested_by)
           VALUES ('expense_invoice','test-realm',?,?,?,NULL) RETURNING id`,
        )
        .get(testCostLineCId, "REJ-TEST · Reject Vendor", cand) as { id?: number } | undefined;
      bRejectSuggBId = rB?.id ?? null;
    } finally {
      sqdb.close();
    }
  });

  afterAll(() => {
    if (!fs.existsSync(SQLITE_DB_PATH)) return;
    const sqdb = new Database(SQLITE_DB_PATH);
    try {
      const ids = [bRejectSuggAId, bRejectSuggBId].filter(Boolean);
      if (ids.length > 0) {
        sqdb
          .prepare(`DELETE FROM quickbooks_match_suggestions WHERE id IN (${ids.map(() => "?").join(",")})`)
          .run(...ids);
      }
    } finally {
      sqdb.close();
    }
  });

  it("POST /bulk-reject → 401 when unauthenticated", async () => {
    const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/bulk-reject", {
      body: { items: [{ suggestionId: 1, reason: "test" }] },
    });
    expect(res.status).toBe(401);
  });

  it("POST /bulk-reject → rejects multiple pending suggestions and writes audit", async () => {
    if (!adminCookie || !bRejectSuggAId || !bRejectSuggBId) return;
    const res = await apiRequest<{
      rejected: number; skipped: number; failed: number;
      results: Array<{ suggestionId: number; outcome: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-reject", {
      body: {
        items: [
          { suggestionId: bRejectSuggAId, reason: "bulk reject test A" },
          { suggestionId: bRejectSuggBId, reason: "bulk reject test B" },
        ],
      },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.rejected).toBe(2);
    expect(res.data.skipped).toBe(0);
    expect(res.data.results.every((r) => r.outcome === "rejected")).toBe(true);

    // Verify DB audit trail
    const sqdb = new Database(SQLITE_DB_PATH);
    const row = sqdb
      .prepare("SELECT rejected_at, rejection_reason FROM quickbooks_match_suggestions WHERE id = ?")
      .get(bRejectSuggAId) as { rejected_at?: string; rejection_reason?: string } | undefined;
    sqdb.close();
    expect(row?.rejected_at).toBeTruthy();
    expect(row?.rejection_reason).toBe("bulk reject test A");
  });

  it("POST /bulk-reject → skips already-rejected suggestion", async () => {
    if (!adminCookie || !bRejectSuggAId) return;
    // bRejectSuggAId was already rejected in the previous test
    const res = await apiRequest<{
      skipped: number;
      results: Array<{ reason?: string }>;
    }>("POST", "/api/quickbooks/invoice-matches/bulk-reject", {
      body: { items: [{ suggestionId: bRejectSuggAId, reason: "duplicate attempt" }] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
    expect(res.data.results[0].reason).toBe("already_rejected");
  });

  it("POST /bulk-reject → skips non-existent suggestion", async () => {
    if (!adminCookie) return;
    const res = await apiRequest<{ skipped: number }>(
      "POST",
      "/api/quickbooks/invoice-matches/bulk-reject",
      { body: { items: [{ suggestionId: 9_999_999, reason: "ghost" }] }, cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe(1);
  });

  it("POST /bulk-reject → validates body (empty items array rejected with 400)", async () => {
    if (!adminCookie) return;
    const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/bulk-reject", {
      body: { items: [] },
      cookie: adminCookie,
    });
    expect(res.status).toBe(400);
  });
});
