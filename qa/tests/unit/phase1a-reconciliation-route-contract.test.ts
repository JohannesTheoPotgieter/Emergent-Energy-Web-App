import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluatePhase1AThresholdOutcome, type Phase1AThresholdRuleResult } from "../../../server/services/promoted-read-compat";
import { isPhase1AEndpointEnabled, isPhase1ADomainEnabled, type Phase1AFlagSet } from "../../../server/services/phase1a-reconciliation-policy";
import { requireAdmin } from "../../../server/middleware/requireAdmin";

const allOff: Phase1AFlagSet = {
  migration_bridge_project_read_v1: false,
  migration_bridge_lifecycle_read_v1: false,
  migration_bridge_approvals_dual_read_v1: false,
  migration_bridge_finance_read_v1: false,
  migration_bridge_deliverables_read_v1: false,
  migration_bridge_party_read_v1: false,
};

const allOn: Phase1AFlagSet = {
  migration_bridge_project_read_v1: true,
  migration_bridge_lifecycle_read_v1: true,
  migration_bridge_approvals_dual_read_v1: true,
  migration_bridge_finance_read_v1: true,
  migration_bridge_deliverables_read_v1: true,
  migration_bridge_party_read_v1: true,
};

describe("Phase 1A reconciliation route contract", () => {

  // ── A. Compare mode behavior ──

  describe("compare mode", () => {
    it("enables endpoint in compare mode even with all flags off", () => {
      expect(isPhase1AEndpointEnabled(true, allOff)).toBe(true);
    });

    it("enables all 6 domains in compare mode regardless of individual flags", () => {
      const domains: Array<"project_reads" | "lifecycle_gates" | "approvals" | "finance" | "deliverables" | "party_contacts"> = [
        "project_reads", "lifecycle_gates", "approvals", "finance", "deliverables", "party_contacts",
      ];
      for (const domain of domains) {
        expect(isPhase1ADomainEnabled(domain, true, allOff)).toBe(true);
      }
    });

    it("route handler checks for compare=1 and compare=true query parameters", () => {
      const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
      expect(content).toContain('req.query.compare === "1"');
      expect(content).toContain('req.query.compare === "true"');
    });
  });

  // ── B. Flags off behavior ──

  describe("flags off (default)", () => {
    it("blocks endpoint when all flags off and compare mode disabled", () => {
      expect(isPhase1AEndpointEnabled(false, allOff)).toBe(false);
    });

    it("returns feature_flag_disabled error when endpoint is blocked", () => {
      const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
      expect(content).toContain('"feature_flag_disabled"');
      expect(content).toContain("403");
    });

    it("filters domains by individual flags when not in compare mode", () => {
      const partialFlags: Phase1AFlagSet = { ...allOff, migration_bridge_finance_read_v1: true };
      expect(isPhase1ADomainEnabled("finance", false, partialFlags)).toBe(true);
      expect(isPhase1ADomainEnabled("approvals", false, partialFlags)).toBe(false);
      expect(isPhase1ADomainEnabled("lifecycle_gates", false, partialFlags)).toBe(false);
      expect(isPhase1ADomainEnabled("deliverables", false, partialFlags)).toBe(false);
      expect(isPhase1ADomainEnabled("party_contacts", false, partialFlags)).toBe(false);
    });
  });

  // ── C. Flags on behavior ──

  describe("flags on", () => {
    it("enables endpoint when project read flag is on", () => {
      expect(isPhase1AEndpointEnabled(false, { ...allOff, migration_bridge_project_read_v1: true })).toBe(true);
    });

    it("enables all domains when all flags are on", () => {
      const domains: Array<"project_reads" | "lifecycle_gates" | "approvals" | "finance" | "deliverables" | "party_contacts"> = [
        "project_reads", "lifecycle_gates", "approvals", "finance", "deliverables", "party_contacts",
      ];
      for (const domain of domains) {
        expect(isPhase1ADomainEnabled(domain, false, allOn)).toBe(true);
      }
    });
  });

  // ── D. Auth/admin guard behavior ──

  describe("auth and admin guards", () => {
    it("route is registered with requireAuth and requireAdmin middleware", () => {
      const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
      expect(content).toContain('router.get("/api/admin/reconciliation/phase-1a", requireAuth, requireAdmin');
    });

    it("requireAdmin rejects non-admin users with 403", () => {
      const req = { user: { role: "ENGINEER" } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "admin_required" });
    });

    it("requireAdmin passes COO_ADMIN role", () => {
      const req = { user: { role: "COO_ADMIN" } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("requireAdmin passes CEO_ADMIN role", () => {
      const req = { user: { role: "CEO_ADMIN" } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ── E. Response shape contract ──

  describe("response shape and threshold contract", () => {
    it("route handler maps check fields to response including thresholdEvaluation", () => {
      const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
      expect(content).toContain("thresholdEvaluation: check.thresholdEvaluation");
      expect(content).toContain("diagnosticsMode");
      expect(content).toContain("generatedAt");
    });

    it("threshold evaluation pass requires all rules to pass", () => {
      const rules: Phase1AThresholdRuleResult[] = [
        { metric: "a", comparator: "eq", threshold: 0, actual: 0, passed: true },
        { metric: "b", comparator: "lte", threshold: 1, actual: 0.5, passed: true },
      ];
      expect(evaluatePhase1AThresholdOutcome(rules).outcome).toBe("pass");
    });

    it("threshold evaluation fails if any single rule fails", () => {
      const rules: Phase1AThresholdRuleResult[] = [
        { metric: "a", comparator: "eq", threshold: 0, actual: 0, passed: true },
        { metric: "b", comparator: "eq", threshold: 0, actual: 1, passed: false },
      ];
      expect(evaluatePhase1AThresholdOutcome(rules).outcome).toBe("fail");
    });

    it("threshold evaluation returns all rule results for audit trail", () => {
      const rules: Phase1AThresholdRuleResult[] = [
        { metric: "m1", comparator: "lte", threshold: 0.05, actual: 0.01, passed: true },
        { metric: "m2", comparator: "eq", threshold: 0, actual: 3, passed: false },
        { metric: "m3", comparator: "gte", threshold: 99.5, actual: 100, passed: true },
      ];
      const result = evaluatePhase1AThresholdOutcome(rules);
      expect(result.rules).toHaveLength(3);
      expect(result.rules[0].metric).toBe("m1");
      expect(result.rules[1].passed).toBe(false);
      expect(result.rules[2].comparator).toBe("gte");
    });
  });

  // ── F. Truth-hardened reconciliation logic verification ──

  describe("truth-hardened reconciliation logic in service file", () => {
    const serviceContent = fs.readFileSync(
      path.join(process.cwd(), "server/services/promoted-read-compat.ts"),
      "utf8"
    );

    it("lifecycle_gates uses field-level comparison (phase, execution_gate_status, rag_status) not count delta", () => {
      expect(serviceContent).toContain("SELECT project_id, phase, execution_gate_status, rag_status FROM public.project_execution_state");
      expect(serviceContent).toContain("SELECT legacy_project_info_id, phase, execution_gate_status, rag_status FROM core.projects");
      expect(serviceContent).toContain("phaseMismatch");
      expect(serviceContent).toContain("gateMismatch");
      expect(serviceContent).toContain("phase_gate_field_mismatch");
    });

    it("approvals uses status distribution comparison not just count delta", () => {
      expect(serviceContent).toContain("LOWER(COALESCE(status, 'unknown')) AS status");
      expect(serviceContent).toContain("GROUP BY");
      expect(serviceContent).toContain("statusDistributionDeltaSum");
      expect(serviceContent).toContain("approval_status_distribution_delta");
    });

    it("finance joins on legacy IDs and compares amounts not row counts", () => {
      expect(serviceContent).toContain("legacy_program_inflow_id");
      expect(serviceContent).toContain("legacy_program_expense_id");
      expect(serviceContent).toContain("milestone_amount");
      expect(serviceContent).toContain("amount_ex_vat");
      expect(serviceContent).toContain("budget_total");
      expect(serviceContent).toContain("legacy_sum");
      expect(serviceContent).toContain("promoted_sum");
      expect(serviceContent).toContain("unresolved_legacy_mappings");
    });

    it("deliverables uses legacy_deliverable_id join for migration completeness", () => {
      expect(serviceContent).toContain("legacy_deliverable_id = d.id");
      expect(serviceContent).toContain("deliverables_missing_in_promoted");
      expect(serviceContent).toContain("mappedCount");
      expect(serviceContent).toContain("missingCount");
    });

    it("party_contacts uses legacy_id client matching and counterparty name resolution", () => {
      expect(serviceContent).toContain("cc.legacy_id = lc.id");
      expect(serviceContent).toContain("LOWER(TRIM(lc.name)) = LOWER(TRIM(cc.name))");
      expect(serviceContent).toContain("LOWER(TRIM(cl.counterparty_name)) = LOWER(TRIM(cp.name_canonical))");
      expect(serviceContent).toContain("clients_missing_legacy_id_mapping");
      expect(serviceContent).toContain("client_name_field_mismatch");
      expect(serviceContent).toContain("counterparty_name_unresolved_in_promoted");
    });

    it("labels all remaining provisional thresholds explicitly with reasons", () => {
      const provisionalMatches = serviceContent.match(/PROVISIONAL:/g);
      expect(provisionalMatches).toBeTruthy();
      expect(provisionalMatches!.length).toBeGreaterThanOrEqual(5);

      // Specific provisional labels
      expect(serviceContent).toContain("PROVISIONAL: current_stage_code and gate_status fields have no promoted counterpart");
      expect(serviceContent).toContain("PROVISIONAL: stale_items_over_15m requires replication-lag timestamp tracking");
      expect(serviceContent).toContain("PROVISIONAL: per-type (gate/exception/handover/general) distribution requires a type column");
      expect(serviceContent).toContain("PROVISIONAL: per-project-month breakdown requires fiscal-month derivation");
      expect(serviceContent).toContain("PROVISIONAL: evidence_link_completeness uses migration mapping ratio");
      expect(serviceContent).toContain("PROVISIONAL: contact_retrieval_match uses client name match as proxy");
      expect(serviceContent).toContain("PROVISIONAL: counterparty resolution checks name presence in finance.cost_lines");
    });
  });
});
