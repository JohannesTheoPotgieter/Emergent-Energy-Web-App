import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cashflowPage = readFileSync(join(process.cwd(), 'client/src/pages/cashflow.tsx'), 'utf8');

const matchPanel = readFileSync(
  join(process.cwd(), 'client/src/components/quickbooks/FindQbMatchesPanel.tsx'),
  'utf8',
);

describe('cashflow QuickBooks link workflow', () => {
  it('keeps the QuickBooks match-and-link workflow on the cashflow screen', () => {
    expect(cashflowPage).toContain('FindQbMatchesPanel');
    expect(cashflowPage).toContain('Open QuickBooks match');
    expect(cashflowPage).toContain('initialSearch');
  });

  it('keeps the cashflow QuickBooks dialog wired and scoped to the link context', () => {
    expect(cashflowPage).toContain('type QbLinkContext');
    expect(cashflowPage).toContain('onOpenQbLink={setQbLinkContext}');
    expect(cashflowPage).toContain('onOpenQbLink: (ctx: QbLinkContext) => void');
    expect(cashflowPage).toContain('data-testid="dialog-cashflow-qb-match"');
    expect(cashflowPage).toContain('open={!!qbLinkContext}');
    expect(cashflowPage).toContain('setQbLinkContext(null)');
  });

  it('allows callers to seed the match panel search from an invoice number', () => {
    expect(matchPanel).toContain('initialSearch');
    expect(matchPanel).toContain('useState(initialSearch)');
  });
});
