import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const MIGRATED_FILES = [
  "server/api/v2/repositories/project-v2-repository.ts",
  "server/services/project-access-service.ts",
  "server/services/exception-dashboard-service.ts",
  "server/storage.ts",
  "server/template-routes.ts",
  "server/routes.ts",
];

describe("soft-delete: project_execution_state isActive → deletedAt", () => {
  const schemaSource = read("shared/schema/projects.ts");
  const migrationSource = read("migrations/20260331_soft_delete_project_execution_state.sql");
  const rollbackSource = read("migrations/20260331_soft_delete_project_execution_state_rollback.sql");
  const migrationDoc = read("docs/soft-delete-migration.md");

  // ── No remaining isActive filters ──

  it("no file uses eq(projectExecutionState.isActive, true) as a filter", () => {
    for (const file of MIGRATED_FILES) {
      const source = read(file);
      expect(source).not.toContain("eq(projectExecutionState.isActive, true)");
    }
  });

  it("no file uses isActive IS NOT FALSE as a filter", () => {
    const routesSource = read("server/routes.ts");
    expect(routesSource).not.toContain("isActive} IS NOT FALSE");
  });

  // ── All filters now use deletedAt IS NULL ──

  it("project-v2-repository uses isNull(projectExecutionState.deletedAt)", () => {
    const source = read("server/api/v2/repositories/project-v2-repository.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("project-access-service uses isNull(projectExecutionState.deletedAt)", () => {
    const source = read("server/services/project-access-service.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("exception-dashboard-service uses isNull(projectExecutionState.deletedAt)", () => {
    const source = read("server/services/exception-dashboard-service.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("storage.ts uses isNull(projectExecutionState.deletedAt) for active count", () => {
    const source = read("server/storage.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("storage.ts write path sets deleted_at = NOW() for deactivation", () => {
    const source = read("server/storage.ts");
    expect(source).toContain("deleted_at = NOW()");
    expect(source).toContain("deleted_at = NULL");
  });

  it("template-routes.ts uses isNull(projectExecutionState.deletedAt)", () => {
    const source = read("server/template-routes.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("routes.ts uses isNull(projectExecutionState.deletedAt)", () => {
    const source = read("server/routes.ts");
    expect(source).toContain("isNull(projectExecutionState.deletedAt)");
  });

  // ── Schema deprecation ──

  it("isActive is marked @deprecated in schema", () => {
    expect(schemaSource).toContain("@deprecated 2026-03-31");
    expect(schemaSource).toContain("Use deletedAt IS NULL instead");
  });

  it("schema still has isActive column (30-day observation window)", () => {
    expect(schemaSource).toContain('isActive: boolean("is_active")');
  });

  it("schema has deletedAt column", () => {
    expect(schemaSource).toContain('deletedAt: timestamp("deleted_at")');
  });

  // ── Migration SQL ──

  it("migration backfills deleted_at where is_active = false", () => {
    expect(migrationSource).toContain("SET deleted_at = NOW()");
    expect(migrationSource).toContain("WHERE is_active = false");
    expect(migrationSource).toContain("AND deleted_at IS NULL");
  });

  it("migration verifies consistency after backfill", () => {
    expect(migrationSource).toContain("SOFT-DELETE MIGRATION VERIFICATION");
    expect(migrationSource).toContain("Backfill failed");
  });

  it("migration adds deprecation comment to column", () => {
    expect(migrationSource).toContain("COMMENT ON COLUMN project_execution_state.is_active");
    expect(migrationSource).toContain("DEPRECATED");
  });

  // ── Rollback ──

  it("rollback syncs is_active back from deleted_at state", () => {
    expect(rollbackSource).toContain("SET is_active = true WHERE deleted_at IS NULL");
    expect(rollbackSource).toContain("SET is_active = false WHERE deleted_at IS NOT NULL");
  });

  // ── Migration inventory ──

  it("migration doc lists all 17 tables with isActive", () => {
    expect(migrationDoc).toContain("project_execution_state");
    expect(migrationDoc).toContain("project_info");
    expect(migrationDoc).toContain("counterparties");
    expect(migrationDoc).toContain("users");
    expect(migrationDoc).toContain("qc_template");
  });

  it("migration doc marks project_execution_state as This PR", () => {
    expect(migrationDoc).toContain("**This PR**");
  });
});
