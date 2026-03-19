import type { NormalizedCostLine, NormalizedRevenueLine } from "@shared/schema";

export function mapCostToExpenseInput(cost: NormalizedCostLine) {
  return {
    expensePaymentDate: cost.paidDate,
    expenseInvoiceNumber: cost.invoiceNumber,
    expenseInvoicedDate: cost.invoiceDate,
    expensePoNumber: cost.poNumber,
    invoiceDateFontColor: cost.invoiceDateFontColor,
    paymentDateFontColor: cost.paidDateFontColor,
    invoiceDateConfirmed: cost.invoiceDateConfirmed,
    paymentDateConfirmed: cost.paidDateConfirmed,
    expenseActualTotal: cost.amountExVat,
  };
}

export function createNameResolver(projectInfoNames: string[]) {
  const piNames = new Set(projectInfoNames);
  const normMap = new Map<string, string>();
  projectInfoNames.forEach(n => {
    normMap.set(n.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim(), n);
  });

  return function resolve(name: string): string {
    if (piNames.has(name)) return name;
    const variants = [
      name.replace(/ /g, "_") + "_Tracker",
      name + "_Tracker",
      name.replace(/ /g, "_"),
    ];
    for (let i = 0; i < variants.length; i++) {
      if (piNames.has(variants[i])) return variants[i];
    }
    const nk = name.replace(/[_ ]/g, " ").toLowerCase().trim();
    const fm = normMap.get(nk);
    if (fm) return fm;
    const entries = Array.from(normMap.entries());
    for (let i = 0; i < entries.length; i++) {
      const [pn, pi] = entries[i];
      if (pn.endsWith(nk) || nk.endsWith(pn)) return pi;
    }
    return name;
  };
}

export function adaptCostToExpense(cost: NormalizedCostLine, resolvedName: string): any {
  const rawInvoiceDateConfirmed = cost.invoiceDateConfirmed;
  const rawPaidDateConfirmed = cost.paidDateConfirmed;
  const invoiceDateFontColor = cost.invoiceDateFontColor ?? null;
  const paymentDateFontColor = cost.paidDateFontColor ?? null;

  const hasInvoice = !!(cost.invoiceNumber);
  const hasInvoiceDate = !!(cost.invoiceDate);
  const hasPO = !!(cost.poNumber);
  const hasPaidDate = !!(cost.paidDate);

  const hasInvoiceColorInfo = rawInvoiceDateConfirmed != null || invoiceDateFontColor != null;
  const invoiceDateActual = hasInvoiceDate && (
    rawInvoiceDateConfirmed === true ||
    invoiceDateFontColor === 'black' ||
    !hasInvoiceColorInfo
  );
  const hasPaymentColorInfo = rawPaidDateConfirmed != null || paymentDateFontColor != null;
  const paidDateActual = hasPaidDate && (
    rawPaidDateConfirmed === true ||
    paymentDateFontColor === 'black' ||
    !hasPaymentColorInfo
  );

  let computedState = "Planned";
  if (hasInvoice && hasPaidDate && paidDateActual) computedState = "Paid";
  else if (hasInvoice && hasInvoiceDate && invoiceDateActual) computedState = "Invoiced";
  else if (hasPO || hasInvoice) computedState = "Committed";

  return {
    id: cost.id + 900000,
    projectName: resolvedName,
    rowNumber: (cost as any).sourceRow || cost.id,
    rowType: "item",
    expenseCategory: cost.costCategory || "General",
    expenseLineItem: cost.description,
    expenseInvoiceNumber: cost.invoiceNumber,
    expenseInvoicedDate: cost.invoiceDate,
    expensePaymentDate: cost.paidDate,
    expenseActualTotal: cost.amountExVat,
    expensePoNumber: cost.poNumber,
    budgetQty: (cost as any).budgetQty ?? null,
    budgetRateUnit: (cost as any).budgetRate ?? null,
    budgetTotal: (cost as any).budgetTotal ?? null,
    budgetCosTotal: (cost as any).budgetCos ?? null,
    actualCosTotal: cost.amountExVat,
    forecastPaymentDate: (cost as any).forecastPaymentDate ?? null,
    computedForecastPaymentDate: null,
    computedState,
    invoiceDateConfirmed: rawInvoiceDateConfirmed ?? false,
    invoiceDateFontColor,
    paymentDateConfirmed: rawPaidDateConfirmed ?? false,
    paymentDateFontColor,
    supplierName: cost.counterpartyName,
    noRevenueLinked: cost.noRevenueLinked ?? false,
    subProjectName: (cost as any).subProjectName ?? null,
    revenueRecognitionAmount: (cost as any).revenueRecognitionAmount ?? null,
    _isNormalized: true,
    _sourceRow: (cost as any).sourceRow || cost.id,
    _cosRealisedFlag: (cost as any).cosRealised ?? false,
  };
}

export function adaptRevenueToInflow(rev: NormalizedRevenueLine, resolvedName: string): any {
  const hasPaymentReceived = !!(rev.paidDate && String(rev.paidDate).trim() && rev.paidDate !== '-');
  const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
  const manualInBank = (rev as any).inBank === 1 || (rev as any).inBank === '1' || (rev as any).inBank === true;
  const inBank = manualInBank || (hasPaymentReceived && hasInvoice) ? 1 : 0;

  return {
    id: rev.id + 900000,
    projectName: resolvedName,
    rowNumber: (rev as any).sourceRow || rev.id,
    milestoneNo: (rev as any).sourceRow || null,
    milestoneName: rev.milestoneName || rev.description,
    milestoneAmount: rev.amountExVat,
    milestoneInvoiceNumber: rev.invoiceNumber,
    invoiceRaisedDate: rev.invoiceDate,
    invoiceDateFontColor: rev.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: rev.invoiceDateConfirmed ?? false,
    plannedPaymentDate: rev.expectedPaymentDate,
    paymentReceivedDate: rev.paidDate,
    paidDateFontColor: rev.paidDateFontColor ?? null,
    paidDateConfirmed: rev.paidDateConfirmed ?? false,
    inBankDate: rev.inBankDate,
    inBank,
    effectiveDate: rev.paidDate || rev.inBankDate || rev.expectedPaymentDate || rev.invoiceDate,
    subProjectName: (rev as any).subProjectName ?? null,
    _isNormalized: true,
  };
}

