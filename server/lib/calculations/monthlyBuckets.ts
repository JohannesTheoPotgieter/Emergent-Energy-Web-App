import type { COSLineItem } from "./cosAggregator";

export interface MonthlyBucketResult {
  buckets: Map<string, { planned: number; committed: number; invoiced: number; paid: number }>;
  /**
   * Line ids flagged MISSING_INVOICE_DATE. Per AGENT_GUARDRAILS § 3.3 the
   * recognition / bucket date is the invoice-raised date ONLY — a line with a
   * blank or unparseable invoice date is flagged here and NOT bucketed by any
   * other date (never the payment or forecast date).
   */
  missingInvoiceDate: number[];
}

/**
 * Bucket COS / REV RECOGNITION by month, strictly on the invoice-raised date
 * (Excel col T). § 3.3: recognition NEVER falls back to the payment or forecast
 * date — that is cash bucketing (§ 3.4), a separate, clearly-named code path. A
 * line with a blank / unparseable invoice date is flagged MISSING_INVOICE_DATE,
 * not bucketed by another date.
 */
export function computeMonthlyBuckets(lines: COSLineItem[]): MonthlyBucketResult {
  const buckets = new Map<string, { planned: number; committed: number; invoiced: number; paid: number }>();
  const missingInvoiceDate: number[] = [];

  for (const line of lines) {
    // § 3.3 recognition: invoice-raised date ONLY. No paymentDate /
    // forecastPaymentDate fallback — a blank invoice date is flagged, not moved
    // to another date's month.
    const invoiceDate = line.invoicedDate;
    if (!invoiceDate) {
      missingInvoiceDate.push(line.id);
      continue;
    }

    const d = new Date(invoiceDate);
    if (isNaN(d.getTime())) {
      missingInvoiceDate.push(line.id);
      continue;
    }

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

  return { buckets, missingInvoiceDate };
}
