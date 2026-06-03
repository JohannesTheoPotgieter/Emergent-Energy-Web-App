/**
 * FYE Tracking — pure computation layer.
 *
 * Reproduces the "FY26 Project Tracking (EE - from trackers)" workbook from
 * the imported tracker lines:
 *
 *   View A — one row per project: Budget vs Actual (Rev/COS/GP, %s, % Realised)
 *            + a Flag, plus a 4-state portfolio reconciliation block.
 *   View B — Revenue/COS/GP dashboard: per-month + YTD-running for three
 *            series (Revised Budget / Actual / Plan-ahead).
 *
 * Everything here is a *grouping/aggregation* over the canonical per-line
 * revenue/COS produced by `finance-line-level-repository` (the single § 3.3
 * read path). No revenue/COS formula is re-implemented. All functions are pure
 * and take their inputs explicitly so the reconciliation test can drive them
 * with in-memory fixtures or live DB rows identically.
 */

import type { FinanceLine } from "../../../repositories/finance-line-level-repository";
import { classifyFyeState, type FyeState } from "./fye-state";
import {
  evaluateExclusion,
  fileNameToComparableLabel,
  isStaleTrackerCopy,
  resolveFyeExclusions,
  type FyeExclusionRule,
} from "./exclusions";

export type FyeProjectType = "Active" | "Past" | "Compliance";

export type FyeFlag =
  | "COS_NO_REVENUE" // Actual COS > 0 but Actual Rev = 0 — amber, keep the row
  | "NON_STANDARD_TEMPLATE"; // old template (no invoice-date / rev-recognition) — exclude from totals

/** Project metadata the compute layer needs. Derived by the orchestrator from
 * project_info + project_execution_state + tracker metadata + import runs. */
export interface FyeProjectMeta {
  projectId: number;
  projectName: string;
  /** Canonical identity for de-dup (falls back to normalised name). */
  canonicalKey: string;
  type: FyeProjectType;
  startDate: string | null;
  pcDate: string | null;
  /** Latest tracker source file name (for exclusion matching). */
  sourceFileName: string | null;
  /** SharePoint folder path, if known (for exclusion matching). */
  sourceFolderPath: string | null;
}

export interface FyeMoneyPair {
  revenue: number;
  cos: number;
}

export interface FyeStateTotals {
  realised: FyeMoneyPair;
  committed: FyeMoneyPair;
  planned: FyeMoneyPair;
  unrealised: FyeMoneyPair;
  /** Budget = sum over all four states. */
  budget: FyeMoneyPair;
}

export interface FyeProjectRow {
  projectId: number;
  project: string;
  type: FyeProjectType;
  startDate: string | null;
  endDatePc: string | null;
  budgetRevenue: number;
  budgetCos: number;
  budgetGp: number;
  budgetGpPct: number | null;
  actualRevenue: number;
  actualCos: number;
  actualGp: number;
  actualGpPct: number | null;
  pctRealised: number | null;
  flags: FyeFlag[];
  /** True when this row is excluded from the portfolio totals (template flag). */
  excludedFromTotals: boolean;
}

export interface FyeExcludedProject {
  projectId: number;
  project: string;
  reason: string;
  rule?: FyeExclusionRule | null;
}

export interface FyeProjectTableResult {
  rows: FyeProjectRow[];
  totals: FyeProjectRow; // a synthetic TOTAL row (project = "TOTAL")
  stateTotals: FyeStateTotals;
  excluded: FyeExcludedProject[];
  /** Count of projects shown in the table (after exclusions + de-dup). */
  projectCount: number;
}

const round2 = (n: number): number => Number((n ?? 0).toFixed(2));
const safePct = (num: number, den: number): number | null =>
  den === 0 || !Number.isFinite(den) ? null : num / den;

const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd",
]);
const hasRealInvoice = (inv: string | null | undefined): boolean => {
  const t = String(inv ?? "").trim();
  return !!t && !PLACEHOLDER_INVOICES.has(t.toLowerCase());
};
const isBlack = (line: FinanceLine): boolean =>
  String(line.invoiceDateFontColor ?? "").toLowerCase() === "black" ||
  line.invoiceDateConfirmed === true;

