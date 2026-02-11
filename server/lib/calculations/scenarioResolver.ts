import type { DateOverride } from "@shared/schema";
import type { CashflowLineItem } from "./cashflow";
import type { COSLineItem } from "./cosAggregator";

export interface EffectiveDateMap {
  [entityKey: string]: { [fieldName: string]: string };
}

export function buildOverrideMap(overrides: DateOverride[]): EffectiveDateMap {
  const map: EffectiveDateMap = {};
  for (const ov of overrides) {
    const key = `${ov.entityType}::${ov.entityId}`;
    if (!map[key]) map[key] = {};
    map[key][ov.fieldName] = ov.overrideDate;
  }
  return map;
}

export function getEffectiveDate(
  overrideMap: EffectiveDateMap,
  entityType: string,
  entityId: string,
  fieldName: string,
  importedDate: string | null,
): string | null {
  const key = `${entityType}::${entityId}`;
  const overrideDate = overrideMap[key]?.[fieldName];
  return overrideDate ?? importedDate;
}

export function applyOverridesToCashflowLines(
  lines: CashflowLineItem[],
  overrideMap: EffectiveDateMap,
): CashflowLineItem[] {
  return lines.map(line => {
    const entityType = line.type === 'inflow' ? 'inflow_line' : 'expense_line';
    const entityId = String(line.id);
    const key = `${entityType}::${entityId}`;

    if (!overrideMap[key]) return line;

    const result = { ...line };

    if (line.type === 'outflow') {
      const paymentOverride = overrideMap[key]?.['payment_date'];
      if (paymentOverride) {
        if (line.actualDate) {
          result.actualDate = paymentOverride;
        } else {
          result.forecastDate = paymentOverride;
        }
      }
      const invoiceOverride = overrideMap[key]?.['invoice_date'];
      if (invoiceOverride && !paymentOverride) {
        if (!result.actualDate) {
          result.forecastDate = invoiceOverride;
        }
      }
    } else {
      const receiptOverride = overrideMap[key]?.['receipt_date'];
      if (receiptOverride) {
        if (line.actualDate) {
          result.actualDate = receiptOverride;
        } else {
          result.forecastDate = receiptOverride;
        }
      }
    }

    return result;
  });
}

export function applyOverridesToCOSLines(
  lines: COSLineItem[],
  overrideMap: EffectiveDateMap,
): COSLineItem[] {
  return lines.map(line => {
    const entityId = String(line.id);
    const key = `expense_line::${entityId}`;

    if (!overrideMap[key]) return line;

    const result = { ...line };

    const paymentOverride = overrideMap[key]?.['payment_date'];
    if (paymentOverride) {
      result.paymentDate = paymentOverride;
      result.forecastPaymentDate = paymentOverride;
    }

    const invoiceOverride = overrideMap[key]?.['invoice_date'];
    if (invoiceOverride) {
      result.invoicedDate = invoiceOverride;
      if (!paymentOverride && !result.paymentDate) {
        result.forecastPaymentDate = invoiceOverride;
      }
    }

    return result;
  });
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
