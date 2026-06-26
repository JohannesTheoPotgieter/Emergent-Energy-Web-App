// ============================================================
// CANONICAL PHASE CYCLE — single source of truth for the
// company-wide project lifecycle.
// ============================================================
// Established 2026-04-20 (migration 20260420_canonical_phase_cycle.sql).
// Updated 2026-04-24 (migration 0030_canonical_lifecycle_phases_v2.sql):
//   - Renamed "Design & Cost Proposal" -> "Cost Proposal & Design"
//   - Renamed "Post-Handover Review"   -> "3 Months Post HO Review"
//   - Swapped order so 3 Months Post HO Review sits at position 9
//     and Compliance Handover sits at position 10 (final review of the
//     project happens *after* compliance is signed off).
//   - Added two terminal "branch" phases: Hold (resumable) and Done.
//
// Every screen, importer, report, and route should derive its phase
// metadata from this module. Legacy constants in shared/schema/projects.ts
// (LIFECYCLE_PHASES, PROJECT_PHASES, PROJECT_PHASE_LABELS, etc.) are
// kept as deprecated shims for incremental migration.
// ============================================================

import type { StageCode } from "./schema/stage-lifecycle";

export interface CanonicalPhase {
  /** Immutable DB stage_code (preserved for historical references). */
  readonly code: StageCode;
  /** Human-facing label shown everywhere in the UI. */
  readonly label: string;
  /** 1..10 display position the user sees. `null` for terminal/branch
   *  phases (Hold/Done) which are not part of the sequential flow. */
  readonly displayNumber: number | null;
  /** Default owning role for this phase. `null` for terminal phases. */
  readonly ownerRole: 'PD' | 'ENGINEERING' | 'PM' | null;
  /** Whether this phase is part of the post-construction handover band
   *  (used by the in-DLP RAG-red rule). */
  readonly isHandover: boolean;
  /** Sequential phases participate in next/prev/order logic. Terminal
   *  branch phases (Hold/Done) are not sequential. */
  readonly isSequential: boolean;
  /** Terminal phases finish the lifecycle. Done is permanent; Hold is
   *  resumable (the prior sequential phase is preserved on the project
   *  so it can pick up where it left off). */
  readonly isTerminal: boolean;
}

/** The 10 active sequential phases plus 2 terminal branch phases of the
 *  canonical company lifecycle. The first 10 entries (indices 0..9) are
 *  the sequential lifecycle in display order. The last two (Hold, Done)
 *  are terminal "branch" phases that sit alongside the sequence and are
 *  rendered separately in UIs. Codes are intentionally kept as the
 *  existing DB stage_code values so that every historical reference
 *  (project_stage_decisions, evidence snapshots, etc.) keeps resolving
 *  correctly. */
