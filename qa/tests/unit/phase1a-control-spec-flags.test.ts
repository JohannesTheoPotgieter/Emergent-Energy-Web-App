import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_KEYS, ROLLOUT_FEATURE_FLAGS } from "@shared/feature-flags";

const PHASE_1A_FLAGS = [
  "promoted_phase1a_project_read_parity_diagnostics",
  "promoted_phase1a_lifecycle_gates_read_diagnostics",
  "promoted_phase1a_approvals_read_diagnostics",
  "promoted_phase1a_finance_read_diagnostics",
  "promoted_phase1a_deliverables_read_diagnostics",
  "promoted_phase1a_party_contact_read_diagnostics",
  "promoted_phase1a_reconciliation_endpoints",
] as const;

describe("Control-Spec Phase 1A feature flags", () => {
  it("registers all Phase 1A keys", () => {
    for (const key of PHASE_1A_FLAGS) {
      expect(FEATURE_FLAG_KEYS).toContain(key);
    }
  });

  it("defaults all Phase 1A flags to OFF", () => {
    for (const key of PHASE_1A_FLAGS) {
      const flag = ROLLOUT_FEATURE_FLAGS.find((item) => item.key === key);
      expect(flag, `Missing rollout flag definition for ${key}`).toBeTruthy();
      expect(flag?.defaultValue).toBe(false);
    }
  });
});
