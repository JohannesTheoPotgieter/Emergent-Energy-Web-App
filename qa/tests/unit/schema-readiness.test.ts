import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import {
  computeReadinessFromHashes,
  setCachedSchemaReadiness,
  type HashedMigration,
  type SchemaReadiness,
} from "../../../server/lib/schema-readiness";
import {
  FINANCE_SCHEMA_GATE_PREFIXES,
  financeSchemaReadinessGate,
} from "../../../server/middleware/schema-readiness-gate";
import { errorHandler } from "../../../server/middleware/errorHandler";
import { buildHealthDiagnostics } from "../../../server/health-diagnostics";
import { ApiError } from "../../../server/lib/api-error";
import { getStartupModes } from "../../../server/startup-modes";

// A slice of the real journal. `0079_dev_drift_repair` carries the journal's
// largest (future-dated) `when` — the value that pins drizzle's created_at
// watermark above the 0090–0096 tail. Hash-presence detection must be immune
// to that, which is exactly what these tests pin down.
const MIGRATIONS: HashedMigration[] = [
  { idx: 79, when: 1_782_000_000_000, tag: "0079_dev_drift_repair", hash: "h0079" },
  { idx: 89, when: 1_780_666_762_196, tag: "0089_missing_tables_drift_repair", hash: "h0089" },
  { idx: 90, when: 1_780_702_383_723, tag: "0090_fiscal_period_backbone", hash: "h0090" },
  { idx: 91, when: 1_780_704_581_981, tag: "0091_financial_reconciliation_table", hash: "h0091" },
  { idx: 96, when: 1_780_756_356_998, tag: "0096_cos_line_recognition_override", hash: "h0096" },
];

const ALL_HASHES = MIGRATIONS.map((m) => m.hash);

function readiness(partial: Partial<SchemaReadiness> = {}): SchemaReadiness {
  return {
    ready: true,
    state: "ready",
    mode: "postgres",
    pendingMigrations: [],
    appliedCount: MIGRATIONS.length,
    totalCount: MIGRATIONS.length,
    checkedAt: new Date().toISOString(),
    ...partial,
  };
}

const behind = (): SchemaReadiness =>
  readiness({
    ready: false,
    state: "schema_behind",
    pendingMigrations: [
      "0090_fiscal_period_backbone",
      "0091_financial_reconciliation_table",
      "0096_cos_line_recognition_override",
    ],
    appliedCount: 2,
  });

describe("computeReadinessFromHashes", () => {
  it("is ready when every migration hash is recorded", () => {
    const result = computeReadinessFromHashes(MIGRATIONS, ALL_HASHES, "postgres");
    expect(result.ready).toBe(true);
    expect(result.state).toBe("ready");
    expect(result.pendingMigrations).toEqual([]);
    expect(result.appliedCount).toBe(MIGRATIONS.length);
  });

  it("reports the exact pending tail when 0090–0096 hashes are missing (incident)", () => {
    // The DB recorded everything THROUGH 0089 (including the future-dated 0079)
    // but not the 0090–0096 tail. A watermark check would wrongly pass here;
    // hash presence catches it.
    const applied = ["h0079", "h0089"];
    const result = computeReadinessFromHashes(MIGRATIONS, applied, "postgres");
    expect(result.ready).toBe(false);
    expect(result.state).toBe("schema_behind");
    expect(result.pendingMigrations).toEqual([
      "0090_fiscal_period_backbone",
      "0091_financial_reconciliation_table",
      "0096_cos_line_recognition_override",
    ]);
    expect(result.appliedCount).toBe(2);
    expect(result.totalCount).toBe(5);
  });

  it("lists pending migrations in journal (idx) order, not hash/when order", () => {
    // Only 0091 recorded — the rest pending. 0079 (largest `when`) must still
    // come first because listing is by idx, not by when.
    const result = computeReadinessFromHashes(MIGRATIONS, ["h0091"], "postgres");
    expect(result.pendingMigrations).toEqual([
      "0079_dev_drift_repair",
      "0089_missing_tables_drift_repair",
      "0090_fiscal_period_backbone",
      "0096_cos_line_recognition_override",
    ]);
  });

  it("fails open (unknown) when the bookkeeping table is empty (db:push / fresh DB)", () => {
    // An empty applied set with migrations present is a push-managed or fresh
    // DB — the schema may well be current; we must NOT 503 it as fully behind.
    const result = computeReadinessFromHashes(MIGRATIONS, [], "postgres");
    expect(result.state).toBe("unknown");
    expect(result.ready).toBe(true);
    expect(result.pendingMigrations).toEqual([]);
  });

  it("is ready for an empty journal", () => {
    const result = computeReadinessFromHashes([], [], "postgres");
    expect(result.ready).toBe(true);
    expect(result.state).toBe("ready");
    expect(result.pendingMigrations).toEqual([]);
  });
});

