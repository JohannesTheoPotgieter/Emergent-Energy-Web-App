import type { NormalizedCostLine, NormalizedRevenueLine } from "@shared/schema";

/**
 * The adapters below read a few fields that are NOT on the canonical
 * `normalized_*_lines` schema types — they are added at runtime by
 * upstream enrichment joins / aliased projections (QB allocation totals,
 * snapshot-run commit timestamp, legacy `inBank`/`source`/`lastEditedAt`).
 * Modelled as optional so the access is type-safe without `any`; absent
 * fields resolve to `null` exactly as before.
 */
type EnrichedCostLine = NormalizedCostLine & {
  source?: string | null;
  lastEditedAt?: Date | string | null;
  lineAssignedQbExVat?: number | string | null;
  lineRealisedAmountExVat?: number | string | null;
  lineUnrealisedRemainderExVat?: number | string | null;
  snapshotRunCommittedAt?: Date | string | null;
};
type EnrichedRevenueLine = NormalizedRevenueLine & {
  inBank?: number | string | boolean | null;
  snapshotRunCommittedAt?: Date | string | null;
};

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

export function createNameResolver(projectInfoNames: ReadonlyArray<string | null | undefined>) {
  // Filter out null/undefined/empty names so downstream .replace calls never crash.
  const safeNames: string[] = [];
  for (const n of projectInfoNames) {
    if (typeof n === "string" && n.length > 0) safeNames.push(n);
  }
  const piNames = new Set(safeNames);
  const normMap = new Map<string, string>();
  safeNames.forEach(n => {
    normMap.set(n.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim(), n);
  });

  return function resolve(name: string | null | undefined): string {
    // Guard against null/undefined/empty — upstream normalized rows may have
    // project_name = NULL when the importer detected a section without being
    // able to bind it to a project (e.g. relaxed-scan fallbacks).
    if (typeof name !== "string" || name.length === 0) return "";

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

export function adaptCostToExpense(costInput: NormalizedCostLine, resolvedName: string) {
  const cost = costInput as EnrichedCostLine;
  const rawInvoiceDateConfirmed = cost.invoiceDateConfirmed;
  const rawPaidDateConfirmed = cost.paidDateConfirmed;
  const invoiceDateFontColor = cost.invoiceDateFontColor ?? null;
  const paymentDateFontColor = cost.paidDateFontColor ?? null;

  const hasInvoice = !!(cost.invoiceNumber);
  const hasInvoiceDate = !!(cost.invoiceDate);
  const hasPO = !!(cost.poNumber);
  const hasPaidDate = !!(cost.paidDate);

  // Use the canonical isDateBlack check: red text = unconfirmed, black text = confirmed.
  // When no color info exists, default to unconfirmed (red) — not confirmed.
  const invoiceDateActual = hasInvoiceDate && (
    rawInvoiceDateConfirmed === true ||
    invoiceDateFontColor === 'black'
  );
  const paidDateActual = hasPaidDate && (
    rawPaidDateConfirmed === true ||
    paymentDateFontColor === 'black'
  );

  let computedState = "Planned";
  if (hasInvoice && hasPaidDate && paidDateActual) computedState = "Paid";
  else if (hasInvoice && hasInvoiceDate && invoiceDateActual) computedState = "Invoiced";
  else if (hasPO || hasInvoice) computedState = "Committed";

  const effectivePaidDate = cost.paidDate || cost.forecastPaymentDate || null;
  const effectivePaidDateFontColor = cost.paidDate ? paymentDateFontColor : (cost.forecastPaymentDate ? (paymentDateFontColor || "red") : null);
  const effectivePaidDateConfirmed = cost.paidDate ? (rawPaidDateConfirmed ?? false) : (cost.forecastPaymentDate ? (rawPaidDateConfirmed ?? false) : false);

  return {
    id: -cost.id,
    projectName: resolvedName,
    projectId: cost.projectId ?? null,
    rowNumber: cost.sourceRow || cost.id,
    rowType: "item",
    expenseCategory: cost.costCategory || "General",
    expenseLineItem: cost.description,
    expenseInvoiceNumber: cost.invoiceNumber,
    expenseInvoicedDate: cost.invoiceDate,
    expensePaymentDate: effectivePaidDate,
    expenseActualTotal: cost.amountExVat,
    quotedTotal: cost.amountExVat,
    expensePoNumber: cost.poNumber,
    budgetQty: cost.budgetQty ?? null,
    budgetRateUnit: cost.budgetRate ?? null,
    budgetTotal: cost.budgetTotal ?? null,
    budgetCosTotal: cost.budgetCos ?? null,
    actualCosTotal: cost.amountExVat,
    approvedDate: cost.approvedDate ?? null,
    status: cost.status ?? null,
    forecastPaymentDate: cost.forecastPaymentDate ?? null,
    computedForecastPaymentDate: null,
    computedState,
    invoiceDateConfirmed: rawInvoiceDateConfirmed ?? false,
    invoiceDateFontColor,
    paymentDateConfirmed: effectivePaidDateConfirmed,
    paymentDateFontColor: effectivePaidDateFontColor,
    supplierName: cost.counterpartyName,
    noRevenueLinked: cost.noRevenueLinked ?? false,
    subProjectName: cost.subProjectName ?? null,
    revenueRecognitionAmount: cost.revenueRecognitionAmount ?? null,
    adminDateOverride: cost.adminDateOverride ?? null,
    adminDateOverrideReason: cost.adminDateOverrideReason ?? null,
    adminDateOverrideBy: cost.adminDateOverrideBy ?? null,
    adminDateOverrideAt: cost.adminDateOverrideAt ?? null,
    source: cost.source ?? null,
    updatedAt: cost.updatedAt ?? null,
    lastEditedAt: cost.lastEditedAt ?? null,
    createdAt: cost.createdAt ?? null,
    effectiveFrom: cost.effectiveFrom ?? null,
    _isNormalized: true,
    _sourceRow: cost.sourceRow || cost.id,
    cosRealised: cost.cosRealised ?? false, // canonical field name for isCosRealised() consumers
    _cosRealisedFlag: cost.cosRealised ?? false, // backward-compat alias
    _cosOverrideStatus: cost.cosStatusOverride ?? null,
    cosStatusOverride: cost.cosStatusOverride ?? null, // canonical field name
    lineAssignedQbExVat: cost.lineAssignedQbExVat ?? null,
    lineRealisedAmountExVat: cost.lineRealisedAmountExVat ?? null,
    lineUnrealisedRemainderExVat: cost.lineUnrealisedRemainderExVat ?? null,
    _cosOverrideBy: cost.cosStatusOverrideBy ?? null,
    _cosOverrideAt: cost.cosStatusOverrideAt ?? null,
    _cosOverrideReason: cost.cosStatusOverrideReason ?? null,
    // Smart Import v2 tracker columns surfaced to the existing
    // Expenditure tab. The replica screens already render these via the
    // tracker-replica endpoint; spreading them here lets the legacy
    // Expenditure tab render the same values inline + apply per-cell
    // font/fill colours via the cell_format JSONB.
    actualQty: cost.actualQty ?? null,
    actualRate: cost.actualRate ?? null,
    comments: cost.comments ?? null,
    checkFlag: cost.checkFlag ?? null,
    savingOverrun: cost.savingOverrun ?? null,
    usdExchangeRate: cost.usdExchangeRate ?? null,
    pricePerWatt: cost.pricePerWatt ?? null,
    cellFormat: cost.cellFormat ?? null,
    importSnapshot: cost.importSnapshot ?? null,
    counterpartyId: cost.counterpartyId ?? null,
    snapshotRunCommittedAt: cost.snapshotRunCommittedAt ?? null,
  };
}

export function adaptRevenueToInflow(revInput: NormalizedRevenueLine, resolvedName: string) {
  const rev = revInput as EnrichedRevenueLine;
  const hasPaymentReceived = !!(rev.paidDate && String(rev.paidDate).trim() && rev.paidDate !== '-');
  const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
  const manualInBank = rev.inBank === 1 || rev.inBank === '1' || rev.inBank === true;
  const inBank = manualInBank || (hasPaymentReceived && hasInvoice) ? 1 : 0;

  return {
    id: -rev.id,
    projectName: resolvedName,
    rowNumber: rev.sourceRow || rev.id,
    milestoneNo: rev.sourceRow || null,
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
    subProjectName: rev.subProjectName ?? null,
    adminDateOverride: rev.adminDateOverride ?? null,
    adminDateOverrideReason: rev.adminDateOverrideReason ?? null,
    adminDateOverrideBy: rev.adminDateOverrideBy ?? null,
    adminDateOverrideAt: rev.adminDateOverrideAt ?? null,
    // normalizedRevenueLines has no counterparty column; customer must come from
    // project-level data or QB customer mappings. Placeholder for future enrichment.
    customerName: null,
    // Smart Import v2 tracker columns surfaced to the existing Revenue tab.
    milestoneNotes: rev.milestoneNotes ?? null,
    cellFormat: rev.cellFormat ?? null,
    _isNormalized: true,
    snapshotRunCommittedAt: rev.snapshotRunCommittedAt ?? null,
  };
}
