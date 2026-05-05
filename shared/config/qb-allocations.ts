/**
 * Configuration for QuickBooks invoice-link allocations (Task #142).
 *
 * Many-to-many allocations: a single QB doc may be paid off by N app lines
 * (e.g. customer pays 10 invoices in one bank deposit) and a single app
 * line may be paid off by N QB docs (e.g. one invoice settled by two
 * partial QB receipts). Each `quickbooks_invoice_links` row now carries
 * an explicit `allocated_amount_ex_vat` and the writer enforces that the
 * sum of allocations against any one QB doc equals the doc total within
 * the tolerance defined here.
 *
 * Tolerance rule (default ±R0.50 OR ±0.5%, whichever is larger):
 *   - covers ZAR rounding from QB JSON serialisation (1c/cent drift)
 *   - covers small rebanking fees skimmed from large deposits
 *
 * Pure module — no DB / network imports — so it can be loaded by both
 * the server writer and the client drawer for symmetric validation.
 */

export const QB_ALLOCATION_FIXED_TOLERANCE_ZAR = 0.5;
export const QB_ALLOCATION_PCT_TOLERANCE = 0.005;

/**
 * Computes the maximum acceptable difference between the sum of
 * allocations and the QB doc total. Returns 0 when `qbDocTotal` is null
 * (the writer treats null totals as "do not enforce sum"; the UI surfaces
 * a `qb_amount_unknown` warning instead).
 */
export function qbAllocationToleranceFor(qbDocTotal: number | null): number {
  if (qbDocTotal === null || qbDocTotal === undefined) return 0;
  const pct = Math.abs(qbDocTotal) * QB_ALLOCATION_PCT_TOLERANCE;
  return Math.max(QB_ALLOCATION_FIXED_TOLERANCE_ZAR, pct);
}

export interface QbAllocationToleranceResult {
  /** Sum of allocations passed in (rounded to 2dp). */
  sum: number;
  /** Signed difference between sum and QB doc total (negative = under-allocated, positive = over). Null if total unknown. */
  delta: number | null;
  /** Effective tolerance (max of fixed + pct rules). */
  tolerance: number;
  /**
   * True when the writer accepts the allocation: total unknown, balanced
   * within tolerance, OR under-allocated (partial settlement). Only
   * over-allocation beyond tolerance is rejected.
   */
  ok: boolean;
  /** True when |delta| > 0 but ≤ tolerance — caller flags `allocation_tolerance_applied`. */
  toleranceApplied: boolean;
  /**
   * True when sum is below QB total by more than tolerance — operator is
   * intentionally partially settling the QB doc; the remaining portion
   * stays unallocated and can be linked to other app lines later.
   */
  partial: boolean;
  /** Remaining unallocated Rand on the QB doc (0 when balanced or over). */
  remaining: number;
}

/**
 * Validate a sibling group's allocation sum against the QB doc total.
 * Pure — used by the server writer (transactional) and the client
 * drawer (live Approve-button gating).
 */
export function checkQbAllocationSum(
  qbDocTotal: number | null,
  allocations: ReadonlyArray<{ allocatedAmountExVat: number }>,
): QbAllocationToleranceResult {
  const sum = Number(
    allocations.reduce((acc, a) => acc + (Number.isFinite(a.allocatedAmountExVat) ? a.allocatedAmountExVat : 0), 0).toFixed(2),
  );
  if (qbDocTotal === null || qbDocTotal === undefined) {
    return { sum, delta: null, tolerance: 0, ok: true, toleranceApplied: false, partial: false, remaining: 0 };
  }
  const delta = Number((sum - qbDocTotal).toFixed(2));
  const tolerance = qbAllocationToleranceFor(qbDocTotal);
  const absDelta = Math.abs(delta);
  const withinTol = absDelta <= tolerance + 1e-9;
  const overAllocated = delta > tolerance + 1e-9;
  const partial = delta < -(tolerance + 1e-9);
  const remaining = partial ? Number((-delta).toFixed(2)) : 0;
  return {
    sum,
    delta,
    tolerance: Number(tolerance.toFixed(4)),
    ok: !overAllocated,
    toleranceApplied: withinTol && absDelta > 0,
    partial,
    remaining,
  };
}

/**
 * Treats legacy single-link rows (created before this feature) as full 100%
 * allocations of their QB doc when `allocated_amount_ex_vat` is 0/NULL but
 * `qb_amount` carries a value. Use everywhere a downstream consumer needs
 * the canonical "what does this link consume from the QB doc" number.
 */
export function effectiveAllocatedAmountExVat(link: {
  allocatedAmountExVat: string | number | null;
  qbAmount: string | number | null;
}): number | null {
  const alloc = link.allocatedAmountExVat;
  if (alloc !== null && alloc !== undefined) {
    const n = typeof alloc === "number" ? alloc : Number(alloc);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const qb = link.qbAmount;
  if (qb === null || qb === undefined) return null;
  const n = typeof qb === "number" ? qb : Number(qb);
  return Number.isFinite(n) ? n : null;
}
