/**
 * DF-9 regression test for the PR #943 RBAC migration.
 *
 * PR #943 migrated 22 finance endpoints from `requireAuth`-only / `requireAdmin`-
 * only to `requirePermission(entity, action)` aligned with
 * `shared/permissions/registry.ts`. Without a regression guard, a future
 * commit could silently remove a gate from one of these endpoints — which
 * would re-open the original confidentiality gap (e.g. any authenticated
 * user could flip the BLACK/RED realisation signal via
 * /api/expenditure/font-color-toggle).
 *
 * This test source-text-asserts the expected `requirePermission(entity,
 * action)` token on each migrated endpoint. It does NOT replace an end-to-
 * end permission test (DF-28) — see audit/FINANCE_AUDIT_V2_2026-05-26.md.
 * It only catches a removed / downgraded gate at compile-time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return readFileSync(resolve(REPO, rel), "utf8");
}

function assertGate(source: string, method: string, path: string, gate: string): void {
  // Match an app.<method>("<path>", ...gate...) call. The arguments between
  // the path and the gate are variable (requireAuth, requireAdmin, body
  // validators) so we use a lazy match.
  const safePath = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[a-zA-Z]+/g, "[^\"']+");
  const re = new RegExp(
    `app\\.${method}\\(["']${safePath}["'][^)]*?${gate.replace(/[.+?^${}()|[\]\\]/g, "\\$&")}`,
    "s",
  );
  expect(
    source.match(re),
    `Expected app.${method}("${path}", ..., ${gate}) — gate is missing or downgraded`,
  ).not.toBeNull();
}

describe("PR #943 RBAC migration — finance route gates pinned", () => {
  it("finance-legacy-extracted-routes.ts: read endpoints", () => {
    const src = readFile("server/routes/finance-legacy-extracted-routes.ts");
    assertGate(src, "get", "/api/program/cos", 'requirePermission("cos", "view")');
    assertGate(src, "get", "/api/financial-headline", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/financial-close/files/:filename", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/realisation-kpis", 'requirePermission("cos", "view")');
    assertGate(src, "get", "/api/program-inflows", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/expenditure/overrides", 'requirePermission("financials", "view")');
  });

  it("finance-legacy-extracted-routes.ts: critical write endpoints (cos:override)", () => {
    const src = readFile("server/routes/finance-legacy-extracted-routes.ts");
    // The font-color-toggle directly mutates the BLACK/RED realisation
    // signal per § 3.2. Without cos:override gating, any authenticated user
    // can flip realisation on any cost line.
    assertGate(src, "patch", "/api/expenditure/font-color-toggle", 'requirePermission("cos", "override")');
    assertGate(src, "post", "/api/cos-status-override", 'requirePermission("cos", "override")');
    assertGate(src, "delete", "/api/cos-status-override/:expenseId", 'requirePermission("cos", "override")');
  });

  it("finance-legacy-extracted-routes.ts: override delete endpoints (financials:override)", () => {
    const src = readFile("server/routes/finance-legacy-extracted-routes.ts");
    assertGate(src, "delete", "/api/revenue-tracking/overrides/:projectName", "requirePermission('financials', 'override')");
    assertGate(src, "delete", "/api/expenditure/overrides/:projectName", "requirePermission('financials', 'override')");
  });

  it("finance-legacy-extracted-routes.ts: upload endpoint (financials:edit)", () => {
    const src = readFile("server/routes/finance-legacy-extracted-routes.ts");
    assertGate(src, "post", "/api/financial-close/upload", 'requirePermission("financials", "edit")');
  });

  it("cos-control-routes.ts: COS Control endpoints use cos_control entity", () => {
    const src = readFile("server/routes/cos-control-routes.ts");
    assertGate(src, "get", "/api/cos-control/summary", 'requirePermission("cos_control", "view")');
    assertGate(src, "get", "/api/cos-control/by-project", 'requirePermission("cos_control", "view")');
    assertGate(src, "get", "/api/cos-control/lines", 'requirePermission("cos_control", "view")');
    assertGate(src, "get", "/api/cos-control/invoices", 'requirePermission("cos_control", "view")');
    assertGate(src, "get", "/api/cos-control/pos", 'requirePermission("cos_control", "view")');
    assertGate(src, "get", "/api/cos-control/tracker", 'requirePermission("cos_control", "view")');
  });

  it("cos-control-routes.ts: cashflow forecast endpoints use cashflow_forecast entity", () => {
    const src = readFile("server/routes/cos-control-routes.ts");
    assertGate(src, "get", "/api/cashflow-forecast/weekly", 'requirePermission("cashflow_forecast", "view")');
    assertGate(src, "get", "/api/cashflow-forecast/week-detail", 'requirePermission("cashflow_forecast", "view")');
  });

  it("cos-control-routes.ts: scenario write endpoints use cos_control:edit", () => {
    const src = readFile("server/routes/cos-control-routes.ts");
    assertGate(src, "post", "/api/scenarios", 'requirePermission("cos_control", "edit")');
    assertGate(src, "delete", "/api/scenarios/:id", 'requirePermission("cos_control", "edit")');
    assertGate(src, "post", "/api/scenarios/:id/duplicate", 'requirePermission("cos_control", "edit")');
    assertGate(src, "post", "/api/scenarios/:id/reset", 'requirePermission("cos_control", "edit")');
  });

  it("register-cashflow-2026-routes.ts: cashflow read endpoints gated", () => {
    const src = readFile("server/routes/register-cashflow-2026-routes.ts");
    assertGate(src, "get", "/api/cashflow-2026", 'requirePermission("cashflow", "view")');
    assertGate(src, "get", "/api/cashflow-2026/detail", 'requirePermission("cashflow", "view")');
    assertGate(src, "get", "/api/cashflow-2026/balance-history", 'requirePermission("cashflow", "view")');
  });

  it("finance-analysis.routes.ts: hardcoded role arrays removed, requirePermission used", () => {
    const src = readFile("server/routes/finance-analysis.routes.ts");
    // The deleted hardcoded arrays must not reappear.
    expect(src).not.toMatch(/^const\s+FINANCE_ANALYSIS_ROLES\s*=/m);
    expect(src).not.toMatch(/^const\s+TOLERANCE_WRITE_ROLES\s*=/m);
    // Spot-check that requirePermission is the gate now.
    expect(src).toMatch(/requirePermission\("cashflow",\s*"view"\)/);
    expect(src).toMatch(/requirePermission\("cos",\s*"view"\)/);
    expect(src).toMatch(/requirePermission\("cos",\s*"override"\)/);
  });
});
