import { useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';

export interface FinancialYearOption {
  value: string;
  label: string;
}

export interface FinancialYearScope {
  allData: boolean;
  fy: number | null;
  label: string;
  startDate: string | null;
  endDate: string | null;
  startMonthKey: string | null;
  endMonthKey: string | null;
  apiQueryString: string;
  options: FinancialYearOption[];
  setFy: (fy: number) => void;
  setAllData: (enabled: boolean) => void;
  appendToUrl: (url: string) => string;
}

export function getCurrentFinancialYear(date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 9 ? year + 1 : year;
}

export function getFinancialYearBounds(fy: number) {
  const startYear = fy - 1;
  return {
    label: `FY${String(fy).slice(-2)}`,
    startDate: `${startYear}-09-01`,
    endDate: `${fy}-08-31`,
    startMonthKey: `${startYear}-09`,
    endMonthKey: `${fy}-08`,
  };
}

function buildOptions(currentFy: number): FinancialYearOption[] {
  return Array.from({ length: 7 }, (_, idx) => {
    const fy = currentFy - 3 + idx;
    return { value: String(fy), label: `FY${String(fy).slice(-2)}` };
  });
}

function currentSearch(location: string): URLSearchParams {
  const searchFromLocation = location.includes('?') ? location.split('?')[1] : '';
  const searchFromWindow =
    typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
  return new URLSearchParams(searchFromLocation || searchFromWindow);
}

function pathWithoutSearch(location: string): string {
  return location.split('?')[0] || (typeof window !== 'undefined' ? window.location.pathname : '/');
}

export function useFinancialYearScope(): FinancialYearScope {
  const [location, navigate] = useLocation();

  const currentFy = getCurrentFinancialYear();
  const params = useMemo(() => currentSearch(location), [location]);
  const rawFy = params.get('fy');
  const allData =
    rawFy === 'all' || params.get('scope') === 'all' || params.get('allData') === 'true';
  const parsedFy = rawFy && rawFy !== 'all' ? Number.parseInt(rawFy, 10) : NaN;
  const fy = allData ? null : Number.isFinite(parsedFy) ? parsedFy : currentFy;
  const bounds = fy ? getFinancialYearBounds(fy) : null;
  const apiQueryString = allData ? 'fy=all' : `fy=${fy}`;

  const updateRoute = useCallback(
    (nextFy: string) => {
      const nextParams = currentSearch(location);
      nextParams.set('fy', nextFy);
      nextParams.delete('scope');
      nextParams.delete('allData');
      const nextSearch = nextParams.toString();
      navigate(`${pathWithoutSearch(location)}${nextSearch ? `?${nextSearch}` : ''}`);
    },
    [location, navigate],
  );

  const setFy = useCallback((nextFy: number) => updateRoute(String(nextFy)), [updateRoute]);
  const setAllData = useCallback(
    (enabled: boolean) => {
      updateRoute(enabled ? 'all' : String(currentFy));
    },
    [currentFy, updateRoute],
  );

  const appendToUrl = useCallback(
    (url: string): string => {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${apiQueryString}`;
    },
    [apiQueryString],
  );

  return {
    allData,
    fy,
    label: allData ? 'All data' : (bounds?.label ?? `FY${String(currentFy).slice(-2)}`),
    startDate: bounds?.startDate ?? null,
    endDate: bounds?.endDate ?? null,
    startMonthKey: bounds?.startMonthKey ?? null,
    endMonthKey: bounds?.endMonthKey ?? null,
    apiQueryString,
    options: buildOptions(currentFy),
    setFy,
    setAllData,
    appendToUrl,
  };
}
