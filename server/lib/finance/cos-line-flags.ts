/**
 * COS line-review integrity flags (R2 / R3 / R4).
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
 *   R3 poMismatch        — the invoiced cost booked against a PO number EXCEEDS
 *      that PO's authorised total (beyond tolerance) — i.e. over-invoiced or a
 *      mis-booked PO. Computed at PO grain (sum of all lines on the PO vs the PO
 *      total) and surfaced on every line of the offending PO. Partial / under-
 *      invoicing (sum < PO total) is normal — a PO not yet fully delivered — and
 *      must NOT flag.
 *   R4 anomaly           — the line's cost is >= 8x the median cost of its
 *      category (per project), i.e. a likely fat-finger / mis-categorised entry.
 */

/** § 3.3 derivation warnings that mean "revenue allocation missing" (R2). */
const ALLOCATION_MISSING_WARNINGS = new Set([
  "category_revenue_allocation_missing",
  "missing_category_allocation_linkage",
]);

/** A line invoiced against a PO must reconcile to the PO total within the
 *  greater of R1 (rounding) and 1% of the PO value before we call it a
 *  mismatch — avoids flagging cent-level rounding noise. */
export const PO_MISMATCH_ABS_TOLERANCE = 1;
export const PO_MISMATCH_PCT_TOLERANCE = 0.01;

/** A line >= 8x its category median cost is flagged as an anomaly (R4). */
export const ANOMALY_MEDIAN_FACTOR = 8;

export interface CosLineFlagInput {
  /** § 3.3 line id (actuals grain). */
  lineId: number;
  projectId: number | null;
  categoryAllocationId: number | null;
  /** Line cost (actual_total). */
  actualTotal: number;
  /** PO number this line is booked against (text; null when none). */
  poNumber: string | null;
  /** The § 3.3 derivation warning for this line (drives R2). */
  derivationWarning: string | null;
}

export interface CosLineFlags {
  lineId: number;
  /** R2 — category revenue allocation (col J) missing. */
  allocationMissing: boolean;
  /** R3 — invoiced cost on this line's PO does not match the PO total. */
  poMismatch: boolean;
  /** R3 detail — sum(lines on PO) − PO total; null when no comparable PO. */
  poDelta: number | null;
  /** R4 — cost is >= ANOMALY_MEDIAN_FACTOR x the category median. */
  anomaly: boolean;
  /** R4 detail — actualTotal / categoryMedian; null when no usable median. */
  anomalyFactor: number | null;
  /** True when any of R2 / R3 / R4 fired. */
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
 * Compute R2/R3/R4 flags for a set of cost lines.
 *
 * @param lines             the § 3.3 lines to evaluate.
 * @param poTotalsByNumber  authorised PO total keyed by PO number (string).
 *                          A PO number absent from this map is treated as
 *                          "no comparable PO" and never produces a mismatch
 *                          (external / legacy POs are not flagged as noise).
 */
export function computeCosLineFlags(
  lines: readonly CosLineFlagInput[],
  poTotalsByNumber: ReadonlyMap<string, number>,
): CosLineFlags[] {
  // R3 — sum invoiced cost per PO number, then compare to the PO total.
  const invoicedByPo = new Map<string, number>();
  for (const line of lines) {
    if (!line.poNumber) continue;
    invoicedByPo.set(
      line.poNumber,
      (invoicedByPo.get(line.poNumber) ?? 0) + line.actualTotal,
    );
  }
  const poDeltaByNumber = new Map<string, number>();
  const poMismatchNumbers = new Set<string>();
  for (const [po, invoiced] of invoicedByPo) {
    const total = poTotalsByNumber.get(po);
    if (total == null) continue; // no comparable PO — never flag.
    const delta = invoiced - total;
    poDeltaByNumber.set(po, delta);
    // Only OVER-invoicing flags. Under-invoicing (delta < 0) is a PO not yet
    // fully delivered — normal, never a mismatch.
    const pctTol = Math.abs(total) * PO_MISMATCH_PCT_TOLERANCE;
    if (delta > Math.max(PO_MISMATCH_ABS_TOLERANCE, pctTol)) {
      poMismatchNumbers.add(po);
    }
  }

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

    const poMismatch = line.poNumber
      ? poMismatchNumbers.has(line.poNumber)
      : false;
    const poDelta = line.poNumber
      ? poDeltaByNumber.get(line.poNumber) ?? null
      : null;

    const med = medianByCategory.get(categoryKey(line)) ?? 0;
    const anomalyFactor = med > 0 ? Math.abs(line.actualTotal) / med : null;
    const anomaly = anomalyFactor != null && anomalyFactor >= ANOMALY_MEDIAN_FACTOR;

    return {
      lineId: line.lineId,
      allocationMissing,
      poMismatch,
      poDelta,
      anomaly,
      anomalyFactor,
      flagged: allocationMissing || poMismatch || anomaly,
    };
  });
}
