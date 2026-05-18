export type ProgressPercentSource = "cache" | "live" | "missing";

export interface ProgressPercentChoice {
  value: number | null;
  source: ProgressPercentSource;
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim().replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts mixed persisted progress scales into display percent.
 *
 * Smart Import writes work_items.percent_complete on the canonical 0..1 scale,
 * while older cached KPI rows may already be stored as 0..100. Priority cards
 * need a single 0..100 integer for labels and bar width.
 */
export function toDisplayProgressPercent(value: unknown): number | null {
  const n = parseNumeric(value);
  if (n === null) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function chooseProgressPercent(args: {
  cachedPct: unknown;
  liveAvgPct: unknown;
  liveTaskCount: unknown;
}): ProgressPercentChoice {
  const cached = toDisplayProgressPercent(args.cachedPct);
  const live = toDisplayProgressPercent(args.liveAvgPct);
  const liveTaskCount = Number(args.liveTaskCount || 0);

  if (cached !== null && cached > 0) {
    return { value: cached, source: "cache" };
  }
  if (liveTaskCount > 0) {
    return { value: live ?? 0, source: "live" };
  }
  if (cached !== null) {
    return { value: cached, source: "cache" };
  }
  return { value: null, source: "missing" };
}
