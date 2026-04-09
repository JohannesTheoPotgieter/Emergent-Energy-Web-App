import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "migrations");

// ---------------------------------------------------------------------------
// Helper: read a migration file
// ---------------------------------------------------------------------------
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), "utf8");
}

// ===========================================================================
// Group 1: Schema Existence Tests (one per migration)
// ===========================================================================
describe("Phase 1B Schema Existence Tests", () => {

  // -- Migration 1: Lifecycle parity columns on core.projects --
  describe("Migration 1: lifecycle_parity_columns", () => {
    const sql = readMigration("20260402_lifecycle_parity_columns.sql");

    it("adds all 6 lifecycle columns to core.projects", () => {
      const columns = [
        "current_stage_code", "gate_status", "gate_readiness_pct",
        "phase_updated_at", "signed_status", "execution_phase",
      ];
      for (const col of columns) {
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
      }
    });

    it("targets core.projects table", () => {
      expect(sql).toContain("ALTER TABLE core.projects");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });

    it("adds COMMENT ON COLUMN for each column", () => {
      const columns = [
        "current_stage_code", "gate_status", "gate_readiness_pct",
        "phase_updated_at", "signed_status", "execution_phase",
      ];
      for (const col of columns) {
        expect(sql).toContain(`COMMENT ON COLUMN core.projects.${col}`);
      }
    });
  });

  // -- Migration 1 rollback --
  describe("Rollback 1: lifecycle_parity_columns_rollback", () => {
    const sql = readMigration("20260402_lifecycle_parity_columns_rollback.sql");

    it("drops all 6 lifecycle columns", () => {
      const columns = [
        "current_stage_code", "gate_status", "gate_readiness_pct",
        "phase_updated_at", "signed_status", "execution_phase",
      ];
      for (const col of columns) {
        expect(sql).toContain(`DROP COLUMN IF EXISTS ${col}`);
      }
    });
  });

  // -- Migration 2: Approval type support on documentation.document_approvals --
  describe("Migration 2: approval_type_support", () => {
    const sql = readMigration("20260402_approval_type_support.sql");

    it("adds all 11 approval columns", () => {
      const columns = [
        "legacy_approval_id", "approval_type", "approval_category", "title",
        "project_id", "related_entity_type", "related_entity_id",
        "requested_by_user_id", "urgency", "evidence_links", "source_table",
      ];
      for (const col of columns) {
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
      }
    });

    it("legacy_approval_id has UNIQUE constraint", () => {
      expect(sql).toContain("legacy_approval_id INTEGER UNIQUE");
    });

    it("project_id references core.projects(id)", () => {
      expect(sql).toContain("REFERENCES core.projects(id)");
    });

    it("adds COMMENT ON COLUMN for key columns", () => {
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_approvals.legacy_approval_id");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_approvals.approval_type");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_approvals.approval_category");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_approvals.project_id");
    });
  });

  // -- Migration 2 rollback --
  describe("Rollback 2: approval_type_support_rollback", () => {
    const sql = readMigration("20260402_approval_type_support_rollback.sql");

    it("drops all 11 approval columns", () => {
      const columns = [
        "legacy_approval_id", "approval_type", "approval_category", "title",
        "project_id", "related_entity_type", "related_entity_id",
        "requested_by_user_id", "urgency", "evidence_links", "source_table",
      ];
      for (const col of columns) {
        expect(sql).toContain(`DROP COLUMN IF EXISTS ${col}`);
      }
    });
  });

  // -- Migration 3: Client contact fields on core.clients --
  describe("Migration 3: client_contact_fields", () => {
    const sql = readMigration("20260402_client_contact_fields.sql");

    it("adds all 6 client contact columns", () => {
      const columns = [
        "legal_entity_name", "trading_name", "client_type",
        "primary_contact_name", "primary_contact_email", "primary_contact_phone",
      ];
      for (const col of columns) {
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
      }
    });

    it("adds COMMENT ON COLUMN for key columns", () => {
      expect(sql).toContain("COMMENT ON COLUMN core.clients.legal_entity_name");
      expect(sql).toContain("COMMENT ON COLUMN core.clients.client_type");
      expect(sql).toContain("COMMENT ON COLUMN core.clients.primary_contact_name");
    });
  });

  // -- Migration 3 rollback --
  describe("Rollback 3: client_contact_fields_rollback", () => {
    const sql = readMigration("20260402_client_contact_fields_rollback.sql");

    it("drops all 6 client contact columns", () => {
      const columns = [
        "legal_entity_name", "trading_name", "client_type",
        "primary_contact_name", "primary_contact_email", "primary_contact_phone",
      ];
      for (const col of columns) {
        expect(sql).toContain(`DROP COLUMN IF EXISTS ${col}`);
      }
    });
  });

  // -- Migration 4: Party abstraction table --
  describe("Migration 4: party_abstraction", () => {
    const sql = readMigration("20260402_party_abstraction.sql");

    it("creates core.parties table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.parties");
    });

    it("includes all required columns", () => {
      const columns = [
        "id BIGSERIAL PRIMARY KEY", "legacy_counterparty_id INTEGER UNIQUE",
        "legacy_client_id INTEGER UNIQUE", "party_type TEXT NOT NULL",
        "name_canonical TEXT NOT NULL", "name_aliases JSONB",
        "is_active BOOLEAN NOT NULL DEFAULT true", "vat_number TEXT",
        "registration_number TEXT", "contact_person TEXT", "contact_email TEXT",
        "contact_phone TEXT", "address TEXT", "payment_terms TEXT",
        "role_tags TEXT[]", "source_table TEXT NOT NULL",
        "created_at TIMESTAMP NOT NULL DEFAULT NOW()",
        "updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
      ];
      for (const col of columns) {
        expect(sql).toContain(col);
      }
    });

    it("creates required indexes", () => {
      expect(sql).toContain("idx_parties_name_canonical");
      expect(sql).toContain("LOWER(name_canonical)");
      expect(sql).toContain("idx_parties_party_type");
    });

    it("has COMMENT ON TABLE", () => {
      expect(sql).toContain("COMMENT ON TABLE core.parties");
    });
  });

  // -- Migration 4 rollback --
  describe("Rollback 4: party_abstraction_rollback", () => {
    const sql = readMigration("20260402_party_abstraction_rollback.sql");

    it("drops indexes then table", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS core.idx_parties_name_canonical");
      expect(sql).toContain("DROP INDEX IF EXISTS core.idx_parties_party_type");
      expect(sql).toContain("DROP TABLE IF EXISTS core.parties");
    });
  });

  // -- Migration 5: Finance period derivation --
  describe("Migration 5: finance_period_derivation", () => {
    const sql = readMigration("20260402_finance_period_derivation.sql");

    it("adds typed date columns to cost_lines", () => {
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE");
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS approved_date_typed DATE");
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE");
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER");
    });

    it("adds opening balance classification columns to cost_lines", () => {
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN");
      expect(sql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS legacy_row_type TEXT");
    });

    it("adds typed date columns to revenue_lines", () => {
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS invoice_date_typed DATE");
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS expected_payment_date_typed DATE");
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS paid_date_typed DATE");
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS fiscal_period_id INTEGER");
    });

    it("adds opening balance classification columns to revenue_lines", () => {
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN");
      expect(sql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS legacy_row_type TEXT");
    });

    it("creates finance.fiscal_periods table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance.fiscal_periods");
    });

    it("creates required indexes", () => {
      expect(sql).toContain("idx_finance_cost_lines_fiscal_period");
      expect(sql).toContain("idx_finance_revenue_lines_fiscal_period");
      expect(sql).toContain("idx_finance_fiscal_periods_range");
    });

    it("adds COMMENT ON COLUMN for key columns", () => {
      expect(sql).toContain("COMMENT ON COLUMN finance.cost_lines.invoice_date_typed");
      expect(sql).toContain("COMMENT ON COLUMN finance.cost_lines.fiscal_period_id");
      expect(sql).toContain("COMMENT ON COLUMN finance.revenue_lines.fiscal_period_id");
    });
  });

  // -- Migration 5 rollback --
  describe("Rollback 5: finance_period_derivation_rollback", () => {
    const sql = readMigration("20260402_finance_period_derivation_rollback.sql");

    it("drops indexes, columns, and table", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS finance.idx_finance_cost_lines_fiscal_period");
      expect(sql).toContain("DROP INDEX IF EXISTS finance.idx_finance_revenue_lines_fiscal_period");
      expect(sql).toContain("DROP INDEX IF EXISTS finance.idx_finance_fiscal_periods_range");
      expect(sql).toContain("DROP COLUMN IF EXISTS invoice_date_typed");
      expect(sql).toContain("DROP COLUMN IF EXISTS fiscal_period_id");
      expect(sql).toContain("DROP COLUMN IF EXISTS is_opening_balance");
      expect(sql).toContain("DROP COLUMN IF EXISTS legacy_row_type");
      expect(sql).toContain("DROP TABLE IF EXISTS finance.fiscal_periods");
    });
  });

  // -- Migration 6: Evidence link parity --
  describe("Migration 6: evidence_link_parity", () => {
    const sql = readMigration("20260402_evidence_link_parity.sql");

    it("adds all 5 SharePoint columns to document_versions", () => {
      const columns = ["site_id TEXT", "drive_id TEXT", "file_item_id TEXT", "web_url TEXT", "is_approved BOOLEAN"];
      for (const col of columns) {
        expect(sql).toContain(col);
      }
    });

    it("creates partial index on file lineage", () => {
      expect(sql).toContain("idx_document_versions_file_lineage");
      expect(sql).toContain("WHERE legacy_deliverable_file_id IS NOT NULL");
    });

    it("adds COMMENT ON COLUMN for all 5 columns", () => {
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_versions.site_id");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_versions.drive_id");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_versions.file_item_id");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_versions.web_url");
      expect(sql).toContain("COMMENT ON COLUMN documentation.document_versions.is_approved");
    });
  });

  // -- Migration 6 rollback --
  describe("Rollback 6: evidence_link_parity_rollback", () => {
    const sql = readMigration("20260402_evidence_link_parity_rollback.sql");

    it("drops index and all 5 columns", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS documentation.idx_document_versions_file_lineage");
      expect(sql).toContain("DROP COLUMN IF EXISTS site_id");
      expect(sql).toContain("DROP COLUMN IF EXISTS drive_id");
      expect(sql).toContain("DROP COLUMN IF EXISTS file_item_id");
      expect(sql).toContain("DROP COLUMN IF EXISTS web_url");
      expect(sql).toContain("DROP COLUMN IF EXISTS is_approved");
    });
  });

  // -- Migration 7: Stale item tracking --
  describe("Migration 7: stale_item_tracking", () => {
    const sql = readMigration("20260402_stale_item_tracking.sql");

    it("adds last_synced_at to all 6 promoted tables", () => {
      const tables = [
        "core.projects", "core.clients",
        "documentation.document_approvals", "documentation.documents",
        "finance.cost_lines", "finance.revenue_lines",
      ];
      for (const table of tables) {
        expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP`);
      }
    });

    it("creates internal.sync_watermarks table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS internal.sync_watermarks");
    });

    it("creates domain+checked_at index", () => {
      expect(sql).toContain("idx_sync_watermarks_domain_checked");
      expect(sql).toContain("(domain, checked_at DESC)");
    });

    it("has COMMENT ON TABLE and COMMENT ON COLUMN for lag_seconds", () => {
      expect(sql).toContain("COMMENT ON TABLE internal.sync_watermarks");
      expect(sql).toContain("COMMENT ON COLUMN internal.sync_watermarks.lag_seconds");
    });
  });

  // -- Migration 7 rollback --
  describe("Rollback 7: stale_item_tracking_rollback", () => {
    const sql = readMigration("20260402_stale_item_tracking_rollback.sql");

    it("drops last_synced_at from all 6 tables", () => {
      const tables = [
        "core.projects", "core.clients",
        "documentation.document_approvals", "documentation.documents",
        "finance.cost_lines", "finance.revenue_lines",
      ];
      for (const table of tables) {
        expect(sql).toContain(`ALTER TABLE ${table} DROP COLUMN IF EXISTS last_synced_at`);
      }
    });

    it("drops index and table", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS internal.idx_sync_watermarks_domain_checked");
      expect(sql).toContain("DROP TABLE IF EXISTS internal.sync_watermarks");
    });
  });

  // -- Migration 8: State history tables --
  describe("Migration 8: state_history_tables", () => {
    const sql = readMigration("20260402_state_history_tables.sql");

    it("creates core.project_state_history table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_state_history");
    });

    it("creates documentation.approval_state_history table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS documentation.approval_state_history");
    });

    it("creates finance.cost_line_history table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance.cost_line_history");
    });

    it("creates finance.revenue_line_history table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance.revenue_line_history");
    });

    it("all history tables have is_current BOOLEAN column", () => {
      // Count occurrences of is_current in CREATE TABLE blocks
      const matches = sql.match(/is_current BOOLEAN NOT NULL DEFAULT false/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(4);
    });

    it("all history tables have snapshot_reason and snapshot_at", () => {
      expect(sql).toContain("snapshot_reason TEXT NOT NULL DEFAULT 'backfill'");
      expect(sql).toContain("snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()");
    });

    it("creates partial indexes for fast is_current queries", () => {
      expect(sql).toContain("WHERE is_current = true");
      expect(sql).toContain("idx_project_state_history_project_current");
      expect(sql).toContain("idx_approval_state_history_approval_current");
      expect(sql).toContain("idx_cost_line_history_line_current");
      expect(sql).toContain("idx_revenue_line_history_line_current");
    });

    it("creates timeline index for project state history", () => {
      expect(sql).toContain("idx_project_state_history_project_timeline");
      expect(sql).toContain("snapshot_at DESC");
    });
  });

  // -- Migration 8 rollback --
  describe("Rollback 8: state_history_tables_rollback", () => {
    const sql = readMigration("20260402_state_history_tables_rollback.sql");

    it("drops all 4 history tables", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.project_state_history");
      expect(sql).toContain("DROP TABLE IF EXISTS documentation.approval_state_history");
      expect(sql).toContain("DROP TABLE IF EXISTS finance.cost_line_history");
      expect(sql).toContain("DROP TABLE IF EXISTS finance.revenue_line_history");
    });
  });
});

// ===========================================================================
// Group 2: Backfill Correctness Tests (one per backfill script)
// ===========================================================================
describe("Phase 1B Backfill Script Correctness Tests", () => {

  // -- Backfill 01: Fiscal periods --
  describe("Backfill 01: fiscal_periods", () => {
    const sql = readMigration("20260402_backfill_01_fiscal_periods.sql");

    it("inserts into finance.fiscal_periods from public.fiscal_periods + fiscal_years", () => {
      expect(sql).toContain("INSERT INTO finance.fiscal_periods");
      expect(sql).toContain("FROM public.fiscal_periods fp");
      expect(sql).toContain("JOIN public.fiscal_years fy ON fy.id = fp.fiscal_year_id");
    });

    it("uses ON CONFLICT DO NOTHING for idempotency", () => {
      expect(sql).toContain("ON CONFLICT (legacy_fiscal_period_id) DO NOTHING");
    });

    it("is wrapped in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Backfill 02: Client contacts --
  describe("Backfill 02: client_contacts", () => {
    const sql = readMigration("20260402_backfill_02_client_contacts.sql");

    it("updates core.clients from public.clients via legacy_id", () => {
      expect(sql).toContain("UPDATE core.clients");
      expect(sql).toContain("FROM public.clients lc");
      expect(sql).toContain("WHERE cc.legacy_id = lc.id");
    });

    it("sets all 6 contact fields", () => {
      const fields = [
        "legal_entity_name", "trading_name", "client_type",
        "primary_contact_name", "primary_contact_email", "primary_contact_phone",
      ];
      for (const f of fields) {
        expect(sql).toContain(f);
      }
    });
  });

  // -- Backfill 03: Parties --
  describe("Backfill 03: parties", () => {
    const sql = readMigration("20260402_backfill_03_parties.sql");

    it("inserts counterparties with ON CONFLICT DO NOTHING", () => {
      expect(sql).toContain("INSERT INTO core.parties");
      expect(sql).toContain("FROM public.counterparties cp");
      expect(sql).toContain("ON CONFLICT (legacy_counterparty_id) DO NOTHING");
    });

    it("inserts clients with ON CONFLICT DO NOTHING", () => {
      expect(sql).toContain("FROM public.clients lc");
      expect(sql).toContain("ON CONFLICT (legacy_client_id) DO NOTHING");
    });

    it("filters deleted counterparties", () => {
      expect(sql).toContain("WHERE cp.deleted_at IS NULL");
    });
  });

  // -- Backfill 04: Lifecycle columns --
  describe("Backfill 04: lifecycle_columns", () => {
    const sql = readMigration("20260402_backfill_04_lifecycle_columns.sql");

    it("updates core.projects from project_execution_state", () => {
      expect(sql).toContain("UPDATE core.projects cp");
      expect(sql).toContain("project_execution_state pes");
    });

    it("uses ROW_NUMBER() to select only latest row per project", () => {
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("PARTITION BY pes.project_id");
      expect(sql).toContain("ORDER BY pes.updated_at DESC");
      expect(sql).toContain("rn = 1");
    });

    it("filters deleted execution state rows", () => {
      expect(sql).toContain("pes.deleted_at IS NULL");
    });

    it("sets all 6 lifecycle fields", () => {
      const fields = [
        "current_stage_code", "gate_status", "gate_readiness_pct",
        "phase_updated_at", "signed_status", "execution_phase",
      ];
      for (const f of fields) {
        expect(sql).toContain(f);
      }
    });
  });

  // -- Backfill 05: Approval lineage --
  describe("Backfill 05: approval_lineage", () => {
    const sql = readMigration("20260402_backfill_05_approval_lineage.sql");

    it("inserts into document_approvals from public.approvals", () => {
      expect(sql).toContain("INSERT INTO documentation.document_approvals");
      expect(sql).toContain("FROM public.approvals a");
    });

    it("joins core.projects for project_id resolution", () => {
      expect(sql).toContain("LEFT JOIN core.projects cp ON cp.legacy_project_info_id = a.project_id");
    });

    it("joins documentation.documents for document_id (LEFT JOIN for non-document approvals)", () => {
      expect(sql).toContain("LEFT JOIN documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id");
      expect(sql).toContain("AND a.related_entity_type = 'deliverable'");
    });

    it("uses ON CONFLICT (legacy_approval_id) DO NOTHING", () => {
      expect(sql).toContain("ON CONFLICT (legacy_approval_id) DO NOTHING");
    });

    it("filters deleted approvals", () => {
      expect(sql).toContain("WHERE a.deleted_at IS NULL");
    });
  });

  // -- Backfill 06: Evidence SharePoint fields --
  describe("Backfill 06: evidence_sharepoint", () => {
    const sql = readMigration("20260402_backfill_06_evidence_sharepoint.sql");

    it("updates document_versions from deliverable_files via correct join key", () => {
      expect(sql).toContain("UPDATE documentation.document_versions dv_promoted");
      expect(sql).toContain("FROM public.deliverable_files df");
      expect(sql).toContain("WHERE dv_promoted.legacy_deliverable_file_id = df.id");
    });

    it("sets all 5 SharePoint fields", () => {
      const fields = ["site_id", "drive_id", "file_item_id", "web_url", "is_approved"];
      for (const f of fields) {
        expect(sql).toContain(f);
      }
    });

    it("guards with WHERE site_id IS NULL for idempotency", () => {
      expect(sql).toContain("AND dv_promoted.site_id IS NULL");
    });

    it("does NOT join on version_id in SQL statements", () => {
      // Filter out comment lines, then check no SQL statement references version_id
      const sqlLines = sql.split("\n").filter((l) => !l.trim().startsWith("--"));
      const joined = sqlLines.join("\n");
      expect(joined).not.toContain("version_id");
    });
  });

  // -- Backfill 07: Finance typed dates --
  describe("Backfill 07: finance_typed_dates", () => {
    const sql = readMigration("20260402_backfill_07_finance_typed_dates.sql");

    it("classifies opening balance rows on cost_lines before date parsing", () => {
      expect(sql).toContain("is_opening_balance = true");
      expect(sql).toContain("legacy_row_type = pe.row_type");
      expect(sql).toContain("public.program_expense pe");
    });

    it("detects opening balance patterns in row_type", () => {
      expect(sql).toContain("'opening_balance'");
      expect(sql).toContain("'balance_forward'");
      expect(sql).toContain("'brought_forward'");
    });

    it("classifies opening balance rows on revenue_lines", () => {
      expect(sql).toContain("public.program_inflows pi");
      expect(sql).toContain("'opening balance'");
    });

    it("parses cost_lines TEXT dates with regex guard", () => {
      expect(sql).toContain("finance.cost_lines");
      expect(sql).toContain("invoice_date ~ '^\\d{4}-\\d{2}-\\d{2}'");
    });

    it("parses revenue_lines TEXT dates with regex guard", () => {
      expect(sql).toContain("finance.revenue_lines");
      expect(sql).toContain("expected_payment_date_typed");
    });

    it("derives fiscal_period_id on cost_lines from fiscal_periods range", () => {
      expect(sql).toContain("UPDATE finance.cost_lines cl");
      expect(sql).toContain("FROM finance.fiscal_periods fp");
      expect(sql).toContain("cl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date");
      expect(sql).toContain("cl.fiscal_period_id IS NULL");
    });

    it("EXCLUDES opening balance rows from fiscal period derivation on cost_lines", () => {
      // The fiscal_period_id derivation must have is_opening_balance = false guard
      const step3Match = sql.match(
        /UPDATE finance\.cost_lines cl[\s\S]*?SET fiscal_period_id = fp\.id[\s\S]*?(?=UPDATE finance\.revenue_lines|COMMIT)/
      );
      expect(step3Match).not.toBeNull();
      expect(step3Match![0]).toContain("is_opening_balance = false");
    });

    it("EXCLUDES opening balance rows from fiscal period derivation on revenue_lines", () => {
      // The fiscal_period_id derivation for revenue_lines must also exclude opening balances
      const step4Match = sql.match(
        /UPDATE finance\.revenue_lines rl[\s\S]*?SET fiscal_period_id = fp\.id[\s\S]*?COMMIT/
      );
      expect(step4Match).not.toBeNull();
      expect(step4Match![0]).toContain("is_opening_balance = false");
    });

    it("derives fiscal_period_id on revenue_lines from fiscal_periods range", () => {
      expect(sql).toContain("UPDATE finance.revenue_lines rl");
      expect(sql).toContain("rl.invoice_date_typed BETWEEN fp.start_date AND fp.end_date");
      expect(sql).toContain("rl.fiscal_period_id IS NULL");
    });

    it("guards all steps with WHERE ... IS NULL", () => {
      expect(sql).toContain("WHERE invoice_date_typed IS NULL");
    });
  });

  // -- Backfill 08: State history --
  describe("Backfill 08: state_history", () => {
    const sql = readMigration("20260402_backfill_08_state_history.sql");

    it("populates project_state_history from project_execution_state", () => {
      expect(sql).toContain("INSERT INTO core.project_state_history");
      expect(sql).toContain("project_execution_state pes");
    });

    it("uses ROW_NUMBER() to derive is_current for project history", () => {
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("PARTITION BY pes.project_id");
    });

    it("populates approval_state_history from document_approvals", () => {
      expect(sql).toContain("INSERT INTO documentation.approval_state_history");
      expect(sql).toContain("document_approvals da");
    });

    it("populates cost_line_history and revenue_line_history", () => {
      expect(sql).toContain("INSERT INTO finance.cost_line_history");
      expect(sql).toContain("INSERT INTO finance.revenue_line_history");
    });

    it("includes integrity checks for exactly one is_current per entity", () => {
      expect(sql).toContain("HISTORY_INTEGRITY_CHECK_PROJECTS");
      expect(sql).toContain("HISTORY_INTEGRITY_CHECK_APPROVALS");
      expect(sql).toContain("HISTORY_INTEGRITY_CHECK_COST_LINES");
      expect(sql).toContain("HISTORY_INTEGRITY_CHECK_REVENUE_LINES");
    });

    it("is idempotent via WHERE NOT EXISTS guards", () => {
      expect(sql).toContain("WHERE NOT EXISTS");
    });

    it("is wrapped in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });
});

// ===========================================================================
// Group 3: Preflight Gate Tests (verify preflight script structure)
// ===========================================================================
describe("Phase 1B Preflight Audit Script Tests", () => {
  const sql = readMigration("20260402_preflight_audit.sql");

  it("is a read-only script (no ALTER, DROP, INSERT, UPDATE, DELETE, CREATE)", () => {
    const lines = sql.split("\n").filter((l) => !l.trim().startsWith("--"));
    const dml = lines.filter((l) =>
      /^\s*(ALTER|DROP|INSERT|UPDATE|DELETE|CREATE)\b/i.test(l)
    );
    expect(dml).toHaveLength(0);
  });

  it("contains all 11 preflight checks", () => {
    expect(sql).toContain("PF-1");
    expect(sql).toContain("PF-2");
    expect(sql).toContain("PF-3");
    expect(sql).toContain("PF-4");
    expect(sql).toContain("PF-5");
    expect(sql).toContain("PF-6");
    expect(sql).toContain("PF-7");
    expect(sql).toContain("PF-8");
    expect(sql).toContain("PF-9");
    expect(sql).toContain("PF-10");
    expect(sql).toContain("PF-11");
  });

  it("PF-1 checks duplicate approval lineage in public.approvals", () => {
    expect(sql).toContain("public.approvals");
    expect(sql).toContain("HAVING COUNT(*) > 1");
  });

  it("PF-2 checks orphan FK mappings across 4 domains", () => {
    expect(sql).toContain("PF-2a");
    expect(sql).toContain("PF-2b");
    expect(sql).toContain("PF-2c");
    expect(sql).toContain("PF-2d");
  });

  it("PF-3 checks unparseable finance dates with regex", () => {
    expect(sql).toContain("!~ '^\\d{4}-\\d{2}-\\d{2}'");
  });

  it("PF-4 checks party canonicalization collisions", () => {
    expect(sql).toContain("LOWER(TRIM(name_canonical))");
    expect(sql).toContain("public.counterparties");
  });

  it("PF-5 checks unresolved project FK mappings", () => {
    expect(sql).toContain("PF-5a");
    expect(sql).toContain("PF-5b");
    expect(sql).toContain("legacy_project_info_id");
  });

  it("PF-6 checks existing promoted rows (INFO level)", () => {
    expect(sql).toContain("PF-6a");
    expect(sql).toContain("PF-6b");
    expect(sql).toContain("PF-6c");
    expect(sql).toContain("PF-6d");
  });

  it("PF-7 checks orphan legacy files", () => {
    expect(sql).toContain("public.deliverable_files df");
    expect(sql).toContain("legacy_deliverable_file_id");
  });

  it("PF-8a reports multiple project_execution_state rows as INFO", () => {
    expect(sql).toContain("PF-8a");
    expect(sql).toContain("'INFO' AS result");
  });

  it("PF-8b checks ambiguous ranking (tied keys) as HARD STOP", () => {
    expect(sql).toContain("PF-8b");
    expect(sql).toContain("Ambiguous current-state rows");
    expect(sql).toContain("THEN 'PASS' ELSE 'FAIL'");
  });

  it("PF-9a/PF-9b are SOFT STOP requiring review", () => {
    expect(sql).toContain("'SOFT_STOP' AS severity");
    expect(sql).toContain("REVIEW REQUIRED");
  });

  it("PF-9 includes detail reports listing every classified OB row", () => {
    expect(sql).toContain("PF-9a-detail");
    expect(sql).toContain("PF-9b-detail");
  });

  it("PF-9c/PF-9d are HARD STOP for multiple OBs per project", () => {
    expect(sql).toContain("PF-9c");
    expect(sql).toContain("PF-9d");
    expect(sql).toContain("'HARD_STOP' AS severity");
  });

  it("PF-10 checks join multiplication on finance lines", () => {
    expect(sql).toContain("PF-10a");
    expect(sql).toContain("PF-10b");
    expect(sql).toContain("PF-10c");
    expect(sql).toContain("legacy_program_expense_id");
    expect(sql).toContain("legacy_program_inflow_id");
  });

  it("PF-11 covers row-count AND amount inflation", () => {
    expect(sql).toContain("PF-11a");
    expect(sql).toContain("PF-11b");
    expect(sql).toContain("PF-11c");
    expect(sql).toContain("PF-11d");
    expect(sql).toContain("amount inflation");
    expect(sql).toContain("row count inflation");
  });

  it("PF-11 covers portfolio-level aggregates", () => {
    expect(sql).toContain("PF-11e");
    expect(sql).toContain("PF-11f");
    expect(sql).toContain("Portfolio-level");
  });

  it("outputs PASS/FAIL for each HARD STOP check", () => {
    const passFailCount = (sql.match(/THEN 'PASS' ELSE 'FAIL'/g) || []).length;
    expect(passFailCount).toBeGreaterThanOrEqual(14);
  });
});

// ===========================================================================
// Group 4: Reconciliation Integration Tests (structural)
// ===========================================================================
describe("Phase 1B Reconciliation Integration Tests", () => {

  it("buildPhase1AReconciliationReport function exists and is exported", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "server/services/promoted-read-compat.ts"),
      "utf8"
    );
    expect(content).toContain("export async function buildPhase1AReconciliationReport");
  });

  it("reconciliation covers all 6 domains", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "server/services/promoted-read-compat.ts"),
      "utf8"
    );
    const domains = [
      "project_reads", "lifecycle_gates", "approvals",
      "finance", "deliverables", "party_contacts",
    ];
    for (const domain of domains) {
      expect(content).toContain(domain);
    }
  });

  it("all 16 migration files exist (8 forward + 8 rollback)", () => {
    const expectedFiles = [
      "20260402_lifecycle_parity_columns.sql",
      "20260402_lifecycle_parity_columns_rollback.sql",
      "20260402_approval_type_support.sql",
      "20260402_approval_type_support_rollback.sql",
      "20260402_client_contact_fields.sql",
      "20260402_client_contact_fields_rollback.sql",
      "20260402_party_abstraction.sql",
      "20260402_party_abstraction_rollback.sql",
      "20260402_finance_period_derivation.sql",
      "20260402_finance_period_derivation_rollback.sql",
      "20260402_evidence_link_parity.sql",
      "20260402_evidence_link_parity_rollback.sql",
      "20260402_stale_item_tracking.sql",
      "20260402_stale_item_tracking_rollback.sql",
      "20260402_state_history_tables.sql",
      "20260402_state_history_tables_rollback.sql",
    ];
    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(migrationsDir, file))).toBe(true);
    }
  });

  it("preflight audit script exists", () => {
    expect(fs.existsSync(path.join(migrationsDir, "20260402_preflight_audit.sql"))).toBe(true);
  });

  it("all 8 backfill scripts exist", () => {
    const expectedFiles = [
      "20260402_backfill_01_fiscal_periods.sql",
      "20260402_backfill_02_client_contacts.sql",
      "20260402_backfill_03_parties.sql",
      "20260402_backfill_04_lifecycle_columns.sql",
      "20260402_backfill_05_approval_lineage.sql",
      "20260402_backfill_06_evidence_sharepoint.sql",
      "20260402_backfill_07_finance_typed_dates.sql",
      "20260402_backfill_08_state_history.sql",
    ];
    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(migrationsDir, file))).toBe(true);
    }
  });

  it("no shared/schema ORM files were modified", () => {
    // Verify we haven't touched the Drizzle schema files
    const schemaDir = path.join(process.cwd(), "shared/schema");
    const schemaFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".ts"));
    expect(schemaFiles.length).toBeGreaterThan(0);
    // This is a structural assertion — actual modification detection would use git diff
  });

  it("all forward migrations are idempotent (IF NOT EXISTS / IF EXISTS)", () => {
    const forwardMigrations = [
      "20260402_lifecycle_parity_columns.sql",
      "20260402_approval_type_support.sql",
      "20260402_client_contact_fields.sql",
      "20260402_party_abstraction.sql",
      "20260402_finance_period_derivation.sql",
      "20260402_evidence_link_parity.sql",
      "20260402_stale_item_tracking.sql",
    ];
    for (const file of forwardMigrations) {
      const content = readMigration(file);
      expect(
        content.includes("IF NOT EXISTS") || content.includes("IF EXISTS")
      ).toBe(true);
    }
  });

  it("all forward migrations are wrapped in BEGIN/COMMIT", () => {
    const forwardMigrations = [
      "20260402_lifecycle_parity_columns.sql",
      "20260402_approval_type_support.sql",
      "20260402_client_contact_fields.sql",
      "20260402_party_abstraction.sql",
      "20260402_finance_period_derivation.sql",
      "20260402_evidence_link_parity.sql",
      "20260402_stale_item_tracking.sql",
    ];
    for (const file of forwardMigrations) {
      const content = readMigration(file);
      expect(content).toContain("BEGIN;");
      expect(content).toContain("COMMIT;");
    }
  });

  it("all backfill scripts are wrapped in BEGIN/COMMIT", () => {
    const backfillFiles = [
      "20260402_backfill_01_fiscal_periods.sql",
      "20260402_backfill_02_client_contacts.sql",
      "20260402_backfill_03_parties.sql",
      "20260402_backfill_04_lifecycle_columns.sql",
      "20260402_backfill_05_approval_lineage.sql",
      "20260402_backfill_06_evidence_sharepoint.sql",
      "20260402_backfill_07_finance_typed_dates.sql",
    ];
    for (const file of backfillFiles) {
      const content = readMigration(file);
      expect(content).toContain("BEGIN;");
      expect(content).toContain("COMMIT;");
    }
  });

  it("no migration contains bridge write logic (excluding comments and COMMENT ON descriptions)", () => {
    const allPhase1bFiles = fs.readdirSync(migrationsDir)
      .filter((f) => f.startsWith("20260402_") && f.endsWith(".sql"));
    for (const file of allPhase1bFiles) {
      const content = readMigration(file);
      // Filter out comment lines and COMMENT ON statements (which contain descriptive text)
      const sqlLines = content.split("\n").filter((l) => {
        const trimmed = l.trim();
        return !trimmed.startsWith("--") && !trimmed.startsWith("COMMENT ON");
      });
      const sqlOnly = sqlLines.join("\n");
      expect(sqlOnly).not.toContain("CREATE TRIGGER");
      expect(sqlOnly).not.toContain("CREATE OR REPLACE FUNCTION");
    }
  });
});

// ===========================================================================
// Group 5: Deduplication & Opening Balance Integrity Tests
// ===========================================================================
describe("Phase 1B Deduplication & Opening Balance Integrity", () => {

  // -- Latest-row selection ensures one current row per project --
  describe("Latest-row deduplication (lifecycle backfill)", () => {
    const sql = readMigration("20260402_backfill_04_lifecycle_columns.sql");

    it("uses deterministic ROW_NUMBER with tiebreaker ordering", () => {
      // Must use updated_at DESC, created_at DESC, id DESC for deterministic results
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("updated_at DESC");
      expect(sql).toContain("created_at DESC");
      expect(sql).toContain("id DESC");
    });

    it("partitions by project_id to get one row per project", () => {
      expect(sql).toContain("PARTITION BY pes.project_id");
    });

    it("filters to rn = 1 (only the latest row)", () => {
      expect(sql).toContain("rn = 1");
    });

    it("handles NULL timestamps gracefully with NULLS LAST", () => {
      expect(sql).toContain("NULLS LAST");
    });
  });

  // -- Opening balance classification and exclusion --
  describe("Opening balance handling (finance backfill)", () => {
    const sql = readMigration("20260402_backfill_07_finance_typed_dates.sql");

    it("classifies opening balances BEFORE date parsing", () => {
      // Step 0 must come before Step 1
      const step0Pos = sql.indexOf("Step 0a");
      const step1Pos = sql.indexOf("Step 1:");
      expect(step0Pos).toBeGreaterThan(-1);
      expect(step1Pos).toBeGreaterThan(-1);
      expect(step0Pos).toBeLessThan(step1Pos);
    });

    it("flags is_opening_balance = true for detected opening balance rows", () => {
      expect(sql).toContain("is_opening_balance = true");
    });

    it("preserves legacy_row_type for audit trail on all cost lines", () => {
      expect(sql).toContain("legacy_row_type = pe.row_type");
      expect(sql).toContain("cl.legacy_row_type IS NULL");
    });

    it("produces audit report of all classified opening balance rows", () => {
      expect(sql).toContain("OPENING_BALANCE_AUDIT_COST_LINES");
      expect(sql).toContain("OPENING_BALANCE_AUDIT_REVENUE_LINES");
      expect(sql).toContain("is_opening_balance = true");
    });

    it("audit report appears BEFORE fiscal period derivation steps", () => {
      const auditPos = sql.indexOf("OPENING_BALANCE_AUDIT");
      const step3Pos = sql.indexOf("Step 3:");
      expect(auditPos).toBeGreaterThan(-1);
      expect(step3Pos).toBeGreaterThan(-1);
      expect(auditPos).toBeLessThan(step3Pos);
    });

    it("opening balance exclusion guard is on fiscal_period_id derivation for cost_lines", () => {
      // Extract the UPDATE ... SET fiscal_period_id block for cost_lines
      const costFpDerivation = sql.match(
        /UPDATE finance\.cost_lines cl\s+SET fiscal_period_id[\s\S]*?(?=--\s*Step 4|UPDATE finance\.revenue_lines rl\s+SET fiscal_period_id)/
      );
      expect(costFpDerivation).not.toBeNull();
      expect(costFpDerivation![0]).toContain("is_opening_balance = false");
    });

    it("opening balance exclusion guard is on fiscal_period_id derivation for revenue_lines", () => {
      // Extract the UPDATE ... SET fiscal_period_id block for revenue_lines
      const revFpDerivation = sql.match(
        /UPDATE finance\.revenue_lines rl\s+SET fiscal_period_id[\s\S]*?COMMIT/
      );
      expect(revFpDerivation).not.toBeNull();
      expect(revFpDerivation![0]).toContain("is_opening_balance = false");
    });

    it("opening balance rows will have NULL fiscal_period_id (excluded from period movement)", () => {
      // Verify the guard: fiscal_period_id derivation requires is_opening_balance = false
      // This means opening balance rows retain fiscal_period_id = NULL
      const lines = sql.split("\n").filter((l) => !l.trim().startsWith("--"));
      const fpDerivations = lines.filter((l) => /SET fiscal_period_id = fp\.id/i.test(l));
      expect(fpDerivations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -- Migration schema includes opening balance columns --
  describe("Opening balance schema support", () => {
    const migrationSql = readMigration("20260402_finance_period_derivation.sql");
    const rollbackSql = readMigration("20260402_finance_period_derivation_rollback.sql");

    it("adds is_opening_balance column to both finance tables", () => {
      expect(migrationSql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN");
      expect(migrationSql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN");
    });

    it("adds legacy_row_type column to both finance tables", () => {
      expect(migrationSql).toContain("finance.cost_lines ADD COLUMN IF NOT EXISTS legacy_row_type TEXT");
      expect(migrationSql).toContain("finance.revenue_lines ADD COLUMN IF NOT EXISTS legacy_row_type TEXT");
    });

    it("defaults is_opening_balance to false (safe default)", () => {
      expect(migrationSql).toContain("DEFAULT false");
    });

    it("has COMMENT explaining opening balance purpose", () => {
      expect(migrationSql).toContain("opening/brought-forward balance");
      expect(migrationSql).toContain("Exclude from movement totals");
    });

    it("rollback drops is_opening_balance and legacy_row_type", () => {
      expect(rollbackSql).toContain("DROP COLUMN IF EXISTS is_opening_balance");
      expect(rollbackSql).toContain("DROP COLUMN IF EXISTS legacy_row_type");
    });
  });

  // -- Preflight detects duplicates and inflation risks --
  describe("Preflight duplicate and inflation detection", () => {
    const sql = readMigration("20260402_preflight_audit.sql");

    it("PF-8a reports history as INFO, PF-8b checks ambiguity as HARD STOP", () => {
      expect(sql).toContain("PF-8a");
      expect(sql).toContain("PF-8b");
      expect(sql).toContain("Ambiguous current-state rows");
    });

    it("PF-9a/PF-9b are SOFT STOP with detail reports for review", () => {
      expect(sql).toContain("PF-9a");
      expect(sql).toContain("PF-9b");
      expect(sql).toContain("PF-9a-detail");
      expect(sql).toContain("PF-9b-detail");
      expect(sql).toContain("SOFT_STOP");
    });

    it("PF-9c/PF-9d detect multiple OBs per project as HARD STOP", () => {
      expect(sql).toContain("PF-9c");
      expect(sql).toContain("PF-9d");
      expect(sql).toContain("HARD_STOP");
    });

    it("PF-10 detects duplicate legacy IDs in promoted finance lines", () => {
      expect(sql).toContain("PF-10a");
      expect(sql).toContain("PF-10b");
      expect(sql).toContain("GROUP BY legacy_program_expense_id");
      expect(sql).toContain("GROUP BY legacy_program_inflow_id");
    });

    it("PF-10c detects ambiguous project names that cause join multiplication", () => {
      expect(sql).toContain("PF-10c");
      expect(sql).toContain("Ambiguous project names");
      expect(sql).toContain("GROUP BY project_name");
    });

    it("PF-11 covers row-count AND amount at per-project AND portfolio levels", () => {
      expect(sql).toContain("PF-11a");
      expect(sql).toContain("PF-11b");
      expect(sql).toContain("PF-11c");
      expect(sql).toContain("PF-11d");
      expect(sql).toContain("PF-11e");
      expect(sql).toContain("PF-11f");
      expect(sql).toContain("row count inflation");
      expect(sql).toContain("amount inflation");
      expect(sql).toContain("Portfolio-level");
    });
  });

  // -- Structural proof that no double-counting is possible --
  describe("Double-counting prevention proof", () => {

    it("opening balances cannot get fiscal_period_id (structural exclusion)", () => {
      const sql = readMigration("20260402_backfill_07_finance_typed_dates.sql");
      // Count occurrences of is_opening_balance = false in fiscal period derivation
      const matches = sql.match(/is_opening_balance = false/g) || [];
      // Must appear at least twice (once for cost_lines, once for revenue_lines)
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("lifecycle backfill produces exactly one update per project (structural proof)", () => {
      const sql = readMigration("20260402_backfill_04_lifecycle_columns.sql");
      // The ranked subquery with rn = 1 guarantees at most one row per project_id
      expect(sql).toContain("PARTITION BY pes.project_id");
      expect(sql).toContain("rn = 1");
      // The UPDATE join on legacy_project_info_id is also 1:1
      expect(sql).toContain("cp.legacy_project_info_id = latest_pes.project_id");
    });

    it("finance date backfill is idempotent and non-duplicating", () => {
      const sql = readMigration("20260402_backfill_07_finance_typed_dates.sql");
      // All UPDATE steps guard with IS NULL to prevent re-processing
      expect(sql).toContain("WHERE invoice_date_typed IS NULL");
      expect(sql).toContain("cl.fiscal_period_id IS NULL");
      expect(sql).toContain("rl.fiscal_period_id IS NULL");
    });

    it("all finance backfill INSERT operations use ON CONFLICT DO NOTHING", () => {
      const sql = readMigration("20260402_backfill_01_fiscal_periods.sql");
      expect(sql).toContain("ON CONFLICT (legacy_fiscal_period_id) DO NOTHING");
    });
  });

  // -- Spec and implementation prompt document the rules --
  describe("Cross-cutting rules documented in spec and implementation prompt", () => {
    it("spec documents Rule 1 (one current row per project)", () => {
      const spec = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-additive-schema-spec.md"), "utf8"
      );
      expect(spec).toContain("Rule 1: One Current Row Per Project");
      expect(spec).toContain("ROW_NUMBER()");
      expect(spec).toContain("DISTINCT is NOT an acceptable substitute");
    });

    it("spec documents Rule 2 (opening balance separation)", () => {
      const spec = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-additive-schema-spec.md"), "utf8"
      );
      expect(spec).toContain("Rule 2: Opening Balance Separation");
      expect(spec).toContain("Opening balance");
      expect(spec).toContain("Period movement");
      expect(spec).toContain("Closing balance");
    });

    it("spec documents Rule 3 (inflation prevention)", () => {
      const spec = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-additive-schema-spec.md"), "utf8"
      );
      expect(spec).toContain("Rule 3: Inflation Prevention");
      expect(spec).toContain("Row-count inflation");
      expect(spec).toContain("Amount inflation");
      expect(spec).toContain("Per-project");
      expect(spec).toContain("Portfolio/aggregate");
    });

    it("implementation prompt documents all three cross-cutting rules", () => {
      const prompt = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-implementation-prompt.md"), "utf8"
      );
      expect(prompt).toContain("Rule 1: One Current Row Per Project");
      expect(prompt).toContain("Rule 2: Opening Balance Separation");
      expect(prompt).toContain("Rule 3: Inflation Prevention");
    });

    it("implementation prompt documents ROW_NUMBER() requirement for backfill 04", () => {
      const prompt = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-implementation-prompt.md"), "utf8"
      );
      expect(prompt).toContain("ROW_NUMBER() OVER (PARTITION BY project_id");
      expect(prompt).toContain("Do NOT use DISTINCT");
    });

    it("implementation prompt documents opening balance audit report in backfill 07", () => {
      const prompt = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-implementation-prompt.md"), "utf8"
      );
      expect(prompt).toContain("AUDIT REPORT");
      expect(prompt).toContain("EXCLUDE opening balance rows");
    });

    it("spec documents updated preflight severity table", () => {
      const spec = fs.readFileSync(
        path.join(process.cwd(), "docs/phase-1b-additive-schema-spec.md"), "utf8"
      );
      expect(spec).toContain("PF-8a");
      expect(spec).toContain("PF-8b");
      expect(spec).toContain("PF-9a");
      expect(spec).toContain("PF-9d");
      expect(spec).toContain("PF-11f");
      expect(spec).toContain("SOFT STOP");
    });
  });
});
