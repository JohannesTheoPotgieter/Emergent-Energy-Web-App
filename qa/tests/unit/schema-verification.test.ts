/**
 * Column-level schema verification — the "ledger is not proof" guard.
 *
 * The migration ledger can report a migration applied while its DDL never
 * ran (0071 lost the whole change_requests actor-trail column set; the
 * same class caused the 0090–0096 outage). These tests pin the portable
 * core in server/lib/schema-verification.ts:
 *
 *   1. deriveExpectedTables() reads the REAL shared/schema barrel and must
 *      include the exact artifacts the 0071 incident lost — if those
 *      declarations ever vanish, the drift repair stops being verifiable.
 *   2. compareSchemas() flags MISSING tables/columns and treats EXTRAS as
 *      informational (additive-only policy — extras must never 503 prod).
 *   3. planAdditiveRepair() emits guarded, additive DDL only.
 *   4. The finance gate emits one typed 503 schema_drift (never a raw 500)
 *      while drift is positively determined, and fails OPEN otherwise.
 *   5. Health diagnostics report ok=false / reason=schema_drift.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  buildVerification,
  compareSchemas,
  deriveExpectedTables,
  formatDriftSummary,
  isSchemaDrifted,
  planAdditiveRepair,
  setCachedSchemaVerification,
  type ExpectedTable,
  type LiveColumn,
  type SchemaVerification,
} from "../../../server/lib/schema-verification";
import { setCachedSchemaReadiness, type SchemaReadiness } from "../../../server/lib/schema-readiness";
import { financeSchemaReadinessGate } from "../../../server/middleware/schema-readiness-gate";
import { buildHealthDiagnostics } from "../../../server/health-diagnostics";
import { getStartupModes } from "../../../server/startup-modes";
import { ApiError } from "../../../server/lib/api-error";

function verification(partial: Partial<SchemaVerification> = {}): SchemaVerification {
  return {
    ok: true,
    state: "aligned",
    mode: "postgres",
    missingTables: [],
    missingColumns: [],
    extraTables: [],
    extraColumns: [],
    expectedTableCount: 1,
    checkedAt: new Date().toISOString(),
    ...partial,
  };
}

const drifted = (): SchemaVerification =>
  verification({
    ok: false,
    state: "schema_drift",
    missingTables: ["post_handover_reviews"],
    missingColumns: [
      { table: "change_requests", column: "submitted_by_user_id" },
      { table: "change_requests", column: "approver_user_id" },
    ],
  });

const readiness = (partial: Partial<SchemaReadiness> = {}): SchemaReadiness => ({
  ready: true,
  state: "ready",
  mode: "postgres",
  pendingMigrations: [],
  appliedCount: 1,
  totalCount: 1,
  checkedAt: new Date().toISOString(),
  ...partial,
});

describe("deriveExpectedTables — real shared/schema barrel", () => {
  const tables = deriveExpectedTables();
  const byName = new Map(tables.map((t) => [t.name, t]));

  it("declares the change_requests actor-trail columns the 0071 incident lost", () => {
    const changeRequests = byName.get("change_requests");
    expect(changeRequests, "change_requests must be a Drizzle pgTable").toBeDefined();
    const columns = new Set(changeRequests!.columns.map((c) => c.name));
    for (const column of [
      "submitted_by_user_id",
      "submitted_at",
      "reviewer_user_id",
      "review_started_at",
      "approver_user_id",
      "approved_at",
      "rejection_reason",
      "rejected_at",
    ]) {
      expect(columns.has(column), `change_requests.${column} missing from shared/schema`).toBe(true);
    }
  });

  it("declares the other 0071 artifacts (post_handover_reviews, handover_packs, sseg_items)", () => {
    expect(byName.has("post_handover_reviews")).toBe(true);
    const handoverPacks = new Set(byName.get("handover_packs")?.columns.map((c) => c.name));
    expect(handoverPacks.has("client_submitted_by_user_id")).toBe(true);
    expect(handoverPacks.has("matriarch_accepted_by_user_id")).toBe(true);
    const ssegItems = new Set(byName.get("sseg_items")?.columns.map((c) => c.name));
    expect(ssegItems.has("techsitter_confirmed_by_user_id")).toBe(true);
    expect(ssegItems.has("metering_confirmed_at")).toBe(true);
  });

  it("covers the full schema surface (sanity: a few hundred tables, unique qualified names)", () => {
    expect(tables.length).toBeGreaterThan(100);
    expect(new Set(tables.map((t) => `${t.schema}.${t.name}`)).size).toBe(tables.length);
  });

  it("carries non-public schemas (core.departments broke migrate-from-zero when unqualified)", () => {
    const departments = tables.find((t) => t.name === "departments" && t.schema === "core");
    expect(departments, "core.departments must be derived with its schema").toBeDefined();
    const roleDefinitions = tables.find((t) => t.name === "role_definitions");
    expect(roleDefinitions?.schema).toBe("core");
  });
});

describe("compareSchemas", () => {
  const expected: ExpectedTable[] = [
    {
      schema: "public",
      name: "change_requests",
      columns: [
        { name: "id", sqlType: "serial", notNull: true, defaultSql: null, primary: true },
        { name: "submitted_by_user_id", sqlType: "integer", notNull: false, defaultSql: null, primary: false },
      ],
    },
    {
      schema: "public",
      name: "post_handover_reviews",
      columns: [{ name: "id", sqlType: "serial", notNull: true, defaultSql: null, primary: true }],
    },
  ];

  it("reports aligned when every declared artifact exists", () => {
    const live: LiveColumn[] = [
      { schemaName: "public", tableName: "change_requests", columnName: "id" },
      { schemaName: "public", tableName: "change_requests", columnName: "submitted_by_user_id" },
      { schemaName: "public", tableName: "post_handover_reviews", columnName: "id" },
    ];
    const comparison = compareSchemas(expected, live);
    expect(comparison.missingTables).toEqual([]);
    expect(comparison.missingColumns).toEqual([]);
    expect(buildVerification(comparison, expected.length).state).toBe("aligned");
  });

  it("detects the 0071 incident shape: ledger-applied table present, columns missing", () => {
    const live: LiveColumn[] = [
      { schemaName: "public", tableName: "change_requests", columnName: "id" },
      // submitted_by_user_id missing; post_handover_reviews entirely missing
    ];
    const comparison = compareSchemas(expected, live);
    expect(comparison.missingTables).toEqual(["post_handover_reviews"]);
    expect(comparison.missingColumns).toEqual([
      { table: "change_requests", column: "submitted_by_user_id" },
    ]);
    const result = buildVerification(comparison, expected.length);
    expect(result.ok).toBe(false);
    expect(result.state).toBe("schema_drift");
    expect(formatDriftSummary(result)).toContain("change_requests.submitted_by_user_id");
  });

  it("treats EXTRA tables/columns as informational, never drift (additive-only policy)", () => {
    const live: LiveColumn[] = [
      { schemaName: "public", tableName: "change_requests", columnName: "id" },
      { schemaName: "public", tableName: "change_requests", columnName: "submitted_by_user_id" },
      { schemaName: "public", tableName: "change_requests", columnName: "legacy_only_column" },
      { schemaName: "public", tableName: "post_handover_reviews", columnName: "id" },
      { schemaName: "public", tableName: "some_legacy_table", columnName: "id" },
    ];
    const comparison = compareSchemas(expected, live);
    expect(comparison.extraTables).toEqual(["some_legacy_table"]);
    expect(comparison.extraColumns).toEqual([
      { table: "change_requests", column: "legacy_only_column" },
    ]);
    expect(buildVerification(comparison, expected.length).ok).toBe(true);
  });
});

describe("planAdditiveRepair", () => {
  const expected: ExpectedTable[] = [
    {
      schema: "public",
      name: "change_requests",
      columns: [
        { name: "id", sqlType: "serial", notNull: true, defaultSql: null, primary: true },
        { name: "submitted_by_user_id", sqlType: "integer", notNull: false, defaultSql: null, primary: false },
        { name: "status", sqlType: "text", notNull: true, defaultSql: "'draft'", primary: false },
        { name: "strict_no_default", sqlType: "text", notNull: true, defaultSql: null, primary: false },
      ],
    },
  ];

  it("emits guarded additive DDL for missing columns", () => {
    const comparison = compareSchemas(expected, [
      { schemaName: "public", tableName: "change_requests", columnName: "id" },
    ]);
    const plan = planAdditiveRepair(expected, comparison);
    expect(plan).toContain(
      'ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "submitted_by_user_id" integer',
    );
    expect(plan).toContain(
      'ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "status" text DEFAULT \'draft\' NOT NULL',
    );
  });

  it("never emits a bare NOT NULL add without a default (fails on populated tables)", () => {
    const comparison = compareSchemas(expected, [
      { schemaName: "public", tableName: "change_requests", columnName: "id" },
    ]);
    const plan = planAdditiveRepair(expected, comparison);
    const strictAdd = plan.find((s) => s.includes('"strict_no_default"'));
    expect(strictAdd).toBe(
      'ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "strict_no_default" text',
    );
  });

  it("creates missing tables guarded, with primary key, and emits no drops", () => {
    const comparison = compareSchemas(expected, []);
    const plan = planAdditiveRepair(expected, comparison);
    expect(plan[0]).toContain('CREATE TABLE IF NOT EXISTS "change_requests"');
    expect(plan[0]).toContain('"id" serial PRIMARY KEY');
    for (const statement of plan) {
      expect(statement).not.toMatch(/\bDROP\b/i);
    }
  });
});

describe("financeSchemaReadinessGate — schema_drift maintenance state", () => {
  const req = {} as unknown as Request;
  const res = {} as unknown as Response;

  beforeEach(() => {
    setCachedSchemaReadiness(readiness());
    setCachedSchemaVerification(verification());
  });

  afterEach(() => {
    // Never leak a drifted cache into other suites in this worker.
    setCachedSchemaVerification(verification());
  });

  it("passes through when aligned", () => {
    let passedCleanly = false;
    const next: NextFunction = (err?: unknown) => {
      if (!err) passedCleanly = true;
    };
    financeSchemaReadinessGate(req, res, next);
    expect(passedCleanly).toBe(true);
  });

  it("emits a typed 503 schema_drift naming the missing artifacts when drifted", () => {
    setCachedSchemaVerification(drifted());
    let captured: unknown;
    const next: NextFunction = (err?: unknown) => {
      captured = err;
    };
    financeSchemaReadinessGate(req, res, next);
    expect(captured).toBeInstanceOf(ApiError);
    const apiError = captured as ApiError;
    expect(apiError.statusCode).toBe(503);
    expect(apiError.code).toBe("schema_drift");
    expect(JSON.stringify(apiError.details)).toContain("change_requests.submitted_by_user_id");
  });

  it("fails OPEN on unknown verification state (never self-inflicts an outage)", () => {
    setCachedSchemaVerification(verification({ state: "unknown" }));
    let passedCleanly = false;
    const next: NextFunction = (err?: unknown) => {
      if (!err) passedCleanly = true;
    };
    financeSchemaReadinessGate(req, res, next);
    expect(passedCleanly).toBe(true);
    expect(isSchemaDrifted(verification({ state: "unknown" }))).toBe(false);
    expect(isSchemaDrifted(null)).toBe(false);
  });
});

describe("buildHealthDiagnostics — schema_drift surface", () => {
  const dbStatus = { connected: true, mode: "postgres", message: "ok" };

  it("reports ok=false with reason schema_drift and the missing artifacts", () => {
    const diagnostics = buildHealthDiagnostics(
      "postgres",
      dbStatus,
      getStartupModes(),
      readiness(),
      drifted(),
    );
    expect(diagnostics.ok).toBe(false);
    expect(diagnostics.reason).toBe("schema_drift");
    expect(diagnostics.schemaVerification?.missingColumns).toContain(
      "change_requests.submitted_by_user_id",
    );
  });

  it("stays ok when verification is aligned", () => {
    const diagnostics = buildHealthDiagnostics(
      "postgres",
      dbStatus,
      getStartupModes(),
      readiness(),
      verification(),
    );
    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.reason).toBeUndefined();
  });
});
