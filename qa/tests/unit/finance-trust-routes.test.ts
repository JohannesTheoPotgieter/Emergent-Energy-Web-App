/**
 * Finance trust routes — static source pin.
 *
 * These tests guard the NEW finance trust endpoints against accidental
 * permission downgrades or silent removal. They read the route file as
 * text so they run without a live server and stay well inside the unit
 * test budget.
 *
 * Routes guarded:
 *   GET /api/finance/trust/exceptions/summary      (financials:view)
 *   GET /api/finance/trust/exceptions/queue        (financials:view)
 *   GET /api/finance/trust/sync-health             (financials:view)
 *   GET /api/finance/trust/integrity-audit         (admin)
 *   GET /api/finance/trust/revalidation-status     (admin)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Quote-insensitive view — route files are auto-formatted to single quotes.
function norm(s: string): string {
  return s.replace(/['"]/g, '"');
}

const ROUTE_FILE = "server/routes/finance-trust-routes.ts";
const ROUTES_INDEX = "server/routes/index.ts";

describe("finance-trust-routes — registration", () => {
  it("is wired into server/routes/index.ts", () => {
    const idx = read(ROUTES_INDEX);
    expect(idx).toMatch(/from ['"]\.\/finance-trust-routes['"]/);
    expect(idx).toContain("registerFinanceTrustRoutes(app)");
  });

  it("exports a registerFinanceTrustRoutes function", () => {
    const source = read(ROUTE_FILE);
    expect(source).toMatch(/export\s+function\s+registerFinanceTrustRoutes/);
  });
});

describe("finance-trust-routes — permissions", () => {
  const source = read(ROUTE_FILE);

  it("gates /exceptions/summary behind financials:view", () => {
    expect(source).toContain('"/api/finance/trust/exceptions/summary"');
    const block = source.slice(
      source.indexOf('"/api/finance/trust/exceptions/summary"'),
      source.indexOf('"/api/finance/trust/exceptions/summary"') + 400,
    );
    expect(block).toContain("requireAuth");
    expect(block).toContain('requirePermission("financials", "view")');
  });

  it("gates /exceptions/queue behind financials:view", () => {
    expect(source).toContain('"/api/finance/trust/exceptions/queue"');
    const block = source.slice(
      source.indexOf('"/api/finance/trust/exceptions/queue"'),
      source.indexOf('"/api/finance/trust/exceptions/queue"') + 400,
    );
    expect(block).toContain("requireAuth");
    expect(block).toContain('requirePermission("financials", "view")');
  });

  it("gates /sync-health behind financials:view", () => {
    const anchor = '"/api/finance/trust/sync-health"';
    expect(source).toContain(anchor);
    const block = source.slice(source.indexOf(anchor), source.indexOf(anchor) + 400);
    expect(block).toContain("requireAuth");
    expect(block).toContain('requirePermission("financials", "view")');
  });

  it("gates /integrity-audit behind requireAdmin", () => {
    const anchor = '"/api/finance/trust/integrity-audit"';
    expect(source).toContain(anchor);
    const block = source.slice(source.indexOf(anchor), source.indexOf(anchor) + 400);
    expect(block).toContain("requireAuth");
    expect(block).toContain("requireAdmin");
  });

  it("gates /revalidation-status behind requireAdmin", () => {
    const anchor = '"/api/finance/trust/revalidation-status"';
    expect(source).toContain(anchor);
    const block = source.slice(source.indexOf(anchor), source.indexOf(anchor) + 400);
    expect(block).toContain("requireAuth");
    expect(block).toContain("requireAdmin");
  });

  it("sets finance trust headers on every route handler", () => {
    // One setFinanceTrustHeaders call per route. Currently 5 routes.
    const matches = source.match(/setFinanceTrustHeaders\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("embeds a trust meta object in every JSON response", () => {
    const matches = source.match(/buildTrustMeta\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});

describe("finance-trust — finance-routes.ts uses the shared helper", () => {
  const financeRoutes = read("server/departments/finance-routes.ts");

  it("imports setFinanceTrustHeaders from the shared lib", () => {
    expect(norm(financeRoutes)).toContain(
      'from "../lib/finance-trust/envelope"',
    );
  });

  it("does not re-declare a local header emission body", () => {
    // A LocalShim wrapper is allowed, but the raw per-header setHeader block
    // must not live in this file any more.
    expect(financeRoutes).not.toMatch(/res\.setHeader\(\s*"X-Finance-Source-Layer"/);
  });
});
