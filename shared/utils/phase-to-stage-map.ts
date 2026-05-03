// ============================================================
// Phase-to-Stage Mapping — maps phase values (legacy AND current)
// to the stage code system. Aligned with shared/phases.ts (the
// single source of truth) — keep alias coverage in sync there.
// ============================================================
// Used by the historical projects backfill and lifecycle board
// phase-move handler to determine which stage a project is
// currently in, and to mark all prior stages as PROGRESSED.
// ============================================================

import type { StageCode } from "../schema/stage-lifecycle";
import type { LifecyclePhase } from "../schema/projects";
import { SEQUENTIAL_STAGE_CODES } from "../schema/stage-lifecycle";

/**
 * Maps a legacy LifecyclePhase string to the corresponding StageCode.
 *
 * Hold / Closed now resolve to their terminal branch codes (S_HOLD /
 * S_DONE) so the lifecycle board can render them as first-class stages.
 * Internal / TBC remain represented purely via project_status and have
 * no lifecycle stage of their own — they fall back to S01.
 *
 * After the S03+S04 / S02+S05 merge (migration 20260413_stage_lifecycle_merge):
 *   - "Planning" lands on S04_PLANNING
 *   - PD-PM handover phases land on S03 (Financial Close)
 */
export const PHASE_TO_STAGE: Record<LifecyclePhase, StageCode> = {
  // Canonical (matches shared/phases.ts):
  "First Assessment":           "S01_FIRST_ASSESSMENT",
  "Cost Proposal & Design":     "S02_DESIGN_COST_PROPOSAL",
  "Design & Cost Proposal":     "S02_DESIGN_COST_PROPOSAL",
  "Financial Close":            "S03_SIGNATURE_FINANCIAL_CLOSE",
  "Planning":                   "S04_PLANNING",
  "Construction":               "S06_CONSTRUCTION",
  "Commissioning":              "S07_COMMISSIONING",
  "O&M Handover":               "S08_OM_HANDOVER",
  "Client Handover":            "S09_CLIENT_HANDOVER",
  "3 Months Post HO Review":    "S10_POST_HANDOVER_REVIEW",
  "Compliance Handover":        "S9B_COMPLIANCE_HANDOVER",
  "Post-Handover Review":       "S10_POST_HANDOVER_REVIEW",
  // Legacy labels still tolerated by the type for compile-time compat
  // (these are no longer stored in the DB after migration 20260420):
  "Cost Proposal":          "S02_DESIGN_COST_PROPOSAL",
  "QA":                     "S07_COMMISSIONING",
  "Handover":               "S08_OM_HANDOVER",
  "Commercial Close Out":   "S10_POST_HANDOVER_REVIEW",
  "DLP":                    "S08_OM_HANDOVER",            // DLP is now an in_dlp flag during handover
  "Internal":               "S01_FIRST_ASSESSMENT",       // moved to project_status
  "Hold":                   "S_HOLD",                     // terminal branch
  "Closed":                 "S_DONE",                     // terminal branch
  "Done":                   "S_DONE",
  "TBC":                    "S01_FIRST_ASSESSMENT",       // moved to project_status
};

/**
 * Broad phase-to-stage mapping that handles ALL phase strings:
 *  - Legacy LifecyclePhase values (from Excel tracker)
 *  - Current lifecycle board phaseValues (from PHASE_GROUPS drag-drop)
 *  - Legacy P-code values
 *  - Stage code strings (S01-S10, S_HOLD, S_DONE)
 *
 * Case-sensitive keys — use resolveStageFromPhase() for case-insensitive lookup.
 */
