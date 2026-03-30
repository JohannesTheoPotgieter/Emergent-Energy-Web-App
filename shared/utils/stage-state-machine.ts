// ============================================================
// STAGE STATE MACHINE — Gate-driven lifecycle transitions
// ============================================================
// Shared between client and server for validation.
// Every gate is a soft gate — admin can always override.

import type { StageStatus, RequirementStatus, StageCode } from "../schema/stage-lifecycle";

// Valid state transitions (non-admin)
export const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY_FOR_REVIEW', 'BLOCKED'],
  READY_FOR_REVIEW: ['APPROVED', 'IN_PROGRESS', 'BLOCKED'],
  APPROVED: ['PROGRESSED'],
  PROGRESSED: [],
  EXCEPTION_APPROVED: ['IN_PROGRESS', 'PROGRESSED'],
  BLOCKED: ['IN_PROGRESS', 'EXCEPTION_APPROVED'],
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
    const all: StageStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVED', 'PROGRESSED', 'EXCEPTION_APPROVED', 'BLOCKED'];
    return all.filter(s => s !== current);
  }
  return VALID_STAGE_TRANSITIONS[current] ?? [];
}

/** Statuses considered "done" for a requirement */
const COMPLETED_STATUSES: RequirementStatus[] = ['COMPLETE', 'NOT_APPLICABLE', 'WAIVED'];

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

  if (stageStatus === 'PROGRESSED') {
    return 'Stage complete — progressed to next stage.';
  }

  if (stageStatus === 'BLOCKED') {
    if (unsatisfiedBlockers.length > 0) {
      return `Blocked: ${unsatisfiedBlockers.slice(0, 3).join(', ')}${unsatisfiedBlockers.length > 3 ? ` (+${unsatisfiedBlockers.length - 3} more)` : ''}`;
    }
    return 'Blocked — requires resolution before progression.';
  }

  if (stageStatus === 'EXCEPTION_APPROVED') {
    return `Progressed under approved exception${openExceptionCount > 1 ? ` (${openExceptionCount} open)` : ''}.`;
  }

  if (stageStatus === 'READY_FOR_REVIEW') {
    return 'Ready for approval.';
  }

  if (stageStatus === 'APPROVED') {
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
 */
export const STAGE_SEQUENCE: Record<StageCode, number> = {
  S01_FIRST_ASSESSMENT: 1,
  S02_DESIGN_COST_PROPOSAL: 2,
  S03_SIGNATURE_FINANCIAL_CLOSE: 3,
  S04_PD_PM_HANDOVER: 4,
  S05_FINANCIAL_REVIEW: 5,
  S06_CONSTRUCTION: 6,
  S07_COMMISSIONING: 7,
  S08_OM_HANDOVER: 8,
  S09_CLIENT_HANDOVER: 9,
  S10_POST_HANDOVER_REVIEW: 10,
};

/**
 * Get the next stage code given the current one.
 * Returns null if at the final stage.
 */
export function getNextStageCode(current: StageCode): StageCode | null {
  const seq = STAGE_SEQUENCE[current];
  const codes = Object.entries(STAGE_SEQUENCE) as [StageCode, number][];
  const next = codes.find(([, s]) => s === seq + 1);
  return next ? next[0] : null;
}
