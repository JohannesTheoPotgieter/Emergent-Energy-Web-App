/**
 * QuickBooks route-hardening governance tests.
 *
 * These tests pin down the hardening applied to the QuickBooks integration
 * surface so any future regression (e.g. someone adding a new QB route with
 * only `requireAuth`, or reintroducing a QB-side COS realisation write) is
 * caught immediately.
 *
 * The QuickBooks integration lives at:
 *   - server/quickbooks-routes.ts                         (HTTP shell)
 *   - server/services/quickbooks-reconciliation-service.ts (orchestration)
 *
 * Hardening rules enforced here:
 *   1. Every QB route MUST carry an explicit permission middleware.
 *      `requireAuth`-only is forbidden — it must be paired with one of
 *      `requireAdmin`, `requirePermission(...)`, or `requireAuthority(...)`.
 *      The OAuth callback is the only exception (Intuit redirects the
 *      browser here without a session; CSRF state protects it).
 *   2. The QB mark-realised bypass endpoint MUST be disabled (HTTP 410
 *      Gone) and MUST not invoke any service function that mutates
 *      `cos_realised`.
 *   3. The QB reconciliation service MUST NOT export a helper that writes
 *      `cos_realised = true` directly. Marking a cost line as realised is
 *      reserved for the canonical finance control path
 *      (`/api/cos-tracker/toggle-realised/:id` in finance-routes.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const QB_ROUTES_PATH = "server/quickbooks-routes.ts";
const QB_RECON_SERVICE_PATH = "server/services/quickbooks-reconciliation-service.ts";
const FINANCE_ROUTES_PATH = "server/departments/finance-routes.ts";

describe("quickbooks route hardening — permission middleware", () => {
  const source = read(QB_ROUTES_PATH);

  it("imports the permission middleware and admin guard", () => {
    expect(source).toContain('from "./permission-middleware"');
    expect(source).toContain("requirePermission");
    expect(source).toContain("requireAdmin");
  });

  it("gates the OAuth start endpoint behind admin", () => {
    expect(source).toContain(
      'app.get("/api/quickbooks/auth", requireAuth, requireAdmin',
    );
  });

  it("gates the disconnect endpoint behind admin", () => {
    expect(source).toContain(
      'app.post("/api/quickbooks/disconnect", requireAuth, requireAdmin',
    );
  });

  it("gates every read-only QB data endpoint behind financial_integration:view", () => {
    const readEndpoints = [
      '/api/quickbooks/status',
      '/api/quickbooks/company',
      '/api/quickbooks/invoices',
      '/api/quickbooks/customers',
      '/api/quickbooks/vendors',
      '/api/quickbooks/bills',
      '/api/quickbooks/reports/pnl',
    ];
    for (const endpoint of readEndpoints) {
      expect(source).toContain(
        `app.get("${endpoint}", requireAuth, requirePermission("financial_integration", "view")`,
      );
    }
  });

  it("gates COS and revenue reconciliation reads behind financial_integration:view", () => {
    expect(source).toContain(
      '"/api/quickbooks/projects/:projectId/cos-reconciliation"',
    );
    expect(source).toContain(
      '"/api/quickbooks/projects/:projectId/revenue-reconciliation"',
    );
    // Structural check: the reconciliation handlers are the only multi-line
    // app.get entries, and both must include the financial_integration guard.
    const cosReconBlock = source.slice(
      source.indexOf('/cos-reconciliation'),
      source.indexOf('/cos-reconciliation') + 400,
    );
    const revReconBlock = source.slice(
      source.indexOf('/revenue-reconciliation'),
      source.indexOf('/revenue-reconciliation') + 400,
    );
    expect(cosReconBlock).toContain('requirePermission("financial_integration", "view")');
    expect(revReconBlock).toContain('requirePermission("financial_integration", "view")');
  });

  it("gates link writes behind financials:edit", () => {
    expect(source).toContain(
      'app.post("/api/quickbooks/links", requireAuth, requirePermission("financials", "edit")',
    );
    expect(source).toContain(
      'app.delete("/api/quickbooks/links/:id", requireAuth, requirePermission("financials", "edit")',
    );
    expect(source).toContain(
      'app.post("/api/quickbooks/revenue-links", requireAuth, requirePermission("financials", "edit")',
    );
  });

  it("gates link reads behind financials:view", () => {
    expect(source).toContain(
      'app.get("/api/quickbooks/links", requireAuth, requirePermission("financials", "view")',
    );
    expect(source).toContain(
      'app.get("/api/quickbooks/projects/:projectId/links", requireAuth, requirePermission("financials", "view")',
    );
  });

  it("gates customer mapping reads and writes behind financials:view / edit", () => {
    expect(source).toContain(
      'app.get("/api/quickbooks/customer-mappings", requireAuth, requirePermission("financials", "view")',
    );
    expect(source).toContain(
      'app.post("/api/quickbooks/customer-mappings", requireAuth, requirePermission("financials", "edit")',
    );
    expect(source).toContain(
      'app.delete("/api/quickbooks/customer-mappings/:id", requireAuth, requirePermission("financials", "edit")',
    );
  });

  it("gates the cost-lines search endpoint behind financials:view", () => {
    expect(source).toContain(
      'app.get("/api/quickbooks/cost-lines/search", requireAuth, requirePermission("financials", "view")',
    );
  });

  it("never leaves a QB route with requireAuth-only (except the OAuth callback)", () => {
    // Match every app.get / app.post / app.delete / app.put / app.patch route
    // up to the handler arrow (`=>`). The `s` flag lets `.` span newlines so
    // multi-line route definitions are captured.
    const routeMatches = [
      ...source.matchAll(/app\.(get|post|put|delete|patch)\(\s*("\/api\/quickbooks[^"]*")(.*?)=>/gs),
    ];
    expect(routeMatches.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const m of routeMatches) {
      const routePath = m[2];
      const middlewareBlock = m[3];
      // OAuth callback is intentionally not middleware-gated (Intuit redirect).
      if (routePath === '"/api/quickbooks/callback"') continue;

      const hasRequireAuth = /requireAuth/.test(middlewareBlock);
      const hasExplicitGuard =
        /requirePermission\(|requireAdmin|requireAuthority\(/.test(middlewareBlock);

      if (hasRequireAuth && !hasExplicitGuard) {
        offenders.push(routePath);
      }
    }
    expect(offenders, `QB routes with requireAuth-only: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("quickbooks route hardening — mark-realised bypass is disabled", () => {
  const source = read(QB_ROUTES_PATH);
  const service = read(QB_RECON_SERVICE_PATH);

  it("does not import markCostLineRealised from the reconciliation service", () => {
    expect(source).not.toContain("markCostLineRealised");
  });

  it("returns HTTP 410 Gone on POST /api/quickbooks/cost-lines/:id/mark-realised", () => {
    const markRealisedIdx = source.indexOf('"/api/quickbooks/cost-lines/:id/mark-realised"');
    expect(markRealisedIdx).toBeGreaterThan(-1);
    const block = source.slice(markRealisedIdx, markRealisedIdx + 800);
    expect(block).toContain("410");
    expect(block).toContain("quickbooks_mark_realised_disabled");
    // The response body must point callers at the canonical finance path.
    expect(block).toContain("/api/cos-tracker/toggle-realised/:id");
  });

  it("removes the markCostLineRealised export from the QB reconciliation service", () => {
    expect(service).not.toMatch(/export\s+async\s+function\s+markCostLineRealised/);
  });

  it("does not set cosRealised = true anywhere in the QB reconciliation service", () => {
    // Allow the read-side `cosRealised: row.cosRealised ?? null` projection,
    // but forbid any literal `cosRealised: true` update.
    expect(service).not.toMatch(/cosRealised:\s*true/);
  });

  it("keeps the canonical COS realisation path wired in finance-routes.ts", () => {
    const financeRoutes = read(FINANCE_ROUTES_PATH);
    // The canonical path is admin-gated and enforces the invoice / period
    // rules. If this line disappears, the QB bypass closure loses its
    // documented replacement.
    expect(financeRoutes).toMatch(/router\.patch\(\s*['"]\/api\/cos-tracker\/toggle-realised\/:id['"][\s\S]*?requireAuth[\s\S]*?requireAdmin/);
  });
});
