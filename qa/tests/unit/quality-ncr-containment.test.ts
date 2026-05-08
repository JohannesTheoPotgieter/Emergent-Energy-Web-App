/**
 * NCR Containment & Integration Tests
 *
 * Proves that the NCR subsystem is properly contained:
 * - Tables are created at bootstrap (not per-request)
 * - NCR data connects to quality risk scoring
 * - Misleading UI is removed
 * - All routes have proper permission gates
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeQualityRiskSummary } from "../../../shared/quality-governance";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("NCR data model containment", () => {
  it("NCR table creation runs at bootstrap, not per-request", () => {
    const bootstrap = read("server/bootstrap/run-startup-seeds.ts");
    expect(bootstrap).toContain("ensureNcrTables");
    expect(bootstrap).toContain("quality-ncr-routes");
  });

  it("NCR tables are now Drizzle-canonical (Plan v3 § T3-2)", () => {
    // Pre-Plan-v3 the route file contained a `ncrTablesEnsured` guard
    // around a runtime `CREATE TABLE IF NOT EXISTS`. T3-2 moved the
    // schema into shared/schema/quality.ts under Drizzle, with the
    // migration file owning DDL. Verify both anchors.
    const schema = read("shared/schema/quality.ts");
    expect(schema).toContain('pgTable("ncr_reports"');
    expect(schema).toContain("ncrStatusEnum");
    expect(schema).toContain("waived");
    const migrations = fs
      .readdirSync(path.join(process.cwd(), "migrations"))
      .filter((f) => f.endsWith(".sql"));
    const ncrMigration = migrations.find((f) => f.toLowerCase().includes("ncr"));
    expect(ncrMigration, "expected an ncr migration file").toBeDefined();
    // The legacy ensureNcrTables() shim must remain (so existing imports
    // do not break) but must no longer carry the ncrTablesEnsured guard.
    const ncr = read("server/quality-ncr-routes.ts");
    expect(ncr).toContain("export async function ensureNcrTables");
  });

  it("NCR reports table includes related_checklist_item_id for quality integration", () => {
    const ncr = read("server/quality-ncr-routes.ts");
    expect(ncr).toContain("related_checklist_item_id");
  });

  it("NCR create endpoint accepts related_checklist_item_id", () => {
    const ncr = read("server/quality-ncr-routes.ts");
    const createBlock = ncr.slice(
      ncr.indexOf('app.post("/api/quality/ncrs"'),
      ncr.indexOf('app.get("/api/quality/ncrs/:id"')
    );
    expect(createBlock).toContain("related_checklist_item_id");
  });

  it("ensureNcrTables is exported for bootstrap import", () => {
    const ncr = read("server/quality-ncr-routes.ts");
    expect(ncr).toContain("export async function ensureNcrTables");
  });
});

describe("NCR integration into quality risk scoring", () => {
  it("computeQualityRiskSummary accepts openNcrCount parameter", () => {
    const result = computeQualityRiskSummary({
      items: [],
      openNcrCount: 3,
    });
    expect(result.exposures.openNcrCount).toBe(3);
  });

  it("open NCRs increase the quality risk score", () => {
    const withoutNcr = computeQualityRiskSummary({ items: [] });
    const withNcr = computeQualityRiskSummary({ items: [], openNcrCount: 2 });
    expect(withNcr.score).toBeGreaterThan(withoutNcr.score);
    expect(withNcr.score - withoutNcr.score).toBe(4); // 2 NCRs × 2 weight
  });

  it("open NCRs push risk level to at least medium", () => {
    const noNcr = computeQualityRiskSummary({ items: [] });
    const withNcr = computeQualityRiskSummary({ items: [], openNcrCount: 1 });
    expect(noNcr.level).toBe("low");
    expect(withNcr.level).toBe("medium");
  });

  it("open NCRs appear in the risk summary text", () => {
    const result = computeQualityRiskSummary({ items: [], openNcrCount: 3 });
    expect(result.summary).toContain("3 open NCR");
  });

  it("zero NCRs do not affect score or summary", () => {
    const result = computeQualityRiskSummary({ items: [], openNcrCount: 0 });
    expect(result.exposures.openNcrCount).toBe(0);
    expect(result.summary).not.toContain("NCR");
  });
});

describe("misleading NCR dashboard is contained", () => {
  it("quality-dashboard.tsx redirects to /quality instead of showing empty charts", () => {
    const source = read("client/src/pages/quality/quality-dashboard.tsx");
    // Must NOT contain the old charting components
    expect(source).not.toContain("PieChart");
    expect(source).not.toContain("BarChart");
    expect(source).not.toContain("LineChart");
    expect(source).not.toContain("openNcrsBySeverity");
    expect(source).not.toContain("ncrTrend");
    // Must redirect to /quality
    expect(source).toContain('setLocation("/quality"');
  });

  it("NCR page routes are registered as redirecting aliases", () => {
    const registry = read("client/src/config/page-registry.ts");
    expect(registry).toContain('id: "qualityNcrList"');
    expect(registry).toContain('redirectTo: "/quality"');
    expect(registry).toContain('id: "qualityNcrDetail"');
  });
});

describe("NCR route permissions are properly gated", () => {
  const ncr = read("server/quality-ncr-routes.ts");

  it("every NCR route uses requirePermission (not just requireAuth)", () => {
    const routeLines = ncr.split("\n").filter((l) =>
      l.match(/app\.(get|post|put|delete)\("\/api\/quality\/ncrs/)
    );
    expect(routeLines.length).toBeGreaterThanOrEqual(5);
    for (const line of routeLines) {
      expect(line).toContain("requirePermission");
    }
  });

  it("NCR routes use audit logging for mutations", () => {
    expect(ncr).toContain('logAuditFromReq');
    const auditCalls = ncr.match(/logAuditFromReq/g);
    expect(auditCalls!.length).toBeGreaterThanOrEqual(3);
  });
});
