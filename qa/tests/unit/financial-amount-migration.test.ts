import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("financial amount migration: TEXT → NUMERIC(15,2)", () => {
  const schemaSource = read("shared/schema/finance.ts");
  const migrationSource = read("migrations/20260330_financial_amounts_to_numeric.sql");
  const rollbackSource = read("migrations/20260330_financial_amounts_to_numeric_rollback.sql");

  // ── Schema type correctness ──

  it("normalizedRevenueLines.amountExVat is now decimal(15,2)", () => {
    expect(schemaSource).toContain('amountExVat: decimal("amount_ex_vat", { precision: 15, scale: 2 })');
  });

  it("normalizedRevenueLines.vat is now decimal(15,2)", () => {
    expect(schemaSource).toContain('vat: decimal("vat", { precision: 15, scale: 2 })');
  });

  it("normalizedCostLines.amountExVat is now decimal(15,2)", () => {
    // Both revenue and cost lines use the same pattern
    const matches = schemaSource.match(/amountExVat: decimal\("amount_ex_vat", \{ precision: 15, scale: 2 \}\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  // ── Legacy columns preserved ──

  it("legacy text columns are preserved in schema for 30-day rollback", () => {
    expect(schemaSource).toContain('amountExVatLegacy: text("amount_ex_vat_legacy")');
    expect(schemaSource).toContain('vatLegacy: text("vat_legacy")');
  });

  it("legacy columns are omitted from insert schemas", () => {
    expect(schemaSource).toContain("amountExVatLegacy: true, vatLegacy: true");
    // Cost lines insert schema also omits legacy
    expect(schemaSource).toContain("amountExVatLegacy: true }");
  });

  // ── Migration SQL safety ──

  it("forward migration creates shadow columns with IF NOT EXISTS", () => {
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS amount_ex_vat_decimal NUMERIC(15,2)");
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS vat_decimal NUMERIC(15,2)");
  });

  it("forward migration creates audit table for unparseable values", () => {
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS migration_unparseable_amounts");
    expect(migrationSource).toContain("original_value TEXT");
    expect(migrationSource).toContain("reason TEXT");
  });

  it("forward migration handles common bad value patterns", () => {
    // Placeholders
    expect(migrationSource).toContain("TBC");
    expect(migrationSource).toContain("N/A");
    // Bracket negatives
    expect(migrationSource).toContain("Bracket negatives");
    // Currency symbols
    expect(migrationSource).toContain("currency symbols");
    // Comma separators
    expect(migrationSource).toContain("REPLACE(cleaned, ','");
  });

  it("forward migration logs unparseable values to audit table", () => {
    expect(migrationSource).toContain("INSERT INTO migration_unparseable_amounts");
    expect(migrationSource).toContain("unparseable_format");
    expect(migrationSource).toContain("placeholder_value");
  });

  it("forward migration includes verification queries", () => {
    expect(migrationSource).toContain("VERIFICATION REPORT");
    expect(migrationSource).toContain("total=%, parsed=%, failed=%");
    expect(migrationSource).toContain("text_sum=%");
    expect(migrationSource).toContain("decimal_sum=%");
    expect(migrationSource).toContain("delta=%");
  });

  it("forward migration renames columns (text→legacy, decimal→canonical)", () => {
    expect(migrationSource).toContain("RENAME COLUMN amount_ex_vat TO amount_ex_vat_legacy");
    expect(migrationSource).toContain("RENAME COLUMN amount_ex_vat_decimal TO amount_ex_vat");
    expect(migrationSource).toContain("RENAME COLUMN vat TO vat_legacy");
    expect(migrationSource).toContain("RENAME COLUMN vat_decimal TO vat");
  });

  it("forward migration does NOT drop legacy columns", () => {
    expect(migrationSource).not.toContain("DROP COLUMN amount_ex_vat_legacy");
    expect(migrationSource).not.toContain("DROP COLUMN vat_legacy");
  });

  it("forward migration does NOT add CHECK constraints on amounts", () => {
    // Negatives are allowed for credits/reversals/adjustments
    expect(migrationSource).not.toContain("CHECK (amount_ex_vat");
    expect(migrationSource).not.toContain("CHECK (vat");
  });

  // ── Rollback SQL safety ──

  it("rollback restores original text columns as canonical", () => {
    expect(rollbackSource).toContain("RENAME COLUMN amount_ex_vat TO amount_ex_vat_decimal");
    expect(rollbackSource).toContain("RENAME COLUMN amount_ex_vat_legacy TO amount_ex_vat");
    expect(rollbackSource).toContain("RENAME COLUMN vat TO vat_decimal");
    expect(rollbackSource).toContain("RENAME COLUMN vat_legacy TO vat");
  });

  it("rollback preserves audit table", () => {
    expect(rollbackSource).toContain("migration_unparseable_amounts table is intentionally preserved");
  });

  // ── Runtime type verification ──

  it("Drizzle pg driver returns decimal as string — parseFloat/Number conversions are kept", () => {
    // Verify that existing toNum() and parseFloat() patterns are NOT removed
    const dashboardMetrics = read("server/services/dashboard-metrics.ts");
    expect(dashboardMetrics).toContain("toNum(row.amountExVat)");

    // Verify client still uses parseFloat for display
    const subcontractorDashboard = read("client/src/pages/subcontractor-dashboard.tsx");
    expect(subcontractorDashboard).toContain('parseFloat(');
  });

  // ── Existing financial tests still pass ──

  it("financeLineSchema in API types still accepts string amounts", () => {
    const apiTypes = read("shared/api-types/project-v2.ts");
    expect(apiTypes).toContain("amountExVat: z.string().nullable()");
  });
});