export const PHASES: ReadonlyArray<CanonicalPhase> = [
  { code: 'S01_FIRST_ASSESSMENT',          label: 'First Assessment',         displayNumber: 1,    ownerRole: 'PD',          isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S02_DESIGN_COST_PROPOSAL',      label: 'Cost Proposal & Design',   displayNumber: 2,    ownerRole: 'ENGINEERING', isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S03_SIGNATURE_FINANCIAL_CLOSE', label: 'Financial Close',          displayNumber: 3,    ownerRole: 'PD',          isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S04_PLANNING',                  label: 'Planning',                 displayNumber: 4,    ownerRole: 'PM',          isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S06_CONSTRUCTION',              label: 'Construction',             displayNumber: 5,    ownerRole: 'PM',          isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S07_COMMISSIONING',             label: 'Commissioning & QA',       displayNumber: 6,    ownerRole: 'ENGINEERING', isHandover: false, isSequential: true,  isTerminal: false },
  { code: 'S08_OM_HANDOVER',               label: 'O&M Handover',             displayNumber: 7,    ownerRole: 'PM',          isHandover: true,  isSequential: true,  isTerminal: false },
  { code: 'S09_CLIENT_HANDOVER',           label: 'Client Handover',          displayNumber: 8,    ownerRole: 'PM',          isHandover: true,  isSequential: true,  isTerminal: false },
  { code: 'S10_POST_HANDOVER_REVIEW',      label: '3 Months Post HO Review',  displayNumber: 9,    ownerRole: 'PM',          isHandover: true,  isSequential: true,  isTerminal: false },
  { code: 'S9B_COMPLIANCE_HANDOVER',       label: 'Compliance Handover',      displayNumber: 10,   ownerRole: 'PM',          isHandover: true,  isSequential: true,  isTerminal: false },
  // Terminal "branch" phases — not numbered, not part of next/prev.
  { code: 'S_HOLD',                        label: 'Hold',                     displayNumber: null, ownerRole: null,          isHandover: false, isSequential: false, isTerminal: true  },
  { code: 'S_DONE',                        label: 'Done',                     displayNumber: null, ownerRole: null,          isHandover: false, isSequential: false, isTerminal: true  },
] as const;

/** Convenience alias used in iteration sites that expect "active" phases.
 *  Currently identical to PHASES — non-active codes (deprecated S04_PD_PM_HANDOVER,
 *  S05_FINANCIAL_REVIEW) are not exposed here and must come from the
 *  stage-lifecycle module if a caller really needs them. */
export const ACTIVE_PHASES: ReadonlyArray<CanonicalPhase> = PHASES;

/** Just the 10 sequential phases in display order. Use this for any
 *  ordered UI (progress steppers, lifecycle boards, default kanban
 *  columns) so terminal Hold/Done don't appear inline with the sequence. */
export const SEQUENTIAL_PHASES: ReadonlyArray<CanonicalPhase> =
  PHASES.filter((p) => p.isSequential);

/** Just the terminal branch phases (Hold, Done). Use these when rendering
 *  off-flow buckets next to the sequential board. */
export const TERMINAL_PHASES: ReadonlyArray<CanonicalPhase> =
  PHASES.filter((p) => p.isTerminal);

/** All canonical phase labels (sequential then terminal). */
export const PHASE_LABELS: ReadonlyArray<string> = PHASES.map((p) => p.label);

/** All canonical stage codes (sequential then terminal). */
export const PHASE_CODES: ReadonlyArray<StageCode> = PHASES.map((p) => p.code);

/** Just the sequential phase codes in display order. */
export const SEQUENTIAL_PHASE_CODES: ReadonlyArray<StageCode> =
  SEQUENTIAL_PHASES.map((p) => p.code);

/** Just the terminal phase codes. */
export const TERMINAL_PHASE_CODES: ReadonlyArray<StageCode> =
  TERMINAL_PHASES.map((p) => p.code);

/** Canonical phase by stage code. */
export const PHASE_BY_CODE: Readonly<Record<string, CanonicalPhase>> =
  Object.fromEntries(PHASES.map((p) => [p.code, p]));

/** Canonical phase by exact label (case-sensitive). */
export const PHASE_BY_LABEL: Readonly<Record<string, CanonicalPhase>> =
  Object.fromEntries(PHASES.map((p) => [p.label, p]));

/** Canonical phase by lowercased label (for case-insensitive lookup). */
const PHASE_BY_LABEL_LC: Readonly<Record<string, CanonicalPhase>> =
  Object.fromEntries(PHASES.map((p) => [p.label.toLowerCase(), p]));

/** Aliases for legacy / tolerated input strings. Kept in sync with the
 *  stage_code_aliases table seeded by 20260420_canonical_phase_cycle.sql
 *  and extended by 0030_canonical_lifecycle_phases_v2.sql.
 *  Any string not in this map (case-insensitive) AND not a canonical
 *  label/code returns null from `resolveCanonicalPhase`. */
const PHASE_ALIASES: Readonly<Record<string, StageCode>> = {
  // Renamed canonical labels (kept as aliases for legacy input)
  'design & cost proposal':       'S02_DESIGN_COST_PROPOSAL',
  'design and cost proposal':     'S02_DESIGN_COST_PROPOSAL',
  'cost proposal':                'S02_DESIGN_COST_PROPOSAL',
  'cost proposal and design':     'S02_DESIGN_COST_PROPOSAL',
  'cost proposal/design':         'S02_DESIGN_COST_PROPOSAL',
  'post-handover review':         'S10_POST_HANDOVER_REVIEW',
  'post handover review':         'S10_POST_HANDOVER_REVIEW',
  '3 months post ho review':      'S10_POST_HANDOVER_REVIEW',
  '3 month post ho review':       'S10_POST_HANDOVER_REVIEW',
  'three months post ho review':  'S10_POST_HANDOVER_REVIEW',
  // Legacy LifecyclePhase labels that no longer match a canonical label
  'signature & financial close':  'S03_SIGNATURE_FINANCIAL_CLOSE',
  'pd-pm handover':               'S03_SIGNATURE_FINANCIAL_CLOSE',
  'financial review':             'S02_DESIGN_COST_PROPOSAL',
  'qa':                           'S07_COMMISSIONING',
  // 2026-05-08 — S07 label was renamed 'Commissioning' → 'Commissioning & QA'.
  // Keep the legacy short string as an alias for backwards compat.
  'commissioning':                'S07_COMMISSIONING',
  'handover':                     'S08_OM_HANDOVER',
  'om handover':                  'S08_OM_HANDOVER',
  'commercial close out':         'S10_POST_HANDOVER_REVIEW',
  'commercial close-out':         'S10_POST_HANDOVER_REVIEW',
  'closeout':                     'S10_POST_HANDOVER_REVIEW',
  'close-out':                    'S10_POST_HANDOVER_REVIEW',
  // Terminal branch aliases
  'hold':                         'S_HOLD',
  'on hold':                      'S_HOLD',
  'on-hold':                      'S_HOLD',
  'parked':                       'S_HOLD',
  'done':                         'S_DONE',
  'closed':                       'S_DONE',
  'gone':                         'S_DONE',
  'complete':                     'S_DONE',
  'completed':                    'S_DONE',
  'cancelled':                    'S_DONE',
  'canceled':                     'S_DONE',
  // Deprecated stage codes -> active replacements
  's04_pd_pm_handover':           'S03_SIGNATURE_FINANCIAL_CLOSE',
  's05_financial_review':         'S02_DESIGN_COST_PROPOSAL',
  // Legacy P-codes from the import era
  'p0_first_assessment':              'S01_FIRST_ASSESSMENT',
  'p1_cost_proposal':                 'S02_DESIGN_COST_PROPOSAL',
  'p1_cost_proposal_design':          'S02_DESIGN_COST_PROPOSAL',
  'p2_pd_pm_handover':                'S03_SIGNATURE_FINANCIAL_CLOSE',
  'p2_financial_close':               'S03_SIGNATURE_FINANCIAL_CLOSE',
  'p3_planning':                      'S04_PLANNING',
  'p3_detailed_design_proc_release':  'S04_PLANNING',
  'p3_financial_close':               'S03_SIGNATURE_FINANCIAL_CLOSE',
  'p4_construction_installation':     'S06_CONSTRUCTION',
  'p5_commissioning':                 'S07_COMMISSIONING',
  'p5_commissioning_qa':              'S07_COMMISSIONING',
  'p5_commissioning_testing':         'S07_COMMISSIONING',
  'p6_handover':                      'S08_OM_HANDOVER',
  'p6_handover_dlp':                  'S08_OM_HANDOVER',
  'p6_handover_client_matriarch':     'S08_OM_HANDOVER',
  'p7_post_handover':                 'S10_POST_HANDOVER_REVIEW',
  'p7_closeout_postmortem':           'S10_POST_HANDOVER_REVIEW',
};

/**
 * Resolve any phase label / stage code / legacy code to a canonical phase.
 * Returns null for unrecognised input. Hold/Done resolve to their terminal
 * branch phases; legacy "On Hold"/"Closed"/"Gone" inputs likewise route to
 * the terminal branches rather than to a sequential phase.
 */
export function resolveCanonicalPhase(input: string | null | undefined): CanonicalPhase | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Direct canonical hits (case-insensitive).
  const directLabel = PHASE_BY_LABEL_LC[trimmed.toLowerCase()];
  if (directLabel) return directLabel;
  const directCode = PHASE_BY_CODE[trimmed];
  if (directCode) return directCode;
  const directCodeUc = PHASE_BY_CODE[trimmed.toUpperCase()];
  if (directCodeUc) return directCodeUc;
  // Aliases (case-insensitive).
  const aliased = PHASE_ALIASES[trimmed.toLowerCase()];
  if (aliased) return PHASE_BY_CODE[aliased] ?? null;
  return null;
}

