import type { RolloutFeatureFlagKey } from "./feature-flags";

export const QA_ROLLOUT_ROLES = [
  "COO",
  "CEO",
  "PM",
  "Construction Manager",
  "Engineer",
  "Engineering Manager",
  "Quality Manager",
  "Finance / CFO / Program Finance",
  "Project Developer",
  "Admin",
] as const;

export const QA_ROLLOUT_AREAS = [
  "role_based_landings",
  "role_aware_nav_relevance",
  "page_shell_consistency",
  "kpi_consistency",
  "microsoft_integration_visibility",
  "create_from_outlook_email",
  "create_from_teams_message",
  "create_from_sharepoint_onedrive",
  "item_type_selection",
  "project_selection_behavior",
  "override_reason_capture",
  "audit_log_coverage",
  "deliverable_send",
  "approval_send",
  "canonical_save",
  "local_synced_save_fallback",
  "admin_settings_cleanup",
  "mobile_behavior",
  "tablet_behavior",
  "desktop_behavior",
] as const;

export type QaRole = (typeof QA_ROLLOUT_ROLES)[number];
export type QaArea = (typeof QA_ROLLOUT_AREAS)[number];

export type GateStatus = "pass" | "fail" | "blocked" | "not_tested";

export interface QaAreaStatus {
  status: GateStatus;
  notes?: string;
}

export type QaRoleAreaCoverage = Partial<Record<QaRole, Partial<Record<QaArea, QaAreaStatus>>>>;

export interface RolloutGateInput {
  phase: RolloutPhaseKey;
  featureFlags: Partial<Record<RolloutFeatureFlagKey, boolean>>;
  coverage: QaRoleAreaCoverage;
  blockers?: string[];
}

export interface RolloutGateReport {
  phase: RolloutPhaseKey;
  go: boolean;
  requiredFlags: RolloutFeatureFlagKey[];
  missingFlags: RolloutFeatureFlagKey[];
  coverageSummary: {
    totalChecks: number;
    passed: number;
    failed: number;
    blocked: number;
    notTested: number;
  };
  missingCoverage: Array<{ role: QaRole; area: QaArea; status: GateStatus }>;
  blockers: string[];
  recommendation: string;
}

export type RolloutPhaseKey = "phase_0_baseline" | "phase_1_role_ux" | "phase_2_ms_context" | "phase_3_ms_create" | "phase_4_local_sync" | "phase_5_admin_cleanup";

export const ROLLOUT_PHASE_REQUIREMENTS: Record<RolloutPhaseKey, { requiredFlags: RolloutFeatureFlagKey[]; requiredAreas: QaArea[] }> = {
  phase_0_baseline: {
    requiredFlags: [],
    requiredAreas: [
      "role_based_landings",
      "role_aware_nav_relevance",
      "page_shell_consistency",
      "kpi_consistency",
      "canonical_save",
      "mobile_behavior",
      "tablet_behavior",
      "desktop_behavior",
    ],
  },
  phase_1_role_ux: {
    requiredFlags: ["role_aware_ux"],
    requiredAreas: [
      "role_based_landings",
      "role_aware_nav_relevance",
      "page_shell_consistency",
      "kpi_consistency",
      "audit_log_coverage",
      "mobile_behavior",
      "tablet_behavior",
      "desktop_behavior",
    ],
  },
  phase_2_ms_context: {
    requiredFlags: ["role_aware_ux", "contextual_ms_surfaces"],
    requiredAreas: [
      "microsoft_integration_visibility",
      "create_from_outlook_email",
      "create_from_teams_message",
      "create_from_sharepoint_onedrive",
      "project_selection_behavior",
      "audit_log_coverage",
      "desktop_behavior",
    ],
  },
  phase_3_ms_create: {
    requiredFlags: ["role_aware_ux", "contextual_ms_surfaces", "ms_create_action"],
    requiredAreas: [
      "item_type_selection",
      "project_selection_behavior",
      "override_reason_capture",
      "deliverable_send",
      "approval_send",
      "audit_log_coverage",
      "canonical_save",
      "desktop_behavior",
    ],
  },
  phase_4_local_sync: {
    requiredFlags: ["role_aware_ux", "contextual_ms_surfaces", "ms_create_action", "local_synced_save_flow"],
    requiredAreas: [
      "canonical_save",
      "local_synced_save_fallback",
      "audit_log_coverage",
      "mobile_behavior",
      "tablet_behavior",
      "desktop_behavior",
    ],
  },
  phase_5_admin_cleanup: {
    requiredFlags: ["role_aware_ux", "contextual_ms_surfaces", "ms_create_action", "local_synced_save_flow", "cleaned_admin_visibility"],
    requiredAreas: [
      "admin_settings_cleanup",
      "audit_log_coverage",
      "mobile_behavior",
      "tablet_behavior",
      "desktop_behavior",
    ],
  },
};

export function evaluateRolloutGate(input: RolloutGateInput): RolloutGateReport {
  const req = ROLLOUT_PHASE_REQUIREMENTS[input.phase];
  const blockers = input.blockers || [];
  const missingFlags = req.requiredFlags.filter((flag) => input.featureFlags[flag] !== true);

  const missingCoverage: Array<{ role: QaRole; area: QaArea; status: GateStatus }> = [];
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let notTested = 0;

  for (const role of QA_ROLLOUT_ROLES) {
    const roleCoverage = input.coverage[role] || {};
    for (const area of req.requiredAreas) {
      const status = roleCoverage[area]?.status || "not_tested";
      if (status === "pass") {
        passed += 1;
      } else if (status === "fail") {
        failed += 1;
        missingCoverage.push({ role, area, status });
      } else if (status === "blocked") {
        blocked += 1;
        missingCoverage.push({ role, area, status });
      } else {
        notTested += 1;
        missingCoverage.push({ role, area, status: "not_tested" });
      }
    }
  }

  const totalChecks = QA_ROLLOUT_ROLES.length * req.requiredAreas.length;
  const go = missingFlags.length === 0 && failed === 0 && blocked === 0 && notTested === 0 && blockers.length === 0;

  const recommendation = go
    ? "Go: promote to the next rollout phase with cohort-based enablement."
    : "No-go: resolve missing flags, coverage gaps, and blockers before enabling the next phase.";

  return {
    phase: input.phase,
    go,
    requiredFlags: req.requiredFlags,
    missingFlags,
    coverageSummary: { totalChecks, passed, failed, blocked, notTested },
    missingCoverage,
    blockers,
    recommendation,
  };
}
