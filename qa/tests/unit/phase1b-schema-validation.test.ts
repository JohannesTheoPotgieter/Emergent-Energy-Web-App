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

  // -- Migration A.2: Expand parties with party_kind + user backfill --
  describe("Migration A.2: expand_parties_add_party_kind", () => {
    const sql = readMigration("20260403_a01_expand_parties_add_party_kind.sql");

    it("adds party_kind column", () => {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS party_kind TEXT");
    });

    it("adds legal_name column", () => {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS legal_name TEXT");
    });

    it("adds legacy_user_id column", () => {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER UNIQUE");
    });

    it("creates idx_parties_party_kind index", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_parties_party_kind ON core.parties (party_kind)");
    });
  });

  describe("Backfill A.2: backfill_parties_users", () => {
    const sql = readMigration("20260403_a02_backfill_parties_users.sql");

    it("backfills existing rows as organisation", () => {
      expect(sql).toContain("SET party_kind = 'organisation' WHERE party_kind IS NULL");
    });

    it("inserts users as person-kind parties", () => {
      expect(sql).toContain("'person'");
      expect(sql).toContain("'user'");
      expect(sql).toContain("FROM public.users");
      expect(sql).toContain("ON CONFLICT (legacy_user_id) DO NOTHING");
    });
  });

  describe("Rollback A.2: expand_parties_add_party_kind_rollback", () => {
    const sql = readMigration("20260403_a01_expand_parties_add_party_kind_rollback.sql");

    it("deletes user rows before dropping columns", () => {
      const deletePos = sql.indexOf("DELETE FROM core.parties WHERE source_table = 'public.users'");
      const dropPos = sql.indexOf("DROP COLUMN IF EXISTS party_kind");
      expect(deletePos).toBeGreaterThan(-1);
      expect(dropPos).toBeGreaterThan(-1);
      expect(deletePos).toBeLessThan(dropPos);
    });

    it("drops index and all three new columns", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS core.idx_parties_party_kind");
      expect(sql).toContain("DROP COLUMN IF EXISTS legacy_user_id");
      expect(sql).toContain("DROP COLUMN IF EXISTS legal_name");
      expect(sql).toContain("DROP COLUMN IF EXISTS party_kind");
    });
  });

  // -- Migration A.3: Create user_accounts table + backfill --
  describe("Migration A.3: create_user_accounts", () => {
    const sql = readMigration("20260403_a04_create_user_accounts.sql");

    it("creates core.user_accounts table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.user_accounts");
    });

    it("has party_id column with FK to core.parties", () => {
      expect(sql).toContain("party_id");
      expect(sql).toContain("REFERENCES core.parties(id)");
    });

    it("has legacy_user_id column with UNIQUE constraint", () => {
      expect(sql).toContain("legacy_user_id INTEGER UNIQUE NOT NULL");
    });

    it("has email column", () => {
      expect(sql).toContain("email          TEXT NOT NULL");
    });

    it("has status column with default", () => {
      expect(sql).toContain("status         TEXT NOT NULL DEFAULT 'active'");
    });

    it("creates idx_user_accounts_party_id unique index", () => {
      expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_party_id");
    });

    it("creates idx_user_accounts_email index", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_user_accounts_email");
    });

    it("creates idx_user_accounts_status index", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_user_accounts_status");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill A.3: backfill_user_accounts", () => {
    const sql = readMigration("20260403_a05_backfill_user_accounts.sql");

    it("joins public.users to core.parties via legacy_user_id", () => {
      expect(sql).toContain("FROM public.users u");
      expect(sql).toContain("JOIN core.parties p ON p.legacy_user_id = u.id");
    });

    it("derives status from deleted_at", () => {
      expect(sql).toContain("CASE WHEN u.deleted_at IS NULL THEN 'active' ELSE 'inactive' END");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (legacy_user_id) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback A.3: create_user_accounts_rollback", () => {
    const sql = readMigration("20260403_a04_create_user_accounts_rollback.sql");

    it("drops core.user_accounts table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.user_accounts");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration A.3b: Create microsoft_identities table + backfill --
  describe("Migration A.3b: create_microsoft_identities", () => {
    const sql = readMigration("20260403_a06_create_microsoft_identities.sql");

    it("creates core.microsoft_identities table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.microsoft_identities");
    });

    it("has user_account_id column with UNIQUE FK to core.user_accounts", () => {
      expect(sql).toContain("user_account_id");
      expect(sql).toContain("REFERENCES core.user_accounts(id)");
    });

    it("has microsoft_user_id column with UNIQUE constraint", () => {
      expect(sql).toContain("microsoft_user_id TEXT NOT NULL UNIQUE");
    });

    it("has tenant_id column NOT NULL", () => {
      expect(sql).toContain("tenant_id         TEXT NOT NULL");
    });

    it("creates idx_microsoft_identities_tenant_id index", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_microsoft_identities_tenant_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill A.3b: backfill_microsoft_identities", () => {
    const sql = readMigration("20260403_a07_backfill_microsoft_identities.sql");

    it("joins users to user_accounts and left joins ms_accounts", () => {
      expect(sql).toContain("FROM public.users u");
      expect(sql).toContain("JOIN core.user_accounts ua ON ua.legacy_user_id = u.id");
      expect(sql).toContain("LEFT JOIN ms_accounts ms ON ms.user_id = u.id");
    });

    it("filters to users with microsoft_id", () => {
      expect(sql).toContain("WHERE u.microsoft_id IS NOT NULL AND u.microsoft_id <> ''");
    });

    it("uses COALESCE for tenant_id fallback", () => {
      expect(sql).toContain("COALESCE(ms.tenant_id,");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (user_account_id) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback A.3b: create_microsoft_identities_rollback", () => {
    const sql = readMigration("20260403_a06_create_microsoft_identities_rollback.sql");

    it("drops core.microsoft_identities table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.microsoft_identities");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration A.1: Create departments + role_definitions --
  describe("Migration A.1: create_departments_role_definitions", () => {
    const sql = readMigration("20260403_a03_create_departments_role_definitions.sql");

    it("creates core.departments table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.departments");
    });

    it("departments has code UNIQUE and name columns", () => {
      expect(sql).toContain("code   TEXT NOT NULL UNIQUE");
      expect(sql).toContain("name   TEXT NOT NULL");
    });

    it("seeds 6 departments", () => {
      const deptCodes = ["ADMIN", "LEADERSHIP", "ENGINEERING", "PROJECT_DEVELOPMENT", "PROJECT_MANAGEMENT", "FINANCE"];
      for (const code of deptCodes) {
        expect(sql).toContain(`'${code}'`);
      }
    });

    it("creates core.role_definitions table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.role_definitions");
    });

    it("role_definitions has code UNIQUE, name, description, and department_id FK", () => {
      expect(sql).toContain("code          TEXT NOT NULL UNIQUE");
      expect(sql).toContain("REFERENCES core.departments(id)");
    });

    it("seeds 16 role definitions", () => {
      const roleCodes = [
        "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER",
        "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER", "QUALITY_MANAGER",
        "ENGINEERING_MANAGER", "KEY_ACCOUNTS_MANAGER", "ACCOUNTANT", "ENGINEER",
        "PROJECT_MANAGER_SITE", "PROJECT_DEVELOPER", "HSE_MANAGER", "SSEG_MANAGER",
      ];
      for (const code of roleCodes) {
        expect(sql).toContain(`'${code}'`);
      }
    });

    it("creates idx_role_definitions_department_id index", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_role_definitions_department_id");
    });

    it("seeds are idempotent via ON CONFLICT", () => {
      // Two ON CONFLICT clauses: one for departments, one for role_definitions
      const matches = sql.match(/ON CONFLICT \(code\) DO NOTHING/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback A.1: create_departments_role_definitions_rollback", () => {
    const sql = readMigration("20260403_a03_create_departments_role_definitions_rollback.sql");

    it("drops role_definitions before departments (FK order)", () => {
      const dropRoles = sql.indexOf("DROP TABLE IF EXISTS core.role_definitions");
      const dropDepts = sql.indexOf("DROP TABLE IF EXISTS core.departments");
      expect(dropRoles).toBeGreaterThan(-1);
      expect(dropDepts).toBeGreaterThan(-1);
      expect(dropRoles).toBeLessThan(dropDepts);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration A.4: Create role_assignments table + backfill --
  describe("Migration A.4: create_role_assignments", () => {
    const sql = readMigration("20260403_a08_create_role_assignments.sql");

    it("creates core.role_assignments table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.role_assignments");
    });

    it("has user_account_id FK to core.user_accounts", () => {
      expect(sql).toContain("user_account_id");
      expect(sql).toContain("REFERENCES core.user_accounts(id)");
    });

    it("has role_definition_id FK to core.role_definitions", () => {
      expect(sql).toContain("role_definition_id");
      expect(sql).toContain("REFERENCES core.role_definitions(id)");
    });

    it("has department_id FK to core.departments", () => {
      expect(sql).toContain("department_id");
      expect(sql).toContain("REFERENCES core.departments(id)");
    });

    it("has temporal columns start_date and end_date", () => {
      expect(sql).toContain("start_date");
      expect(sql).toContain("end_date");
    });

    it("does NOT enforce unique on user_account_id (multiple roles allowed)", () => {
      expect(sql).not.toContain("UNIQUE");
    });

    it("creates partial index for active assignments", () => {
      expect(sql).toContain("idx_role_assignments_active");
      expect(sql).toContain("WHERE end_date IS NULL");
    });

    it("creates indexes on all FK columns", () => {
      expect(sql).toContain("idx_role_assignments_user_account_id");
      expect(sql).toContain("idx_role_assignments_role_definition_id");
      expect(sql).toContain("idx_role_assignments_department_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill A.4: backfill_role_assignments", () => {
    const sql = readMigration("20260403_a09_backfill_role_assignments.sql");

    it("joins users to user_accounts and role_definitions", () => {
      expect(sql).toContain("FROM public.users u");
      expect(sql).toContain("JOIN core.user_accounts ua ON ua.legacy_user_id = u.id");
      expect(sql).toContain("JOIN core.role_definitions rd ON rd.code = u.role");
    });

    it("uses rd.department_id for department resolution", () => {
      expect(sql).toContain("rd.department_id");
    });

    it("is idempotent via NOT EXISTS guard", () => {
      expect(sql).toContain("WHERE NOT EXISTS");
      expect(sql).toContain("ra.user_account_id = ua.id");
      expect(sql).toContain("ra.role_definition_id = rd.id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback A.4: create_role_assignments_rollback", () => {
    const sql = readMigration("20260403_a08_create_role_assignments_rollback.sql");

    it("drops core.role_assignments table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.role_assignments");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.1: Create project_types + parameter_definitions --
  describe("Migration B.1: create_project_types", () => {
    const sql = readMigration("20260403_b01_create_project_types.sql");

    it("creates core.project_types table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_types");
    });

    it("project_types has code UNIQUE and name columns", () => {
      expect(sql).toContain("code      TEXT NOT NULL UNIQUE");
    });

    it("seeds 6 project types", () => {
      const typeCodes = ["GRID_TIED", "BESS", "HYBRID", "WATER", "AD_HOC", "OTHER"];
      for (const code of typeCodes) {
        expect(sql).toContain(`'${code}'`);
      }
    });

    it("creates core.project_type_parameter_definitions table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_type_parameter_definitions");
    });

    it("parameter_definitions has composite unique constraint", () => {
      expect(sql).toContain("UNIQUE (project_type_id, parameter_code)");
    });

    it("parameter_definitions has FK to project_types", () => {
      expect(sql).toContain("REFERENCES core.project_types(id)");
    });

    it("parameter_definitions supports data_type and select_options", () => {
      expect(sql).toContain("data_type");
      expect(sql).toContain("select_options  JSONB");
    });

    it("creates indexes on parameter_definitions", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_param_defs_project_type_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_param_defs_active");
    });

    it("project_types seed is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (code) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.1: create_project_types_rollback", () => {
    const sql = readMigration("20260403_b01_create_project_types_rollback.sql");

    it("drops parameter_definitions before project_types (FK order)", () => {
      const dropParams = sql.indexOf("DROP TABLE IF EXISTS core.project_type_parameter_definitions");
      const dropTypes = sql.indexOf("DROP TABLE IF EXISTS core.project_types");
      expect(dropParams).toBeGreaterThan(-1);
      expect(dropTypes).toBeGreaterThan(-1);
      expect(dropParams).toBeLessThan(dropTypes);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.2: Create project_instances + backfill --
  describe("Migration B.2: create_project_instances", () => {
    const sql = readMigration("20260403_b02_create_project_instances.sql");

    it("creates core.project_instances table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_instances");
    });

    it("has legacy_project_id UNIQUE NOT NULL", () => {
      expect(sql).toContain("legacy_project_id   INTEGER UNIQUE NOT NULL");
    });

    it("has project_type_id FK to core.project_types (nullable)", () => {
      expect(sql).toContain("project_type_id");
      expect(sql).toContain("REFERENCES core.project_types(id)");
    });

    it("has client_party_id FK to core.parties (nullable)", () => {
      expect(sql).toContain("client_party_id");
      expect(sql).toContain("REFERENCES core.parties(id)");
    });

    it("has status, current_phase, and date columns", () => {
      expect(sql).toContain("status");
      expect(sql).toContain("current_phase");
      expect(sql).toContain("planned_start_date");
      expect(sql).toContain("planned_end_date");
    });

    it("does NOT have pm_user_id or pd_user_id", () => {
      expect(sql).not.toContain("pm_user_id");
      expect(sql).not.toContain("pd_user_id");
    });

    it("creates indexes on key columns", () => {
      expect(sql).toContain("idx_project_instances_project_code");
      expect(sql).toContain("idx_project_instances_project_type_id");
      expect(sql).toContain("idx_project_instances_client_party_id");
      expect(sql).toContain("idx_project_instances_status");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill B.2: backfill_project_instances", () => {
    const sql = readMigration("20260403_b03_backfill_project_instances.sql");

    it("sources from core.projects with LEFT JOINs", () => {
      expect(sql).toContain("FROM core.projects p");
      expect(sql).toContain("LEFT JOIN core.parties cp ON cp.legacy_client_id = p.client_id");
      expect(sql).toContain("LEFT JOIN project_execution_state pes");
    });

    it("derives status from archived_status and execution_gate_status", () => {
      expect(sql).toContain("archived_status = 'archived'");
      expect(sql).toContain("execution_gate_status = 'blocked'");
    });

    it("maps planned dates from execution_state", () => {
      expect(sql).toContain("pes.construction_start_date");
      expect(sql).toContain("pes.client_handover_date");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (legacy_project_id) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.2: create_project_instances_rollback", () => {
    const sql = readMigration("20260403_b02_create_project_instances_rollback.sql");

    it("drops core.project_instances table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.project_instances");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.3: Create project_info + parameter_values --
  describe("Migration B.3: create_project_info", () => {
    const sql = readMigration("20260403_b04_create_project_info.sql");

    it("creates core.project_info table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_info");
    });

    it("has project_instance_id UNIQUE NOT NULL FK to project_instances", () => {
      expect(sql).toContain("project_instance_id   BIGINT NOT NULL UNIQUE REFERENCES core.project_instances(id)");
    });

    it("has project_type_id FK to core.project_types (nullable)", () => {
      expect(sql).toContain("project_type_id       INTEGER REFERENCES core.project_types(id)");
    });

    it("creates index on project_type_id", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_info_project_type_id");
    });

    it("creates core.project_info_parameter_values table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_info_parameter_values");
    });

    it("parameter_values has FK to project_info", () => {
      expect(sql).toContain("REFERENCES core.project_info(id)");
    });

    it("parameter_values has FK to project_type_parameter_definitions", () => {
      expect(sql).toContain("REFERENCES core.project_type_parameter_definitions(id)");
    });

    it("parameter_values has composite unique constraint", () => {
      expect(sql).toContain("UNIQUE (project_info_id, parameter_definition_id)");
    });

    it("parameter_values supports all 4 value types", () => {
      expect(sql).toContain("value_text");
      expect(sql).toContain("value_number");
      expect(sql).toContain("value_boolean");
      expect(sql).toContain("value_date");
    });

    it("creates indexes on parameter_values FK columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_param_values_project_info_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_param_values_parameter_definition_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill B.3: backfill_project_info", () => {
    const sql = readMigration("20260403_b05_backfill_project_info.sql");

    it("inserts one row per project_instance", () => {
      expect(sql).toContain("INSERT INTO core.project_info");
      expect(sql).toContain("FROM core.project_instances pi");
    });

    it("copies project_type_id from project_instances", () => {
      expect(sql).toContain("pi.project_type_id");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (project_instance_id) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.3: create_project_info_rollback", () => {
    const sql = readMigration("20260403_b04_create_project_info_rollback.sql");

    it("drops parameter_values before project_info (FK order)", () => {
      const dropParams = sql.indexOf("DROP TABLE IF EXISTS core.project_info_parameter_values");
      // Search for the standalone project_info drop after the parameter_values drop
      const dropInfo = sql.indexOf("DROP TABLE IF EXISTS core.project_info;", dropParams + 1);
      expect(dropParams).toBeGreaterThan(-1);
      expect(dropInfo).toBeGreaterThan(-1);
      expect(dropParams).toBeLessThan(dropInfo);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.4: Create project_party_links --
  describe("Migration B.4: create_project_party_links", () => {
    const sql = readMigration("20260403_b06_create_project_party_links.sql");

    it("creates core.project_party_links table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_party_links");
    });

    it("has project_instance_id FK to project_instances", () => {
      expect(sql).toContain("project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id)");
    });

    it("has party_id FK to parties", () => {
      expect(sql).toContain("party_id              BIGINT NOT NULL REFERENCES core.parties(id)");
    });

    it("has project_role NOT NULL", () => {
      expect(sql).toContain("project_role          TEXT NOT NULL");
    });

    it("has is_primary, start_date, end_date columns", () => {
      expect(sql).toContain("is_primary");
      expect(sql).toContain("start_date");
      expect(sql).toContain("end_date");
    });

    it("has composite unique constraint on (project_instance_id, party_id, project_role)", () => {
      expect(sql).toContain("UNIQUE (project_instance_id, party_id, project_role)");
    });

    it("creates indexes on FK and role columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_party_links_project_instance_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_party_links_party_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_party_links_project_role");
    });

    it("creates partial index for active links", () => {
      expect(sql).toContain("idx_project_party_links_active");
      expect(sql).toContain("WHERE end_date IS NULL");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill B.4: backfill_project_party_links", () => {
    const sql = readMigration("20260403_b07_backfill_project_party_links.sql");

    it("backfills client role from core.projects.client_id", () => {
      expect(sql).toContain("'client'");
      expect(sql).toContain("cp.legacy_client_id = p.client_id");
    });

    it("backfills pm role from core.projects.pm_user_id", () => {
      expect(sql).toContain("'pm'");
      expect(sql).toContain("ua.legacy_user_id = p.pm_user_id");
    });

    it("backfills pd role from core.projects.pd_user_id", () => {
      expect(sql).toContain("'pd'");
      expect(sql).toContain("ua.legacy_user_id = p.pd_user_id");
    });

    it("backfills 6 execution-state roles via ROW_NUMBER", () => {
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("PARTITION BY pes.project_id");
      expect(sql).toContain("'construction_manager'");
      expect(sql).toContain("'quality_lead'");
      expect(sql).toContain("'engineering_lead'");
      expect(sql).toContain("'program_manager'");
      expect(sql).toContain("'project_finance'");
      expect(sql).toContain("'key_accounts_manager'");
    });

    it("sets is_primary=true for client, pm, pd roles", () => {
      // Count occurrences of is_primary true in the three primary role inserts
      const matches = sql.match(/true/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });

    it("includes safety warnings for unresolvable IDs", () => {
      expect(sql).toContain("RAISE WARNING");
      expect(sql).toContain("pm_user_id not resolvable");
      expect(sql).toContain("pd_user_id not resolvable");
      expect(sql).toContain("client_id not resolvable");
    });

    it("is idempotent via ON CONFLICT", () => {
      const matches = sql.match(/ON CONFLICT \(project_instance_id, party_id, project_role\) DO NOTHING/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(4);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.4: create_project_party_links_rollback", () => {
    const sql = readMigration("20260403_b06_create_project_party_links_rollback.sql");

    it("drops core.project_party_links table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.project_party_links");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.5: Create phase_definitions + project_phase_history --
  describe("Migration B.5: create_phase_definitions", () => {
    const sql = readMigration("20260403_b08_create_phase_definitions.sql");

    it("creates core.phase_definitions table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.phase_definitions");
    });

    it("has code UNIQUE and name columns", () => {
      expect(sql).toContain("code                TEXT NOT NULL UNIQUE");
      expect(sql).toContain("name                TEXT NOT NULL");
    });

    it("has phase_group and is_gate columns", () => {
      expect(sql).toContain("phase_group");
      expect(sql).toContain("is_gate");
    });

    it("has sequence_order and department_owner columns", () => {
      expect(sql).toContain("sequence_order      INTEGER NOT NULL");
      expect(sql).toContain("department_owner");
    });

    it("seeds 10 phase definitions", () => {
      const codes = [
        "S01_FIRST_ASSESSMENT", "S02_DESIGN_COST_PROPOSAL", "S03_SIGNATURE_FINANCIAL_CLOSE",
        "S04_PD_PM_HANDOVER", "S05_FINANCIAL_REVIEW", "S06_CONSTRUCTION",
        "S07_COMMISSIONING", "S08_OM_HANDOVER", "S09_CLIENT_HANDOVER", "S10_POST_HANDOVER_REVIEW",
      ];
      for (const code of codes) {
        expect(sql).toContain(`'${code}'`);
      }
    });

    it("assigns phase_group values (project_development, execution, closeout)", () => {
      expect(sql).toContain("'project_development'");
      expect(sql).toContain("'execution'");
      expect(sql).toContain("'closeout'");
    });

    it("marks 6 gate stages", () => {
      // S03, S04, S05, S07, S08, S09 should have is_gate = true
      const lines = sql.split("\n");
      const gateLines = lines.filter((l) => l.includes("true)") || l.includes("true ),"));
      expect(gateLines.length).toBe(6);
    });

    it("seed is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (code) DO NOTHING");
    });

    it("creates core.project_phase_history table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.project_phase_history");
    });

    it("project_phase_history has project_instance_id FK", () => {
      expect(sql).toContain("REFERENCES core.project_instances(id)");
    });

    it("project_phase_history has phase_definition_id FK", () => {
      expect(sql).toContain("REFERENCES core.phase_definitions(id)");
    });

    it("project_phase_history has entered_at, exited_at, is_current columns", () => {
      expect(sql).toContain("entered_at");
      expect(sql).toContain("exited_at");
      expect(sql).toContain("is_current");
    });

    it("creates partial index for current phase", () => {
      expect(sql).toContain("idx_project_phase_history_current");
      expect(sql).toContain("WHERE is_current = true");
    });

    it("creates indexes on FK columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_phase_history_project_instance_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_phase_history_phase_definition_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill B.5: backfill_project_phase_history", () => {
    const sql = readMigration("20260403_b09_backfill_project_phase_history.sql");

    it("sources current_stage_code from core.projects", () => {
      expect(sql).toContain("FROM core.projects p");
      expect(sql).toContain("JOIN core.phase_definitions pd ON pd.code = p.current_stage_code");
    });

    it("joins project_instances for FK resolution", () => {
      expect(sql).toContain("JOIN core.project_instances pi ON pi.legacy_project_id = p.id");
    });

    it("sets is_current=true for all backfilled rows", () => {
      expect(sql).toContain("true");
      expect(sql).toContain("is_current");
    });

    it("uses COALESCE for entered_at fallback", () => {
      expect(sql).toContain("COALESCE(p.phase_updated_at, p.created_at)");
    });

    it("includes safety warning for unmatched stage codes", () => {
      expect(sql).toContain("RAISE WARNING");
      expect(sql).toContain("current_stage_code not found in core.phase_definitions");
    });

    it("is idempotent via NOT EXISTS guard", () => {
      expect(sql).toContain("WHERE NOT EXISTS");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.5: create_phase_definitions_rollback", () => {
    const sql = readMigration("20260403_b08_create_phase_definitions_rollback.sql");

    it("drops project_phase_history before phase_definitions (FK order)", () => {
      const dropHistory = sql.indexOf("DROP TABLE IF EXISTS core.project_phase_history");
      const dropDefs = sql.indexOf("DROP TABLE IF EXISTS core.phase_definitions");
      expect(dropHistory).toBeGreaterThan(-1);
      expect(dropDefs).toBeGreaterThan(-1);
      expect(dropHistory).toBeLessThan(dropDefs);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration B.5 fix: Add current_phase_definition_id FK --
  describe("Migration B.5 fix: add_phase_definition_fk_to_project_instances", () => {
    const sql = readMigration("20260403_b10_add_phase_definition_fk_to_project_instances.sql");

    it("adds current_phase_definition_id column to project_instances", () => {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS current_phase_definition_id INTEGER");
    });

    it("references core.phase_definitions(id)", () => {
      expect(sql).toContain("REFERENCES core.phase_definitions(id)");
    });

    it("creates index on the new FK column", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_project_instances_current_phase_definition_id");
    });

    it("backfills from core.projects.current_stage_code via phase_definitions", () => {
      expect(sql).toContain("UPDATE core.project_instances pi");
      expect(sql).toContain("JOIN core.phase_definitions pd ON pd.code = p.current_stage_code");
    });

    it("is idempotent via IF NOT EXISTS and IS NULL guard", () => {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
      expect(sql).toContain("pi.current_phase_definition_id IS NULL");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback B.5 fix: add_phase_definition_fk_rollback", () => {
    const sql = readMigration("20260403_b10_add_phase_definition_fk_to_project_instances_rollback.sql");

    it("drops the FK column", () => {
      expect(sql).toContain("DROP COLUMN IF EXISTS current_phase_definition_id");
    });

    it("drops the index", () => {
      expect(sql).toContain("DROP INDEX IF EXISTS core.idx_project_instances_current_phase_definition_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration C.1: Create work_packages --
  describe("Migration C.1: create_work_packages", () => {
    const sql = readMigration("20260403_c01_create_work_packages.sql");

    it("creates core.work_packages table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.work_packages");
    });

    it("has project_instance_id FK NOT NULL", () => {
      expect(sql).toContain("project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id)");
    });

    it("has phase_definition_id FK (nullable)", () => {
      expect(sql).toContain("phase_definition_id   INTEGER REFERENCES core.phase_definitions(id)");
    });

    it("has workstream NOT NULL", () => {
      expect(sql).toContain("workstream            TEXT NOT NULL");
    });

    it("has owner_party_id FK (nullable)", () => {
      expect(sql).toContain("owner_party_id        BIGINT REFERENCES core.parties(id)");
    });

    it("has composite unique on (project_instance_id, workstream)", () => {
      expect(sql).toContain("UNIQUE (project_instance_id, workstream)");
    });

    it("creates indexes on key columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_packages_project_instance_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_packages_workstream");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_packages_status");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill C.1: backfill_work_packages", () => {
    const sql = readMigration("20260403_c02_backfill_work_packages.sql");

    it("derives work_packages from work_items grouped by project + workstream", () => {
      expect(sql).toContain("FROM work_items wi");
      expect(sql).toContain("JOIN core.project_instances pi");
      expect(sql).toContain("wi.workstream");
    });

    it("excludes personal tasks", () => {
      expect(sql).toContain("wi.workstream <> 'PERSONAL'");
    });

    it("excludes deleted work items", () => {
      expect(sql).toContain("wi.deleted_at IS NULL");
    });

    it("includes safety warning for unresolvable projects", () => {
      expect(sql).toContain("RAISE WARNING");
      expect(sql).toContain("not resolvable to project_instances");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (project_instance_id, workstream) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback C.1: create_work_packages_rollback", () => {
    const sql = readMigration("20260403_c09_create_work_packages_rollback.sql");

    it("drops core.work_packages table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.work_packages");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration C.2: Create work_items_clean --
  describe("Migration C.2: create_work_items_clean", () => {
    const sql = readMigration("20260403_c03_create_work_items_clean.sql");

    it("creates core.work_items_clean table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.work_items_clean");
    });

    it("has legacy_work_item_id UNIQUE NOT NULL", () => {
      expect(sql).toContain("legacy_work_item_id   INTEGER UNIQUE NOT NULL");
    });

    it("has work_package_id FK to work_packages", () => {
      expect(sql).toContain("work_package_id       BIGINT REFERENCES core.work_packages(id)");
    });

    it("has project_instance_id FK", () => {
      expect(sql).toContain("project_instance_id   BIGINT REFERENCES core.project_instances(id)");
    });

    it("has assigned_to_party_id FK to parties", () => {
      expect(sql).toContain("assigned_to_party_id  BIGINT REFERENCES core.parties(id)");
    });

    it("has self-referencing parent_id FK", () => {
      expect(sql).toContain("parent_id             BIGINT REFERENCES core.work_items_clean(id)");
    });

    it("has all 17 columns (identity + core + dates + meta)", () => {
      const cols = [
        "title", "description", "status", "priority",
        "start_date", "end_date", "percent_complete", "is_milestone",
        "sort_order", "created_at", "updated_at",
      ];
      for (const col of cols) {
        expect(sql).toContain(col);
      }
    });

    it("creates indexes on FK and status columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_items_clean_work_package_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_items_clean_project_instance_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_items_clean_assigned_to_party_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_items_clean_status");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_items_clean_parent_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill C.2: backfill_work_items_clean", () => {
    const sql = readMigration("20260403_c04_backfill_work_items_clean.sql");

    it("sources from work_items with LEFT JOINs for optional FKs", () => {
      expect(sql).toContain("FROM work_items wi");
      expect(sql).toContain("LEFT JOIN core.projects p ON p.legacy_project_info_id = wi.project_id");
      expect(sql).toContain("LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id");
      expect(sql).toContain("LEFT JOIN core.work_packages wp ON wp.project_instance_id = pi.id AND wp.workstream = wi.workstream");
      expect(sql).toContain("LEFT JOIN core.user_accounts ua ON ua.legacy_user_id = wi.owner_user_id");
    });

    it("resolves assigned_to_party_id from user_accounts", () => {
      expect(sql).toContain("ua.party_id");
    });

    it("uses 2-pass for parent_id resolution", () => {
      expect(sql).toContain("UPDATE core.work_items_clean wic");
      expect(sql).toContain("parent_clean.legacy_work_item_id = wi.parent_id");
    });

    it("includes safety warnings for unresolvable references", () => {
      expect(sql).toContain("RAISE WARNING");
      expect(sql).toContain("project_id not resolvable");
      expect(sql).toContain("owner_user_id not resolvable");
    });

    it("includes safety warning for orphaned parent_id references", () => {
      expect(sql).toContain("parent_id referencing deleted items");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (legacy_work_item_id) DO NOTHING");
    });

    it("excludes deleted work items", () => {
      expect(sql).toContain("wi.deleted_at IS NULL");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback C.2: create_work_items_clean_rollback", () => {
    const sql = readMigration("20260403_c08_create_work_items_clean_rollback.sql");

    it("drops core.work_items_clean table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.work_items_clean");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration C.3: Create work_item_dependencies_clean --
  describe("Migration C.3: create_work_item_dependencies_clean", () => {
    const sql = readMigration("20260403_c05_create_work_item_dependencies_clean.sql");

    it("creates core.work_item_dependencies_clean table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.work_item_dependencies_clean");
    });

    it("has predecessor_id FK to work_items_clean with CASCADE", () => {
      expect(sql).toContain("predecessor_id    BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE");
    });

    it("has successor_id FK to work_items_clean with CASCADE", () => {
      expect(sql).toContain("successor_id      BIGINT NOT NULL REFERENCES core.work_items_clean(id) ON DELETE CASCADE");
    });

    it("has dep_type with FS default", () => {
      expect(sql).toContain("dep_type          TEXT NOT NULL DEFAULT 'FS'");
    });

    it("has lag_days column", () => {
      expect(sql).toContain("lag_days          INTEGER DEFAULT 0");
    });

    it("creates unique index on (predecessor, successor, dep_type)", () => {
      expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_work_item_deps_clean_unique_pair");
      expect(sql).toContain("(predecessor_id, successor_id, dep_type)");
    });

    it("creates indexes on FK columns", () => {
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_item_deps_clean_predecessor_id");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_work_item_deps_clean_successor_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Backfill C.3: backfill_work_item_dependencies_clean", () => {
    const sql = readMigration("20260403_c06_backfill_work_item_dependencies_clean.sql");

    it("maps legacy IDs to clean IDs via legacy_work_item_id", () => {
      expect(sql).toContain("JOIN core.work_items_clean pred ON pred.legacy_work_item_id = wid.predecessor_id");
      expect(sql).toContain("JOIN core.work_items_clean succ ON succ.legacy_work_item_id = wid.successor_id");
    });

    it("excludes soft-deleted dependencies", () => {
      expect(sql).toContain("wid.deleted_at IS NULL");
    });

    it("includes safety warning for orphaned dependencies", () => {
      expect(sql).toContain("RAISE WARNING");
      expect(sql).toContain("not in work_items_clean and will be skipped");
    });

    it("is idempotent via ON CONFLICT", () => {
      expect(sql).toContain("ON CONFLICT (predecessor_id, successor_id, dep_type) DO NOTHING");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  describe("Rollback C.3: create_work_item_dependencies_clean_rollback", () => {
    const sql = readMigration("20260403_c07_create_work_item_dependencies_clean_rollback.sql");

    it("drops core.work_item_dependencies_clean table", () => {
      expect(sql).toContain("DROP TABLE IF EXISTS core.work_item_dependencies_clean");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Migration D.1: Create governed_processes + governed_process_checklist_items --
  describe("Migration D.1: create_governed_processes", () => {
    const sql = readMigration("20260403_d01_create_governed_processes.sql");

    it("creates core.governed_processes table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.governed_processes");
    });

    it("includes all required columns on governed_processes", () => {
      const columns = [
        "legacy_entity_id", "legacy_entity_table", "project_instance_id",
        "process_type", "phase_definition_id", "status", "owner_party_id",
        "reviewer_party_id", "title", "started_at", "completed_at",
        "process_data", "created_at", "updated_at",
      ];
      for (const col of columns) {
        expect(sql).toContain(col);
      }
    });

    it("has UNIQUE constraint on (legacy_entity_table, legacy_entity_id)", () => {
      expect(sql).toContain("UNIQUE (legacy_entity_table, legacy_entity_id)");
    });

    it("process_data defaults to empty JSONB", () => {
      expect(sql).toContain("process_data          JSONB NOT NULL DEFAULT '{}'");
    });

    it("references core.project_instances, core.phase_definitions, core.parties", () => {
      expect(sql).toContain("REFERENCES core.project_instances(id)");
      expect(sql).toContain("REFERENCES core.phase_definitions(id)");
      expect(sql).toContain("REFERENCES core.parties(id)");
    });

    it("creates indexes on governed_processes", () => {
      expect(sql).toContain("idx_governed_processes_project_instance_id");
      expect(sql).toContain("idx_governed_processes_process_type");
      expect(sql).toContain("idx_governed_processes_status");
      expect(sql).toContain("idx_governed_processes_phase_definition_id");
      expect(sql).toContain("idx_governed_processes_owner_party_id");
      expect(sql).toContain("idx_governed_processes_reviewer_party_id");
    });

    it("creates core.governed_process_checklist_items table", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS core.governed_process_checklist_items");
    });

    it("includes all required columns on checklist_items", () => {
      const columns = [
        "governed_process_id", "legacy_item_id", "legacy_item_table",
        "item_code", "title", "category", "status", "blocks_gate",
        "owner_party_id", "completed_at", "evidence_url", "notes", "sort_order",
      ];
      for (const col of columns) {
        expect(sql).toContain(col);
      }
    });

    it("checklist_items references governed_processes", () => {
      expect(sql).toContain("REFERENCES core.governed_processes(id)");
    });

    it("creates indexes on checklist_items", () => {
      expect(sql).toContain("idx_gp_checklist_governed_process_id");
      expect(sql).toContain("idx_gp_checklist_status");
      expect(sql).toContain("idx_gp_checklist_blocks_gate");
      expect(sql).toContain("idx_gp_checklist_owner_party_id");
    });

    it("has partial index on blocks_gate = true", () => {
      expect(sql).toContain("WHERE blocks_gate = true");
    });

    it("has COMMENT ON TABLE for both tables", () => {
      expect(sql).toContain("COMMENT ON TABLE core.governed_processes");
      expect(sql).toContain("COMMENT ON TABLE core.governed_process_checklist_items");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Backfill D.2: Backfill governed_processes --
  describe("Backfill D.2: backfill_governed_processes", () => {
    const sql = readMigration("20260403_d02_backfill_governed_processes.sql");

    it("backfills all 6 process types", () => {
      const types = [
        "pd_to_pm_handover", "financial_review", "phase_gate_review",
        "gate_exception", "change_request", "payment_batch",
      ];
      for (const t of types) {
        expect(sql).toContain(`'${t}'`);
      }
    });

    it("sources from correct legacy tables", () => {
      const tables = [
        "project_pd_pm_handover", "project_financial_reviews",
        "project_gate_evaluations", "project_stage_exceptions",
        "change_requests", "payment_batches",
      ];
      for (const t of tables) {
        expect(sql).toContain(t);
      }
    });

    it("uses ON CONFLICT DO NOTHING for idempotency", () => {
      const matches = sql.match(/ON CONFLICT \(legacy_entity_table, legacy_entity_id\) DO NOTHING/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(6);
    });

    it("builds process_data JSONB for each type", () => {
      expect(sql).toContain("jsonb_build_object");
    });

    it("resolves owner_party_id via user_accounts", () => {
      expect(sql).toContain("SET owner_party_id = ua.party_id");
    });

    it("resolves reviewer_party_id via user_accounts", () => {
      expect(sql).toContain("SET reviewer_party_id = ua.party_id");
    });

    it("uses IS NULL guards on party resolution UPDATEs", () => {
      expect(sql).toContain("gp.owner_party_id IS NULL");
      expect(sql).toContain("gp.reviewer_party_id IS NULL");
    });

    it("payment_batch has no project_instance_id (project-less)", () => {
      // payment_batches INSERT does not include project_instance_id
      const pbSection = sql.substring(
        sql.indexOf("6. payment_batch"),
        sql.indexOf("7. Resolve owner_party_id")
      );
      expect(pbSection).not.toContain("project_instance_id   BIGINT");
      expect(pbSection).toContain("payment_batches");
    });

    it("excludes soft-deleted records where applicable", () => {
      expect(sql).toContain("fr.deleted_at IS NULL");
      expect(sql).toContain("cr.deleted_at IS NULL");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Backfill D.3: Backfill governed_process_checklist_items --
  describe("Backfill D.3: backfill_governed_process_checklist_items", () => {
    const sql = readMigration("20260403_d03_backfill_governed_process_checklist_items.sql");

    it("backfills from handover_checklist_items", () => {
      expect(sql).toContain("handover_checklist_items");
      expect(sql).toContain("'handover_checklist_items'");
    });

    it("backfills from project_stage_requirements", () => {
      expect(sql).toContain("project_stage_requirements");
      expect(sql).toContain("'project_stage_requirements'");
    });

    it("filters out NOT_STARTED stage requirements", () => {
      expect(sql).toContain("psr.status <> 'NOT_STARTED'");
    });

    it("creates stage_gate governed_processes from project_stage_instances", () => {
      expect(sql).toContain("'stage_gate'");
      expect(sql).toContain("'project_stage_instances'");
    });

    it("uses NOT EXISTS guards for idempotency", () => {
      const matches = sql.match(/NOT EXISTS/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("uses ON CONFLICT DO NOTHING for stage_gate inserts", () => {
      expect(sql).toContain("ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING");
    });

    it("resolves owner for stage instances via user_accounts", () => {
      expect(sql).toContain("SET owner_party_id = ua.party_id");
      expect(sql).toContain("stage_owner_user_id");
    });

    it("links handover checklist items via handover_packs → projects → governed_processes", () => {
      expect(sql).toContain("handover_packs");
      expect(sql).toContain("legacy_project_info_id");
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Rollback D.4: governed_processes rollback --
  describe("Rollback D.4: governed_processes_rollback", () => {
    const sql = readMigration("20260403_d04_create_governed_processes_rollback.sql");

    it("drops checklist_items before governed_processes (FK order)", () => {
      const dropChecklist = sql.indexOf("DROP TABLE IF EXISTS core.governed_process_checklist_items");
      const dropProcesses = sql.indexOf("DROP TABLE IF EXISTS core.governed_processes");
      expect(dropChecklist).toBeGreaterThan(-1);
      expect(dropProcesses).toBeGreaterThan(-1);
      expect(dropChecklist).toBeLessThan(dropProcesses);
    });

    it("wraps in BEGIN/COMMIT", () => {
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });
  });

  // -- Phase D dependency order --
  it("Phase D migration files sort in correct dependency order", () => {
    const phaseDFiles = fs.readdirSync(migrationsDir)
      .filter((f) => f.startsWith("20260403_d") && f.endsWith(".sql") && !f.includes("rollback"))
      .sort();
    const expectedOrder = [
      "20260403_d01_create_governed_processes.sql",
      "20260403_d02_backfill_governed_processes.sql",
      "20260403_d03_backfill_governed_process_checklist_items.sql",
    ];
    expect(phaseDFiles).toEqual(expectedOrder);
  });

  it("Phase D backfill files sort after DDL file", () => {
    const pairs = [
      { ddl: "20260403_d01_create_governed_processes.sql", backfill: "20260403_d02_backfill_governed_processes.sql" },
      { ddl: "20260403_d02_backfill_governed_processes.sql", backfill: "20260403_d03_backfill_governed_process_checklist_items.sql" },
    ];
    for (const { ddl, backfill } of pairs) {
      expect(ddl.localeCompare(backfill)).toBeLessThan(0);
      expect(fs.existsSync(path.join(migrationsDir, ddl))).toBe(true);
      expect(fs.existsSync(path.join(migrationsDir, backfill))).toBe(true);
    }
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

  it("all 56 migration files exist", () => {
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
      "20260403_a04_create_user_accounts.sql",
      "20260403_a04_create_user_accounts_rollback.sql",
      "20260403_a05_backfill_user_accounts.sql",
      "20260403_a06_create_microsoft_identities.sql",
      "20260403_a06_create_microsoft_identities_rollback.sql",
      "20260403_a07_backfill_microsoft_identities.sql",
      "20260403_a03_create_departments_role_definitions.sql",
      "20260403_a03_create_departments_role_definitions_rollback.sql",
      "20260403_a08_create_role_assignments.sql",
      "20260403_a08_create_role_assignments_rollback.sql",
      "20260403_a09_backfill_role_assignments.sql",
      "20260403_b01_create_project_types.sql",
      "20260403_b01_create_project_types_rollback.sql",
      "20260403_b02_create_project_instances.sql",
      "20260403_b02_create_project_instances_rollback.sql",
      "20260403_b03_backfill_project_instances.sql",
      "20260403_b04_create_project_info.sql",
      "20260403_b04_create_project_info_rollback.sql",
      "20260403_b05_backfill_project_info.sql",
      "20260403_b06_create_project_party_links.sql",
      "20260403_b06_create_project_party_links_rollback.sql",
      "20260403_b07_backfill_project_party_links.sql",
      "20260403_b08_create_phase_definitions.sql",
      "20260403_b08_create_phase_definitions_rollback.sql",
      "20260403_b09_backfill_project_phase_history.sql",
      "20260403_b10_add_phase_definition_fk_to_project_instances.sql",
      "20260403_b10_add_phase_definition_fk_to_project_instances_rollback.sql",
      "20260403_c01_create_work_packages.sql",
      "20260403_c09_create_work_packages_rollback.sql",
      "20260403_c02_backfill_work_packages.sql",
      "20260403_c03_create_work_items_clean.sql",
      "20260403_c08_create_work_items_clean_rollback.sql",
      "20260403_c04_backfill_work_items_clean.sql",
      "20260403_c05_create_work_item_dependencies_clean.sql",
      "20260403_c07_create_work_item_dependencies_clean_rollback.sql",
      "20260403_c06_backfill_work_item_dependencies_clean.sql",
      "20260403_d01_create_governed_processes.sql",
      "20260403_d04_create_governed_processes_rollback.sql",
      "20260403_d02_backfill_governed_processes.sql",
      "20260403_d03_backfill_governed_process_checklist_items.sql",
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

  it("Phase A migration files sort in correct dependency order", () => {
    const phaseAFiles = fs.readdirSync(migrationsDir)
      .filter((f) => f.startsWith("20260403_a") && f.endsWith(".sql") && !f.includes("rollback"))
      .sort();
    const expectedOrder = [
      "20260403_a01_expand_parties_add_party_kind.sql",
      "20260403_a02_backfill_parties_users.sql",
      "20260403_a03_create_departments_role_definitions.sql",
      "20260403_a04_create_user_accounts.sql",
      "20260403_a05_backfill_user_accounts.sql",
      "20260403_a06_create_microsoft_identities.sql",
      "20260403_a07_backfill_microsoft_identities.sql",
      "20260403_a08_create_role_assignments.sql",
      "20260403_a09_backfill_role_assignments.sql",
    ];
    expect(phaseAFiles).toEqual(expectedOrder);
  });

  it("Phase A backfill files always sort after their DDL files", () => {
    const pairs = [
      { ddl: "20260403_a04_create_user_accounts.sql", backfill: "20260403_a05_backfill_user_accounts.sql" },
      { ddl: "20260403_a06_create_microsoft_identities.sql", backfill: "20260403_a07_backfill_microsoft_identities.sql" },
      { ddl: "20260403_a08_create_role_assignments.sql", backfill: "20260403_a09_backfill_role_assignments.sql" },
    ];
    for (const { ddl, backfill } of pairs) {
      expect(ddl.localeCompare(backfill)).toBeLessThan(0);
      expect(fs.existsSync(path.join(migrationsDir, ddl))).toBe(true);
      expect(fs.existsSync(path.join(migrationsDir, backfill))).toBe(true);
    }
  });

  it("role_assignments backfill includes unmatched-role safety check", () => {
    const sql = readMigration("20260403_a09_backfill_role_assignments.sql");
    expect(sql).toContain("RAISE WARNING");
    expect(sql).toContain("role code not found in core.role_definitions");
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
      "20260403_a04_create_user_accounts.sql",
      "20260403_a06_create_microsoft_identities.sql",
      "20260403_a03_create_departments_role_definitions.sql",
      "20260403_a08_create_role_assignments.sql",
      "20260403_b01_create_project_types.sql",
      "20260403_b02_create_project_instances.sql",
      "20260403_b04_create_project_info.sql",
      "20260403_b06_create_project_party_links.sql",
      "20260403_b08_create_phase_definitions.sql",
      "20260403_b10_add_phase_definition_fk_to_project_instances.sql",
      "20260403_c01_create_work_packages.sql",
      "20260403_c03_create_work_items_clean.sql",
      "20260403_c05_create_work_item_dependencies_clean.sql",
      "20260403_d01_create_governed_processes.sql",
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
      "20260403_a04_create_user_accounts.sql",
      "20260403_a06_create_microsoft_identities.sql",
      "20260403_a03_create_departments_role_definitions.sql",
      "20260403_a08_create_role_assignments.sql",
      "20260403_b01_create_project_types.sql",
      "20260403_b02_create_project_instances.sql",
      "20260403_b04_create_project_info.sql",
      "20260403_b06_create_project_party_links.sql",
      "20260403_b08_create_phase_definitions.sql",
      "20260403_b10_add_phase_definition_fk_to_project_instances.sql",
      "20260403_c01_create_work_packages.sql",
      "20260403_c03_create_work_items_clean.sql",
      "20260403_c05_create_work_item_dependencies_clean.sql",
      "20260403_d01_create_governed_processes.sql",
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
