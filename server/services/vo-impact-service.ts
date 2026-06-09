/**
 * Variation Order (VO) financial-impact service.
 *
 * Single source of truth for VO revenue/cost/GP impact and the BR-025/026
 * 5%-of-GP gate. BOTH the finance VO-impact view (read) and the change-control
 * submit path (gate) call into here, so finance and execution can never show
 * divergent VO numbers.
 *
 * Business rules:
 *   - BR-025: PMs may approve VOs whose GP impact is ≤ 5% of project GP.
 *   - BR-026: VOs > 5% need management review (Programme Manager OR COO) + RCA.
 *
 * GP is the canonical § 3.3 figure — the project's GP is summed from the
 * per-line GP the finance engine already computes (FinanceLineLevelRepository).
 * We never invent a parallel revenue/GP calc; the VO's own revenue/cost deltas
 * live on the change_request, and the project-GP denominator comes from the
 * canonical lines.
 */
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";
import { ChangeRequestsRepository } from "../repositories/change-requests-repository";
import type { ChangeRequest } from "@shared/schema/projects";

/** BR-025/026 threshold: 5% of project GP. */
export const VO_GP_THRESHOLD = 0.05;

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A VO's COS (cost-of-sales) delta. Prefer the COS-specific field; fall back to
 * the older generic cost field when a VO predates the B6 enrichment.
 */
export function voCostDelta(cr: Pick<ChangeRequest, "cosImpact" | "costImpact">): number {
  return cr.cosImpact != null ? num(cr.cosImpact) : num(cr.costImpact);
}

/**
 * GP impact of a VO = revenue delta − COS delta. Mirrors the canonical § 3.3
 * definition (perLineGp = perLineRevenue − cost); `marginImpact` on the row is a
 * stored cross-check of the same quantity, not an independent input.
 */
export function voGpImpact(
  cr: Pick<ChangeRequest, "revenueImpact" | "cosImpact" | "costImpact">,
): number {
  return num(cr.revenueImpact) - voCostDelta(cr);
}

export interface VoGateResult {
  gpImpact: number;
  projectGp: number;
  /** gpImpact ÷ projectGp, or null when project GP is 0 (ratio undefined). */
  gpImpactPct: number | null;
  /** True when |GP impact| exceeds 5% of project GP → management review + RCA. */
  exceedsThreshold: boolean;
}

/**
 * Pure gate evaluation (no DB). The test ≤5% / >5% is on the ABSOLUTE GP impact
 * against 5% of |project GP|. When project GP is 0 the ratio is undefined, so a
 * non-zero VO is conservatively escalated (record + surface, never silently
 * pass it as PM-approvable).
 */
export function evaluateVoGate(gpImpact: number, projectGp: number): VoGateResult {
  const base = Math.abs(projectGp);
  const gpImpactPct = base > 0 ? gpImpact / projectGp : null;
  const exceedsThreshold = base > 0
    ? Math.abs(gpImpact) > VO_GP_THRESHOLD * base
    : Math.abs(gpImpact) > 0;
  return { gpImpact, projectGp, gpImpactPct, exceedsThreshold };
}

/** Pure: sum canonical per-line GP into the project GP (the 5% base). */
export function sumProjectGp(lines: ReadonlyArray<{ perLineGp: number }>): number {
  return lines.reduce((acc, l) => acc + (Number.isFinite(l.perLineGp) ? l.perLineGp : 0), 0);
}

/**
 * Structural seams so the gate/view are unit-testable without a DB. The
 * concrete FinanceLineLevelRepository / ChangeRequestsRepository satisfy these.
 */
export interface FinanceLinesSource {
  getProjectFinanceLines(projectId: number): Promise<Array<{ perLineGp: number }>>;
}
export interface ChangeRequestsSource {
  listByProject(projectId: number): Promise<ChangeRequest[]>;
}

