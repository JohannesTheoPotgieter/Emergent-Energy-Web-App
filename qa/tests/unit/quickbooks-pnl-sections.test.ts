import { describe, expect, it } from 'vitest';

import { extractMonthlyPnLSections } from '../../../server/services/quickbooks-service';

/**
 * QuickBooks' own Revenue / COS / GP read from the standard P&L section
 * structure (Income + Cost of Sales) rather than by account-number prefix.
 * This is the source the finance Revenue / COS / GP comparison columns use.
 */

// A report whose Income/COS sections carry per-account leaf rows but NO
// section Summary — totals must be derived by summing the leaf accounts.
const reportWithoutSummary = {
  Columns: {
    Column: [
      { ColTitle: '' },
      { ColTitle: 'Sep 2025', MetaData: [{ Name: 'StartDate', Value: '2025-09-01' }] },
      { ColTitle: 'Oct 2025', MetaData: [{ Name: 'StartDate', Value: '2025-10-01' }] },
      { ColTitle: 'Total' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Income' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ id: '200000', value: '200000 Solar Sales' }, { value: '1000.50' }, { value: '2000.25' }, { value: '3000.75' }] },
            { type: 'Data', ColData: [{ id: '200100', value: '200100 O&M Sales' }, { value: '400' }, { value: '' }, { value: '400' }] },
          ],
        },
      },
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Cost of Sales' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ id: '1000000', value: '1000000 Materials' }, { value: '250' }, { value: '300' }, { value: '550' }] },
            { type: 'Data', ColData: [{ id: '1000100', value: '1000100 Labour' }, { value: '100' }, { value: '150' }, { value: '250' }] },
          ],
        },
      },
    ],
  },
};

describe('extractMonthlyPnLSections', () => {
  it('totals revenue from the Income section and COS from the Cost of Sales section', () => {
    const r = extractMonthlyPnLSections(reportWithoutSummary);

    expect(Array.from(r.income.entries())).toEqual([
      ['2025-09', 1400.5],
      ['2025-10', 2000.25],
    ]);
    expect(Array.from(r.costOfSales.entries())).toEqual([
      ['2025-09', 350],
      ['2025-10', 450],
    ]);
  });

  it('derives Gross Profit as Income − Cost of Sales per month', () => {
    const r = extractMonthlyPnLSections(reportWithoutSummary);
    expect(Array.from(r.grossProfit.entries())).toEqual([
      ['2025-09', 1050.5],
      ['2025-10', 1550.25],
    ]);
  });

  it('returns per-account detail that reconciles to the section total', () => {
    const r = extractMonthlyPnLSections(reportWithoutSummary);

    // Income drilldown — 200100 has no Oct value, so only three rows.
    expect(r.incomeAccounts).toEqual([
      { accountId: '200000', accountName: '200000 Solar Sales', monthKey: '2025-09', amount: 1000.5 },
      { accountId: '200000', accountName: '200000 Solar Sales', monthKey: '2025-10', amount: 2000.25 },
      { accountId: '200100', accountName: '200100 O&M Sales', monthKey: '2025-09', amount: 400 },
    ]);

    // Each section total equals the sum of its drilldown rows for that month.
    const sumSep = r.incomeAccounts
      .filter((a) => a.monthKey === '2025-09')
      .reduce((s, a) => s + a.amount, 0);
    expect(sumSep).toBe(r.income.get('2025-09'));
    expect(r.costOfSalesAccounts).toHaveLength(4);
  });

  it('does not double-count a parent account that also lists its sub-accounts', () => {
    // QB renders a parent account with sub-accounts as a nested Section whose
    // Summary equals the sum of the children. Only the leaf children must count.
    const nested = {
      Columns: {
        Column: [
          { ColTitle: '' },
          { ColTitle: 'Sep 2025', MetaData: [{ Name: 'StartDate', Value: '2025-09-01' }] },
          { ColTitle: 'Total' },
        ],
      },
      Rows: {
        Row: [
          {
            type: 'Section',
            group: 'Income',
            Header: { ColData: [{ value: 'Income' }] },
            Rows: {
              Row: [
                {
                  type: 'Section',
                  Header: { ColData: [{ id: '200000', value: '200000 Sales' }] },
                  Rows: {
                    Row: [
                      { type: 'Data', ColData: [{ id: '200001', value: '200001 Solar' }, { value: '600' }, { value: '600' }] },
                      { type: 'Data', ColData: [{ id: '200002', value: '200002 O&M' }, { value: '400' }, { value: '400' }] },
                    ],
                  },
                  Summary: { ColData: [{ value: 'Total 200000 Sales' }, { value: '1000' }, { value: '1000' }] },
                },
              ],
            },
          },
        ],
      },
    };

    const r = extractMonthlyPnLSections(nested);
    // 600 + 400 = 1000 (NOT 2000 from also counting the parent Summary).
    expect(r.income.get('2025-09')).toBe(1000);
    expect(r.incomeAccounts).toHaveLength(2);
  });

  it('returns empty maps when the report has no recognisable month columns', () => {
    const r = extractMonthlyPnLSections({ Columns: { Column: [] }, Rows: { Row: [] } });
    expect(r.income.size).toBe(0);
    expect(r.costOfSales.size).toBe(0);
    expect(r.grossProfit.size).toBe(0);
  });
});
