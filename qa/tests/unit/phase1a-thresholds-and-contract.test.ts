import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePhase1AThresholdOutcome } from "../../../server/services/promoted-read-compat";

describe("Phase 1A threshold evaluation", () => {
  it("returns pass when all rules pass", () => {
    const result = evaluatePhase1AThresholdOutcome([
      { metric: "mismatch_rate_percent", comparator: "lte", threshold: 0.05, actual: 0.01, passed: true },
      { metric: "critical_mismatch_count", comparator: "eq", threshold: 0, actual: 0, passed: true },
    ]);

    expect(result.outcome).toBe("pass");
    expect(result.rules).toHaveLength(2);
  });

  it("returns fail when any rule fails", () => {
    const result = evaluatePhase1AThresholdOutcome([
      { metric: "queue_count_delta", comparator: "eq", threshold: 0, actual: 1, passed: false },
      { metric: "status_distribution_delta_percent", comparator: "lte", threshold: 0.1, actual: 0.05, passed: true },
    ]);

    expect(result.outcome).toBe("fail");
  });
});

describe("Phase 1A contracts/auth safeguards", () => {
  it("preserves auth and admin guards on manual reconciliation endpoint", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
    expect(content).toContain('router.get("/api/admin/reconciliation/phase-1a", requireAuth, requireAdmin');
  });

  it("keeps endpoint default-off contract with compare-mode escape hatch", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "server/departments/admin-routes.ts"), "utf8");
    expect(content).toContain("feature_flag_disabled");
    expect(content).toContain("use compare mode");
  });
});
