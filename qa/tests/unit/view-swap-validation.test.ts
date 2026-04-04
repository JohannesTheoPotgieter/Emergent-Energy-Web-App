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
      const clientsSql = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_clients.sql"),
        "utf-8",
      );
      const projectInfoSql = fs.readFileSync(
        path.join(migrationsDir, "20260404_view_swap_project_info.sql"),
        "utf-8",
      );
      expect(clientsSql).toContain("_clients_legacy");
      expect(projectInfoSql).toContain("_project_info_legacy");
    });

    it("follows the same dual-write pattern (promoted + legacy)", () => {
      // Existing pattern: INSERT into promoted AND legacy
      expect(spine).toContain("INSERT INTO public._approvals_legacy");
      expect(spine).toContain("INSERT INTO public._work_items_legacy");
    });
  });
});