/** Strict variant — returns the canonical code or throws. */
export function resolveCanonicalCode(input: string | null | undefined): StageCode {
  const phase = resolveCanonicalPhase(input);
  if (!phase) {
    throw new Error(
      `Unrecognised phase input: ${JSON.stringify(input)}. ` +
      `Internal/TBC are project_status values; DLP is the in_dlp flag. ` +
      `Hold/Done/Closed/Gone resolve to the terminal Hold/Done branch phases.`,
    );
  }
  return phase.code;
}

/** Loose variant — returns the canonical code or undefined. */
export function tryResolveCanonicalCode(input: string | null | undefined): StageCode | undefined {
  return resolveCanonicalPhase(input)?.code;
}

/** Display label for a stage code, or the code itself if unknown. */
export function phaseLabel(code: string | null | undefined): string {
  if (!code) return '';
  return PHASE_BY_CODE[code]?.label ?? code;
}

/** Get the phase that comes after the given one in the canonical sequence.
 *  Terminal phases (Hold/Done) and stages outside the sequential set return
 *  null. */
export function nextPhase(code: StageCode): CanonicalPhase | null {
  const idx = SEQUENTIAL_PHASES.findIndex((p) => p.code === code);
  if (idx < 0 || idx >= SEQUENTIAL_PHASES.length - 1) return null;
  return SEQUENTIAL_PHASES[idx + 1] ?? null;
}

