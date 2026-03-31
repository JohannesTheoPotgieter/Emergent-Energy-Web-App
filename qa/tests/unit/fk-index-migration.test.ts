import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const NEW_INDEXES = [
  "idx_ncl_import_run_id",
  "idx_nrl_import_run_id",
  "idx_hci_handover_pack_id",
  "idx_sites_client_id",
  "idx_users_role",
  "idx_cs_entity",
  "idx_ncl_project_snapshot",
  "idx_nrl_project_snapshot",
  "idx_psi_project_stage",
];

describe("FK index migration", () => {
  const migrationSource = read("migrations/20260331_add_missing_fk_indexes.sql");
  const rollbackSource = read("migrations/20260331_add_missing_fk_indexes_rollback.sql");
  const tuningNotes = read("docs/index-tuning-notes.md");

  it("creates all 9 new indexes with IF NOT EXISTS (idempotent)", () => {
    for (const idx of NEW_INDEXES) {
      expect(migrationSource).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
  });

  it("does not CREATE already-existing indexes", () => {
    expect(migrationSource).not.toContain("CREATE INDEX IF NOT EXISTS idx_work_items_client_id");
    expect(migrationSource).not.toContain("CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_counterparty_id");
    // They are mentioned only in SKIPPED comments
    expect(migrationSource).toContain("SKIPPED");
  });

  it("documents the transaction behavior and CONCURRENTLY option", () => {
    expect(migrationSource).toContain("NOT auto-wrap");
    expect(migrationSource).toContain("CONCURRENTLY");
  });

  it("composite indexes use correct column combinations", () => {
    expect(migrationSource).toContain("change_sets(entity_type, entity_id)");
    expect(migrationSource).toContain("normalized_cost_lines(project_id, snapshot_run_id)");
    expect(migrationSource).toContain("normalized_revenue_lines(project_id, snapshot_run_id)");
    expect(migrationSource).toContain("project_stage_instances(project_id, stage_code)");
  });

  it("rollback drops all 9 indexes safely", () => {
    for (const idx of NEW_INDEXES) {
      expect(rollbackSource).toContain(`DROP INDEX IF EXISTS ${idx}`);
    }
  });

  it("rollback does not drop pre-existing indexes", () => {
    expect(rollbackSource).not.toContain("idx_work_items_client_id");
    expect(rollbackSource).not.toContain("idx_normalized_cost_lines_counterparty_id");
  });

  it("tuning notes document all 9 indexes with rationale", () => {
    for (const idx of NEW_INDEXES) {
      expect(tuningNotes).toContain(idx);
    }
  });

  it("tuning notes include EXPLAIN ANALYZE instructions", () => {
    expect(tuningNotes).toContain("EXPLAIN ANALYZE");
  });

  it("tuning notes document skipped indexes", () => {
    expect(tuningNotes).toContain("idx_work_items_client_id");
    expect(tuningNotes).toContain("already exist");
  });
});
