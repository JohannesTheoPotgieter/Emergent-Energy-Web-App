export function isImportStale(lastImportedAt: string | null | undefined): boolean {
  if (!lastImportedAt || lastImportedAt.toLowerCase() === "unknown") return true;
  const parsed = new Date(lastImportedAt);
  if (Number.isNaN(parsed.getTime())) return true;
  return (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24) > 7;
}

export function computeDateShiftDays(prev: unknown, curr: unknown): number | null {
  if (typeof prev !== "string" || typeof curr !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prev) || !/^\d{4}-\d{2}-\d{2}$/.test(curr)) return null;
  return Math.round((new Date(curr).getTime() - new Date(prev).getTime()) / 864e5);
}

export function isQbDivergent(
  appAmount: number | null,
  qbAmount: number | null,
  taxUncertain?: boolean,
): boolean {
  if (appAmount === null || qbAmount === null) return false;
  if (taxUncertain) return false;
  return Math.abs(appAmount - qbAmount) > 100;
}
