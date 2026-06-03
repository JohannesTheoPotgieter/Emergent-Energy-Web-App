import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The FYE tab's actual revenue/COS comes from the canonical single read path
// (FinanceLineLevelRepository, § 3.3). After the FY26-tracking rebuild that
// usage lives in the service layer; the route delegates to it.
const service = fs.readFileSync(
  path.resolve(process.cwd(), 'server/lib/finance/fye-tracking/service.ts'),
  'utf8',
);
const computeSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'server/lib/finance/fye-tracking/compute.ts'),
  'utf8',
);

describe('FYE revenue tracking canonical finance source', () => {
  it('uses the finance line-level repository for actual revenue and COS', () => {
    expect(service).toContain('FinanceLineLevelRepository');
    expect(service).toContain('getPortfolioFinanceLines');
  });

  it('does not reimplement the forbidden pooled COS-ratio revenue formula', () => {
    for (const src of [service, computeSrc]) {
      expect(src).not.toContain('(amt / projectTotalCOS) * projectTotalRevenue');
      expect(src).not.toContain('projectTotalCOS > 0 ? (amt / projectTotalCOS)');
    }
  });

  it('consumes per-line revenue rather than deriving it (perLineRevenue / actualTotal)', () => {
    expect(computeSrc).toContain('perLineRevenue');
    expect(computeSrc).toContain('actualTotal');
  });
});
