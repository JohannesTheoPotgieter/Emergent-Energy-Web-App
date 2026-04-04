import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Static validation: every route file that contains inline DDL (CREATE TABLE,
 * ALTER TABLE) must guard it behind a NODE_ENV check so it never runs in
 * production or staging. The authoritative DDL lives in migrations/*.sql.
 */
describe("Route DDL production guards", () => {
  const serverDir = path.resolve(__dirname, "../../../server");

  const routeFiles = [
    "quality-ncr-routes.ts",
    "report-routes.ts",
    "standup-routes.ts",
    "lifecycle-routes.ts",
    "smart-import-routes.ts",
  ];

  for (const file of routeFiles) {
    it(`${file} guards all DDL behind NODE_ENV check`, () => {
      const filePath = path.join(serverDir, file);
      const src = fs.readFileSync(filePath, "utf-8");
      const lines = src.split("\n");

      // Find all lines that contain actual DDL statements (not comments)
      const ddlLineIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        if (/CREATE TABLE IF NOT EXISTS|ALTER TABLE\b.*ADD COLUMN/i.test(lines[i])) {
          ddlLineIndices.push(i);
        }
      }

      if (ddlLineIndices.length === 0) return; // no DDL, nothing to guard

      // The guard pattern must exist in the file
      const guardPattern =
        /process\.env\.NODE_ENV\s*===\s*["']production["']\s*\|\|\s*process\.env\.NODE_ENV\s*===\s*["']staging["']/;

      const guardLineIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (guardPattern.test(lines[i])) {
          guardLineIndices.push(i);
        }
      }

      expect(guardLineIndices.length).toBeGreaterThan(0);

      // Every DDL line must have a guard appearing within 50 lines before it
      for (const ddlLine of ddlLineIndices) {
        const hasNearbyGuard = guardLineIndices.some(
          (g) => g < ddlLine && ddlLine - g < 50,
        );
        expect(hasNearbyGuard).toBe(true);
      }
    });
  }

  it("migration files exist for all route-bootstrapped tables", () => {
    const migrationsDir = path.resolve(__dirname, "../../../migrations");
    const migrationFiles = fs.readdirSync(migrationsDir).join("\n");

    // NCR tables
    expect(migrationFiles).toMatch(/create_ncr_tables/i);
    // Report tables
    expect(migrationFiles).toMatch(/create_report_tables/i);
    // Standup v2
    expect(migrationFiles).toMatch(/create_standup_entries_v2/i);
  });

  it("migration SQL creates all required tables", () => {
    const migrationsDir = path.resolve(__dirname, "../../../migrations");

    const ncrSql = fs.readFileSync(
      path.join(migrationsDir, "20260404_create_ncr_tables.sql"),
      "utf-8",
    );
    expect(ncrSql).toContain("ncr_reports");
    expect(ncrSql).toContain("ncr_attachments");
    expect(ncrSql).toContain("ncr_comments");

    const reportSql = fs.readFileSync(
      path.join(migrationsDir, "20260404_create_report_tables.sql"),
      "utf-8",
    );
    expect(reportSql).toContain("report_history");
    expect(reportSql).toContain("scheduled_reports");

    const standupSql = fs.readFileSync(
      path.join(migrationsDir, "20260404_create_standup_entries_v2.sql"),
      "utf-8",
    );
    expect(standupSql).toContain("standup_entries_v2");
  });
});
