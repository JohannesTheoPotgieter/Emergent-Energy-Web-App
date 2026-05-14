import { describe, expect, it } from 'vitest';

import {
  financeScopeToQuery,
  getFinanceScopeMonthKeys,
  monthKeyInFinanceScope,
  resolveFinanceYearScope,
} from '../../../server/lib/finance-year-scope';

describe('finance year scope helper', () => {
  it('defaults to the current South African EPC financial year', () => {
    const scope = resolveFinanceYearScope({}, new Date('2026-05-14T10:00:00Z'));

    expect(scope).toMatchObject({
      mode: 'fy',
      fy: 2026,
      label: 'FY26',
      startDate: '2025-09-01',
      endDate: '2026-08-31',
      startMonthKey: '2025-09',
      endMonthKey: '2026-08',
    });
    expect(getFinanceScopeMonthKeys(scope)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it('parses an explicit FY and keeps month filtering bounded to that year', () => {
    const scope = resolveFinanceYearScope({ fy: '2025' }, new Date('2026-05-14T10:00:00Z'));

    expect(scope.label).toBe('FY25');
    expect(scope.startDate).toBe('2024-09-01');
    expect(scope.endDate).toBe('2025-08-31');
    expect(monthKeyInFinanceScope('2025-08', scope)).toBe(true);
    expect(monthKeyInFinanceScope('2025-09', scope)).toBe(false);
    expect(financeScopeToQuery(scope)).toBe('fy=2025');
  });

  it('parses the all-data toggle and disables date bounds', () => {
    const scope = resolveFinanceYearScope({ fy: 'all' }, new Date('2026-05-14T10:00:00Z'));

    expect(scope).toMatchObject({
      mode: 'all',
      fy: null,
      label: 'All data',
      startDate: null,
      endDate: null,
      startMonthKey: null,
      endMonthKey: null,
    });
    expect(monthKeyInFinanceScope('2020-01', scope)).toBe(true);
    expect(monthKeyInFinanceScope('2030-12', scope)).toBe(true);
    expect(financeScopeToQuery(scope)).toBe('fy=all');
  });

  it('accepts the FYE route alias for all-data finance pages', () => {
    const scope = resolveFinanceYearScope({ fye: 'all' }, new Date('2026-05-14T10:00:00Z'));

    expect(scope.mode).toBe('all');
    expect(scope.fy).toBeNull();
  });
});
