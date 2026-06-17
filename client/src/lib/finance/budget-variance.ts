/**
 * Budget-vs-actuals helpers for the Revenue / COS / GP tracker pages.
 *
 * Budget is the manually-captured annual figure (revised at half-year), held at
 * MONTH level. These helpers compute how a pipeline state (Planned / Committed /
 * Realised / Unrealised) tracks against that budget. Pure presentation maths —
 * no finance figure is computed or recognised here.
 */

/** Signed variance of an actual/pipeline figure against budget (actual − budget). */
export function budgetDelta(actual: number, budget: number): number {
  return actual - budget;
}

/**
 * "% consumed" — the actual/pipeline figure as a percentage of budget. Returns
 * an em dash when budget is 0 (no target captured) to avoid a divide-by-zero
 * Infinity. Rounded to a whole percent for the compact tracker cells.
 */
export function budgetPctLabel(actual: number, budget: number): string {
  return budget !== 0 ? `${Math.round((actual / budget) * 100)}%` : '—';
}