export const normalizeName = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Per-tracker realisation signal summary used by the de-dup rule. Computed
 * across a project's FY-windowed lines.
 */
export function summarizeTrackerSignals(lines: FinanceLine[]): {
  hasAnyInvoiceNumber: boolean;
  hasAnyBlackDate: boolean;
  lineCount: number;
} {
  let hasAnyInvoiceNumber = false;
  let hasAnyBlackDate = false;
  for (const l of lines) {
    if (hasRealInvoice(l.invoiceNumber)) hasAnyInvoiceNumber = true;
    if (isBlack(l)) hasAnyBlackDate = true;
    if (hasAnyInvoiceNumber && hasAnyBlackDate) break;
  }
  return { hasAnyInvoiceNumber, hasAnyBlackDate, lineCount: lines.length };
}

/** Whether a project's lines look like the legacy template (no invoice-raised
 * dates anywhere AND zero recognised revenue) — e.g. MEGA_PARK_P2. */
export function isNonStandardTemplate(lines: FinanceLine[]): boolean {
  if (lines.length === 0) return false;
  let anyInvoiceDate = false;
  let anyRevenue = false;
  for (const l of lines) {
    if (l.invoiceRaisedDate) anyInvoiceDate = true;
    if (l.perLineRevenue !== 0) anyRevenue = true;
    if (anyInvoiceDate || anyRevenue) return false;
  }
  return true;
}

/**
 * Compute View A — the project table + 4-state portfolio reconciliation.
 *
 * @param linesByProject FY-windowed FinanceLines grouped by projectId. All
 *        lines must already be filtered to the FY (invoice_date ∈ FY).
 * @param metas project metadata keyed by projectId.
 * @param today ISO date anchor for the 4-state future-dated test.
 */
