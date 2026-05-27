/**
 * PR-D redesign — portfolio lens derivation.
 *
 * The portfolio page has a single rightmost column whose meaning
 * changes with the lens (Delivery / Revenue / Cost / Quality). The
 * rules live in client/src/pages/portfolio-lens.ts and this test
 * locks them down. Future drift fails CI.
 */

import { describe, expect, it } from 'vitest';
import {
  computeLensSummary,
  computePortfolioRow,
  PORTFOLIO_LENSES,
  PORTFOLIO_STATE_FILTERS,
  LENS_LABELS,
  STATE_LABELS,
} from '../../../client/src/pages/portfolio-lens';
import type { ProjectSummary } from '../../../client/src/lib/api';

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    project_info_id: 1,
    project_name: 'Test_Project_Tracker_abc',
    size_kwp: 1000,
    pd: 'PD',
    pm: 'PM',
    phase: 'Construction',
    project_pct_complete: 0.5,
    expected_pct_complete: 0.5,
    delta_vs_expected: 0,
    total_contract_revenue: 0,
    actual_revenue: 0,
    total_expenses: 0,
    actual_expenses: 0,
    gp_percent: null,
    revenue_outstanding: 0,
    expenses_outstanding: 0,
    current_vo_total: 0,
    ...overrides,
  } as ProjectSummary;
}

describe('portfolio-lens — public surface', () => {
  it('lens + state enums have stable labels', () => {
    expect(PORTFOLIO_LENSES).toEqual(['delivery', 'revenue', 'cost', 'quality']);
    expect(PORTFOLIO_STATE_FILTERS).toEqual(['active', 'mine', 'behind', 'missing_fc', 'archived']);
    for (const l of PORTFOLIO_LENSES) expect(LENS_LABELS[l]).toBeTruthy();
    for (const s of PORTFOLIO_STATE_FILTERS) expect(STATE_LABELS[s]).toBeTruthy();
  });
});

describe('computePortfolioRow', () => {
  it('strips _Tracker suffix and underscores from the project name', () => {
    const r = computePortfolioRow(project({ project_name: 'Mondi_Solar_Tracker_2026' }), 'delivery');
    expect(r.projectName).toBe('Mondi Solar');
  });

  it('falls back to execution_phase when phase is null', () => {
    const r = computePortfolioRow(project({ phase: null, execution_phase: 'Commissioning' as any }), 'delivery');
    expect(r.phase).toBe('Commissioning');
  });

  it('derives RAG from delta_vs_expected when rag_status is absent', () => {
    expect(computePortfolioRow(project({ delta_vs_expected: -0.15 }), 'delivery').rag).toBe('RED');
    expect(computePortfolioRow(project({ delta_vs_expected: -0.07 }), 'delivery').rag).toBe('AMBER');
    expect(computePortfolioRow(project({ delta_vs_expected: 0 }), 'delivery').rag).toBe('GREEN');
    expect(computePortfolioRow(project({ delta_vs_expected: null as any }), 'delivery').rag).toBeNull();
  });

  it('returns null pctComplete when project_pct_complete is null (no zeroing)', () => {
    const r = computePortfolioRow(project({ project_pct_complete: null }), 'delivery');
    expect(r.pctComplete).toBeNull();
  });
});

describe('delivery lens', () => {
  it('flags critical when ≥10pp behind', () => {
    const s = computeLensSummary(project({ delta_vs_expected: -0.15 }), 'delivery');
    expect(s.badges[0]).toMatchObject({ label: '15d behind', level: 'critical' });
  });

  it('flags warning when 5–10pp behind', () => {
    const s = computeLensSummary(project({ delta_vs_expected: -0.07 }), 'delivery');
    expect(s.badges[0]).toMatchObject({ label: '7d behind', level: 'warning' });
  });

  it('marks ahead when ≥5pp ahead', () => {
    const s = computeLensSummary(project({ delta_vs_expected: 0.07 }), 'delivery');
    expect(s.badges[0]).toMatchObject({ label: '7d ahead', level: 'healthy' });
  });

  it('says "on track" when within ±5pp', () => {
    const s = computeLensSummary(project({ delta_vs_expected: 0 }), 'delivery');
    expect(s.badges).toEqual([]);
    expect(s.text).toBe('on track');
  });

  it('says "no schedule data" when both completion fields are null', () => {
    const s = computeLensSummary(
      project({ project_pct_complete: null, expected_pct_complete: null, delta_vs_expected: null as any }),
      'delivery',
    );
    expect(s.text).toBe('no schedule data');
  });
});