/** Get the phase that comes before the given one in the sequential
 *  cycle. Returns null at the start of the cycle and for non-sequential
 *  (terminal) phases. */
export function prevPhase(code: StageCode): CanonicalPhase | null {
  const idx = SEQUENTIAL_PHASES.findIndex((p) => p.code === code);
  if (idx <= 0) return null;
  return SEQUENTIAL_PHASES[idx - 1] ?? null;
}

/** True if this stage code is one of the post-construction handover phases
 *  (S07, S08, S09, S10, S9B). Used by the in-DLP RAG-red rule. Terminal
 *  Hold/Done phases are never handover phases. */
export function isHandoverPhase(code: string | null | undefined): boolean {
  if (!code) return false;
  return PHASE_BY_CODE[code]?.isHandover ?? false;
}

/** True if the given code is a sequential lifecycle phase (i.e. one of
 *  the 10 ordered phases, not a terminal branch). */
export function isSequentialPhase(code: string | null | undefined): boolean {
  if (!code) return false;
  return PHASE_BY_CODE[code]?.isSequential ?? false;
}

/** True if the given code is a terminal branch phase (Hold or Done). */
export function isTerminalPhase(code: string | null | undefined): boolean {
  if (!code) return false;
  return PHASE_BY_CODE[code]?.isTerminal ?? false;
}

/**
 * True if a project (given its phase stage-code or label) is in the active
 * execution window: from Financial Close (`S03_SIGNATURE_FINANCIAL_CLOSE`,
 * displayNumber 3) onward, INCLUDING `S_HOLD` (resumable, still live work),
 * but EXCLUDING `S_DONE` and the two pre-Financial-Close stages
 * (First Assessment, Cost Proposal & Design). Unrecognised / empty input
 * returns false.
 *
 * Accepts canonical codes, canonical labels, or tolerated aliases (anything
 * `resolveCanonicalPhase` understands). Used to scope project pickers to
 * live delivery work.
 */
export function isInActiveExecutionWindow(stageOrLabel: string | null | undefined): boolean {
  const phase = resolveCanonicalPhase(stageOrLabel);
  if (!phase) return false;
  if (phase.code === 'S_DONE') return false;
  if (phase.code === 'S_HOLD') return true;
  // Sequential phases: in-window from Financial Close (displayNumber 3) onward.
  return phase.isSequential && phase.displayNumber != null && phase.displayNumber >= 3;
}

// ===================== PROJECT STATUS =====================
// Hold / Internal / Closed / TBC remain on project_info.project_status as
// an orthogonal dimension (kept for backward compatibility — Hold and
// Closed now have a corresponding terminal phase that the lifecycle UI
// renders directly).

export const PROJECT_STATUSES = ['active', 'hold', 'internal', 'closed', 'tbc'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  active:   'Active',
  hold:     'On Hold',
  internal: 'Internal',
  closed:   'Closed',
  tbc:      'TBC',
};

/** Resolve a free-text status input (e.g. from importers) to a canonical
 *  ProjectStatus, or null if it doesn't look like a status string. */
export function resolveProjectStatus(input: string | null | undefined): ProjectStatus | null {
  if (!input) return null;
  const lc = input.trim().toLowerCase();
  if (lc === 'active' || lc === '' ) return 'active';
  if (lc === 'hold' || lc === 'on hold' || lc === 'on-hold' || lc === 'parked') return 'hold';
  if (lc === 'internal') return 'internal';
  if (lc === 'closed' || lc === 'gone' || lc === 'done' || lc === 'cancelled' || lc === 'canceled' || lc === 'complete' || lc === 'completed') return 'closed';
  if (lc === 'tbc' || lc === 'unknown') return 'tbc';
  return null;
}

// ===================== TERMINAL BRANCH HELPERS =====================

/** The terminal stage code that corresponds to a project status, if any.
 *  - 'hold'   -> S_HOLD (resumable terminal)
 *  - 'closed' -> S_DONE (permanent terminal)
 *  - others   -> null (no dedicated terminal phase)
 */
export function terminalCodeForStatus(status: ProjectStatus | null | undefined): StageCode | null {
  if (status === 'hold') return 'S_HOLD';
  if (status === 'closed') return 'S_DONE';
  return null;
}
