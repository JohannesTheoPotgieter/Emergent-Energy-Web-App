/**
 * COS line-review integrity flags (R2 / R4).
 *
 * Pure, computed-on-read signals that surface lines the weekly finance meeting
 * should eyeball. They change NOTHING about the canonical figures — a flagged
 * line still reports its § 3.3 revenue / GP exactly as before; the flag is
 * advisory metadata only. Kept as a pure function (no DB, no clock) so the
 * fire / don't-fire behaviour is unit-testable with in-memory rows.
 *
 *   R2 allocationMissing — the line's category has no revenue allocation
 *      (Excel col J), so its revenue can't be derived. Sourced from the § 3.3
 *      derivation warning, never recomputed here.
 *   R4 anomaly           — the line's cost is >= 8x the median cost of its
 *      category (per project), i.e. a likely fat-finger / mis-categorised entry.
 *
 * R3 (invoice↔PO mismatch) was removed (2026-06, owner decision): it depended on
 * the purchase-order register, which is parked, so the check could not reliably
 * fire and was dropped rather than show a flag that never triggers.
 */

/** § 3.3 derivation warnings that mean "revenue allocation missing" (R2). */
const ALLOCATION_MISSING_WARNINGS = new Set([
  "category_revenue_allocation_missing",
  "missing_category_allocation_linkage",
]);

/** A line >= 8x its category median cost is flagged as an anomaly (R4). */
export const ANOMALY_MEDIAN_FACTOR = 8;

export interface CosLineFlagInput {
  /** § 3.3 line id (actuals grain). */
  lineId: number;
  projectId: number | null;
  categoryAllocationId: number | null;
  /** Line cost (actual_total). */
  actualTotal: number;
  /** The § 3.3 derivation warning for this line (drives R2). */
  derivationWarning: string | null;
}

export interface CosLineFlags {
  lineId: number;
  /** R2 — category revenue allocation (col J) missing. */
  allocationMissing: boolean;
  /** R4 — cost is >= ANOMALY_MEDIAN_FACTOR x the category median. */
  anomaly: boolean;
  /** R4 detail — actualTotal / categoryMedian; null when no usable median. */
  anomalyFactor: number | null;
  /** True when any of R2 / R4 fired. */
  flagged: boolean;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function categoryKey(line: CosLineFlagInput): string {
  return `${line.projectId ?? "x"}:${line.categoryAllocationId ?? "x"}`;
}

/**
 * Compute R2/R4 flags for a set of cost lines.
 *
 * @param lines  the § 3.3 lines to evaluate.
 */
export function computeCosLineFlags(
  lines: readonly CosLineFlagInput[],
): CosLineFlags[] {
  // R4 — median cost per (project, category).
  const costsByCategory = new Map<string, number[]>();
  for (const line of lines) {
    const key = categoryKey(line);
    const arr = costsByCategory.get(key) ?? [];
    arr.push(Math.abs(line.actualTotal));
    costsByCategory.set(key, arr);
  }
  const medianByCategory = new Map<string, number>();
  for (const [key, costs] of costsByCategory) {
    medianByCategory.set(key, median(costs));
  }

  return lines.map((line) => {
    const allocationMissing =
      line.derivationWarning != null &&
      ALLOCATION_MISSING_WARNINGS.has(line.derivationWarning);

    const med = medianByCategory.get(categoryKey(line)) ?? 0;
    const anomalyFactor = med > 0 ? Math.abs(line.actualTotal) / med : null;
    const anomaly = anomalyFactor != null && anomalyFactor >= ANOMALY_MEDIAN_FACTOR;

    return {
      lineId: line.lineId,
      allocationMissing,
      anomaly,
      anomalyFactor,
      flagged: allocationMissing || anomaly,
    };
  });
}
