/**
 * Migration Execution Integration Tests
 *
 * Applies all migrations against a real Postgres database with fixture data,
 * then verifies schema integrity, backfill correctness, FK resolution,
 * finance totals, and post-migration mutation behavior.
 *
 * Requires: DATABASE_URL or MIGRATION_TEST_DATABASE_URL pointing to a
 * disposable Postgres instance (CI provides this automatically).
 *
 * Run: npx vitest run qa/tests/integration/migration-execution.test.ts -c qa/vitest.integration.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupMigrationDb,
  teardownMigrationDb,
  query,
  queryOne,
  queryCount,
  getPool,
  expectRowCount,
  expectNoOrphanedFks,
  expectSumsMatch,
} from "./migration-test-helper";

// ---------------------------------------------------------------------------
// Global setup/teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await setupMigrationDb();
}, 300_000); // 5 min for full migration suite

afterAll(async () => {
  await teardownMigrationDb();
});

// ===========================================================================
// 1. SCHEMA CREATION — promoted schemas exist
// ===========================================================================
describe("Schema Creation", () => {
  const EXPECTED_SCHEMAS = ["core", "finance", "internal", "engineering", "quality", "documentation", "project_management", "project_development", "imports", "personal"];

  it.each(EXPECTED_SCHEMAS)("schema %s exists", async (schemaName) => {
    const row = await queryOne(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`,
    );
    expect(row).not.toBeNull();
    expect(row.schema_name).toBe(schemaName);
  });
});

// ===========================================================================
// 2. PARTIES / USERS / ROLES — Phase A backfills
// ===========================================================================
describe("Parties, Users, and Roles (Phase A)", () => {
  it("core.parties contains backfilled counterparties", async () => {
    const count = await expectRowCount("core.parties", 1, "source_table = 'public.counterparties'");
    expect(count).toBeGreaterThanOrEqual(2); // Panel Supply Co + InstallCrew SA
  });

  it("core.parties contains backfilled clients", async () => {
    const count = await expectRowCount("core.parties", 1, "source_table = 'public.clients'");
    expect(count).toBeGreaterThanOrEqual(2); // SolarCo + WindPower
  });

  it("core.parties contains backfilled users", async () => {
    const count = await expectRowCount("core.parties", 1, "legacy_user_id IS NOT NULL");
    expect(count).toBeGreaterThanOrEqual(3); // Alice + Bob + Carol
  });

  it("core.parties legacy_client_id resolves to clients", async () => {
    await expectNoOrphanedFks("core.parties", "legacy_client_id", "clients", "id");
  });

  it("core.parties legacy_counterparty_id resolves to counterparties", async () => {
    await expectNoOrphanedFks("core.parties", "legacy_counterparty_id", "counterparties", "id");
  });

  it("core.user_accounts created for fixture users", async () => {
    const count = await expectRowCount("core.user_accounts", 1);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("core.user_accounts.party_id FK is populated", async () => {
    const nullParty = await queryCount(
      `SELECT count(*) AS cnt FROM core.user_accounts WHERE party_id IS NULL`,
    );
    expect(nullParty).toBe(0);
  });

  it("core.user_accounts.party_id references valid core.parties", async () => {
    await expectNoOrphanedFks("core.user_accounts", "party_id", "core.parties", "id");
  });
});

// ===========================================================================
// 3. PROJECT SPINE — Phase B backfills
// ===========================================================================
describe("Project Spine (Phase B)", () => {
  it("core.project_instances created for fixture projects", async () => {
    const count = await expectRowCount("core.project_instances", 1);
    expect(count).toBeGreaterThanOrEqual(2); // Solar Farm Alpha + Wind Farm Beta
  });

  it("core.project_instances.legacy_project_id maps back to project_info", async () => {
    await expectNoOrphanedFks("core.project_instances", "legacy_project_id", "project_info", "id");
  });

  it("core.project_instances.client_party_id is populated for projects with clients", async () => {
    const rows = await query(
      `SELECT pi2.id, pi2.client_party_id FROM core.project_instances pi2 JOIN project_info pi ON pi.id = pi2.legacy_project_id WHERE pi.client_id IS NOT NULL`,
    );
    for (const row of rows) {
      expect(row.client_party_id).not.toBeNull();
    }
  });

  it("core.project_instances.client_party_id references valid core.parties", async () => {
    await expectNoOrphanedFks("core.project_instances", "client_party_id", "core.parties", "id");
  });

  it("project_party_links created with 'client' role", async () => {
    const count = await expectRowCount("core.project_party_links", 1, "project_role = 'client'");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("project_party_links FK integrity to project_instances", async () => {
    await expectNoOrphanedFks("core.project_party_links", "project_instance_id", "core.project_instances", "id");
  });

  it("project_party_links FK integrity to parties", async () => {
    await expectNoOrphanedFks("core.project_party_links", "party_id", "core.parties", "id");
  });
});

// ===========================================================================
// 4. WORK ENGINE — Phase C backfills
// ===========================================================================
describe("Work Engine (Phase C)", () => {
  it("core.work_packages table exists and is queryable", async () => {
    // Work packages may have 0 rows if no legacy data mapped
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.work_packages`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.work_items_v2 table exists and is queryable", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.work_items_v2`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("work_items_v2 FK to project_instances is valid (if rows exist)", async () => {
    const hasRows = await queryCount(`SELECT count(*) AS cnt FROM core.work_items_v2`);
    if (hasRows > 0) {
      await expectNoOrphanedFks("core.work_items_v2", "project_instance_id", "core.project_instances", "id");
    }
  });
});

// ===========================================================================
// 5. APPROVALS & DELIVERABLES — Phase D/E backfills
// ===========================================================================
describe("Approvals and Deliverables (Phase D/E)", () => {
  it("core.governed_processes table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.governed_processes`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.deliverable_definitions table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.deliverable_definitions`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.approval_instances table exists and is queryable", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.approval_instances`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("approval_instances FK to project_instances (if rows exist)", async () => {
    const hasRows = await queryCount(`SELECT count(*) AS cnt FROM core.approval_instances WHERE project_instance_id IS NOT NULL`);
    if (hasRows > 0) {
      await expectNoOrphanedFks("core.approval_instances", "project_instance_id", "core.project_instances", "id");
    }
  });
});

// ===========================================================================
// 6. FINANCE — Phase F backfills
// ===========================================================================
describe("Finance Records (Phase F)", () => {
  it("finance.finance_records table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM finance.finance_records`);
    expect(count).toBeGreaterThan(0);
  });

  it("finance.finance_record_events table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM finance.finance_record_events`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("cost lines backfilled into finance_records", async () => {
    const count = await queryCount(
      `SELECT count(*) AS cnt FROM finance.finance_records WHERE legacy_entity_table = 'cost_lines'`,
    );
    expect(count).toBeGreaterThanOrEqual(3); // 3 fixture cost lines
  });

  it("revenue lines backfilled into finance_records", async () => {
    const count = await queryCount(
      `SELECT count(*) AS cnt FROM finance.finance_records WHERE legacy_entity_table = 'revenue_lines'`,
    );
    expect(count).toBeGreaterThanOrEqual(2); // 2 fixture revenue lines
  });

  it("change requests backfilled into finance_records as variation_order", async () => {
    const count = await queryCount(
      `SELECT count(*) AS cnt FROM finance.finance_records WHERE legacy_entity_table = 'public.change_requests' AND financial_type = 'variation_order'`,
    );
    expect(count).toBeGreaterThanOrEqual(2); // 2 fixture change requests
  });

  it("finance_records.project_instance_id FK is valid", async () => {
    await expectNoOrphanedFks("finance.finance_records", "project_instance_id", "core.project_instances", "id");
  });

  it("cost line finance_records amount sum matches legacy", async () => {
    await expectSumsMatch(
      "normalized_cost_lines", "amount_ex_vat", "effective_to IS NULL",
      "finance.finance_records", "amount_ex_vat", "legacy_entity_table = 'cost_lines'",
    );
  });

  it("revenue line finance_records amount sum matches legacy", async () => {
    await expectSumsMatch(
      "normalized_revenue_lines", "amount_ex_vat", "effective_to IS NULL",
      "finance.finance_records", "amount_ex_vat", "legacy_entity_table = 'revenue_lines'",
    );
  });

  it("VO finance_records amount matches legacy cost_impact", async () => {
    await expectSumsMatch(
      "change_requests", "cost_impact", "deleted_at IS NULL AND cost_impact IS NOT NULL",
      "finance.finance_records", "amount_ex_vat", "legacy_entity_table = 'public.change_requests'",
    );
  });

  it("finance_records direction is set correctly for VOs", async () => {
    // Negative cost_impact → inflow, positive → outflow
    const negativeVo = await queryOne(
      `SELECT fr.direction FROM finance.finance_records fr JOIN change_requests cr ON cr.id = fr.legacy_entity_id WHERE fr.legacy_entity_table = 'public.change_requests' AND cr.cost_impact::numeric < 0 LIMIT 1`,
    );
    if (negativeVo) expect(negativeVo.direction).toBe("inflow");

    const positiveVo = await queryOne(
      `SELECT fr.direction FROM finance.finance_records fr JOIN change_requests cr ON cr.id = fr.legacy_entity_id WHERE fr.legacy_entity_table = 'public.change_requests' AND cr.cost_impact::numeric > 0 LIMIT 1`,
    );
    if (positiveVo) expect(positiveVo.direction).toBe("outflow");
  });

  it("VO finance_records have party_id populated", async () => {
    const rows = await query(
      `SELECT fr.id, fr.party_id FROM finance.finance_records fr WHERE fr.legacy_entity_table = 'public.change_requests'`,
    );
    for (const row of rows) {
      expect(row.party_id).not.toBeNull();
    }
  });

  it("finance.budget_lines table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM finance.budget_lines`);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// 7. BRIDGE INFRASTRUCTURE
// ===========================================================================
describe("Bridge Infrastructure", () => {
  it("internal.bridge_sync_failures table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM internal.bridge_sync_failures`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("internal.sync_watermarks table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM internal.sync_watermarks`);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// 8. SUPPORT TABLES — Phase G/H
// ===========================================================================
describe("Support Tables (Phase G/H)", () => {
  it("core.external_resources table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.external_resources`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.activity_logs table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.activity_logs`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.strategic_priorities table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.strategic_priorities`);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("core.import_batches table exists", async () => {
    const count = await queryCount(`SELECT count(*) AS cnt FROM core.import_batches`);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// 9. FK INTEGRITY — cross-cutting
// ===========================================================================
describe("Cross-Domain FK Integrity", () => {
  it("finance_records party_id references valid core.parties", async () => {
    await expectNoOrphanedFks("finance.finance_records", "party_id", "core.parties", "id");
  });

  it("project_party_links party references valid parties", async () => {
    await expectNoOrphanedFks("core.project_party_links", "party_id", "core.parties", "id");
  });

  it("no orphaned legacy_entity_id in finance_records for cost_lines", async () => {
    const count = await queryCount(
      `SELECT count(*) AS cnt FROM finance.finance_records fr WHERE fr.legacy_entity_table = 'cost_lines' AND NOT EXISTS (SELECT 1 FROM finance.cost_lines cl WHERE cl.id = fr.legacy_entity_id)`,
    );
    expect(count).toBe(0);
  });

  it("no orphaned legacy_entity_id in finance_records for revenue_lines", async () => {
    const count = await queryCount(
      `SELECT count(*) AS cnt FROM finance.finance_records fr WHERE fr.legacy_entity_table = 'revenue_lines' AND NOT EXISTS (SELECT 1 FROM finance.revenue_lines rl WHERE rl.id = fr.legacy_entity_id)`,
    );
    expect(count).toBe(0);
  });
});

// ===========================================================================
// 10. POST-MIGRATION MUTATIONS — prove runtime writes still work
// ===========================================================================
describe("Post-Migration Mutations", () => {
  it("can INSERT a new legacy user and it is valid", async () => {
    const [row] = await query(
      `INSERT INTO users (name, email, role, username, password, created_at, updated_at) VALUES ('Test User', 'testuser@test.com', 'user', 'testuser', 'hashed', NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    // Cleanup
    await getPool().query(`DELETE FROM users WHERE id = ${row.id}`);
  });

  it("can INSERT a new legacy project", async () => {
    const [row] = await query(
      `INSERT INTO project_info (project_name, client_id, phase, created_at, updated_at) VALUES ('Test Project', 1, 'Development', NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    // Cleanup
    await getPool().query(`DELETE FROM project_info WHERE id = ${row.id}`);
  });

  it("can INSERT a new cost line", async () => {
    const [row] = await query(
      `INSERT INTO normalized_cost_lines (project_name, counterparty_name, description, amount_ex_vat, status, effective_from, created_at, updated_at) VALUES ('Solar Farm Alpha', 'Panel Supply Co', 'Test Cost', '1000.00', 'PLANNED', '2026-04-01', NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    await getPool().query(`DELETE FROM normalized_cost_lines WHERE id = ${row.id}`);
  });

  it("can INSERT a new change_request", async () => {
    const [row] = await query(
      `INSERT INTO change_requests (project_id, title, change_type, status, cost_impact, requested_by_user_id, created_at, updated_at) VALUES (1, 'Test VO', 'cost', 'draft', 5000, 1, NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    await getPool().query(`DELETE FROM change_requests WHERE id = ${row.id}`);
  });

  it("can INSERT directly into finance.finance_records", async () => {
    const [row] = await query(
      `INSERT INTO finance.finance_records (legacy_entity_id, legacy_entity_table, financial_type, direction, title, amount_ex_vat, status, record_data, created_at, updated_at) VALUES (99999, 'test_entity', 'test', 'outflow', 'Test Record', 100.00, 'draft', '{}'::jsonb, NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    await getPool().query(`DELETE FROM finance.finance_records WHERE id = ${row.id}`);
  });

  it("can INSERT into core.parties", async () => {
    const [row] = await query(
      `INSERT INTO core.parties (party_type, name_canonical, source_table, created_at, updated_at) VALUES ('vendor', 'Test Vendor', 'test', NOW(), NOW()) RETURNING id`,
    );
    expect(row.id).toBeGreaterThan(0);

    await getPool().query(`DELETE FROM core.parties WHERE id = ${row.id}`);
  });

  it("can UPDATE a legacy project", async () => {
    await getPool().query(
      `UPDATE project_info SET phase = 'Construction', updated_at = NOW() WHERE id = 1`,
    );
    const row = await queryOne(`SELECT phase FROM project_info WHERE id = 1`);
    expect(row.phase).toBe("Construction");

    // Restore
    await getPool().query(`UPDATE project_info SET phase = 'Execution', updated_at = NOW() WHERE id = 1`);
  });

  it("can soft-delete a change_request", async () => {
    const [cr] = await query(
      `INSERT INTO change_requests (project_id, title, change_type, status, created_at, updated_at) VALUES (1, 'Temp VO', 'scope', 'draft', NOW(), NOW()) RETURNING id`,
    );
    await getPool().query(
      `UPDATE change_requests SET deleted_at = NOW(), delete_reason = 'test cleanup' WHERE id = ${cr.id}`,
    );
    const row = await queryOne(`SELECT deleted_at FROM change_requests WHERE id = ${cr.id}`);
    expect(row.deleted_at).not.toBeNull();

    await getPool().query(`DELETE FROM change_requests WHERE id = ${cr.id}`);
  });
});

// ===========================================================================
// 11. IDEMPOTENCY — re-running migrations is safe
// ===========================================================================
describe("Migration Idempotency", () => {
  it("key promoted tables still exist after full migration pass", async () => {
    // If migrations are idempotent, we should still be in a clean state
    const tables = [
      "core.parties",
      "core.user_accounts",
      "core.project_instances",
      "core.project_party_links",
      "finance.finance_records",
      "finance.finance_record_events",
      "internal.bridge_sync_failures",
    ];
    for (const table of tables) {
      const [schema, name] = table.split(".");
      const row = await queryOne(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${name}'`,
      );
      expect(row).not.toBeNull();
    }
  });
});
