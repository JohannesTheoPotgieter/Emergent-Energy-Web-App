import { describe, expect, it } from 'vitest';

import {
  extractMonthlyAccountDetailsFromPnL,
  extractMonthlyAccountTotalsFromPnL,
} from '../../../server/services/quickbooks-service';

const report = {
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
            {
              type: 'Data',
              ColData: [
                { id: '100100', value: '100100 Solar Sales' },
                { value: '1000.50' },
                { value: '2000.25' },
                { value: '3000.75' },
              ],
            },
            {
              type: 'Data',
              ColData: [
                { id: '100200', value: '100200 O&M Sales' },
                { value: '400' },
                { value: '' },
                { value: '400' },
              ],
            },
          ],
        },
      },
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Cost of Sales' }] },
        Rows: {
          Row: [
            {
              type: 'Data',
              ColData: [
                { id: '200100', value: '200100 Materials' },
                { value: '250' },
                { value: '300' },
                { value: '550' },
              ],
            },
          ],
        },
      },
    ],
  },
};

describe('QuickBooks P&L monthly account detail extraction', () => {
  it('returns every matching account with month-level amounts', () => {
    const details = extractMonthlyAccountDetailsFromPnL(
      report,
      (acc) => acc.id?.startsWith('100') === true,
    );

    expect(details).toEqual([
      {
        accountId: '100100',
        accountName: '100100 Solar Sales',
        monthKey: '2025-09',
        amount: 1000.5,
      },
      {
        accountId: '100100',
        accountName: '100100 Solar Sales',
        monthKey: '2025-10',
        amount: 2000.25,
      },
      {
        accountId: '100200',
        accountName: '100200 O&M Sales',
        monthKey: '2025-09',
        amount: 400,
      },
    ]);
  });

  it('keeps the legacy monthly total helper as the sum of matching accounts', () => {
    const totals = extractMonthlyAccountTotalsFromPnL(
      report,
      (acc) => acc.id?.startsWith('100') === true,
    );

    expect(Array.from(totals.entries())).toEqual([
      ['2025-09', 1400.5],
      ['2025-10', 2000.25],
    ]);
  });
});
