// ============================================================
// /now — "What's on fire?" derivation.
//
// PR-B of the redesign. Extracted from the page so the rule can be
// unit-tested without React. Pure function, no I/O.
//
// A project is "on fire" when ANY of:
//   • RAG = Red
//   • 10+ days behind expected progress
//   • Has overdue receivables OR payables on the FY
//   • Engineering status = Blocked
//   • Quality status = Blocked
//   • 5+ pending approvals (proxy for stuck work)
//
// Reasons are listed in severity order; the first one shows next to
// the project name, the rest collapse into a "+N more" pill.
// ============================================================

import type { ExecutionDashboardProject } from '@/lib/execution-dashboard';
import { formatZarCompact } from '@/lib/currency';

export interface FireReason {
  /** Short label shown to the user. */
  label: string;
  /** Severity tier — feeds into the badge colour. */
  level: 'critical' | 'warning';
}

export interface FireProject {
  project: ExecutionDashboardProject;
  reasons: FireReason[];
  /** Higher = more on fire. */
  score: number;
}

export function computeFireList(
  projects: readonly ExecutionDashboardProject[],
): FireProject[] {
  return projects
    .map((p): FireProject | null => {
      const reasons: FireReason[] = [];
      let score = 0;

      if (p.rag === 'Red') {
        reasons.push({ label: 'RAG red', level: 'critical' });
        score += 100;
      }

      const behindDays = computeBehindDays(p);
      if (behindDays != null && behindDays >= 10) {
        reasons.push({ label: `${behindDays}d behind`, level: 'critical' });
        score += Math.min(80, behindDays * 2);
      } else if (p.behindPlan) {
        reasons.push({ label: 'behind plan', level: 'warning' });
        score += 30;
      }

      const overdueTotal = (p.overdueInflowFy || 0) + (p.overdueOutflowFy || 0);
      if (overdueTotal > 0) {
        reasons.push({
          label: `${formatZarCompact(overdueTotal)} overdue`,
          level: 'critical',
        });
        score += 60;
      }

      if (p.engineeringStatus === 'Blocked') {
        reasons.push({ label: 'engineering blocked', level: 'critical' });
        score += 50;
      }
      if (p.qualityStatus === 'Blocked') {
        reasons.push({ label: 'quality blocked', level: 'critical' });
        score += 50;
      }

      if (p.pendingApprovalCount >= 5) {
        reasons.push({
          label: `${p.pendingApprovalCount} pending approvals`,
          level: 'warning',
        });
        score += 20;
      }

      if (reasons.length === 0) return null;
      return { project: p, reasons, score };
    })
    .filter((x): x is FireProject => x !== null)
    .sort((a, b) => b.score - a.score);
}

export function computeBehindDays(p: ExecutionDashboardProject): number | null {
  const expected = p.expectedProgressPct ?? null;
  const actual = p.actualProgressPct ?? null;
  if (expected == null || actual == null) return null;
  const delta = expected - actual;
  if (delta <= 0) return null;
  return Math.round(delta);
}
