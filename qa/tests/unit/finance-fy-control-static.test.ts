import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const focusedScreens = [
  'client/src/pages/execution-dashboard/FinancePage.tsx',
  'client/src/pages/cashflow.tsx',
  'client/src/pages/cos.tsx',
  'client/src/pages/revenue-tracker.tsx',
  'client/src/pages/finance-gp-company.tsx',
  'client/src/pages/fye-revenue-tracking.tsx',
];

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('focused finance screens expose shared FY/all-data scope control', () => {
  it.each(focusedScreens)('%s renders the shared scope control', (relativePath) => {
    const source = read(relativePath);

    expect(source).toContain('FinancialYearScopeControl');
  });

  it.each([
    'client/src/pages/cashflow.tsx',
    'client/src/pages/cos.tsx',
    'client/src/pages/revenue-tracker.tsx',
    'client/src/pages/finance-gp-company.tsx',
    'client/src/pages/fye-revenue-tracking.tsx',
    'client/src/pages/execution-dashboard/use-execution-data.ts',
  ])('%s includes the scope query in its data request identity', (relativePath) => {
    const source = read(relativePath);

    expect(source).toContain('fyScope.apiQueryString');
  });

  it('FYE revenue tracking uses the shared FY/all-data selector instead of a local select', () => {
    const source = read('client/src/pages/fye-revenue-tracking.tsx');

    expect(source).toContain('FinancialYearScopeControl');
    expect(source).not.toContain('data-testid="select-fye"');
  });
});