describe('revenue lens', () => {
  it('shows "no revenue data" when planned and actual are both 0', () => {
    const s = computeLensSummary(project(), 'revenue');
    expect(s.text).toBe('no revenue data');
  });

  it('flags healthy at ≥90% billed', () => {
    const s = computeLensSummary(
      project({ total_contract_revenue: 1_000_000, actual_revenue: 900_000 }),
      'revenue',
    );
    expect(s.badges[0]).toMatchObject({ level: 'healthy' });
  });

  it('flags warning at 50–89% billed', () => {
    const s = computeLensSummary(
      project({ total_contract_revenue: 1_000_000, actual_revenue: 600_000 }),
      'revenue',
    );
    expect(s.badges[0]).toMatchObject({ level: 'warning' });
  });

  it('flags critical at <50% billed', () => {
    const s = computeLensSummary(
      project({ total_contract_revenue: 1_000_000, actual_revenue: 200_000 }),
      'revenue',
    );
    expect(s.badges[0]).toMatchObject({ level: 'critical' });
  });

  it('appends an "outstanding" warning badge when revenue_outstanding > 0', () => {
    const s = computeLensSummary(
      project({ total_contract_revenue: 1_000_000, actual_revenue: 800_000, revenue_outstanding: 200_000 }),
      'revenue',
    );
    expect(s.badges.length).toBe(2);
    expect(s.badges[1].label).toMatch(/outstanding/);
    expect(s.badges[1].level).toBe('warning');
  });
});

describe('cost lens', () => {
  it('shows "no cost data" when both expense fields are 0', () => {
    const s = computeLensSummary(project(), 'cost');
    expect(s.text).toBe('no cost data');
  });

  it('flags GP% bands healthy ≥20, warning ≥10, critical otherwise', () => {
    expect(
      computeLensSummary(project({ total_expenses: 100, actual_expenses: 50, gp_percent: 25 }), 'cost').badges[0],
    ).toMatchObject({ level: 'healthy' });
    expect(
      computeLensSummary(project({ total_expenses: 100, actual_expenses: 50, gp_percent: 12 }), 'cost').badges[0],
    ).toMatchObject({ level: 'warning' });
    expect(
      computeLensSummary(project({ total_expenses: 100, actual_expenses: 50, gp_percent: 5 }), 'cost').badges[0],
    ).toMatchObject({ level: 'critical' });
  });

  it('flags burn>100% as critical', () => {
    const s = computeLensSummary(
      project({ total_expenses: 100, actual_expenses: 130 }),
      'cost',
    );
    const burnBadge = s.badges.find((b) => b.label.includes('% spent'));
    expect(burnBadge?.level).toBe('critical');
  });
});

describe('quality lens', () => {
  it('says "no quality data yet" when shared_summary is null', () => {
    const s = computeLensSummary(project(), 'quality');
    expect(s.text).toBe('no quality data yet');
  });

  it('surfaces pending approvals as warning', () => {
    const s = computeLensSummary(
      project({
        shared_summary: {
          project: {} as any,
          latestUpdate: {} as any,
          activity: {} as any,
          workflow: {
            approvals: { total: 5, pending: 3, approved: 2, rejected: 0 },
            deliverables: { total: 0, pending: 0, inReview: 0, completed: 0 },
          },
        } as any,
      }),
      'quality',
    );
    expect(s.badges.find((b) => b.label === '3 pending approvals')?.level).toBe('warning');
  });

  it('surfaces rejected approvals as critical', () => {
    const s = computeLensSummary(
      project({
        shared_summary: {
          project: {} as any,
          latestUpdate: {} as any,
          activity: {} as any,
          workflow: {
            approvals: { total: 5, pending: 0, approved: 4, rejected: 1 },
            deliverables: { total: 0, pending: 0, inReview: 0, completed: 0 },
          },
        } as any,
      }),
      'quality',
    );
    expect(s.badges.find((b) => b.label === '1 rejected')?.level).toBe('critical');
  });
});