export function computeProjectTable(
  linesByProject: Map<number, FinanceLine[]>,
  metas: Map<number, FyeProjectMeta>,
  today: string,
  exclusions: readonly FyeExclusionRule[] = resolveFyeExclusions(),
): FyeProjectTableResult {
  const excluded: FyeExcludedProject[] = [];

  // 1. Exclusion list — drop named archive/grouping/stale artefacts.
  const survivors: number[] = [];
  for (const [projectId, meta] of metas) {
    const candidates = [
      meta.projectName,
      normalizeName(meta.projectName),
      fileNameToComparableLabel(meta.sourceFileName),
      meta.sourceFolderPath,
    ];
    const decision = evaluateExclusion(candidates, exclusions);
    if (decision.excluded) {
      excluded.push({
        projectId,
        project: meta.projectName,
        reason: decision.rule?.reason ?? `Excluded by rule "${decision.rule?.label}"`,
        rule: decision.rule,
      });
      continue;
    }
    survivors.push(projectId);
  }

  // 2. De-dup — when several trackers map to the same canonical project, drop
  //    stale copies (no invoices + no black dates) in favour of a live one.
  const byCanonical = new Map<string, number[]>();
  for (const projectId of survivors) {
    const meta = metas.get(projectId)!;
    const key = meta.canonicalKey || normalizeName(meta.projectName);
    if (!byCanonical.has(key)) byCanonical.set(key, []);
    byCanonical.get(key)!.push(projectId);
  }
  const keptProjectIds: number[] = [];
  for (const [, group] of byCanonical) {
    if (group.length === 1) {
      keptProjectIds.push(group[0]);
      continue;
    }
    // Multiple trackers → keep the live ones, drop stale copies.
    const live: number[] = [];
    for (const projectId of group) {
      const lines = linesByProject.get(projectId) ?? [];
      const summary = summarizeTrackerSignals(lines);
      if (isStaleTrackerCopy(summary)) {
        excluded.push({
          projectId,
          project: metas.get(projectId)!.projectName,
          reason: "Stale duplicate tracker (all dates red, no invoices) — superseded by the live copy",
        });
      } else {
        live.push(projectId);
      }
    }
    if (live.length > 0) {
      keptProjectIds.push(...live);
    } else {
      // All copies looked stale — keep the one with the most lines so the
      // project is not silently dropped entirely.
      const best = group.slice().sort(
        (a, b) => (linesByProject.get(b)?.length ?? 0) - (linesByProject.get(a)?.length ?? 0),
      )[0];
      keptProjectIds.push(best);
      // Remove it from `excluded` if we had added it.
      const idx = excluded.findIndex((e) => e.projectId === best);
      if (idx >= 0) excluded.splice(idx, 1);
    }
  }

  // 3. Build a row per kept project.
  const rows: FyeProjectRow[] = [];
  const stateTotals: FyeStateTotals = {
    realised: { revenue: 0, cos: 0 },
    committed: { revenue: 0, cos: 0 },
    planned: { revenue: 0, cos: 0 },
    unrealised: { revenue: 0, cos: 0 },
    budget: { revenue: 0, cos: 0 },
  };

  for (const projectId of keptProjectIds) {
    const meta = metas.get(projectId)!;
    const lines = linesByProject.get(projectId) ?? [];

    const perState: Record<FyeState, FyeMoneyPair> = {
      realised: { revenue: 0, cos: 0 },
      committed: { revenue: 0, cos: 0 },
      planned: { revenue: 0, cos: 0 },
      unrealised: { revenue: 0, cos: 0 },
    };
    for (const l of lines) {
      const state = classifyFyeState(
        {
          invoiceNumber: l.invoiceNumber,
          invoiceDateFontColor: l.invoiceDateFontColor,
          invoiceDateConfirmed: l.invoiceDateConfirmed,
          invoiceRaisedDate: l.invoiceRaisedDate,
        },
        today,
      );
      perState[state].revenue += l.perLineRevenue;
      perState[state].cos += l.actualTotal;
    }

    const budgetRevenue =
      perState.realised.revenue + perState.committed.revenue + perState.planned.revenue + perState.unrealised.revenue;
    const budgetCos =
      perState.realised.cos + perState.committed.cos + perState.planned.cos + perState.unrealised.cos;
    const actualRevenue = perState.realised.revenue;
    const actualCos = perState.realised.cos;

    const flags: FyeFlag[] = [];
    const nonStandard = isNonStandardTemplate(lines);
    if (nonStandard) flags.push("NON_STANDARD_TEMPLATE");
    if (actualCos > 0 && actualRevenue === 0) flags.push("COS_NO_REVENUE");

    const row: FyeProjectRow = {
      projectId,
      project: meta.projectName,
      type: meta.type,
      startDate: meta.startDate,
      endDatePc: meta.pcDate,
      budgetRevenue: round2(budgetRevenue),
      budgetCos: round2(budgetCos),
      budgetGp: round2(budgetRevenue - budgetCos),
      budgetGpPct: safePct(budgetRevenue - budgetCos, budgetRevenue),
      actualRevenue: round2(actualRevenue),
      actualCos: round2(actualCos),
      actualGp: round2(actualRevenue - actualCos),
      actualGpPct: safePct(actualRevenue - actualCos, actualRevenue),
      pctRealised: safePct(actualRevenue, budgetRevenue),
      flags,
      excludedFromTotals: nonStandard,
    };
    rows.push(row);

    // NON_STANDARD_TEMPLATE rows are shown but excluded from portfolio totals.
    if (!nonStandard) {
      for (const s of ["realised", "committed", "planned", "unrealised"] as FyeState[]) {
        stateTotals[s].revenue += perState[s].revenue;
        stateTotals[s].cos += perState[s].cos;
      }
    }
  }

  // Finalise the 4-state block + budget = sum of states.
  for (const s of ["realised", "committed", "planned", "unrealised"] as FyeState[]) {
    stateTotals.budget.revenue += stateTotals[s].revenue;
    stateTotals.budget.cos += stateTotals[s].cos;
    stateTotals[s] = { revenue: round2(stateTotals[s].revenue), cos: round2(stateTotals[s].cos) };
  }
  stateTotals.budget = { revenue: round2(stateTotals.budget.revenue), cos: round2(stateTotals.budget.cos) };

  // Sort by Budget Rev desc (TOTAL row appended by the caller / below).
  rows.sort((a, b) => b.budgetRevenue - a.budgetRevenue);

  // TOTAL row over the rows that count towards totals.
  const counted = rows.filter((r) => !r.excludedFromTotals);
  const tBudgetRev = counted.reduce((s, r) => s + r.budgetRevenue, 0);
  const tBudgetCos = counted.reduce((s, r) => s + r.budgetCos, 0);
  const tActualRev = counted.reduce((s, r) => s + r.actualRevenue, 0);
  const tActualCos = counted.reduce((s, r) => s + r.actualCos, 0);
  const totals: FyeProjectRow = {
    projectId: -1,
    project: "TOTAL",
    type: "Active",
    startDate: null,
    endDatePc: null,
    budgetRevenue: round2(tBudgetRev),
    budgetCos: round2(tBudgetCos),
    budgetGp: round2(tBudgetRev - tBudgetCos),
    budgetGpPct: safePct(tBudgetRev - tBudgetCos, tBudgetRev),
    actualRevenue: round2(tActualRev),
    actualCos: round2(tActualCos),
    actualGp: round2(tActualRev - tActualCos),
    actualGpPct: safePct(tActualRev - tActualCos, tActualRev),
    pctRealised: safePct(tActualRev, tBudgetRev),
    flags: [],
    excludedFromTotals: false,
  };

  return { rows, totals, stateTotals, excluded, projectCount: rows.length };
}