export interface VoImpactDeps {
  financeRepo?: FinanceLinesSource;
  changeRequestsRepo?: ChangeRequestsSource;
}

/** Project GP from the canonical § 3.3 engine — the 5% gate denominator. */
export async function getProjectGp(projectId: number, deps: VoImpactDeps = {}): Promise<number> {
  const financeRepo = deps.financeRepo ?? new FinanceLineLevelRepository();
  const lines = await financeRepo.getProjectFinanceLines(projectId);
  return sumProjectGp(lines);
}

export interface VoImpactRow {
  id: number;
  title: string;
  changeType: string;
  status: string;
  revenueDelta: number;
  costDelta: number;
  gpImpact: number;
  /** Live ratio vs the project's CURRENT canonical GP. */
  gpImpactPct: number | null;
  /** Live gate decision vs current GP. */
  exceedsThreshold: boolean;
  /** Frozen at submit time by the change-control gate (BR-025/026). */
  requiresManagementReview: boolean | null;
  gpImpactPctAtSubmit: number | null;
  approvalId: number | null;
  approverUserId: number | null;
  finalDecision: string | null;
}

export interface ProjectVoImpact {
  projectId: number;
  projectGp: number;
  thresholdPct: number;
  vos: VoImpactRow[];
  totals: {
    revenueDelta: number;
    costDelta: number;
    gpImpact: number;
    count: number;
    flaggedCount: number;
  };
}

/** Pure projection of a change_request + project GP into a finance VO row. */
export function toVoImpactRow(cr: ChangeRequest, projectGp: number): VoImpactRow {
  const revenueDelta = num(cr.revenueImpact);
  const costDelta = voCostDelta(cr);
  const gpImpact = revenueDelta - costDelta;
  const gate = evaluateVoGate(gpImpact, projectGp);
  return {
    id: cr.id,
    title: cr.title,
    changeType: cr.changeType,
    status: cr.status,
    revenueDelta,
    costDelta,
    gpImpact,
    gpImpactPct: gate.gpImpactPct,
    exceedsThreshold: gate.exceedsThreshold,
    requiresManagementReview: cr.requiresManagementReview ?? null,
    gpImpactPctAtSubmit: cr.gpImpactPctAtSubmit != null ? num(cr.gpImpactPctAtSubmit) : null,
    approvalId: cr.approvalId ?? null,
    approverUserId: cr.approverUserId ?? null,
    finalDecision: cr.finalDecision ?? null,
  };
}

/**
 * The per-project VO impact view: every live VO with revenue/cost/GP impact and
 * the 5% flag, plus the canonical project GP. Both the finance endpoint and any
 * execution surface read this, so the numbers cannot diverge.
 */
export async function getProjectVoImpacts(
  projectId: number,
  deps: VoImpactDeps = {},
): Promise<ProjectVoImpact> {
  const financeRepo = deps.financeRepo ?? new FinanceLineLevelRepository();
  const changeRequestsRepo = deps.changeRequestsRepo ?? new ChangeRequestsRepository();
  const [lines, crs] = await Promise.all([
    financeRepo.getProjectFinanceLines(projectId),
    changeRequestsRepo.listByProject(projectId),
  ]);
  const projectGp = sumProjectGp(lines);
  const vos = crs.map((cr) => toVoImpactRow(cr, projectGp));
  const totals = vos.reduce(
    (a, v) => ({
      revenueDelta: a.revenueDelta + v.revenueDelta,
      costDelta: a.costDelta + v.costDelta,
      gpImpact: a.gpImpact + v.gpImpact,
      count: a.count + 1,
      flaggedCount: a.flaggedCount + (v.exceedsThreshold ? 1 : 0),
    }),
    { revenueDelta: 0, costDelta: 0, gpImpact: 0, count: 0, flaggedCount: 0 },
  );
  return { projectId, projectGp, thresholdPct: VO_GP_THRESHOLD, vos, totals };
}
