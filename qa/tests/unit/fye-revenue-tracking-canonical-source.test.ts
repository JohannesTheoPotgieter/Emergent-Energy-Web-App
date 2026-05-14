import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'server/departments/fye-revenue-tracking-routes.ts'),
  'utf8',
);

describe('FYE revenue tracking canonical finance source', () => {
  it('uses the finance line-level repository for actual revenue and COS', () => {
    expect(source).toContain('FinanceLineLevelRepository');
    expect(source).toContain('getPortfolioFinanceLines');
  });

  it('does not reimplement the forbidden pooled COS-ratio revenue formula', () => {
    expect(source).not.toContain('(amt / projectTotalCOS) * projectTotalRevenue');
    expect(source).not.toContain('projectTotalCOS > 0 ? (amt / projectTotalCOS)');
  });
});