// ─── View B — Dashboard ──────────────────────────────────────────────────────

export type FyeMetric = "revenue" | "cos" | "gp";

export interface FyeMonthlySeriesRow {
  monthKey: string;
  label: string;
  /** Manual once-off Revised Budget for this month (null if not set). */
  revisedBudget: number | null;
  /** Realised actual for this month — null for months after the last closed month. */
  actual: number | null;
  /** Plan-ahead for this month: actual (≤ last closed) then +pipeline. Continuous. */
  planAhead: number | null;
}

export interface FyeMetricBlock {
  metric: FyeMetric;
  /** Monthly (non-cumulative) figures. */
  monthly: FyeMonthlySeriesRow[];
  /** YTD running (cumulative) figures — what the line chart plots. */
  ytd: FyeMonthlySeriesRow[];
}

export interface FyeDashboardResult {
  monthKeys: string[];
  lastClosedMonthKey: string | null;
  revenue: FyeMetricBlock;
  cos: FyeMetricBlock;
  gp: FyeMetricBlock;
}

/** Manual Revised-Budget monthly figures: metric → monthKey → amount. */
export type RevisedBudgetMap = Partial<Record<FyeMetric, Record<string, number>>>;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthKeyLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_LABELS[Number(m) - 1]} ${y.slice(2)}`;
}

/**
 * Compute View B — the Revenue/COS/GP dashboard with monthly + YTD running
 * figures for three series (Revised Budget / Actual / Plan-ahead).
 *
 * Actual = realised lines by recognition month, shown only through the last
 * closed month. Plan-ahead shares the actual values through the last closed
 * month (no gap), then adds the next-period pipeline (Committed + Planned) by
 * month for the remaining FY months — a continuous line to year-end.
 *
 * @param lines FY-windowed FinanceLines (already de-dup/exclusion filtered).
 * @param revised manual Revised-Budget monthly figures.
 * @param fyMonthKeys the 12 FY month keys in order (Sep..Aug).
 * @param lastClosedMonthKey last month with closed actuals (e.g. "2026-05").
 * @param today ISO anchor for 4-state classification.
 */
export function computeDashboard(
  lines: FinanceLine[],
  revised: RevisedBudgetMap,
  fyMonthKeys: string[],
  lastClosedMonthKey: string | null,
  today: string,
): FyeDashboardResult {
  // Per-month realised (actual) and pipeline (committed+planned) sums.
  const zero = () => ({ revenue: 0, cos: 0 });
  const actualByMonth = new Map<string, { revenue: number; cos: number }>();
  const pipelineByMonth = new Map<string, { revenue: number; cos: number }>();
  const monthSet = new Set(fyMonthKeys);

  for (const l of lines) {
    const mk = l.recognitionMonth;
    if (!mk || !monthSet.has(mk)) continue;
    const state = classifyFyeState(
      {
        invoiceNumber: l.invoiceNumber,
        invoiceDateFontColor: l.invoiceDateFontColor,
        invoiceDateConfirmed: l.invoiceDateConfirmed,
        invoiceRaisedDate: l.invoiceRaisedDate,
      },
      today,
    );
    if (state === "realised") {
      const a = actualByMonth.get(mk) ?? zero();
      a.revenue += l.perLineRevenue;
      a.cos += l.actualTotal;
      actualByMonth.set(mk, a);
    } else if (state === "committed" || state === "planned") {
      const p = pipelineByMonth.get(mk) ?? zero();
      p.revenue += l.perLineRevenue;
      p.cos += l.actualTotal;
      pipelineByMonth.set(mk, p);
    }
  }

  const buildBlock = (metric: FyeMetric): FyeMetricBlock => {
    const pick = (pair: { revenue: number; cos: number } | undefined, m: FyeMetric): number => {
      if (!pair) return 0;
      if (m === "revenue") return pair.revenue;
      if (m === "cos") return pair.cos;
      return pair.revenue - pair.cos; // gp
    };
    const revisedForMetric = revised[metric] ?? {};

    const monthly: FyeMonthlySeriesRow[] = [];
    for (const mk of fyMonthKeys) {
      const isClosed = lastClosedMonthKey ? mk <= lastClosedMonthKey : true;
      const actualPair = actualByMonth.get(mk);
      const pipePair = pipelineByMonth.get(mk);
      const actual = isClosed ? round2(pick(actualPair, metric)) : null;
      // Plan-ahead monthly delta: actual for closed months, pipeline for future.
      const planAhead = isClosed ? round2(pick(actualPair, metric)) : round2(pick(pipePair, metric));
      const rb = revisedForMetric[mk];
      monthly.push({
        monthKey: mk,
        label: monthKeyLabel(mk),
        revisedBudget: rb == null ? null : round2(rb),
        actual,
        planAhead,
      });
    }

    // YTD running (cumulative). Actual stops accumulating after last closed
    // month (its cumulative is held flat / null beyond). Plan-ahead continues
    // from the actual cumulative through the last closed month.
    const ytd: FyeMonthlySeriesRow[] = [];
    let runRevised = 0;
    let runActual = 0;
    let runPlan = 0;
    let sawRevised = false;
    for (const mk of fyMonthKeys) {
      const isClosed = lastClosedMonthKey ? mk <= lastClosedMonthKey : true;
      const m = monthly.find((x) => x.monthKey === mk)!;

      if (m.revisedBudget != null) {
        runRevised += m.revisedBudget;
        sawRevised = true;
      }
      const revisedOut = sawRevised ? round2(runRevised) : null;

      let actualOut: number | null = null;
      if (isClosed) {
        runActual += m.actual ?? 0;
        runPlan = runActual; // plan-ahead shares the actual cumulative for closed months
        actualOut = round2(runActual);
      } else {
        runPlan += m.planAhead ?? 0; // continue from the last actual cumulative
        actualOut = null; // no actual beyond last closed month
      }
      ytd.push({
        monthKey: mk,
        label: monthKeyLabel(mk),
        revisedBudget: revisedOut,
        actual: actualOut,
        planAhead: round2(runPlan),
      });
    }

    return { metric, monthly, ytd };
  };

  return {
    monthKeys: fyMonthKeys,
    lastClosedMonthKey,
    revenue: buildBlock("revenue"),
    cos: buildBlock("cos"),
    gp: buildBlock("gp"),
  };
}
