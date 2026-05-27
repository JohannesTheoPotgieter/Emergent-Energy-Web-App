/**
 * PR-B redesign — /now "what's on fire?" derivation.
 *
 * Pins the rule set so future drift fails CI. The COO's daily
 * question on /now is answered by `computeFireList`; if the rule
 * silently changes, projects either disappear from the list or
 * appear with the wrong urgency.
 */

import { describe, expect, it } from 'vitest';
import {
  computeFireList,
  computeBehindDays,
} from '../../../client/src/pages/now-fire-list';
import type { ExecutionDashboardProject } from '../../../client/src/lib/execution-dashboard';

function project(overrides: Partial<ExecutionDashboardProject>): ExecutionDashboardProject {
  return {
    projectId: 1,
    projectName: 'Test',
    portfolio: 'C&I',
    pm: 'PM',
    pd: 'PD',
    executionPhase: 'Construction',
    rag: 'Green',
    actualProgressPct: 50,
    expectedProgressPct: 50,
    scheduleVariancePct: 0,
    plannedRevenueFy: 0,
    receivedInflowFy: 0,
    openInflowFy: 0,
    plannedExpenditureFy: 0,
    paidExpenditureFy: 0,
    openExpenditureFy: 0,
    grossProfitFy: 0,
    grossMarginPctFy: null,
    engineeringStatus: 'On Track',
    qualityStatus: 'On Track',
    importFreshness: 'Fresh',
    importAgeDays: null,
    behindPlan: false,
    inflowRisk: false,
    outflowRisk: false,
    engineeringBlockerCount: 0,
    openQualityWarningCount: 0,
    pendingApprovalCount: 0,
    criticalActionCount: 0,
    overdueInflowFy: 0,
    overdueOutflowFy: 0,
    plannedRevenueMonth: 0,
    realisedRevenueMonth: 0,
    openRevenueMonth: 0,
    plannedCosMonth: 0,
    realisedCosMonth: 0,
    openCosMonth: 0,
    inflowsWeek: 0,
    outflowsWeek: 0,
    cpSigned: false,
    signedStatus: 'PENDING',
    ...overrides,
  };
}

describe('/now — computeBehindDays', () => {
  it('returns null when either progress field is missing', () => {
    expect(computeBehindDays(project({ actualProgressPct: null }))).toBeNull();
    expect(computeBehindDays(project({ expectedProgressPct: null }))).toBeNull();
  });

  it('returns null when project is on or ahead of schedule', () => {
    expect(computeBehindDays(project({ actualProgressPct: 50, expectedProgressPct: 50 }))).toBeNull();
    expect(computeBehindDays(project({ actualProgressPct: 60, expectedProgressPct: 50 }))).toBeNull();
  });

  it('returns the rounded percentage-point gap when behind', () => {
    expect(computeBehindDays(project({ actualProgressPct: 40, expectedProgressPct: 50 }))).toBe(10);
    expect(computeBehindDays(project({ actualProgressPct: 35.4, expectedProgressPct: 50 }))).toBe(15);
  });
});

describe('/now — computeFireList', () => {
  it('returns empty when nothing is on fire', () => {
    const list = computeFireList([
      project({ projectId: 1 }),
      project({ projectId: 2 }),
    ]);
    expect(list).toEqual([]);
  });

  it('flags RAG=Red projects as critical', () => {
    const list = computeFireList([project({ projectId: 1, rag: 'Red' })]);
    expect(list).toHaveLength(1);
    expect(list[0].reasons[0]).toMatchObject({ label: 'RAG red', level: 'critical' });
  });

  it('flags 10+ days behind as critical, < 10 as warning', () => {
    const list = computeFireList([
      project({ projectId: 1, actualProgressPct: 40, expectedProgressPct: 60, behindPlan: true }),
      project({ projectId: 2, actualProgressPct: 47, expectedProgressPct: 50, behindPlan: true }),
    ]);
    const byId = new Map(list.map((f) => [f.project.projectId, f]));
    expect(byId.get(1)?.reasons[0]).toMatchObject({ label: '20d behind', level: 'critical' });
    expect(byId.get(2)?.reasons[0]).toMatchObject({ label: 'behind plan', level: 'warning' });
  });

  it('flags overdue receivables / payables', () => {
    const list = computeFireList([
      project({ projectId: 1, overdueInflowFy: 1_000_000 }),
      project({ projectId: 2, overdueOutflowFy: 500_000 }),
    ]);
    expect(list).toHaveLength(2);
    for (const f of list) {
      expect(f.reasons[0].label).toMatch(/overdue/);
      expect(f.reasons[0].level).toBe('critical');
    }
  });

  it('flags engineering / quality blocked status', () => {
    const list = computeFireList([
      project({ projectId: 1, engineeringStatus: 'Blocked' }),
      project({ projectId: 2, qualityStatus: 'Blocked' }),
    ]);
    expect(list[0].reasons[0]).toMatchObject({ label: 'engineering blocked', level: 'critical' });
    expect(list[1].reasons[0]).toMatchObject({ label: 'quality blocked', level: 'critical' });
  });

  it('flags 5+ pending approvals as warning', () => {
    const list = computeFireList([
      project({ projectId: 1, pendingApprovalCount: 4 }), // not on fire
      project({ projectId: 2, pendingApprovalCount: 6 }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].project.projectId).toBe(2);
    expect(list[0].reasons[0]).toMatchObject({ label: '6 pending approvals', level: 'warning' });
  });

  it('sorts by severity score descending', () => {
    const list = computeFireList([
      project({ projectId: 1, pendingApprovalCount: 6 }), // score 20
      project({ projectId: 2, rag: 'Red', overdueInflowFy: 5_000_000 }), // score 100+60
      project({ projectId: 3, qualityStatus: 'Blocked' }), // score 50
    ]);
    expect(list.map((f) => f.project.projectId)).toEqual([2, 3, 1]);
  });

  it('collapses multiple reasons in severity order', () => {
    const list = computeFireList([
      project({
        projectId: 1,
        rag: 'Red',
        overdueInflowFy: 1_000_000,
        engineeringStatus: 'Blocked',
        pendingApprovalCount: 7,
      }),
    ]);
    expect(list[0].reasons.length).toBe(4);
    // Headline reason is the highest-score signal (RAG red, score 100).
    expect(list[0].reasons[0].label).toBe('RAG red');
  });
});
