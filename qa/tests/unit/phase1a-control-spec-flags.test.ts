import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_KEYS, ROLLOUT_FEATURE_FLAGS } from "@shared/feature-flags";

const CONTROL_SPEC_FLAGS = [
  "migration_bridge_project_read_v1",
  "migration_bridge_lifecycle_read_v1",
  "migration_bridge_approvals_dual_read_v1",
  "migration_bridge_finance_read_v1",
  "migration_bridge_party_read_v1",
  "migration_bridge_deliverables_read_v1",
  "migration_bridge_approvals_dual_write_v1",
  "migration_bridge_project_dual_write_v1",
] as const;

describe("Control-Spec migration bridge feature flags", () => {
  it("registers all Section F keys", () => {
    for (const key of CONTROL_SPEC_FLAGS) {
      expect(FEATURE_FLAG_KEYS).toContain(key);
    }
  });

  it("defaults all Section F flags to OFF", () => {
    for (const key of CONTROL_SPEC_FLAGS) {
      const flag = ROLLOUT_FEATURE_FLAGS.find((item) => item.key === key);
      expect(flag, `Missing rollout flag definition for ${key}`).toBeTruthy();
      expect(flag?.defaultValue).toBe(false);
    }
  });
});