describe("financeSchemaReadinessGate", () => {
  const req = {} as unknown as Request;
  const res = {} as unknown as Response;

  beforeEach(() => {
    setCachedSchemaReadiness(readiness());
  });

  it("passes through when the schema is current", () => {
    let passedCleanly = false;
    let captured: unknown;
    const next: NextFunction = (err?: unknown) => {
      if (err) captured = err;
      else passedCleanly = true;
    };
    financeSchemaReadinessGate(req, res, next);
    expect(passedCleanly).toBe(true);
    expect(captured).toBeUndefined();
  });

  it("emits a typed 503 schema_behind (not a raw 500) when behind", () => {
    setCachedSchemaReadiness(behind());
    let captured: unknown;
    const next: NextFunction = (err?: unknown) => {
      captured = err;
    };
    financeSchemaReadinessGate(req, res, next);

    expect(captured).toBeInstanceOf(ApiError);
    const error = captured as ApiError;
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe("schema_behind");
    expect(error.details?.pendingMigrations).toContain("0091_financial_reconciliation_table");
    expect(error.details?.pendingCount).toBe("3");
  });

  it("fails open when readiness is unknown (never blocks finance on its own)", () => {
    setCachedSchemaReadiness(readiness({ state: "unknown", ready: true }));
    let passedCleanly = false;
    const next: NextFunction = (err?: unknown) => {
      if (!err) passedCleanly = true;
    };
    financeSchemaReadinessGate(req, res, next);
    expect(passedCleanly).toBe(true);
  });
});

describe("buildHealthDiagnostics schema state", () => {
  const dbStatus = { connected: true, mode: "postgres", message: "ok" };

  it("stays ok=200 and reports ready when the schema is current", () => {
    const diagnostics = buildHealthDiagnostics("postgres", dbStatus, getStartupModes(), readiness());
    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.reason).toBeUndefined();
    expect(diagnostics.schema?.state).toBe("ready");
  });

  it("flips ok=false (→503) and surfaces the pending list when behind", () => {
    const diagnostics = buildHealthDiagnostics("postgres", dbStatus, getStartupModes(), behind());
    expect(diagnostics.ok).toBe(false);
    expect(diagnostics.reason).toBe("schema_behind");
    expect(diagnostics.schema?.pendingMigrations).toContain("0091_financial_reconciliation_table");
  });

  it("is unchanged (backward compatible) when no readiness is supplied", () => {
    const diagnostics = buildHealthDiagnostics("postgres", dbStatus, getStartupModes());
    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.reason).toBeUndefined();
    expect(diagnostics.schema).toBeUndefined();
  });
});

// End-to-end proof through a real Express app: confirms the gate is correctly
// mounted/scoped on the finance prefixes and that the global error handler
// serialises a typed 503 with a correlation id (traceId) — not a raw 500.
describe("finance gate (HTTP integration)", () => {
  function buildApp() {
    const app = express();
    app.use(FINANCE_SCHEMA_GATE_PREFIXES, financeSchemaReadinessGate);
    app.get("/api/finance/lines", (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/api/reconciliation/board", (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/api/projects", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it("serves finance routes normally when the schema is current", async () => {
    setCachedSchemaReadiness(readiness());
    const res = await request(buildApp()).get("/api/finance/lines");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns a typed 503 schema_behind with a traceId when behind", async () => {
    setCachedSchemaReadiness(behind());
    const res = await request(buildApp()).get("/api/finance/lines");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("schema_behind");
    expect(res.body.code).toBe("schema_behind");
    expect(typeof res.body.traceId).toBe("string");
    expect(res.body.details.pendingMigrations).toContain("0091_financial_reconciliation_table");
  });

  it("gates every configured finance prefix", async () => {
    setCachedSchemaReadiness(behind());
    const res = await request(buildApp()).get("/api/reconciliation/board");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("schema_behind");
  });

  it("never gates non-finance routes, even when behind", async () => {
    setCachedSchemaReadiness(behind());
    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
