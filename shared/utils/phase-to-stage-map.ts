// ============================================================
// Phase-to-Stage Mapping — maps phase values (legacy AND current)
// to the 10-stage StageCode system.
// ============================================================
// Used by the historical projects backfill and lifecycle board
// phase-move handler to determine which stage a project is
// currently in, and to mark all prior stages as PROGRESSED.
// ============================================================

import type { StageCode } from "../schema/stage-lifecycle";
import type { LifecyclePhase } from "../schema/projects";
import { STAGE_CODES } from "../schema/stage-lifecycle";

/**
 * Maps a legacy LifecyclePhase string to the corresponding StageCode.
 *
 * After the S03+S04 / S02+S05 merge (migration 20260413_stage_lifecycle_merge):
 *   - "Planning" (formerly Financial Review territory) lands on S02
 *   - PD-PM handover phases land on S03 (Financial Close)
 */
export const PHASE_TO_STAGE: Record<LifecyclePhase, StageCode> = {
  "First Assessment":     "S01_FIRST_ASSESSMENT",
  "Cost Proposal":        "S02_DESIGN_COST_PROPOSAL",
  "Financial Close":      "S03_SIGNATURE_FINANCIAL_CLOSE",
  "Planning":             "S02_DESIGN_COST_PROPOSAL",    // Planning = closing step of Cost Proposal post-merge
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
 * Broad phase-to-stage mapping that handles ALL phase strings:
 *  - Legacy LifecyclePhase values (from Excel tracker)
 *  - Current lifecycle board phaseValues (from PHASE_GROUPS drag-drop)
 *  - Legacy P-code values
 *  - Stage code strings (S01-S10)
 *
 * Case-sensitive keys — use resolveStageFromPhase() for case-insensitive lookup.
 */
export const PHASE_VALUE_TO_STAGE: Record<string, StageCode> = {
  // --- Legacy LifecyclePhase values ---
  "First Assessment":     "S01_FIRST_ASSESSMENT",
  "Cost Proposal":        "S02_DESIGN_COST_PROPOSAL",
  "Financial Close":      "S03_SIGNATURE_FINANCIAL_CLOSE",
  "Planning":             "S02_DESIGN_COST_PROPOSAL",    // post-merge: Planning = S02
  "Construction":         "S06_CONSTRUCTION",
  "QA":                   "S07_COMMISSIONING",
  "Handover":             "S08_OM_HANDOVER",
  "Compliance Handover":  "S09_CLIENT_HANDOVER",
  "Commercial Close Out": "S10_POST_HANDOVER_REVIEW",
  "Commercial Close out": "S10_POST_HANDOVER_REVIEW",
  "DLP":                  "S10_POST_HANDOVER_REVIEW",
  "Internal":             "S01_FIRST_ASSESSMENT",
  "Hold":                 "S01_FIRST_ASSESSMENT",
  "Closed":               "S10_POST_HANDOVER_REVIEW",
  "TBC":                  "S01_FIRST_ASSESSMENT",

  // --- Current lifecycle board phaseValues (PHASE_GROUPS) ---
  "Design & Cost Proposal":       "S02_DESIGN_COST_PROPOSAL",
  "Signature & Financial Close":  "S03_SIGNATURE_FINANCIAL_CLOSE",
  "PD-PM Handover":               "S03_SIGNATURE_FINANCIAL_CLOSE",  // merged into S03
  "Financial Review":             "S02_DESIGN_COST_PROPOSAL",       // merged into S02
  "Commissioning":                "S07_COMMISSIONING",
  "O&M Handover":                 "S08_OM_HANDOVER",
  "Client Handover":              "S09_CLIENT_HANDOVER",
  "Post-Handover Review":         "S10_POST_HANDOVER_REVIEW",
  "Closeout":                     "S10_POST_HANDOVER_REVIEW",
  "Gone":                         "S10_POST_HANDOVER_REVIEW",
  "On Hold":                      "S01_FIRST_ASSESSMENT",

  // --- Legacy P-code values ---
  "P0_FIRST_ASSESSMENT":               "S01_FIRST_ASSESSMENT",
  "P1_COST_PROPOSAL_DESIGN":           "S02_DESIGN_COST_PROPOSAL",
  "P2_PD_PM_HANDOVER":                 "S03_SIGNATURE_FINANCIAL_CLOSE",  // merged into S03
  "P3_DETAILED_DESIGN_PROC_RELEASE":   "S02_DESIGN_COST_PROPOSAL",       // merged into S02
  "P3_FINANCIAL_CLOSE":                "S03_SIGNATURE_FINANCIAL_CLOSE",
  "P4_CONSTRUCTION_INSTALLATION":      "S06_CONSTRUCTION",
  "P5_COMMISSIONING_QA":               "S07_COMMISSIONING",
  "P5_COMMISSIONING_TESTING":          "S07_COMMISSIONING",
  "P6_HANDOVER_DLP":                   "S08_OM_HANDOVER",
  "P6_HANDOVER_CLIENT_MATRIARCH":      "S08_OM_HANDOVER",
  "P7_CLOSEOUT_POSTMORTEM":            "S10_POST_HANDOVER_REVIEW",

  // --- Stage code strings (direct pass-through) ---
  "S01_FIRST_ASSESSMENT":              "S01_FIRST_ASSESSMENT",
  "S02_DESIGN_COST_PROPOSAL":          "S02_DESIGN_COST_PROPOSAL",
  "S03_SIGNATURE_FINANCIAL_CLOSE":     "S03_SIGNATURE_FINANCIAL_CLOSE",
  "S04_PD_PM_HANDOVER":                "S03_SIGNATURE_FINANCIAL_CLOSE",  // merged
  "S05_FINANCIAL_REVIEW":              "S02_DESIGN_COST_PROPOSAL",       // merged
  "S06_CONSTRUCTION":                  "S06_CONSTRUCTION",
  "S07_COMMISSIONING":                 "S07_COMMISSIONING",
  "S08_OM_HANDOVER":                   "S08_OM_HANDOVER",
  "S09_CLIENT_HANDOVER":               "S09_CLIENT_HANDOVER",
  "S10_POST_HANDOVER_REVIEW":          "S10_POST_HANDOVER_REVIEW",
};

// Build a lowercase lookup for case-insensitive resolution
const PHASE_VALUE_TO_STAGE_LOWER: Record<string, StageCode> = {};
for (const [key, val] of Object.entries(PHASE_VALUE_TO_STAGE)) {
  PHASE_VALUE_TO_STAGE_LOWER[key.toLowerCase()] = val;
}

/**
 * Resolves any phase string to a StageCode. Case-insensitive.
 * Falls back to S01_FIRST_ASSESSMENT if the phase is not recognized.
 */
export function resolveStageFromPhase(phase: string | null | undefined): StageCode {
  if (!phase) return "S01_FIRST_ASSESSMENT";
  const trimmed = phase.trim();
  return PHASE_VALUE_TO_STAGE_LOWER[trimmed.toLowerCase()] ?? "S01_FIRST_ASSESSMENT";
}

/**
 * Phases where ALL stages should be marked as PROGRESSED (project is complete).
 */
export const FULLY_COMPLETED_PHASES: readonly LifecyclePhase[] = [
  "DLP",
  "Closed",
] as const;

/**
 * All phase values (any casing) where ALL stages should be marked PROGRESSED.
 */
export const FULLY_COMPLETED_PHASE_VALUES: readonly string[] = [
  "DLP",
  "Closed",
  "Gone",
  "Commercial Close Out",
  "Commercial Close out",
  "Closeout",
  "P7_CLOSEOUT_POSTMORTEM",
] as const;

/**
 * Special/parked phase values where we should look up phase history
 * to determine the real last active stage.
 */
export const SPECIAL_PHASES: readonly string[] = [
  "Hold",
  "On Hold",
  "Internal",
  "Gone",
  "HOLD",
  "INTERNAL",
  "GONE",
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

/**
 * Check if a phase value represents a fully-completed project.
 */
export function isFullyCompletedPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return FULLY_COMPLETED_PHASE_VALUES.some(p => p.toLowerCase() === phase.trim().toLowerCase());
}

/**
 * Check if a phase value is a special/parked phase (Hold, Internal, Gone).
 */
export function isSpecialPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return SPECIAL_PHASES.some(p => p.toLowerCase() === phase.trim().toLowerCase());
}
