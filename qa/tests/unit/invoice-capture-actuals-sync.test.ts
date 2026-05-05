import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('invoice capture actuals sync guardrails', () => {
  const src = readFileSync('server/invoice-capture-routes.ts', 'utf8');

  it('syncs into normalized_cost_lines using PO match', () => {
    expect(src).toContain('UPDATE normalized_cost_lines ncl');
    expect(src).toContain('ncl.po_number = po.po_number');
  });

  it('does not silently overwrite imported/manual data', () => {
    expect(src).toContain("(ncl.invoice_number IS NULL OR btrim(ncl.invoice_number) = '')");
    expect(src).toContain('WHEN ncl.invoice_date IS NULL THEN');
    expect(src).toContain('ncl.manual_overrides IS NULL');
  });

  it('marks synced invoice date as trusted and auditable', () => {
    expect(src).toContain("invoice_date_confirmed = CASE");
    expect(src).toContain("invoice_date_font_color = CASE");
    expect(src).toContain("action: 'sync_actuals'");
  });
});
