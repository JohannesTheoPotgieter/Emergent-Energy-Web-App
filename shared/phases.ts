// ============================================================
// CANONICAL PHASE CYCLE — single source of truth for the
// company-wide 10-stage project lifecycle.
// ============================================================
// Established 2026-04-20 (migration 20260420_canonical_phase_cycle.sql).
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
  /** 1..10 display position the user sees. */
  readonly displayNumber: number;
  /** Default owning role for this phase. */
  readonly ownerRole: 'PD' | 'ENGINEERING' | 'PM';
  /** Whether this phase is part of the post-construction handover band
   *  (used by the in-DLP RAG-red rule). */
  readonly isHandover: boolean;
}

/** The 10 active phases of the canonical company lifecycle. Order is the
 *  display order; index 0 is First Assessment, index 9 is Post-Handover Review.
 *  Codes are intentionally kept as the existing DB stage_code values so that
 *  every historical reference (project_stage_decisions, evidence snapshots,
 *  etc.) keeps resolving correctly. */
export const PHASES: ReadonlyArray<CanonicalPhase> = [
  { code: 'S01_FIRST_ASSESSMENT',          label: 'First Assessment',       displayNumber: 1,  ownerRole: 'PD',          isHandover: false },
  { code: 'S02_DESIGN_COST_PROPOSAL',      label: 'Design & Cost Proposal', displayNumber: 2,  ownerRole: 'ENGINEERING', isHandover: false },
  { code: 'S03_SIGNATURE_FINANCIAL_CLOSE', label: 'Financial Close',        displayNumber: 3,  ownerRole: 'PD',          isHandover: false },
  { code: 'S04_PLANNING',                  label: 'Planning',               displayNumber: 4,  ownerRole: 'PM',          isHandover: false },
  { code: 'S06_CONSTRUCTION',              label: 'Construction',           displayNumber: 5,  ownerRole: 'PM',          isHandover: false },
  { code: 'S07_COMMISSIONING',             label: 'Commissioning',          displayNumber: 6,  ownerRole: 'ENGINEERING', isHandover: false },
  { code: 'S08_OM_HANDOVER',               label: 'O&M Handover',           displayNumber: 7,  ownerRole: 'PM',          isHandover: true  },
  { code: 'S09_CLIENT_HANDOVER',           label: 'Client Handover',        displayNumber: 8,  ownerRole: 'PM',          isHandover: true  },
  { code: 'S9B_COMPLIANCE_HANDOVER',       label: 'Compliance Handover',    displayNumber: 9,  ownerRole: 'PM',          isHandover: true  },
  { code: 'S10_POST_HANDOVER_REVIEW',      label: 'Post-Handover Review',   displayNumber: 10, ownerRole: 'PM',          isHandover: true  },
] as const;

/** Convenience alias used in iteration sites that expect "active" phases.
 *  Currently identical to PHASES — non-active codes (deprecated S04_PD_PM_HANDOVER,
 *  S05_FINANCIAL_REVIEW) are not exposed here and must come from the
 *  stage-lifecycle module if a caller really needs them. */
export const ACTIVE_PHASES: ReadonlyArray<CanonicalPhase> = PHASES;

/** All canonical phase labels in display order. */
export const PHASE_LABELS: ReadonlyArray<string> = PHASES.map((p) => p.label);

/** All canonical stage codes in display order. */
export const PHASE_CODES: ReadonlyArray<StageCode> = PHASES.map((p) => p.code);

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
 *  stage_code_aliases table seeded by 20260420_canonical_phase_cycle.sql.
 *  Any string not in this map (case-insensitive) AND not a canonical
 *  label/code returns null from `resolveCanonicalPhase`. */
const PHASE_ALIASES: Readonly<Record<string, StageCode>> = {
  // Legacy LifecyclePhase labels that no longer match a canonical label
  'cost proposal':                'S02_DESIGN_COST_PROPOSAL',
  'design and cost proposal':     'S02_DESIGN_COST_PROPOSAL',
  'signature & financial close':  'S03_SIGNATURE_FINANCIAL_CLOSE',
  'pd-pm handover':               'S03_SIGNATURE_FINANCIAL_CLOSE',
  'financial review':             'S02_DESIGN_COST_PROPOSAL',
  'qa':                           'S07_COMMISSIONING',
  'handover':                     'S08_OM_HANDOVER',
  'om handover':                  'S08_OM_HANDOVER',
  'commercial close out':         'S10_POST_HANDOVER_REVIEW',
  'commercial close-out':         'S10_POST_HANDOVER_REVIEW',
  'closeout':                     'S10_POST_HANDOVER_REVIEW',
  'close-out':                    'S10_POST_HANDOVER_REVIEW',
  'post handover review':         'S10_POST_HANDOVER_REVIEW',
  'post-handover review':         'S10_POST_HANDOVER_REVIEW',
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
  // Removed-from-lifecycle states (now lives on project_status / in_dlp).
  // We intentionally DO NOT alias these to a phase — callers should read
  // project_status / in_dlp instead. Returning null forces the migration.
};

/**
 * Resolve any phase label / stage code / legacy code to a canonical phase.
 * Returns null for unrecognised input or for input that has been moved off
 * the lifecycle (Hold / Internal / Closed / TBC / DLP).
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
      `Unrecognised or off-lifecycle phase input: ${JSON.stringify(input)}. ` +
      `Hold/Internal/Closed/TBC are project_status values; DLP is the in_dlp flag.`,
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

/** Get the phase that comes after the given one in the canonical sequence. */
export function nextPhase(code: StageCode): CanonicalPhase | null {
  const idx = PHASES.findIndex((p) => p.code === code);
  if (idx < 0 || idx >= PHASES.length - 1) return null;
  return PHASES[idx + 1] ?? null;
}

/** Get the phase that comes before the given one. */
export function prevPhase(code: StageCode): CanonicalPhase | null {
  const idx = PHASES.findIndex((p) => p.code === code);
  if (idx <= 0) return null;
  return PHASES[idx - 1] ?? null;
}

/** True if this stage code is one of the post-construction handover phases
 *  (S07, S08, S9B, S10). Used by the in-DLP RAG-red rule. */
export function isHandoverPhase(code: string | null | undefined): boolean {
  if (!code) return false;
  return PHASE_BY_CODE[code]?.isHandover ?? false;
}

// ===================== PROJECT STATUS =====================
// Hold / Internal / Closed / TBC are no longer phases — they live on
// project_info.project_status as a separate orthogonal dimension.

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
  if (lc === 'hold' || lc === 'on hold' || lc === 'on-hold') return 'hold';
  if (lc === 'internal') return 'internal';
  if (lc === 'closed' || lc === 'gone') return 'closed';
  if (lc === 'tbc' || lc === 'unknown') return 'tbc';
  return null;
}
