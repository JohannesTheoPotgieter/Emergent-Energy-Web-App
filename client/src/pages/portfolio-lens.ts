// ============================================================
// Portfolio lens — derives the rightmost column for /portfolio.
//
// PR-D of the truth/clear/simple redesign. Extracted from the page so
// each lens rule is unit-testable without React.
//
// Truth: when the underlying field is missing, `text` is null and the
// badge list is empty — the row shows "—", never a zeroed number.
// ============================================================

import type { ProjectSummary } from '@/lib/api';
import { formatZarCompact } from '@/lib/currency';

export const PORTFOLIO_LENSES = ['delivery', 'revenue', 'cost', 'quality'] as const;
export type PortfolioLens = (typeof PORTFOLIO_LENSES)[number];

export const PORTFOLIO_STATE_FILTERS = ['active', 'mine', 'behind', 'missing_fc', 'archived'] as const;
export type PortfolioStateFilter = (typeof PORTFOLIO_STATE_FILTERS)[number];

export const LENS_LABELS: Record<PortfolioLens, string> = {
  delivery: 'Delivery',
  revenue: 'Revenue',
  cost: 'Cost',
  quality: 'Quality',
};

export const STATE_LABELS: Record<PortfolioStateFilter, string> = {
  active: 'Active',
  mine: 'My projects',
  behind: 'Behind plan',
  missing_fc: 'Missing financial close',
  archived: 'Archived',
};

export interface LensBadge {
  label: string;
  level: 'healthy' | 'warning' | 'critical' | 'neutral';
}

export interface LensSummary {
  badges: LensBadge[];
  /** Free-text trailing line shown after the badges. Null when no value. */
  text: string | null;
}

export interface PortfolioRow {
  projectId: number | null;
  projectName: string;
  phase: string | null;
  pm: string | null;
  rag: string | null;
  pctComplete: number | null;
  lensSummary: LensSummary;
}

export function computePortfolioRow(p: ProjectSummary, lens: PortfolioLens): PortfolioRow {
  return {
    projectId: p.project_info_id,
    projectName: cleanProjectName(p.project_name),
    phase: p.phase || (p as ProjectSummary & { execution_phase?: string | null }).execution_phase || null,
    pm: p.pm || null,
    rag: ragFromSummary(p),
    pctComplete: p.project_pct_complete != null ? Number(p.project_pct_complete) * 100 : null,
    lensSummary: computeLensSummary(p, lens),
  };
}

// ===================== Per-lens computation =====================

export function computeLensSummary(p: ProjectSummary, lens: PortfolioLens): LensSummary {
  switch (lens) {
    case 'delivery':
      return computeDeliveryLens(p);
    case 'revenue':
      return computeRevenueLens(p);
    case 'cost':
      return computeCostLens(p);
    case 'quality':
      return computeQualityLens(p);
  }
}

function computeDeliveryLens(p: ProjectSummary): LensSummary {
  const badges: LensBadge[] = [];
  let text: string | null = null;

  // Schedule delta — turn into days-behind via the same heuristic as /now.
  if (p.delta_vs_expected != null) {
    const pp = p.delta_vs_expected * 100; // delta in percentage points
    if (pp <= -10) {
      badges.push({ label: `${Math.round(-pp)}d behind`, level: 'critical' });
    } else if (pp <= -5) {
      badges.push({ label: `${Math.round(-pp)}d behind`, level: 'warning' });
    } else if (pp >= 5) {
      badges.push({ label: `${Math.round(pp)}d ahead`, level: 'healthy' });
    }
  }

  if (p.expected_pct_complete == null && p.project_pct_complete == null) {
    text = 'no schedule data';
  } else if (badges.length === 0) {
    text = 'on track';
  }

  return { badges, text };
}

function computeRevenueLens(p: ProjectSummary): LensSummary {
  const badges: LensBadge[] = [];
  const planned = Number(p.total_contract_revenue || 0);
  const actual = Number(p.actual_revenue || 0);
  const outstanding = Number(p.revenue_outstanding || 0);

  if (planned === 0 && actual === 0) {
    return { badges: [], text: 'no revenue data' };
  }

  const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;
  if (pct != null) {
    const level = pct >= 90 ? 'healthy' : pct >= 50 ? 'warning' : pct < 50 && planned > 0 ? 'critical' : 'neutral';
    badges.push({ label: `${pct}% billed`, level });
  }
  if (outstanding > 0) {
    badges.push({ label: `${formatZarCompact(outstanding)} outstanding`, level: 'warning' });
  }

  return { badges, text: null };
}

function computeCostLens(p: ProjectSummary): LensSummary {
  const badges: LensBadge[] = [];
  const planned = Number(p.total_expenses || 0);
  const actual = Number(p.actual_expenses || 0);
  const gpPct = p.gp_percent != null ? Number(p.gp_percent) : null;

  if (planned === 0 && actual === 0) {
    return { badges: [], text: 'no cost data' };
  }

  if (gpPct != null) {
    // GP% is already scaled to 0-100 in ProjectSummary by upstream service.
    const level: LensBadge['level'] =
      gpPct >= 20 ? 'healthy'
      : gpPct >= 10 ? 'warning'
      : 'critical';
    badges.push({ label: `GP ${gpPct.toFixed(1)}%`, level });
  }

  if (planned > 0) {
    const burnPct = Math.round((actual / planned) * 100);
    // Cost burn above 100% is critical (over budget). 80-100% = warning.
    const level: LensBadge['level'] =
      burnPct > 100 ? 'critical'
      : burnPct >= 80 ? 'warning'
      : 'healthy';
    badges.push({ label: `${burnPct}% spent`, level });
  }

  return { badges, text: null };
}

function computeQualityLens(p: ProjectSummary): LensSummary {
  // ProjectSummary doesn't carry NCR / handover-readiness fields today.
  // Surface what we can from the shared_summary payload when present;
  // otherwise show "no quality data" so the cell is honest.
  const shared = p.shared_summary;
  if (!shared) {
    return { badges: [], text: 'no quality data yet' };
  }

  const badges: LensBadge[] = [];
  const approvals = shared.workflow?.approvals;
  if (approvals) {
    if (approvals.pending > 0) {
      badges.push({ label: `${approvals.pending} pending approvals`, level: 'warning' });
    }
    if (approvals.rejected > 0) {
      badges.push({ label: `${approvals.rejected} rejected`, level: 'critical' });
    }
  }

  const deliverables = shared.workflow?.deliverables;
  if (deliverables && deliverables.total > 0) {
    const ready = deliverables.completed;
    const total = deliverables.total;
    const pct = Math.round((ready / total) * 100);
    const level: LensBadge['level'] = pct === 100 ? 'healthy' : pct >= 50 ? 'warning' : 'critical';
    badges.push({ label: `${ready}/${total} deliverables`, level });
  }

  if (badges.length === 0) {
    return { badges: [], text: 'no open quality items' };
  }
  return { badges, text: null };
}

// ===================== Helpers =====================

function cleanProjectName(raw: string): string {
  return raw.replace(/_Tracker.*$/i, '').replace(/_/g, ' ');
}

function ragFromSummary(p: ProjectSummary): string | null {
  const rs = (p as ProjectSummary & { rag_status?: string | null }).rag_status;
  if (rs) return rs;
  // Fallback: derive a rag from delta_vs_expected.
  if (p.delta_vs_expected == null) return null;
  if (p.delta_vs_expected <= -0.10) return 'RED';
  if (p.delta_vs_expected <= -0.05) return 'AMBER';
  return 'GREEN';
}
