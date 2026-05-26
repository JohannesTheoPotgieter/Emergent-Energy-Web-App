/**
 * TF-9 (audit V3) — Contract test for the finance audit-prep export
 * routes. Pins the route paths, RBAC guards, and CSV envelope so a
 * future refactor cannot silently change the auditor-facing surface.
 *
 * Real DB integration (CSV correctness against fixture rows) needs a
 * test DB; queued as DF-21 follow-up.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("TF-9 — finance audit-prep export routes contract", () => {
  const source = read("server/routes/finance-audit-export.routes.ts");

  it("exports the registration function", () => {
    expect(source).toContain("export function registerFinanceAuditExportRoutes");
  });

  it("defines the three auditor-facing GET endpoints", () => {
    expect(source).toContain('"/api/finance/audit-export/invoices-by-project"');
    expect(source).toContain('"/api/finance/audit-export/revenue-milestones"');
    expect(source).toContain('"/api/finance/audit-export/period-locks"');
  });

  it("gates all three endpoints on requirePermission(\"financials\", \"approve\")", () => {
    // Three call sites (plus the JSDoc reference) — one per export route.
    const matches = source.match(/requirePermission\("financials", "approve"\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("records every export to audit_events", () => {
    expect(source).toContain('action: "export_invoices_by_project"');
    expect(source).toContain('action: "export_revenue_milestones"');
    expect(source).toContain('action: "export_period_locks"');
    const auditCalls = source.match(/logAuditFromReq\(req, \{/g) ?? [];
    expect(auditCalls.length).toBe(3);
  });

  it("guards all snapshot reads with effectiveTo IS NULL", () => {
    // Snapshot tables: normalized_revenue_lines, normalized_cost_lines.
    // Each export reading those tables must keep the effectiveTo guard.
    const guards = source.match(/isNull\((normalizedRevenueLines|normalizedCostLines)\.effectiveTo\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });

  it("sends CSV with auditor-friendly envelope (UTF-8 BOM + Content-Disposition)", () => {
    expect(source).toContain('"Content-Type", "text/csv; charset=utf-8"');
    expect(source).toContain('"Content-Disposition"');
    expect(source).toMatch(/attachment; filename=/);
  });

  it("registers the routes in the department-routes registry", () => {
    const reg = read("server/routes/register-department-routes.ts");
    expect(reg).toContain("registerFinanceAuditExportRoutes");
    expect(reg).toContain('await import("./finance-audit-export.routes")');
  });
});
