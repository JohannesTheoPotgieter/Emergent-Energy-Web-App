import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const migrationsDir = path.resolve(__dirname, "../../../migrations");

describe("View-swap migration validation", () => {
  describe("clients view-swap", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_view_swap_clients.sql"),
      "utf-8",
    );

    it("runs in a transaction", () => {
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it("adds missing legacy columns to core.clients before swap", () => {
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS billing_entity");
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS secondary_contact_name");
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS secondary_contact_email");
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS industry");
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS pipedrive_org_id");
      expect(sql).toContain("ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS status");
    });

    it("backfills new columns from legacy data", () => {
      expect(sql).toContain("UPDATE core.clients");
      expect(sql).toContain("FROM public.clients leg");
    });

    it("renames legacy table", () => {
      expect(sql).toContain("ALTER TABLE public.clients RENAME TO _clients_legacy");
    });

    it("creates view with all legacy columns", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.clients AS");
      // Verify key column mappings
      expect(sql).toContain("c.client_code AS client_id");
      expect(sql).toContain("c.name");
      expect(sql).toContain("c.billing_entity");
      expect(sql).toContain("c.pipedrive_org_id");
      expect(sql).toContain("c.status");
    });

    it("creates INSTEAD OF triggers for INSERT, UPDATE, DELETE", () => {
      expect(sql).toContain("CREATE TRIGGER clients_view_insert INSTEAD OF INSERT");
      expect(sql).toContain("CREATE TRIGGER clients_view_update INSTEAD OF UPDATE");
      expect(sql).toContain("CREATE TRIGGER clients_view_delete INSTEAD OF DELETE");
    });

    it("insert trigger writes to both core.clients and _clients_legacy", () => {
      expect(sql).toContain("INSERT INTO core.clients");
      expect(sql).toContain("INSERT INTO public._clients_legacy");
    });

    it("update trigger writes to both core.clients and _clients_legacy", () => {
      expect(sql).toContain("UPDATE core.clients SET");
      expect(sql).toContain("UPDATE public._clients_legacy SET");
    });

    it("has a rollback script", () => {
      const rollback = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_clients_rollback.sql"),
        "utf-8",
      );
      expect(rollback).toContain("DROP TRIGGER IF EXISTS clients_view_insert");
      expect(rollback).toContain("DROP VIEW IF EXISTS public.clients");
      expect(rollback).toContain("ALTER TABLE public._clients_legacy RENAME TO clients");
    });
  });

  describe("project_info view-swap", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_view_swap_project_info.sql"),
      "utf-8",
    );

    it("runs in a transaction", () => {
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it("renames legacy table", () => {
      expect(sql).toContain("ALTER TABLE public.project_info RENAME TO _project_info_legacy");
    });

    it("creates view with all legacy columns", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.project_info AS");
      const requiredColumns = [
        "project_name", "size_kwp", "pd", "pm", "contract_value",
        "canonical_project_id", "client_id", "pm_user_id", "pd_user_id",
        "site_id", "opportunity_id", "delivery_model", "project_code",
      ];
      for (const col of requiredColumns) {
        expect(sql).toContain(col);
      }
    });

    it("creates INSTEAD OF triggers for INSERT, UPDATE, DELETE", () => {
      expect(sql).toContain("CREATE TRIGGER project_info_view_insert INSTEAD OF INSERT");
      expect(sql).toContain("CREATE TRIGGER project_info_view_update INSTEAD OF UPDATE");
      expect(sql).toContain("CREATE TRIGGER project_info_view_delete INSTEAD OF DELETE");
    });

    it("insert trigger writes to both core.projects and _project_info_legacy", () => {
      expect(sql).toContain("INSERT INTO core.projects");
      expect(sql).toContain("INSERT INTO public._project_info_legacy");
    });

    it("delete trigger soft-deletes in core.projects", () => {
      expect(sql).toContain("UPDATE core.projects SET deleted_at = NOW() WHERE id = OLD.id");
    });

    it("has a rollback script", () => {
      const rollback = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_project_info_rollback.sql"),
        "utf-8",
      );
      expect(rollback).toContain("DROP TRIGGER IF EXISTS project_info_view_insert");
      expect(rollback).toContain("DROP VIEW IF EXISTS public.project_info");
      expect(rollback).toContain("ALTER TABLE public._project_info_legacy RENAME TO project_info");
    });
  });

  describe("project_execution_state view-swap", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_view_swap_project_execution_state.sql"),
      "utf-8",
    );

    it("runs in a transaction", () => {
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it("adds legacy_execution_state_id to core.projects", () => {
      expect(sql).toContain("ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS legacy_execution_state_id");
    });

    it("backfills legacy_execution_state_id from existing data", () => {
      expect(sql).toContain("UPDATE core.projects p SET");
      expect(sql).toContain("legacy_execution_state_id = pes.id");
    });

    it("backfills execution state columns to core.projects", () => {
      expect(sql).toContain("phase_updated_at = COALESCE(p.phase_updated_at, pes.phase_updated_at)");
      expect(sql).toContain("construction_manager_user_id = COALESCE(p.construction_manager_user_id, pes.construction_manager_user_id)");
    });

    it("renames legacy table", () => {
      expect(sql).toContain("ALTER TABLE public.project_execution_state RENAME TO _project_execution_state_legacy");
    });

    it("creates view with all legacy columns", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.project_execution_state AS");
      const requiredColumns = [
        "legacy_execution_state_id AS id",
        "AS project_id",
        "phase", "rag_status", "rag_comment",
        "execution_gate_status", "execution_gate_reason",
        "signed_status", "signed_date",
        "current_stage_code", "gate_status",
        "construction_manager_user_id",
        "cost_baseline", "margin_baseline",
        "financial_review_status",
      ];
      for (const col of requiredColumns) {
        expect(sql).toContain(col);
      }
    });

    it("creates INSTEAD OF triggers for INSERT, UPDATE, DELETE", () => {
      expect(sql).toContain("CREATE TRIGGER pes_view_insert INSTEAD OF INSERT");
      expect(sql).toContain("CREATE TRIGGER pes_view_update INSTEAD OF UPDATE");
      expect(sql).toContain("CREATE TRIGGER pes_view_delete INSTEAD OF DELETE");
    });

    it("update trigger creates state history snapshot", () => {
      expect(sql).toContain("INSERT INTO core.project_state_history");
      expect(sql).toContain("snapshot_reason");
      expect(sql).toContain("'view_swap_trigger'");
    });

    it("update trigger marks previous snapshots as not current", () => {
      expect(sql).toContain("SET is_current = false");
    });

    it("insert and update triggers write to both promoted and legacy", () => {
      expect(sql).toContain("UPDATE core.projects SET");
      expect(sql).toContain("INSERT INTO public._project_execution_state_legacy");
      expect(sql).toContain("UPDATE public._project_execution_state_legacy SET");
    });

    it("delete trigger soft-deletes in core.projects", () => {
      expect(sql).toContain("UPDATE core.projects SET deleted_at = NOW(), is_active = false");
    });

    it("has a rollback script", () => {
      const rollback = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_project_execution_state_rollback.sql"),
        "utf-8",
      );
      expect(rollback).toContain("DROP TRIGGER IF EXISTS pes_view_insert");
      expect(rollback).toContain("DROP VIEW IF EXISTS public.project_execution_state");
      expect(rollback).toContain("ALTER TABLE public._project_execution_state_legacy RENAME TO project_execution_state");
    });
  });

  describe("normalized_cost_lines view-swap", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_view_swap_normalized_cost_lines.sql"),
      "utf-8",
    );

    it("runs in a transaction", () => {
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it("creates safe date parser helper function", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public._safe_parse_date");
      expect(sql).toContain("LANGUAGE plpgsql IMMUTABLE");
    });

    it("adds missing legacy columns to finance.cost_lines", () => {
      expect(sql).toContain("ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_rule_id");
      expect(sql).toContain("ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_classified_at");
      expect(sql).toContain("ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS pattern_inferred_type");
      expect(sql).toContain("ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE");
      expect(sql).toContain("ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS amount_ex_vat_legacy");
    });

    it("backfills new columns from legacy data", () => {
      expect(sql).toContain("UPDATE finance.cost_lines cl SET");
      expect(sql).toContain("FROM public.normalized_cost_lines ncl");
    });

    it("renames legacy table", () => {
      expect(sql).toContain("ALTER TABLE public.normalized_cost_lines RENAME TO _normalized_cost_lines_legacy");
    });

    it("creates view with all legacy columns", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.normalized_cost_lines AS");
      const requiredColumns = [
        "legacy_normalized_cost_line_id AS id",
        "project_name_snapshot",
        "cost_category", "counterparty_name", "amount_ex_vat",
        "invoice_number", "invoice_date", "cost_line_status",
        "effective_from", "effective_to",
        "pattern_rule_id", "admin_date_override",
      ];
      for (const col of requiredColumns) {
        expect(sql).toContain(col);
      }
    });

    it("creates INSTEAD OF triggers for INSERT, UPDATE, DELETE", () => {
      expect(sql).toContain("CREATE TRIGGER ncl_view_insert INSTEAD OF INSERT");
      expect(sql).toContain("CREATE TRIGGER ncl_view_update INSTEAD OF UPDATE");
      expect(sql).toContain("CREATE TRIGGER ncl_view_delete INSTEAD OF DELETE");
    });

    it("insert trigger derives typed dates and fiscal_period_id", () => {
      expect(sql).toContain("_safe_parse_date(NEW.invoice_date)");
      expect(sql).toContain("_safe_parse_date(NEW.approved_date)");
      expect(sql).toContain("_safe_parse_date(NEW.paid_date)");
      expect(sql).toContain("FROM finance.fiscal_periods");
      expect(sql).toContain("_fiscal_period_id");
    });

    it("insert trigger resolves project_id from project_name", () => {
      expect(sql).toContain("SELECT id INTO _resolved_project_id");
      expect(sql).toContain("FROM core.projects");
      expect(sql).toContain("WHERE project_name = NEW.project_name");
    });

    it("insert trigger uses ON CONFLICT for upsert safety", () => {
      expect(sql).toContain("ON CONFLICT (legacy_normalized_cost_line_id) DO UPDATE SET");
    });

    it("triggers write to both promoted and legacy", () => {
      expect(sql).toContain("INSERT INTO finance.cost_lines");
      expect(sql).toContain("INSERT INTO public._normalized_cost_lines_legacy");
      expect(sql).toContain("UPDATE public._normalized_cost_lines_legacy SET");
    });

    it("delete trigger soft-closes via effective_to", () => {
      expect(sql).toContain("SET effective_to = NOW()");
    });

    it("has a rollback script", () => {
      const rollback = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_normalized_cost_lines_rollback.sql"),
        "utf-8",
      );
      expect(rollback).toContain("DROP TRIGGER IF EXISTS ncl_view_insert");
      expect(rollback).toContain("DROP VIEW IF EXISTS public.normalized_cost_lines");
      expect(rollback).toContain("ALTER TABLE public._normalized_cost_lines_legacy RENAME TO normalized_cost_lines");
    });
  });

  describe("normalized_revenue_lines view-swap", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_view_swap_normalized_revenue_lines.sql"),
      "utf-8",
    );

    it("runs in a transaction", () => {
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it("adds missing legacy columns to finance.revenue_lines", () => {
      expect(sql).toContain("ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE");
      expect(sql).toContain("ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS amount_ex_vat_legacy");
      expect(sql).toContain("ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS vat_legacy");
    });

    it("backfills new columns from legacy data", () => {
      expect(sql).toContain("UPDATE finance.revenue_lines rl SET");
      expect(sql).toContain("FROM public.normalized_revenue_lines nrl");
    });

    it("renames legacy table", () => {
      expect(sql).toContain("ALTER TABLE public.normalized_revenue_lines RENAME TO _normalized_revenue_lines_legacy");
    });

    it("creates view with all legacy columns", () => {
      expect(sql).toContain("CREATE OR REPLACE VIEW public.normalized_revenue_lines AS");
      const requiredColumns = [
        "legacy_normalized_revenue_line_id AS id",
        "project_name_snapshot",
        "milestone_name", "amount_ex_vat", "vat",
        "invoice_number", "status",
        "effective_from", "effective_to",
        "admin_date_override",
      ];
      for (const col of requiredColumns) {
        expect(sql).toContain(col);
      }
    });

    it("creates INSTEAD OF triggers for INSERT, UPDATE, DELETE", () => {
      expect(sql).toContain("CREATE TRIGGER nrl_view_insert INSTEAD OF INSERT");
      expect(sql).toContain("CREATE TRIGGER nrl_view_update INSTEAD OF UPDATE");
      expect(sql).toContain("CREATE TRIGGER nrl_view_delete INSTEAD OF DELETE");
    });

    it("insert trigger derives typed dates and fiscal_period_id", () => {
      expect(sql).toContain("_safe_parse_date(NEW.invoice_date)");
      expect(sql).toContain("_safe_parse_date(NEW.expected_payment_date)");
      expect(sql).toContain("_safe_parse_date(NEW.paid_date)");
      expect(sql).toContain("_fiscal_period_id");
    });

    it("insert trigger resolves project_id from project_name", () => {
      expect(sql).toContain("SELECT id INTO _resolved_project_id");
      expect(sql).toContain("WHERE project_name = NEW.project_name");
    });

    it("insert trigger uses ON CONFLICT for upsert safety", () => {
      expect(sql).toContain("ON CONFLICT (legacy_normalized_revenue_line_id) DO UPDATE SET");
    });

    it("triggers write to both promoted and legacy", () => {
      expect(sql).toContain("INSERT INTO finance.revenue_lines");
      expect(sql).toContain("INSERT INTO public._normalized_revenue_lines_legacy");
      expect(sql).toContain("UPDATE public._normalized_revenue_lines_legacy SET");
    });

    it("delete trigger soft-closes via effective_to", () => {
      expect(sql).toContain("SET effective_to = NOW()");
    });

    it("has a rollback script", () => {
      const rollback = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_normalized_revenue_lines_rollback.sql"),
        "utf-8",
      );
      expect(rollback).toContain("DROP TRIGGER IF EXISTS nrl_view_insert");
      expect(rollback).toContain("DROP VIEW IF EXISTS public.normalized_revenue_lines");
      expect(rollback).toContain("ALTER TABLE public._normalized_revenue_lines_legacy RENAME TO normalized_revenue_lines");
    });
  });

  describe("consistency with existing view-swap pattern", () => {
    const spine = fs.readFileSync(
      path.join(migrationsDir, "20260403_spine_view_swap.sql"),
      "utf-8",
    );

    it("follows the same _legacy naming convention", () => {
      // Existing pattern uses _<table>_legacy suffix
      expect(spine).toContain("_approvals_legacy");
      expect(spine).toContain("_deliverables_legacy");
      expect(spine).toContain("_work_items_legacy");

      // New migrations follow same convention
      const files: [string, string][] = [
        ["20260404_view_swap_clients.sql", "_clients_legacy"],
        ["20260404_view_swap_project_info.sql", "_project_info_legacy"],
        ["20260404_view_swap_project_execution_state.sql", "_project_execution_state_legacy"],
        ["20260404_view_swap_normalized_cost_lines.sql", "_normalized_cost_lines_legacy"],
        ["20260404_view_swap_normalized_revenue_lines.sql", "_normalized_revenue_lines_legacy"],
      ];
      for (const [file, legacyName] of files) {
        const s = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        expect(s).toContain(legacyName);
      }
    });

    it("follows the same dual-write pattern (promoted + legacy)", () => {
      // Existing pattern: INSERT into promoted AND legacy
      expect(spine).toContain("INSERT INTO public._approvals_legacy");
      expect(spine).toContain("INSERT INTO public._work_items_legacy");
    });
  });
});
