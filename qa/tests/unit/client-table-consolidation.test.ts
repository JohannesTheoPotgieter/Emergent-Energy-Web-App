import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("client table consolidation: legacy → canonical", () => {
  const migrationSource = read("migrations/20260331_consolidate_client_tables.sql");
  const rollbackSource = read("migrations/20260331_consolidate_client_tables_rollback.sql");
  const stageCollabSchema = read("shared/schema/stage-collaboration.ts");
  const routeRegistration = read("server/routes/register-project-routes.ts");
  const legacyRoutes = read("server/stage-collaboration-routes.ts");
  const canonicalService = read("server/services/collaboration-workflow-service.ts");
  const auditDoc = read("docs/dual-source-audit.md");

  // ── Canonical routes registered first ──

  it("canonical collaboration-workflow-routes registered before legacy stage-collaboration-routes", () => {
    const canonicalIdx = routeRegistration.indexOf("registerCollaborationWorkflowRoutes");
    const legacyIdx = routeRegistration.indexOf("registerStageCollaborationRoutes");
    expect(canonicalIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(-1);
    expect(canonicalIdx).toBeLessThan(legacyIdx);
  });

  // ── Canonical service uses correct tables ──

  it("canonical service reads from clientCommitments (not projectClientCommitments)", () => {
    expect(canonicalService).toContain("clientCommitments");
    expect(canonicalService).not.toContain("projectClientCommitments");
  });

  it("canonical service reads from clientUpdates (not projectClientUpdates)", () => {
    expect(canonicalService).toContain("clientUpdates");
    expect(canonicalService).not.toContain("projectClientUpdates");
  });

  // ── Legacy tables marked deprecated ──

  it("legacy tables are marked @deprecated in schema", () => {
    expect(stageCollabSchema).toContain("@deprecated 2026-03-31");
    expect(stageCollabSchema).toContain("Replaced by client_commitments");
    expect(stageCollabSchema).toContain("Replaced by client_updates");
  });

  it("legacy route file has deprecation notice", () => {
    expect(legacyRoutes).toContain("DEPRECATION NOTICE");
    expect(legacyRoutes).toContain("collaboration-workflow-routes.ts");
  });

  // ── Migration SQL safety ──

  it("migration adds migrated_from_legacy tracking column", () => {
    expect(migrationSource).toContain("migrated_from_legacy BOOLEAN DEFAULT false");
  });

  it("migration uses explicit conflict avoidance (NOT bare ON CONFLICT DO NOTHING)", () => {
    expect(migrationSource).not.toContain("ON CONFLICT DO NOTHING");
    expect(migrationSource).toContain("WHERE NOT EXISTS");
  });

  it("migration maps legacy status to lowercase canonical format", () => {
    expect(migrationSource).toContain("LOWER(COALESCE(pcc.status, 'open'))");
  });

  it("migration includes verification counts", () => {
    expect(migrationSource).toContain("CLIENT TABLE CONSOLIDATION VERIFICATION");
    expect(migrationSource).toContain("legacy=%");
    expect(migrationSource).toContain("canonical total=%");
    expect(migrationSource).toContain("migrated=%");
  });

  it("migration is idempotent (NOT EXISTS guard)", () => {
    expect(migrationSource).toContain("WHERE NOT EXISTS");
  });

  it("migration marks legacy tables with deprecation comment", () => {
    expect(migrationSource).toContain("COMMENT ON TABLE project_client_commitments");
    expect(migrationSource).toContain("COMMENT ON TABLE project_client_updates");
    expect(migrationSource).toContain("DEPRECATED");
  });

  // ── Rollback safety ──

  it("rollback removes only migrated rows", () => {
    expect(rollbackSource).toContain("WHERE migrated_from_legacy = true");
  });

  it("rollback removes tracking column", () => {
    expect(rollbackSource).toContain("DROP COLUMN IF EXISTS migrated_from_legacy");
  });

  it("rollback clears deprecation comments", () => {
    expect(rollbackSource).toContain("COMMENT ON TABLE project_client_commitments IS NULL");
    expect(rollbackSource).toContain("COMMENT ON TABLE project_client_updates IS NULL");
  });

  // ── Audit documentation ──

  it("audit doc covers all read/write locations", () => {
    expect(auditDoc).toContain("stage-collaboration-routes.ts");
    expect(auditDoc).toContain("collaboration-workflow-service.ts");
    expect(auditDoc).toContain("collaboration-workflow-routes.ts");
    expect(auditDoc).toContain("startup-orchestrator.ts");
    expect(auditDoc).toContain("use-collaboration-workflow.ts");
  });

  it("audit doc identifies the dead export", () => {
    expect(auditDoc).toContain("never imported");
    expect(auditDoc).toContain("dead code");
  });
});
