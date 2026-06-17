/**
 * ============================================================================
 * FINANCE MODEL — single packaged entrypoint (FROZEN)
 * ============================================================================
 *
 * `computeFinanceModel()` packages the canonical finance computation as ONE
 * callable function. It is a thin FACADE: it only orchestrates the existing,
 * frozen finance primitives and returns their combined output. It contains
 * NO finance math of its own.
 *
 *   1. `getFyWindow()`                         → resolve the Sep–Aug FY window
 *      (server/lib/fy-window.ts)                 (§ 3B S8 — FY is dynamic)
 *   2. `FinanceLineLevelRepository`            → per-line REV / COS / GP, the
 *      .getPortfolioFinanceLines()               § 3.3 category-scoped POC, the
 *      (server/repositories/                     SOLE computation path (§ 3B S6)
 *       finance-line-level-repository.ts)
 *   3. `aggregateLinesByMonth()`               → FY / month / bucket roll-ups,
 *      (same repository module)                   summed from per-line values
 *                                                 (§ 3.3.1 — never pooled)
 *
 * FREEZE (CLAUDE.md FREEZE + AGENT_GUARDRAILS § 3B S10):
 *   - The numbers this function returns are produced entirely by the frozen
 *     primitives above. Do NOT add, inline, or "optimise" any revenue / COS /
 *     GP / cashflow calculation here — that would create a parallel finance
 *     path, which § 3B S6 forbids.
 *   - Formula / number / calculation changes require explicit owner approval.
 *     Changes here that alter a surfaced number must keep `npm run verify:finance`
 *     and the finance unit tests green.
 *   - Recognition date is the invoice-raised date (col T), enforced inside the
 *     repository. This facade never re-buckets on any other date.
 *
 * Read-only. No writes, no mutations. Safe to call against production.
 */

import { getFyWindow, type FyWindow } from "../lib/fy-window";
import {
  FinanceLineLevelRepository,
  aggregateLinesByMonth,
  type BucketRollup,
  type FinanceLine,
  type MonthlyReconRow,
} from "../repositories/finance-line-level-repository";

export interface FinanceModelInput {
  /** Projects to include. Each project is computed independently (§ 3.3.1). */
  projectIds: number[];
  /**
   * Lock to a specific FY year (calendar year of the Aug close, e.g. 2026 for
   * FY26). Omit to use the current FY. Ignored when an explicit fyStart/fyEnd
   * window is supplied.
   */
  fy?: number | null;
  /** Reference date for resolving the current FY window (tests / back-fill). */
  date?: Date;
  /**
   * Explicit inclusive ISO window (YYYY-MM-DD) on the invoice-raised date.
   * When provided, these win over `fy`/`date` and `fyWindow` is left null —
   * the caller is asking for an arbitrary window, not a named FY.
   */
  fyStart?: string;
  fyEnd?: string;
  /**
   * Pass `false` to compute over ALL invoice-raised dates (no window). The
   * default windows to the resolved FY so callers get a bounded result.
   */
  useFyWindow?: boolean;
}

export interface FinanceModelResult {
  /** Resolved Sep–Aug FY window, or null when an explicit window was used. */
  fyWindow: FyWindow | null;
  /** The ISO window actually applied to the line read (empty = unbounded). */
  window: { fyStart?: string; fyEnd?: string };
  /** Per-line REV / COS / GP — the canonical § 3.3 output, summed by callers. */
  lines: FinanceLine[];
  /** Month roll-up (actual + planned + realised sums). */
  byMonth: MonthlyReconRow[];
  /** Lines with no recognition month (no invoice-raised date). */
  unrecognised: MonthlyReconRow;
  /** Grand total across every line in the window. */
  total: MonthlyReconRow;
  /** Planned / committed / realised bucket roll-up. */
  byBucket: BucketRollup[];
}

/**
 * Compute the packaged finance model for one or more projects.
 *
 * @param input       projects + window selection (see `FinanceModelInput`).
 * @param repository  optional repository injection (tests / alternate db);
 *                    defaults to a fresh `FinanceLineLevelRepository`.
 */
export async function computeFinanceModel(
  input: FinanceModelInput,
  repository: FinanceLineLevelRepository = new FinanceLineLevelRepository(),
): Promise<FinanceModelResult> {
  const { projectIds, fy, date, useFyWindow = true } = input;

  // Resolve the read window. An explicit fyStart/fyEnd is an arbitrary window
  // (no named FY); otherwise window to the resolved Sep–Aug FY unless the
  // caller opted out with useFyWindow === false.
  const hasExplicitWindow = input.fyStart != null || input.fyEnd != null;

  let fyWindow: FyWindow | null = null;
  let window: { fyStart?: string; fyEnd?: string } = {};

  if (hasExplicitWindow) {
    window = { fyStart: input.fyStart, fyEnd: input.fyEnd };
  } else if (useFyWindow) {
    fyWindow = getFyWindow({ fy, date });
    window = { fyStart: fyWindow.fyStartIso, fyEnd: fyWindow.fyEndIso };
  }

  const lines = await repository.getPortfolioFinanceLines(projectIds, window);
  const { byMonth, unrecognised, total, byBucket } = aggregateLinesByMonth(lines);

  return { fyWindow, window, lines, byMonth, unrecognised, total, byBucket };
}
