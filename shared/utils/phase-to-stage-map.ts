// ============================================================
// Phase-to-Stage Mapping — maps legacy LifecyclePhase values
// to the 10-stage StageCode system.
// ============================================================
// Used by the historical projects backfill to determine which
// stage a project is currently in based on its executionPhase,
// and to mark all prior stages as PROGRESSED (completed).
// ============================================================

import type { StageCode } from "../schema/stage-lifecycle";
import type { LifecyclePhase } from "../schema/projects";
import { STAGE_CODES } from "../schema/stage-lifecycle";

/**
 * Maps a legacy LifecyclePhase string to the corresponding StageCode.
 * For phases that span multiple stages (e.g. "Planning" covers S04+S05),
 * we map to the stage the project is actively IN.
 */
export const PHASE_TO_STAGE: Record<LifecyclePhase, StageCode> = {
  "First Assessment":     "S01_FIRST_ASSESSMENT",
  "Cost Proposal":        "S02_DESIGN_COST_PROPOSAL",
  "Financial Close":      "S03_SIGNATURE_FINANCIAL_CLOSE",
  "Planning":             "S05_FINANCIAL_REVIEW",        // Planning = PD-PM Handover done, Financial Review active
  "Construction":         "S06_CONSTRUCTION",
  "QA":                   "S07_COMMISSIONING",
  "Handover":             "S08_OM_HANDOVER",
  "Compliance Handover":  "S09_CLIENT_HANDOVER",
  "Commercial Close Out": "S10_POST_HANDOVER_REVIEW",
  "DLP":                  "S10_POST_HANDOVER_REVIEW",    // Defect Liability Period — project essentially complete
  "Internal":             "S01_FIRST_ASSESSMENT",        // Internal projects — start at stage 1
  "Hold":                 "S01_FIRST_ASSESSMENT",        // On hold — conservative default
  "Closed":               "S10_POST_HANDOVER_REVIEW",    // Closed — all stages completed
  "TBC":                  "S01_FIRST_ASSESSMENT",        // Unknown — conservative default
};

/**
 * Phases where ALL stages should be marked as PROGRESSED (project is complete).
 */
export const FULLY_COMPLETED_PHASES: readonly LifecyclePhase[] = [
  "DLP",
  "Closed",
] as const;

/**
 * Returns the index of a stage code in the STAGE_CODES array (0-based).
 */
export function stageIndex(code: StageCode): number {
  return STAGE_CODES.indexOf(code);
}

/**
 * Returns all stage codes that come BEFORE the given stage (i.e. should be PROGRESSED for historical projects).
 */
export function stagesBefore(currentStage: StageCode): StageCode[] {
  const idx = stageIndex(currentStage);
  return STAGE_CODES.slice(0, idx) as unknown as StageCode[];
}
