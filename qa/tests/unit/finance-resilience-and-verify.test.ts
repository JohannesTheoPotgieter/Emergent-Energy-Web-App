/**
 * feat/finance-resilience-and-verify — regression guards.
 *
 *  1. Graceful finance errors: a finance read handler that throws returns the
 *     TYPED error shape (error/code/type + message + correlation id), HTTP
 *     500/503, and NEVER a raw stack — in production no error detail leaks at
 *     all. Covers both `sendFinanceError` (the finance-route helper) and the
 *     central `errorHandler` backstop.
 *
 *  2. verify:finance: the pure evaluators behind
 *     server/scripts/verify-all-projects-reconciliation.ts classify app-vs-
 *     tracker ties, the period-lock guarantee, and the company-level R2
 *     snapshot consistency correctly — and the script is statically read-only
 *     (no insert/update/delete).
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendFinanceError, serviceUnavailable } from "../../../server/lib/api-error";
import { errorHandler } from "../../../server/middleware/errorHandler";
import { QB_RECON_TOLERANCE, type ReconSummaryRow } from "../../../server/services/qb-tracker-reconcile";
import {
  evaluateAppVsTracker,
  proveLockLogic,
  reconcileCompanySnapshot,
  formatVerificationCsv,
  type VerifyFinanceLine,
} from "../../../server/scripts/verify-all-projects-reconciliation";

/** Minimal Express-like response that captures status + JSON body. */
function mockRes() {
  return {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: Record<string, unknown>) {
      this.body = b;
      return this;
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  // The error helpers log the root cause server-side; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("graceful finance errors — typed shape + correlation id, no stack", () => {
  it("sendFinanceError returns a typed 500 with a traceId and the machine code", () => {
    const res = mockRes();
    sendFinanceError(res as never, "reconciliation_portfolio_failed", new Error("db exploded"));

    expect(res.statusCode).toBe(500);
    const body = res.body!;
    expect(body.error).toBe("reconciliation_portfolio_failed");
    expect(body.code).toBe("reconciliation_portfolio_failed");
    expect(body.type).toBe("reconciliation_portfolio_failed");
    expect(typeof body.message).toBe("string");
    expect(String(body.traceId)).toMatch(UUID_RE);
    // The correlation id is present so the client error ties to the server log.
    expect(body).not.toHaveProperty("stack");
  });

  it("supports a 503 for transient dependency failures", () => {
    const res = mockRes();
    sendFinanceError(res as never, "qb_recon_failed", new Error("QB down"), { status: 503 });
    expect(res.statusCode).toBe(503);
    expect(res.body!.code).toBe("qb_recon_failed");
    expect(String(res.body!.traceId)).toMatch(UUID_RE);

    // serviceUnavailable helper is a 503 ApiError.
    const apiErr = serviceUnavailable();
    expect(apiErr.statusCode).toBe(503);
    expect(apiErr.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("never leaks the raw error/stack to the client in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = mockRes();
      sendFinanceError(res as never, "company_overview_failed", new Error("SECRET internal detail"));
      const serialized = JSON.stringify(res.body);
      expect(res.body).not.toHaveProperty("stack");
      expect(res.body!.detail).toBeUndefined();
      expect(serialized).not.toContain("SECRET internal detail");
      // A friendly message + correlation id still reach the user.
      expect(String(res.body!.message).length).toBeGreaterThan(0);
      expect(String(res.body!.traceId)).toMatch(UUID_RE);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("central errorHandler turns an unexpected throw into a typed 500 (no stack)", () => {
    const res = mockRes();
    const next = vi.fn();
    errorHandler(
      new Error("unexpected boom"),
      { method: "GET", path: "/api/finance/reconciliation" } as never,
      res as never,
      next as never,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body!.code).toBe("SERVER_ERROR");
    expect(String(res.body!.traceId)).toMatch(UUID_RE);
    expect(res.body).not.toHaveProperty("stack");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("verify:finance — app vs tracker (per project × period)", () => {
  const line = (over: Partial<VerifyFinanceLine>): VerifyFinanceLine => ({
    lineId: 1,
    perLineRevenue: 100,
    revenueStored: 100,
    reconDelta: 0,
    derivationWarning: null,
    actualTotal: 60,
    perLineGp: 40,
    ...over,
  });

  it("PASSES when the app ties the tracker within R1 (green)", () => {
    const r = evaluateAppVsTracker([line({}), line({ lineId: 2 })]);
    expect(r.status).toBe("green");
    expect(r.pass).toBe(true);
    expect(r.warn).toBe(false);
    expect(r.appRevenue).toBe(200);
    expect(r.trackerRevenue).toBe(200);
    expect(r.revenueDelta).toBe(0);
    expect(r.appCos).toBe(120);
    expect(r.appGp).toBe(80);
    expect(r.comparableLines).toBe(2);
  });

  it("FAILS on drift beyond R1 (amber)", () => {
    const r = evaluateAppVsTracker([line({ perLineRevenue: 100, revenueStored: 90, reconDelta: -10 })]);
    expect(r.status).toBe("amber");
    expect(r.pass).toBe(false);
    expect(r.absDelta).toBe(10);
  });

  it("FAILS on a structural fault (red)", () => {
    const r = evaluateAppVsTracker([
      line({ revenueStored: null, reconDelta: null, derivationWarning: "orphan_actuals_row_no_parent" }),
    ]);
    expect(r.status).toBe("red");
    expect(r.pass).toBe(false);
  });

  it("WARNS (not fail) on an unlinked allocation — data readiness, not a tie failure", () => {
    const r = evaluateAppVsTracker([
      line({ revenueStored: null, reconDelta: null, derivationWarning: "category_revenue_allocation_missing" }),
    ]);
    expect(r.status).toBe("unlinked");
    expect(r.warn).toBe(true);
    expect(r.pass).toBe(false);
  });
});

describe("verify:finance — period lock blocks a write into a locked month", () => {
  it("proves block / override-without-reason / override-with-reason", () => {
    const p = proveLockLogic();
    expect(p.nonOverrideBlocked).toBe(true);
    expect(p.overrideNoReasonBlocked).toBe(true);
    expect(p.overrideWithReasonProceeds).toBe(true);
    expect(p.pass).toBe(true);
  });
});

describe("verify:finance — company-level tracker vs QuickBooks (R2)", () => {
  const stored: ReconSummaryRow[] = [
    {
      grain: "month",
      periodKey: "2026-03",
      fiscalPeriodId: 1,
      stream: "REV",
      trackerTotal: 1000,
      qbTotal: 950,
      matchedTotal: 900,
      varianceTotal: 5,
      trackerOnlyTotal: 100,
      qbOnlyTotal: 50,
    },
  ];

  it("PASSES when the stored summary ties to a re-summarise of its own lines", () => {
    const { rows, allPass } = reconcileCompanySnapshot(stored, stored);
    expect(allPass).toBe(true);
    expect(rows[0].pass).toBe(true);
    expect(rows[0].difference).toBe(50); // tracker − qb
    expect(rows[0].matched).toBe(900);
    expect(rows[0].trackerOnly).toBe(100);
    expect(rows[0].qbOnly).toBe(50);
  });

  it("FAILS when a stored field drifts beyond R1 from the lines", () => {
    const drifted: ReconSummaryRow[] = [{ ...stored[0], matchedTotal: 800 }];
    const { rows, allPass } = reconcileCompanySnapshot(stored, drifted);
    expect(allPass).toBe(false);
    expect(rows[0].worstFieldGap).toBeGreaterThan(QB_RECON_TOLERANCE);
  });

  it("FAILS when a period exists on only one side (corrupt snapshot)", () => {
    const { rows } = reconcileCompanySnapshot(stored, []);
    expect(rows[0].pass).toBe(false);
  });
});

describe("verify:finance — report + read-only guarantees", () => {
  it("formatVerificationCsv emits a tidy, CSV-escaped sheet across all scopes", () => {
    const csv = formatVerificationCsv(
      [
        {
          projectId: 1,
          projectName: "Site A, Phase 2",
          fiscalPeriodLabel: "FY26 · Mar",
          appRevenue: 100,
          trackerRevenue: 100,
          revenueDelta: 0,
          absDelta: 0,
          appCos: 60,
          appGp: 40,
          comparableLines: 1,
          status: "green",
          pass: true,
          warn: false,
        },
      ],
      [
        {
          periodKey: "2026-03",
          stream: "REV",
          trackerTotal: 1000,
          qbTotal: 950,
          matched: 900,
          variance: 5,
          trackerOnly: 100,
          qbOnly: 50,
          difference: 50,
          worstFieldGap: 0,
          pass: true,
        },
      ],
      { live: "no_locked_period", logic: proveLockLogic(), probedPeriod: null },
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("scope,project_id,project_name");
    expect(csv).toContain("project_period");
    expect(csv).toContain("company_period");
    expect(csv).toContain("period_lock");
    expect(csv).toContain('"Site A, Phase 2"'); // comma escaped
  });

  it("the verify script is statically read-only (no insert/update/delete)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "server/scripts/verify-all-projects-reconciliation.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\.\s*(insert|update|delete)\s*\(/);
  });
});
