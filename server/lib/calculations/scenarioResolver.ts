import type { CashflowLineItem } from "./cashflow";
import type { COSLineItem } from "./cosAggregator";

export interface EffectiveDateMap {
  [entityKey: string]: { [fieldName: string]: string };
}

// DEPRECATED: Override tables have been dropped (Cleanup Prompt 4).
// These functions are stubs that return inputs unchanged.

export function buildOverrideMap(_overrides: any[]): EffectiveDateMap {
  return {};
}

export function getEffectiveDate(
  _overrideMap: EffectiveDateMap,
  _entityType: string,
  _entityId: string,
  _fieldName: string,
  importedDate: string | null,
): string | null {
  return importedDate;
}

export function applyOverridesToCashflowLines(
  lines: CashflowLineItem[],
  _overrideMap: EffectiveDateMap,
): CashflowLineItem[] {
  return lines;
}

export function applyOverridesToCOSLines(
  lines: COSLineItem[],
  _overrideMap: EffectiveDateMap,
): COSLineItem[] {
  return lines;
}

export function computeMonthlyBuckets(
  lines: COSLineItem[],
): Map<string, { planned: number; committed: number; invoiced: number; paid: number }> {
  const buckets = new Map<string, { planned: number; committed: number; invoiced: number; paid: number }>();

  for (const line of lines) {
    const effectiveDate = line.paymentDate || line.forecastPaymentDate || line.invoicedDate;
    if (!effectiveDate) continue;

    const d = new Date(effectiveDate);
    if (isNaN(d.getTime())) continue;

    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(monthKey)) {
      buckets.set(monthKey, { planned: 0, committed: 0, invoiced: 0, paid: 0 });
    }

    const bucket = buckets.get(monthKey)!;
    const amount = Math.abs(line.amount);

    switch (line.state) {
      case 'Planned': bucket.planned += amount; break;
      case 'Committed': bucket.committed += amount; break;
      case 'Invoiced': bucket.invoiced += amount; break;
      case 'Paid': bucket.paid += amount; break;
    }
  }

  return buckets;
}
