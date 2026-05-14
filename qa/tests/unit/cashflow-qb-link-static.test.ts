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

  it('keeps the cashflow QuickBooks dialog visible, compact, and scroll-contained', () => {
    expect(cashflowPage).toContain('data-testid="dialog-cashflow-qb-match"');
    expect(cashflowPage).toContain('z-[60]');
    expect(cashflowPage).toContain("width: 'min(calc(100vw - 1rem), 1120px)'");
    expect(cashflowPage).toContain('zIndex: 60');
    expect(cashflowPage).toContain('max-h-[min(86dvh,780px)]');
    expect(cashflowPage).toContain('overflow-hidden');
    expect(cashflowPage).toContain('touch-compact h-4');
    expect(cashflowPage).toContain('event.stopPropagation()');
  });

  it('allows callers to seed the match panel search from an invoice number', () => {
    expect(matchPanel).toContain('initialSearch');
    expect(matchPanel).toContain('useState(initialSearch)');
  });
});
