import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relPath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

describe("finance support table coverage", () => {
  it("keeps the SQLite bootstrap aligned with tracker support tables", () => {
    const dbBootstrap = read("server/db.ts");

    expect(dbBootstrap).toContain("CREATE TABLE IF NOT EXISTS tracker_monthly_manual");
    expect(dbBootstrap).toContain("CREATE TABLE IF NOT EXISTS category_revenue_allocations");
    expect(dbBootstrap).toContain("uq_category_revenue_allocations_active");
  });

  it("ships an additive migration for missing finance support tables", () => {
    const migration = read("migrations/0084_restore_finance_tracker_support_tables.sql");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS tracker_monthly_manual");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS category_revenue_allocations");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS category_key");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS category_allocation_id");
    expect(migration).toContain("WHERE effective_to IS NULL");
  });
});
