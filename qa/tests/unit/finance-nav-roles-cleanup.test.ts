import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVisibleTopSections,
  TOP_SECTIONS,
} from "../../../client/src/config/app-navigation";

/**
 * Finance nav + role-gating cleanup.
 *
 * The new finance screens (Finance Home, Reconciliation, Weekly Close) must be
 * discoverable from the Finance nav and correctly gated. Each item gates on its
 * OWN path via canViewPath(item.path) (which resolves the page-registry
 * permission entity), so the nav surfaces an item exactly when the role can
 * view that path. These tests pin that behaviour with a canViewPath stub.
 */

// Live-Ready module: Weekly Close scrapped (folded into Cashflow); Payment
// Requests + PO Approvals parked. The discoverable "new screens" are now
// Finance Home + QB Reconciliation only.
const NEW_FINANCE_LABELS = ["Finance Home", "QB Reconciliation"];
const ALL_FINANCE_PATHS = [
  "/finance",
  "/cashflow",
  "/cos",
  "/revenue-tracker",
  "/finance/gp/company",
  "/finance/qb-reconciliation",
  "/fye-revenue-tracking",
];

function financeSecondaryLabels(viewablePaths: string[]): string[] {
  const viewable = new Set(viewablePaths);
  const sections = buildVisibleTopSections({
    canViewPath: (p) => viewable.has(p),
    allowedSectionKeys: ["FINANCE"],
  });
  const finance = sections.find((section) => section.label === "Finance");
  return (finance?.secondary ?? []).map((item) => item.label);
}

describe("Finance nav — new screens are discoverable and role-gated", () => {
  it("shows Finance Home and Reconciliation for a permitted role", () => {
    const labels = financeSecondaryLabels(ALL_FINANCE_PATHS);
    for (const label of NEW_FINANCE_LABELS) {
      expect(labels).toContain(label);
    }
    // Old tabs remain intact.
    for (const label of ["Cashflow", "Cost of Sales", "Revenue", "Gross Profit", "FYE Tracking Report"]) {
      expect(labels).toContain(label);
    }
  });

  it("hides the new finance screens from a role that cannot view their paths", () => {
    // The role can see the section (via /cashflow) but not the finance-home /
    // reconciliation paths.
    const labels = financeSecondaryLabels(["/cashflow"]);
    for (const label of NEW_FINANCE_LABELS) {
      expect(labels).not.toContain(label);
    }
    expect(labels).toContain("Cashflow");
  });

  it("hides the whole Finance section from a role with no finance access", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => false,
      allowedSectionKeys: ["FINANCE"],
    });
    expect(sections.find((section) => section.label === "Finance")).toBeUndefined();
  });

  it("never gates a finance item via an 'entity:action' string in requiredPathPermissions", () => {
    // requiredPathPermissions is evaluated as a PATH (canViewPath); an
    // 'entity:action' string is an unknown path → denied for everyone. Guard
    // against re-introducing the mis-gate that was hiding Reconciliation.
    const finance = TOP_SECTIONS.find((section) => section.label === "Finance");
    expect(finance).toBeDefined();
    for (const item of finance!.secondary) {
      for (const required of item.requiredPathPermissions ?? []) {
        expect(required.startsWith("/")).toBe(true);
      }
    }
  });
});

/**
 * Permission-contract: the finance route surface stays on the modern
 * requirePermission(entity, action) gate. None of these files may use the
 * legacy requireRole shim (server/middleware/requireRole.ts) — that is the
 * gate that logs the "legacy gate" deprecation warning. Locking this in keeps
 * the finance routes warning-free and on the same effective access model.
 */
const FINANCE_ROUTE_FILES = [
  "server/routes/finance-legacy-extracted-routes.ts",
  "server/routes/finance-analysis.routes.ts",
  "server/routes/finance-audit-export.routes.ts",
  "server/routes/finance-lines.routes.ts",
  "server/routes/finance-trust-routes.ts",
  "server/routes/reconciliation.routes.ts",
  "server/routes/cos-control-routes.ts",
  "server/routes/cos-line-review.routes.ts",
];

describe("Finance routes — modern permission gates only (no legacy requireRole)", () => {
  it("no finance route file imports or calls the legacy requireRole shim", () => {
    let sawRequirePermission = false;
    for (const rel of FINANCE_ROUTE_FILES) {
      const file = path.join(process.cwd(), rel);
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      expect(src, `${rel} must not import the legacy requireRole shim`).not.toMatch(
        /from\s+["'][^"']*middleware\/requireRole["']/,
      );
      expect(src, `${rel} must not call requireRole(`).not.toMatch(/\brequireRole\s*\(/);
      if (/\brequirePermission\s*\(/.test(src)) sawRequirePermission = true;
    }
    expect(sawRequirePermission, "finance surface must gate via requirePermission").toBe(true);
  });
});
