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
  // Find an `app.<method>(...)` call that mentions both the path literal and
  // the gate token within a window of ~1500 chars. Both single-line and
  // multi-line styles are valid in this codebase, and route handlers
  // sometimes have multiple middleware lines (requireAuth, validateBody,
  // requireAdmin, etc.) between the path and the gate. We search the call
  // site as a whole rather than relying on tight punctuation matching.
  const safePath = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[a-zA-Z]+/g, "[^\"']+");
  const pathPattern = new RegExp(`app\\.${method}\\(\\s*["']${safePath}["']`, "g");
  let m: RegExpExecArray | null;
  while ((m = pathPattern.exec(source)) !== null) {
    // Inspect the next 1500 chars after this match. If the gate token is
    // present before the next `app.` call, this site has the expected gate.
    const tail = source.slice(m.index, m.index + 1500);
    const nextAppCall = tail.indexOf("app.", method.length + 8);
    const window = nextAppCall >= 0 ? tail.slice(0, nextAppCall) : tail;
    if (window.includes(gate)) return;
  }
  throw new Error(
    `Expected app.${method}("${path}", ..., ${gate}) — gate is missing or downgraded`,
  );
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

  // ──────────────────────────────────────────────────────────────────────────
  // TF-11 (audit V3): extend coverage to the QB / finance-lines / finance-trust
  // route files. Without these assertions, a future commit could silently
  // remove a `requirePermission(...)` on (for example) /api/quickbooks/invoice-
  // matches/manual-link — re-opening the "any user with financials:edit can
  // force a QB match" gap V1 closed.
  // ──────────────────────────────────────────────────────────────────────────

  it("quickbooks-invoice-matches.routes.ts: view endpoints gated on financials:view", () => {
    const src = readFile("server/routes/quickbooks-invoice-matches.routes.ts");
    assertGate(src, "post", "/api/quickbooks/invoice-matches/find", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/quickbooks/invoice-matches/app-lines/search", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/quickbooks/invoice-matches/payment-status/:linkId", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/quickbooks/invoice-matches/links/:linkId/proposals", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/quickbooks/cascade-proposals/summary", 'requirePermission("financials", "view")');
  });

  it("quickbooks-invoice-matches.routes.ts: edit endpoints gated on financials:edit", () => {
    const src = readFile("server/routes/quickbooks-invoice-matches.routes.ts");
    assertGate(src, "post", "/api/quickbooks/invoice-matches/:suggestionId/approve", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/:suggestionId/approve-multi", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/:suggestionId/reject", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/bulk-approve", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/bulk-reject", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/proposals/:id/accept", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/proposals/:id/decline", 'requirePermission("financials", "edit")');
    assertGate(src, "post", "/api/quickbooks/invoice-matches/auto-suggest/run", 'requirePermission("financials", "edit")');
  });

  it("quickbooks-invoice-matches.routes.ts: manual-link gated on financials:override", () => {
    const src = readFile("server/routes/quickbooks-invoice-matches.routes.ts");
    // Manual link is the override path — should require the strictest gate.
    assertGate(src, "post", "/api/quickbooks/invoice-matches/manual-link", 'requirePermission("financials", "override")');
  });

  it("finance-lines.routes.ts: all endpoints gated on financials:view", () => {
    const src = readFile("server/routes/finance-lines.routes.ts");
    assertGate(src, "get", "/api/finance/lines/:projectId", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/lines", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/category-allocation-health", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/recon-check/:projectId", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/recon-grid", 'requirePermission("financials", "view")');
  });

  it("finance-trust-routes.ts: operational endpoints gated on financials:view, admin views on requireAdmin", () => {
    const src = readFile("server/routes/finance-trust-routes.ts");
    // Operational triage — visible to anyone with finance read access.
    assertGate(src, "get", "/api/finance/trust/exceptions/summary", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/trust/exceptions/queue", 'requirePermission("financials", "view")');
    assertGate(src, "get", "/api/finance/trust/sync-health", 'requirePermission("financials", "view")');
    // Admin-only audit views — raw schema drift / revalidation queue.
    // These intentionally require requireAdmin per the file header comment;
    // the gate must NOT be downgraded to financials:view.
    assertGate(src, "get", "/api/finance/trust/integrity-audit", "requireAdmin");
    assertGate(src, "get", "/api/finance/trust/revalidation-status", "requireAdmin");
  });
});
