// ============================================================
// STAGE STATE MACHINE — Gate-driven lifecycle transitions
// ============================================================
// Shared between client and server for validation.
// Every gate is a soft gate — admin can always override.

import type { StageStatus, RequirementStatus, StageCode } from "../schema/stage-lifecycle";
import { SEQUENTIAL_STAGE_CODES, DEPRECATED_STAGE_CODES, TERMINAL_STAGE_CODES } from "../schema/stage-lifecycle";

// Valid state transitions (non-admin) — C6 canonical lowercase_underscore
export const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['ready_for_review', 'blocked'],
  ready_for_review: ['approved', 'in_progress', 'blocked'],
  approved: ['progressed'],
  progressed: [],
  exception_approved: ['in_progress', 'progressed'],
  blocked: ['in_progress', 'exception_approved'],
};

/**
 * Check if a transition is valid.
 * Admin can always override (soft gates).
 */
export function canTransition(from: StageStatus, to: StageStatus, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return (VALID_STAGE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Get the list of valid next states for a given status.
 */
export function getValidNextStates(current: StageStatus, isAdmin: boolean): StageStatus[] {
  if (isAdmin) {
    // Admin can go to any non-current state
    const all: StageStatus[] = ['not_started', 'in_progress', 'ready_for_review', 'approved', 'progressed', 'exception_approved', 'blocked'];
    return all.filter(s => s !== current);
  }
  return VALID_STAGE_TRANSITIONS[current] ?? [];
}

/** Statuses considered "done" for a requirement */
const COMPLETED_STATUSES: RequirementStatus[] = ['complete', 'not_applicable', 'waived'];

/**
 * Compute readiness percentage from requirement statuses.
 * Returns 100 if no requirements exist.
 */
export function computeReadinessPct(requirements: { status: string; blocksGate: boolean }[]): number {
  if (requirements.length === 0) return 100;
  const completed = requirements.filter(r => COMPLETED_STATUSES.includes(r.status as RequirementStatus)).length;
  return Math.round((completed / requirements.length) * 100);
}

/**
 * Check if all gate-blocking requirements are satisfied.
 */
export function areGateBlockersSatisfied(requirements: { status: string; blocksGate: boolean }[]): boolean {
  return requirements
    .filter(r => r.blocksGate)
    .every(r => COMPLETED_STATUSES.includes(r.status as RequirementStatus));
}

/**
 * Get the list of unsatisfied gate-blocking items.
 */
export function getUnsatisfiedBlockers(requirements: { status: string; blocksGate: boolean; itemName: string }[]): string[] {
  return requirements
    .filter(r => r.blocksGate && !COMPLETED_STATUSES.includes(r.status as RequirementStatus))
    .map(r => r.itemName);
}

export interface StatusSentenceInput {
  stageStatus: string;
  readinessPct: number;
  waitingOnDepartment?: string | null;
  waitingOnUserName?: string | null;
  unsatisfiedBlockers: string[];
  openExceptionCount: number;
}

/**
 * Generate "the one sentence that matters" for a project stage.
 */
export function generateStatusSentence(input: StatusSentenceInput): string {
  const { stageStatus, readinessPct, waitingOnDepartment, waitingOnUserName, unsatisfiedBlockers, openExceptionCount } = input;

  if (stageStatus === 'progressed') {
    return 'Stage complete — progressed to next stage.';
  }

  if (stageStatus === 'blocked') {
    if (unsatisfiedBlockers.length > 0) {
      return `Blocked: ${unsatisfiedBlockers.slice(0, 3).join(', ')}${unsatisfiedBlockers.length > 3 ? ` (+${unsatisfiedBlockers.length - 3} more)` : ''}`;
    }
    return 'Blocked — requires resolution before progression.';
  }

  if (stageStatus === 'exception_approved') {
    return `Progressed under approved exception${openExceptionCount > 1 ? ` (${openExceptionCount} open)` : ''}.`;
  }

  if (stageStatus === 'ready_for_review') {
    return 'Ready for approval.';
  }

  if (stageStatus === 'approved') {
    return 'Approved — ready to progress.';
  }

  if (waitingOnDepartment || waitingOnUserName) {
    const who = waitingOnUserName || waitingOnDepartment || 'unknown';
    return `Waiting on: ${who}`;
  }

  if (unsatisfiedBlockers.length > 0) {
    return `Cannot progress because: ${unsatisfiedBlockers.slice(0, 3).join(', ')}${unsatisfiedBlockers.length > 3 ? ` (+${unsatisfiedBlockers.length - 3} more)` : ''}`;
  }

  if (readinessPct === 100) {
    return 'All requirements met — ready for review.';
  }

  return `In progress — ${readinessPct}% complete.`;
}

/**
 * Compute days in stage from started_at timestamp.
 */
export function computeDaysInStage(startedAt: Date | string | null): number {
  if (!startedAt) return 0;
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Stage sequence map for ordering.
 *
 * Deprecated stages (S04 PD-PM Handover, S05 Financial Review) are kept
 * in this map so legacy data still resolves to a number, but they share
 * the sequence of their replacement stage. Terminal branch stages
 * (S_HOLD, S_DONE) are NOT sequential — they get a sentinel value (0)
 * so any caller that accidentally uses this for next-stage maths gets a
 * value that obviously doesn't fit between two real stages. Use
 * SEQUENTIAL_STAGE_CODES / getNextStageCode() for ordered traversal.
 *
 * Display order (after the 2026-04-24 swap):
 *   1 First Assessment
 *   2 Cost Proposal & Design
 *   3 Financial Close
 *   4 Planning
 *   5 Construction
 *   6 Commissioning
 *   7 O&M Handover
 *   8 Client Handover
 *   9 3 Months Post HO Review
 *  10 Compliance Handover
 *   - Hold / Done — terminal branch, no sequence number
 */
export const STAGE_SEQUENCE: Record<StageCode, number> = {
  S01_FIRST_ASSESSMENT: 1,
  S02_DESIGN_COST_PROPOSAL: 2,
  S03_SIGNATURE_FINANCIAL_CLOSE: 3,
  S04_PD_PM_HANDOVER: 3,             // deprecated, merged into S03
  S05_FINANCIAL_REVIEW: 2,           // deprecated, merged into S02
  S04_PLANNING: 4,
  S06_CONSTRUCTION: 5,
  S07_COMMISSIONING: 6,
  S08_OM_HANDOVER: 7,
  S09_CLIENT_HANDOVER: 8,
  S10_POST_HANDOVER_REVIEW: 9,
  S9B_COMPLIANCE_HANDOVER: 10,
  S_HOLD: 0,                          // terminal branch — not sequential
  S_DONE: 0,                          // terminal branch — not sequential
};

/**
 * Active sequential stage list (10 stages after the S03/S04 + S02/S05
 * merge, with Hold/Done excluded as terminal branches).
 */
export const ACTIVE_STAGE_SEQUENCE: ReadonlyArray<StageCode> = SEQUENTIAL_STAGE_CODES;

/**
 * Get the next sequential stage code given the current one. Deprecated
 * stages are first translated to their active replacement before the
 * lookup, so a stale reference to S04 still finds the correct next
 * stage (S06_CONSTRUCTION). Terminal stages (S_HOLD, S_DONE) have no
 * "next" — they are off-flow branches and always return null.
 *
 * Returns null if at the final stage or for any terminal/unknown code.
 */
export function getNextStageCode(current: StageCode): StageCode | null {
  if (TERMINAL_STAGE_CODES.has(current)) return null;
  const active: StageCode = DEPRECATED_STAGE_CODES.has(current)
    ? // S04_PD_PM_HANDOVER -> S03, S05_FINANCIAL_REVIEW -> S02. Inlined
      // to avoid pulling stage-lifecycle helpers into this file.
      (current === 'S04_PD_PM_HANDOVER'
        ? ('S03_SIGNATURE_FINANCIAL_CLOSE' as StageCode)
        : ('S02_DESIGN_COST_PROPOSAL' as StageCode))
    : current;
  const idx = ACTIVE_STAGE_SEQUENCE.indexOf(active);
  if (idx === -1) return null;
  if (idx === ACTIVE_STAGE_SEQUENCE.length - 1) return null;
  return ACTIVE_STAGE_SEQUENCE[idx + 1] ?? null;
}
