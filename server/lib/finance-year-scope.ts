import { getFiscalYear, getFiscalYearBounds } from '@shared/fiscal-year';

export type FinanceYearScopeMode = 'fy' | 'all';

export interface FinanceYearScope {
  mode: FinanceYearScopeMode;
  fy: number | null;
  label: string;
  startDate: string | null;
  endDate: string | null;
  startMonthKey: string | null;
  endMonthKey: string | null;
  start: string | null;
  end: string | null;
}

type QueryLike = Record<string, unknown>;

function firstQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? firstQueryValue(value[0]) : null;
  if (value == null) return null;
  return String(value);
}

export function getCurrentFinanceYear(today = new Date()): number {
  // Delegates to the single canonical FY source (shared/fiscal-year.ts), which
  // is SAST-anchored — matching server/lib/fy-window.ts and resolving the
  // IMPORTER_AUDIT UTC-drift note (the boundary no longer flips ~2h early).
  return getFiscalYear(today);
}

export function getFinanceYearBounds(fy: number) {
  const bounds = getFiscalYearBounds(fy);
  return {
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    startMonthKey: bounds.startMonthKey,
    endMonthKey: bounds.endMonthKey,
    label: bounds.label,
  };
}

export function resolveFinanceYearScope(
  query: QueryLike = {},
  today = new Date(),
): FinanceYearScope {
  const rawFy = firstQueryValue(query.fy ?? query.fye);
  const rawScope = firstQueryValue(query.scope);
  const rawAllData = firstQueryValue(query.allData ?? query.all);
  const allRequested =
    rawFy?.toLowerCase() === 'all' ||
    rawScope?.toLowerCase() === 'all' ||
    rawAllData?.toLowerCase() === 'true' ||
    rawAllData === '1';

  if (allRequested) {
    return {
      mode: 'all',
      fy: null,
      label: 'All data',
      startDate: null,
      endDate: null,
      startMonthKey: null,
      endMonthKey: null,
      start: null,
      end: null,
    };
  }

  const parsedFy = rawFy ? Number.parseInt(rawFy, 10) : NaN;
  const fy =
    Number.isInteger(parsedFy) && parsedFy >= 2000 && parsedFy <= 2100
      ? parsedFy
      : getCurrentFinanceYear(today);
  const bounds = getFinanceYearBounds(fy);
  return {
    mode: 'fy',
    fy,
    ...bounds,
    start: bounds.startDate,
    end: bounds.endDate,
  };
}

export function getFinanceScopeMonthKeys(
  scope: FinanceYearScope,
  fallbackMonthKeys: string[] = [],
): string[] {
  if (scope.mode === 'all') {
    return Array.from(new Set(fallbackMonthKeys.filter((m) => /^\d{4}-\d{2}$/.test(m)))).sort();
  }
  if (!scope.startMonthKey || !scope.endMonthKey) return [];
  const [startYear, startMonth] = scope.startMonthKey.split('-').map(Number);
  const [endYear, endMonth] = scope.endMonthKey.split('-').map(Number);
  const out: string[] = [];
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));
  while (cursor <= end) {
    out.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export function monthKeyInFinanceScope(
  monthKey: string | null | undefined,
  scope: FinanceYearScope,
): boolean {
  if (scope.mode === 'all') return true;
  if (!monthKey || !scope.startMonthKey || !scope.endMonthKey) return false;
  return monthKey >= scope.startMonthKey && monthKey <= scope.endMonthKey;
}

export function dateInFinanceScope(
  dateValue: string | null | undefined,
  scope: FinanceYearScope,
): boolean {
  if (scope.mode === 'all') return true;
  if (!dateValue || !scope.startDate || !scope.endDate) return false;
  const iso = dateValue.slice(0, 10);
  return iso >= scope.startDate && iso <= scope.endDate;
}

export function financeScopeToQuery(scope: FinanceYearScope): string {
  return scope.mode === 'all' ? 'fy=all' : `fy=${scope.fy}`;
}

export function monthKeyFromDate(dateValue: string | null | undefined): string | null {
  if (!dateValue) return null;
  const match = String(dateValue).match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}
