import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const ALL_13_COLUMNS = [
  "pd_handover_date",
  "construction_start_date",
  "commissioning_date",
  "om_handover_date",
  "client_handover_date",
  "construction_start_actual",
  "pd_handover_actual",
  "commissioning_actual",
  "client_handover_actual",
  "signed_date",
  "cp_signed_date",
  "site_establishment_date",
  "site_establishment_actual",
];

describe("project execution state date migration: TEXT → DATE", () => {
  const schemaSource = read("shared/schema/projects.ts");
  const migrationSource = read("migrations/20260331_convert_project_dates_to_date.sql");
  const rollbackSource = read("migrations/20260331_convert_project_dates_to_date_rollback.sql");

  // ── Schema type correctness ──

  it("schema defines exactly 13 date columns (not text) for project dates", () => {
    const dateColumns = [
      'pdHandoverDate: date("pd_handover_date")',
      'constructionStartDate: date("construction_start_date")',
      'commissioningDate: date("commissioning_date")',
      'omHandoverDate: date("om_handover_date")',
      'clientHandoverDate: date("client_handover_date")',
      'constructionStartActual: date("construction_start_actual")',
      'pdHandoverActual: date("pd_handover_actual")',
      'commissioningActual: date("commissioning_actual")',
      'clientHandoverActual: date("client_handover_actual")',
      'signedDate: date("signed_date")',
      'cpSignedDate: date("cp_signed_date")',
      'siteEstablishmentDate: date("site_establishment_date")',
      'siteEstablishmentActual: date("site_establishment_actual")',
    ];
    for (const col of dateColumns) {
      expect(schemaSource).toContain(col);
    }
  });

  // ── Forward migration ──

  it("forward migration creates shadow columns for all 13 columns", () => {
    for (const col of ALL_13_COLUMNS) {
      expect(migrationSource).toContain(`ADD COLUMN IF NOT EXISTS ${col}_typed DATE`);
    }
  });

  it("forward migration creates audit table for unparseable dates", () => {
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS migration_unparseable_dates");
    expect(migrationSource).toContain("original_value TEXT");
    expect(migrationSource).toContain("reason TEXT");
  });

  it("forward migration handles all required date formats", () => {
    // YYYY-MM-DD
    expect(migrationSource).toContain("'^\\d{4}-\\d{2}-\\d{2}$'");
    // ISO datetime
    expect(migrationSource).toContain("'^\\d{4}-\\d{2}-\\d{2}T'");
    // DD/MM/YYYY
    expect(migrationSource).toContain("DD/MM/YYYY");
    // DD-Mon-YYYY
    expect(migrationSource).toContain("DD-Mon-YYYY");
    // Excel serial dates
    expect(migrationSource).toContain("1899-12-30");
    // Placeholders
    expect(migrationSource).toContain("TBC");
    expect(migrationSource).toContain("PENDING");
  });

  it("forward migration logs failures to audit table", () => {
    expect(migrationSource).toContain("INSERT INTO migration_unparseable_dates");
    expect(migrationSource).toContain("unparseable_format");
    expect(migrationSource).toContain("placeholder_value");
  });

  it("forward migration includes verification with correct column count", () => {
    expect(migrationSource).toContain("PROJECT EXECUTION STATE DATE MIGRATION VERIFICATION");
    // All 13 columns listed in the verification array
    for (const col of ALL_13_COLUMNS) {
      expect(migrationSource).toContain(`'${col}'`);
    }
  });

  it("forward migration renames all 13 columns correctly", () => {
    for (const col of ALL_13_COLUMNS) {
      expect(migrationSource).toContain(`RENAME COLUMN ${col} TO ${col}_legacy`);
      expect(migrationSource).toContain(`RENAME COLUMN ${col}_typed TO ${col}`);
    }
  });

  it("forward migration does NOT drop legacy columns", () => {
    expect(migrationSource).not.toContain("DROP COLUMN");
  });

  // ── Rollback migration ──

  it("rollback restores all 13 text columns as canonical", () => {
    for (const col of ALL_13_COLUMNS) {
      expect(rollbackSource).toContain(`RENAME COLUMN ${col} TO ${col}_typed`);
      expect(rollbackSource).toContain(`RENAME COLUMN ${col}_legacy TO ${col}`);
    }
  });

  it("rollback preserves audit table", () => {
    expect(rollbackSource).toContain("migration_unparseable_dates table is intentionally preserved");
  });

  // ── No stale text() columns remain ──

  it("schema no longer uses text() for any of the 13 date columns", () => {
    const textDatePatterns = ALL_13_COLUMNS.map(
      col => `text("${col}")`
    );
    for (const pattern of textDatePatterns) {
      expect(schemaSource).not.toContain(pattern);
    }
  });

  // ── Frontend sends YYYY-MM-DD ──

  it("lifecycle board uses HTML date input for signedDate", () => {
    const lifecycleBoard = read("client/src/pages/lifecycle-board.tsx");
    // HTML date inputs produce YYYY-MM-DD format natively
    expect(lifecycleBoard).toContain("signedDate");
    expect(lifecycleBoard).toContain('type="date"');
  });
});
