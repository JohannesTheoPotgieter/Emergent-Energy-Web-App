import { describe, expect, it } from "vitest";
import {
  QA_ROLLOUT_AREAS,
  QA_ROLLOUT_ROLES,
  evaluateRolloutGate,
  type QaRoleAreaCoverage,
} from "@shared/rollout-gate";

function buildCoverage(status: "pass" | "fail" | "blocked" | "not_tested"): QaRoleAreaCoverage {
  const coverage: QaRoleAreaCoverage = {};
  for (const role of QA_ROLLOUT_ROLES) {
    coverage[role] = {};
    for (const area of QA_ROLLOUT_AREAS) {
      coverage[role]![area] = { status };
    }
  }
  return coverage;
}

describe("rollout gate", () => {
  it("fails when required flags for a phase are not enabled", () => {
    const report = evaluateRolloutGate({
      phase: "phase_2_ms_context",
      featureFlags: { role_aware_ux: true, contextual_ms_surfaces: false },
      coverage: buildCoverage("pass"),
    });

    expect(report.go).toBe(false);
    expect(report.missingFlags).toEqual(["contextual_ms_surfaces"]);
  });

  it("fails when required role x area coverage has not been completed", () => {
    const coverage = buildCoverage("pass");
    coverage["Engineer"]!["create_from_teams_message"] = { status: "blocked" };

    const report = evaluateRolloutGate({
      phase: "phase_2_ms_context",
      featureFlags: { role_aware_ux: true, contextual_ms_surfaces: true },
      coverage,
    });

    expect(report.go).toBe(false);
    expect(report.coverageSummary.blocked).toBe(1);
    expect(report.missingCoverage).toContainEqual({
      role: "Engineer",
      area: "create_from_teams_message",
      status: "blocked",
    });
  });

  it("passes when all required flags and coverage checks pass", () => {
    const report = evaluateRolloutGate({
      phase: "phase_1_role_ux",
      featureFlags: { role_aware_ux: true },
      coverage: buildCoverage("pass"),
      blockers: [],
    });

    expect(report.go).toBe(true);
    expect(report.coverageSummary.failed).toBe(0);
    expect(report.coverageSummary.blocked).toBe(0);
    expect(report.coverageSummary.notTested).toBe(0);
  });
});
