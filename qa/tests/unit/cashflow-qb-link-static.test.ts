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

describe('cashflow QuickBooks link workflow', () => {
  it('keeps the QuickBooks match-and-link workflow on the cashflow screen', () => {
    expect(cashflowPage).toContain('FindQbMatchesPanel');
    expect(cashflowPage).toContain('Open QuickBooks match');
    expect(cashflowPage).toContain('initialSearch');
  });

  it('keeps the cashflow QuickBooks dialog visible, compact, and scroll-contained', () => {
    expect(cashflowPage).toContain('type QbLinkContext');
    expect(cashflowPage).toContain('onOpenQbLink={setQbLinkContext}');
    expect(cashflowPage).toContain('onOpenQbLink: (ctx: QbLinkContext) => void');
    expect(cashflowPage).toContain('data-testid="dialog-cashflow-qb-match"');
    expect(cashflowPage).toContain('data-wide-dialog');
    expect(cashflowPage).toContain('z-[60]');
    expect(cashflowPage).toContain("width: 'min(calc(100vw - 1rem), 1280px)'");
    expect(cashflowPage).toContain('zIndex: 60');
    expect(cashflowPage).toContain('max-h-[min(92dvh,920px)]');
    expect(cashflowPage).toContain('overflow-hidden');
    expect(cashflowPage).toContain('touch-compact h-4');
    expect(cashflowPage).toContain('stopPropagation()');
  });

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
