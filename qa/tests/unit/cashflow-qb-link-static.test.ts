import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cashflowPage = readFileSync(join(process.cwd(), 'client/src/pages/cashflow.tsx'), 'utf8');

const matchPanel = readFileSync(
  join(process.cwd(), 'client/src/components/quickbooks/FindQbMatchesPanel.tsx'),
  'utf8',
);
const cascadePanel = readFileSync(
  join(process.cwd(), 'client/src/components/quickbooks/QbCascadeProposalsPanel.tsx'),
  'utf8',
);
const dialogComponent = readFileSync(
  join(process.cwd(), 'client/src/components/ui/dialog.tsx'),
  'utf8',
);
const indexCss = readFileSync(join(process.cwd(), 'client/src/index.css'), 'utf8');

describe('cashflow line detail (no QuickBooks link)', () => {
  it('drops the QuickBooks match-and-link workflow from the cashflow screen', () => {
    expect(cashflowPage).not.toContain('FindQbMatchesPanel');
    expect(cashflowPage).not.toContain('Open QuickBooks match');
    expect(cashflowPage).not.toContain('onOpenQbLink');
    expect(cashflowPage).not.toContain('dialog-cashflow-qb-match');
  });

  it('shows the invoice number on each cashflow line', () => {
    expect(cashflowPage).toContain('milestoneInvoiceNumber');
    expect(cashflowPage).toContain('expenseInvoiceNumber');
  });
});

describe('shared QuickBooks match dialog and panel', () => {
  it('keeps shared dialogs centered under tailwind-merge and layout-mode overrides', () => {
    expect(dialogComponent).toContain('sm:right-auto');
    expect(dialogComponent).not.toContain('sm:inset-x-auto');
    expect(dialogComponent).toContain('sm:-translate-x-1/2');
    expect(dialogComponent).toContain('sm:-translate-y-1/2');
    expect(indexCss).toContain('translate: -50% -50% !important');
    expect(indexCss).toContain('transform: none !important');
    expect(indexCss).not.toContain('inset-inline: auto !important');
    expect(indexCss).toContain('[data-wide-dialog][data-state="open"]');
    expect(indexCss).toContain('1280px');
  });

  it('lets long proposal text wrap instead of clipping inside the modal', () => {
    expect(cascadePanel).toContain('break-words');
    expect(cascadePanel).toContain('grid-cols-1 sm:grid-cols-2');
    expect(cascadePanel).toContain('flex-wrap');
    expect(cascadePanel).toContain('min-w-0');
  });

  it('allows callers to seed the match panel search from an invoice number', () => {
    expect(matchPanel).toContain('initialSearch');
    expect(matchPanel).toContain('useState(initialSearch)');
  });
});