export const PHASE_VALUE_TO_STAGE: Record<string, StageCode> = {
  // --- Legacy LifecyclePhase values ---
  "First Assessment":     "S01_FIRST_ASSESSMENT",
  "Cost Proposal":        "S02_DESIGN_COST_PROPOSAL",
  "Financial Close":      "S03_SIGNATURE_FINANCIAL_CLOSE",
  "Planning":             "S04_PLANNING",
  "Construction":         "S06_CONSTRUCTION",
  "QA":                   "S07_COMMISSIONING",
  "Handover":             "S08_OM_HANDOVER",
  "Compliance Handover":  "S9B_COMPLIANCE_HANDOVER",
  "Commercial Close Out": "S10_POST_HANDOVER_REVIEW",
  "Commercial Close out": "S10_POST_HANDOVER_REVIEW",
  "DLP":                  "S08_OM_HANDOVER",
  "Internal":             "S01_FIRST_ASSESSMENT",
  "Hold":                 "S_HOLD",
  "On Hold":              "S_HOLD",
  "Parked":               "S_HOLD",
  "Closed":               "S_DONE",
  "Done":                 "S_DONE",
  "Gone":                 "S_DONE",
  "TBC":                  "S01_FIRST_ASSESSMENT",

  // --- Current lifecycle board phaseValues (PHASE_GROUPS) ---
  "Cost Proposal & Design":       "S02_DESIGN_COST_PROPOSAL",
  "Design & Cost Proposal":       "S02_DESIGN_COST_PROPOSAL",
  "Signature & Financial Close":  "S03_SIGNATURE_FINANCIAL_CLOSE",
  "PD-PM Handover":               "S03_SIGNATURE_FINANCIAL_CLOSE",  // merged into S03
  "Financial Review":             "S02_DESIGN_COST_PROPOSAL",       // merged into S02
  "Commissioning":                "S07_COMMISSIONING",
  "O&M Handover":                 "S08_OM_HANDOVER",
  "Client Handover":              "S09_CLIENT_HANDOVER",
  "3 Months Post HO Review":      "S10_POST_HANDOVER_REVIEW",
  "Post-Handover Review":         "S10_POST_HANDOVER_REVIEW",
  "Closeout":                     "S10_POST_HANDOVER_REVIEW",

  // --- Legacy P-code values ---
  "P0_FIRST_ASSESSMENT":               "S01_FIRST_ASSESSMENT",
  "P1_COST_PROPOSAL_DESIGN":           "S02_DESIGN_COST_PROPOSAL",
  "P2_PD_PM_HANDOVER":                 "S03_SIGNATURE_FINANCIAL_CLOSE",  // merged into S03
  "P3_DETAILED_DESIGN_PROC_RELEASE":   "S04_PLANNING",                   // legacy planning code
  "P3_PLANNING":                       "S04_PLANNING",
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
  "S04_PLANNING":                      "S04_PLANNING",
  "S06_CONSTRUCTION":                  "S06_CONSTRUCTION",
  "S07_COMMISSIONING":                 "S07_COMMISSIONING",
  "S08_OM_HANDOVER":                   "S08_OM_HANDOVER",
  "S09_CLIENT_HANDOVER":               "S09_CLIENT_HANDOVER",
  "S9B_COMPLIANCE_HANDOVER":           "S9B_COMPLIANCE_HANDOVER",
  "S10_POST_HANDOVER_REVIEW":          "S10_POST_HANDOVER_REVIEW",
  "S_HOLD":                            "S_HOLD",
  "S_DONE":                            "S_DONE",
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
 *
 * Note: Closed projects now live in the terminal Done branch (S_DONE) and
 * Hold projects live in the terminal Hold branch (S_HOLD). DLP remains a
 * flag on top of the O&M Handover lifecycle phase.
 */
export const FULLY_COMPLETED_PHASES: readonly LifecyclePhase[] = [
  "DLP",
  "Closed",
  "Done",
] as const;

/**
 * All phase values (any casing) where ALL stages should be marked PROGRESSED.
 */
export const FULLY_COMPLETED_PHASE_VALUES: readonly string[] = [
  "DLP",
  "Closed",
  "Done",
  "Gone",
  "Commercial Close Out",
  "Commercial Close out",
  "Closeout",
  "P7_CLOSEOUT_POSTMORTEM",
  "S_DONE",
] as const;

/**
 * Special/parked phase values where we should look up phase history
 * to determine the real last active stage. Hold inputs are still treated
 * as special for legacy data, but new code should rely on
 * project_info.previous_phase or the S_HOLD stage instance to reconstruct
 * what the project was working on before being parked.
 */
export const SPECIAL_PHASES: readonly string[] = [
  "Hold",
  "On Hold",
  "Internal",
  "Gone",
  "HOLD",
  "INTERNAL",
  "GONE",
  "S_HOLD",
] as const;

/**
 * Returns the index of a stage code in the SEQUENTIAL_STAGE_CODES array
 * (0-based). Returns -1 for terminal branch codes (S_HOLD, S_DONE) and
 * any deprecated codes that were filtered out of the sequence.
 */
export function stageIndex(code: StageCode): number {
  return SEQUENTIAL_STAGE_CODES.indexOf(code);
}

/**
 * Returns all sequential stage codes that come BEFORE the given stage
 * (i.e. should be PROGRESSED for historical projects). Terminal Hold/Done
 * have no "stages before" and return an empty list.
 */
export function stagesBefore(currentStage: StageCode): StageCode[] {
  const idx = stageIndex(currentStage);
  if (idx < 0) return [];
  return SEQUENTIAL_STAGE_CODES.slice(0, idx) as unknown as StageCode[];
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
