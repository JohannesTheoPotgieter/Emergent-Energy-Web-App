/**
 * QuickBooks ↔ App reconciliation service.
 *
 * Scope (first pass): QuickBooks `Bill` entities ↔ `normalized_cost_lines`.
 * Matches are computed on the fly from live QB data + cost lines, with
 * persistent overrides stored in the `quickbooks_invoice_links` table.
 *
 * Matching ladder:
 *   1. `linked`      — a row in quickbooks_invoice_links already exists
 *   2. `auto_exact`  — normalized invoice number matches AND amount within tolerance
 *   3. `auto_fuzzy`  — vendor + amount + same month match (invoice number
 *                      differs or is missing)
 *   4. `app_only`    — cost line has no QB counterpart
 *   5. `qb_only`     — QB bill has no cost-line counterpart
 *
 * All entry points here are pure orchestration; the HTTP shell lives in
 * server/quickbooks-routes.ts.
 */

import { and, desc, eq, ilike, isNull, inArray, or, sql } from "drizzle-orm";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  projectInfo,
  quickbooksCustomerMappings,
  quickbooksInvoiceLinks,
  type NormalizedCostLine,
  type NormalizedRevenueLine,
  type QuickBooksCustomerMapping,
  type QuickBooksInvoiceLink,
} from "@shared/schema";
import { db } from "../db";
import {
  getBills,
  getValidAccessToken,
  loadQuickBooksMetadata,
  queryQuickBooks,
} from "./quickbooks-service";

const AMOUNT_TOLERANCE = 1; // R1 — generous enough to absorb rounding.

// ===================== TYPES =====================

export interface QuickBooksBillSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  balance: number | null;
  vendorName: string | null;
  vendorId: string | null;
}

export interface AppCostLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  cosRealised: boolean | null;
  paidDateConfirmed: boolean | null;
  status: string | null;
  description: string | null;
  poNumber: string | null;
}

export type ReconciliationMatchType =
  | "linked"
  | "auto_exact"
  | "auto_fuzzy"
  | "app_only"
  | "qb_only";

export interface ReconciliationRow {
  matchType: ReconciliationMatchType;
  /** Present for all types except `qb_only`. */
  costLine: AppCostLineSummary | null;
  /** Present for all types except `app_only`. */
  bill: QuickBooksBillSummary | null;
  /** Absolute amount variance (QB − app). 0 or `null` when one side is missing. */
  amountVariance: number | null;
  /** True when either side has non-zero balance or variance. */
  hasWarning: boolean;
  /** Persistent link record when matchType === 'linked'. */
  link: QuickBooksInvoiceLink | null;
}

export interface ReconciliationSummary {
  linkedCount: number;
  autoExactCount: number;
  autoFuzzyCount: number;
  appOnlyCount: number;
  qbOnlyCount: number;
  totalAppAmount: number;
  totalQbAmount: number;
  amountVariance: number;
}

export interface ReconciliationResult {
  projectId: number;
  summary: ReconciliationSummary;
  rows: ReconciliationRow[];
  generatedAt: string;
}

// ===================== NORMALISATION HELPERS =====================

function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function amountToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function sameMonth(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 7) === b.slice(0, 7); // YYYY-MM
}

function amountsWithinTolerance(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

// ===================== RAW → SUMMARY ADAPTERS =====================

export function billRawToSummary(raw: any): QuickBooksBillSummary {
  const vendorName = raw?.VendorRef?.name ?? null;
  const vendorId = raw?.VendorRef?.value ?? null;
  // QB `TotalAmt` is tax-inclusive. App cost lines store ex-VAT. Prefer the
  // ex-tax subtotal when QB provides it (TxnTaxDetail.TotalTax) so variance
  // against `normalized_cost_lines.amount_ex_vat` is apples-to-apples.
  const totalAmount = amountToNumber(raw?.TotalAmt);
  const totalTax = amountToNumber(raw?.TxnTaxDetail?.TotalTax);
  const totalExTax =
    totalAmount !== null && totalTax !== null
      ? Number((totalAmount - totalTax).toFixed(2))
      : totalAmount;
  return {
    id: String(raw?.Id ?? ""),
    docNumber: raw?.DocNumber ?? null,
    txnDate: raw?.TxnDate ?? null,
    dueDate: raw?.DueDate ?? null,
    totalAmount: totalExTax,
    balance: amountToNumber(raw?.Balance),
    vendorName,
    vendorId,
  };
}

export function costLineToSummary(row: NormalizedCostLine): AppCostLineSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    paidDate: row.paidDate ? String(row.paidDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    counterpartyName: row.counterpartyName ?? null,
    cosRealised: row.cosRealised ?? null,
    paidDateConfirmed: row.paidDateConfirmed ?? null,
    status: row.status ?? null,
    description: row.description ?? null,
    poNumber: row.poNumber ?? null,
  };
}

// ===================== DB ACCESS =====================

async function fetchProjectCostLines(projectId: number): Promise<NormalizedCostLine[]> {
  return db
    .select()
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
      ),
    );
}

async function fetchLinksForCostLines(
  costLineIds: number[],
): Promise<QuickBooksInvoiceLink[]> {
  if (costLineIds.length === 0) return [];
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, "cost_line"),
        eq(quickbooksInvoiceLinks.qbEntityType, "bill"),
        isNull(quickbooksInvoiceLinks.deletedAt),
        inArray(quickbooksInvoiceLinks.appEntityId, costLineIds),
      ),
    );
}

export async function fetchProjectLinks(projectId: number): Promise<QuickBooksInvoiceLink[]> {
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.projectId, projectId),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    );
}

export async function listAllLinks(limit = 500): Promise<QuickBooksInvoiceLink[]> {
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(isNull(quickbooksInvoiceLinks.deletedAt))
    .orderBy(desc(quickbooksInvoiceLinks.confirmedAt))
    .limit(limit);
}

export async function searchCostLines(
  query: string,
  limit = 50,
): Promise<AppCostLineSummary[]> {
  const trimmed = query.trim();
  const where = trimmed
    ? and(
        isNull(normalizedCostLines.effectiveTo),
        or(
          ilike(normalizedCostLines.invoiceNumber, `%${trimmed}%`),
          ilike(normalizedCostLines.counterpartyName, `%${trimmed}%`),
          ilike(normalizedCostLines.description, `%${trimmed}%`),
          ilike(normalizedCostLines.projectName, `%${trimmed}%`),
        ),
      )
    : isNull(normalizedCostLines.effectiveTo);

  const rows = await db
    .select()
    .from(normalizedCostLines)
    .where(where)
    .orderBy(desc(normalizedCostLines.invoiceDate))
    .limit(limit);

  return rows.map(costLineToSummary);
}

// Export `sql` tag through to keep the drizzle import used if we grow.
void sql;

// ===================== LINK CRUD =====================

export interface CreateLinkInput {
  projectId: number | null;
  appEntityType: "cost_line" | "revenue_line";
  appEntityId: number;
  qbEntityType: "bill" | "invoice";
  qbEntityId: string;
  qbRealmId?: string;
  qbDocNumber?: string | null;
  qbTxnDate?: string | null;
  qbAmount?: number | null;
  qbCounterpartyName?: string | null;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  notes?: string | null;
  confirmedBy?: number | null;
}

export async function createOrUpdateLink(
  input: CreateLinkInput,
): Promise<QuickBooksInvoiceLink> {
  const realmId =
    input.qbRealmId ?? ((await loadQuickBooksMetadata()).realmId ?? "unknown");

  const now = new Date();
  const values = {
    projectId: input.projectId ?? null,
    appEntityType: input.appEntityType,
    appEntityId: input.appEntityId,
    qbEntityType: input.qbEntityType,
    qbEntityId: String(input.qbEntityId),
    qbRealmId: realmId,
    qbDocNumber: input.qbDocNumber ?? null,
    qbTxnDate: input.qbTxnDate ?? null,
    qbAmount:
      input.qbAmount !== null && input.qbAmount !== undefined
        ? Number(input.qbAmount).toFixed(2)
        : null,
    qbCounterpartyName: input.qbCounterpartyName ?? null,
    matchType: input.matchType ?? "manual",
    notes: input.notes ?? null,
    confirmedBy: input.confirmedBy ?? null,
    confirmedAt: now,
    updatedAt: now,
  };

  const existing = await db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, values.appEntityType),
        eq(quickbooksInvoiceLinks.appEntityId, values.appEntityId),
        eq(quickbooksInvoiceLinks.qbEntityType, values.qbEntityType),
        eq(quickbooksInvoiceLinks.qbEntityId, values.qbEntityId),
        eq(quickbooksInvoiceLinks.qbRealmId, values.qbRealmId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    const updated = await db
      .update(quickbooksInvoiceLinks)
      .set({ ...values, deletedAt: null } as any)
      .where(eq(quickbooksInvoiceLinks.id, row.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(quickbooksInvoiceLinks)
    .values(values as any)
    .returning();
  return inserted[0]!;
}

export async function softDeleteLink(linkId: number): Promise<void> {
  await db
    .update(quickbooksInvoiceLinks)
    .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(quickbooksInvoiceLinks.id, linkId));
}

// ===================== MATCHING CORE =====================

export function matchCostLinesToBills(
  costLines: AppCostLineSummary[],
  bills: QuickBooksBillSummary[],
  links: QuickBooksInvoiceLink[],
): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];

  const billsById = new Map<string, QuickBooksBillSummary>();
  for (const b of bills) billsById.set(b.id, b);

  const costLinesById = new Map<number, AppCostLineSummary>();
  for (const c of costLines) costLinesById.set(c.id, c);

  const usedCostLineIds = new Set<number>();
  const usedBillIds = new Set<string>();

  // 1. Persistent links first (highest trust).
  for (const link of links) {
    if (link.appEntityType !== "cost_line" || link.qbEntityType !== "bill") continue;
    const cost = costLinesById.get(link.appEntityId) ?? null;
    const bill = billsById.get(link.qbEntityId) ?? null;
    if (!cost && !bill) continue;

    const variance =
      cost?.amountExVat !== null && cost?.amountExVat !== undefined &&
      bill?.totalAmount !== null && bill?.totalAmount !== undefined
        ? Number((bill!.totalAmount! - cost!.amountExVat!).toFixed(2))
        : null;

    rows.push({
      matchType: "linked",
      costLine: cost,
      bill,
      amountVariance: variance,
      hasWarning: variance !== null && Math.abs(variance) > AMOUNT_TOLERANCE,
      link,
    });
    if (cost) usedCostLineIds.add(cost.id);
    if (bill) usedBillIds.add(bill.id);
  }

  // 2. Exact invoice number + amount.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    const normCost = normalizeInvoiceNumber(cost.invoiceNumber);
    if (!normCost) continue;

    const match = bills.find((b) => {
      if (usedBillIds.has(b.id)) return false;
      const normBill = normalizeInvoiceNumber(b.docNumber);
      if (!normBill || normBill !== normCost) return false;
      return amountsWithinTolerance(cost.amountExVat, b.totalAmount);
    });

    if (match) {
      const variance =
        cost.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - cost.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_exact",
        costLine: cost,
        bill: match,
        amountVariance: variance,
        hasWarning: false,
        link: null,
      });
      usedCostLineIds.add(cost.id);
      usedBillIds.add(match.id);
    }
  }

  // 3. Fuzzy: vendor + amount tolerance + same month.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    const normVendor = normalizeName(cost.counterpartyName);
    if (!normVendor) continue;

    const match = bills.find((b) => {
      if (usedBillIds.has(b.id)) return false;
      if (normalizeName(b.vendorName) !== normVendor) return false;
      if (!amountsWithinTolerance(cost.amountExVat, b.totalAmount)) return false;
      return sameMonth(cost.invoiceDate, b.txnDate);
    });

    if (match) {
      const variance =
        cost.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - cost.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_fuzzy",
        costLine: cost,
        bill: match,
        amountVariance: variance,
        hasWarning: true,
        link: null,
      });
      usedCostLineIds.add(cost.id);
      usedBillIds.add(match.id);
    }
  }

  // 4. App-only.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    rows.push({
      matchType: "app_only",
      costLine: cost,
      bill: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }

  // 5. QB-only.
  for (const bill of bills) {
    if (usedBillIds.has(bill.id)) continue;
    rows.push({
      matchType: "qb_only",
      costLine: null,
      bill,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }

  return rows;
}

export function buildSummary(rows: ReconciliationRow[]): ReconciliationSummary {
  let linked = 0;
  let exact = 0;
  let fuzzy = 0;
  let appOnly = 0;
  let qbOnly = 0;
  let totalApp = 0;
  let totalQb = 0;

  for (const row of rows) {
    switch (row.matchType) {
      case "linked":
        linked++;
        break;
      case "auto_exact":
        exact++;
        break;
      case "auto_fuzzy":
        fuzzy++;
        break;
      case "app_only":
        appOnly++;
        break;
      case "qb_only":
        qbOnly++;
        break;
    }
    if (row.costLine?.amountExVat !== null && row.costLine?.amountExVat !== undefined) {
      totalApp += row.costLine.amountExVat;
    }
    if (row.bill?.totalAmount !== null && row.bill?.totalAmount !== undefined) {
      totalQb += row.bill.totalAmount;
    }
  }

  return {
    linkedCount: linked,
    autoExactCount: exact,
    autoFuzzyCount: fuzzy,
    appOnlyCount: appOnly,
    qbOnlyCount: qbOnly,
    totalAppAmount: Number(totalApp.toFixed(2)),
    totalQbAmount: Number(totalQb.toFixed(2)),
    amountVariance: Number((totalQb - totalApp).toFixed(2)),
  };
}

// ===================== HIGH-LEVEL ORCHESTRATION =====================

export async function runProjectCostReconciliation(
  projectId: number,
  options: { startDate?: string; endDate?: string } = {},
): Promise<ReconciliationResult> {
  // Touch getValidAccessToken early so we fail fast with "not connected".
  await getValidAccessToken();

  const [rawBills, costLineRows] = await Promise.all([
    getBills(options.startDate, options.endDate),
    fetchProjectCostLines(projectId),
  ]);

  const bills: QuickBooksBillSummary[] = (
    rawBills?.QueryResponse?.Bill ?? []
  ).map(billRawToSummary);

  const costLines = costLineRows.map(costLineToSummary);
  const links = await fetchLinksForCostLines(costLines.map((c) => c.id));

  const rows = matchCostLinesToBills(costLines, bills, links);
  const summary = buildSummary(rows);

  return {
    projectId,
    summary,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Snapshot a bill + cost line into a manual link. Used by the "Link" button
 * in the recon tab and by the global linking page.
 */
export async function confirmCostLineLink(params: {
  projectId: number | null;
  costLineId: number;
  bill: QuickBooksBillSummary;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  confirmedBy?: number | null;
  notes?: string | null;
}): Promise<QuickBooksInvoiceLink> {
  return createOrUpdateLink({
    projectId: params.projectId,
    appEntityType: "cost_line",
    appEntityId: params.costLineId,
    qbEntityType: "bill",
    qbEntityId: params.bill.id,
    qbDocNumber: params.bill.docNumber ?? null,
    qbTxnDate: params.bill.txnDate ?? null,
    qbAmount: params.bill.totalAmount ?? null,
    qbCounterpartyName: params.bill.vendorName ?? null,
    matchType: params.matchType ?? "manual",
    notes: params.notes ?? null,
    confirmedBy: params.confirmedBy ?? null,
  });
}

/**
 * Set `cos_realised = true` (and paid confirmation flags) on the cost line
 * after the recon tab has validated the QB bill is paid / captured.
 * Called after a link is confirmed + the user clicks "Mark COS Realised".
 */
export async function markCostLineRealised(costLineId: number): Promise<NormalizedCostLine | null> {
  const updated = await db
    .update(normalizedCostLines)
    .set({
      cosRealised: true,
      paidDateConfirmed: true,
      updatedAt: new Date(),
    } as any)
    .where(eq(normalizedCostLines.id, costLineId))
    .returning();
  return updated[0] ?? null;
}

// ===================== CUSTOMER MAPPING =====================

export interface ProjectWithMapping {
  projectId: number;
  projectName: string;
  clientId: number | null;
  mapping: QuickBooksCustomerMapping | null;
}

export async function listProjectsWithMappings(): Promise<ProjectWithMapping[]> {
  const [projects, mappings] = await Promise.all([
    db
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        clientId: projectInfo.clientId,
      })
      .from(projectInfo)
      .where(isNull(projectInfo.deletedAt)),
    db
      .select()
      .from(quickbooksCustomerMappings)
      .where(isNull(quickbooksCustomerMappings.deletedAt)),
  ]);

  const mappingByProject = new Map<number, QuickBooksCustomerMapping>();
  for (const m of mappings) mappingByProject.set(m.projectId, m);

  return (projects as Array<{ id: number; projectName: string; clientId: number | null }>).map(
    (p) => ({
      projectId: p.id,
      projectName: p.projectName,
      clientId: p.clientId ?? null,
      mapping: mappingByProject.get(p.id) ?? null,
    }),
  );
}

export async function getCustomerMappingForProject(
  projectId: number,
): Promise<QuickBooksCustomerMapping | null> {
  const rows = await db
    .select()
    .from(quickbooksCustomerMappings)
    .where(
      and(
        eq(quickbooksCustomerMappings.projectId, projectId),
        isNull(quickbooksCustomerMappings.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertCustomerMappingInput {
  projectId: number;
  clientId?: number | null;
  qbCustomerId: string;
  qbCustomerName?: string | null;
  qbRealmId?: string;
  notes?: string | null;
  createdBy?: number | null;
}

export async function upsertCustomerMapping(
  input: UpsertCustomerMappingInput,
): Promise<QuickBooksCustomerMapping> {
  const realmId =
    input.qbRealmId ?? ((await loadQuickBooksMetadata()).realmId ?? "unknown");

  const now = new Date();
  const values = {
    projectId: input.projectId,
    clientId: input.clientId ?? null,
    qbCustomerId: String(input.qbCustomerId),
    qbCustomerName: input.qbCustomerName ?? null,
    qbRealmId: realmId,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
    updatedAt: now,
  };

  const existing = await db
    .select()
    .from(quickbooksCustomerMappings)
    .where(
      and(
        eq(quickbooksCustomerMappings.projectId, values.projectId),
        eq(quickbooksCustomerMappings.qbRealmId, values.qbRealmId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    const updated = await db
      .update(quickbooksCustomerMappings)
      .set({ ...values, deletedAt: null } as any)
      .where(eq(quickbooksCustomerMappings.id, row.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(quickbooksCustomerMappings)
    .values(values as any)
    .returning();
  return inserted[0]!;
}

export async function softDeleteCustomerMapping(id: number): Promise<void> {
  await db
    .update(quickbooksCustomerMappings)
    .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(quickbooksCustomerMappings.id, id));
}

// ===================== REVENUE (INVOICES) RECONCILIATION =====================

export interface QuickBooksInvoiceSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  balance: number | null;
  customerName: string | null;
  customerId: string | null;
}

export interface AppRevenueLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  status: string | null;
  milestoneName: string | null;
  description: string | null;
}

export interface RevenueReconciliationRow {
  matchType: ReconciliationMatchType;
  revenueLine: AppRevenueLineSummary | null;
  invoice: QuickBooksInvoiceSummary | null;
  amountVariance: number | null;
  hasWarning: boolean;
  link: QuickBooksInvoiceLink | null;
}

export interface RevenueReconciliationResult {
  projectId: number;
  mapping: QuickBooksCustomerMapping | null;
  summary: ReconciliationSummary;
  rows: RevenueReconciliationRow[];
  generatedAt: string;
}

export function invoiceRawToSummary(raw: any): QuickBooksInvoiceSummary {
  const totalAmount = amountToNumber(raw?.TotalAmt);
  const totalTax = amountToNumber(raw?.TxnTaxDetail?.TotalTax);
  const totalExTax =
    totalAmount !== null && totalTax !== null
      ? Number((totalAmount - totalTax).toFixed(2))
      : totalAmount;
  return {
    id: String(raw?.Id ?? ""),
    docNumber: raw?.DocNumber ?? null,
    txnDate: raw?.TxnDate ?? null,
    dueDate: raw?.DueDate ?? null,
    totalAmount: totalExTax,
    balance: amountToNumber(raw?.Balance),
    customerName: raw?.CustomerRef?.name ?? null,
    customerId: raw?.CustomerRef?.value ?? null,
  };
}

export function revenueLineToSummary(row: NormalizedRevenueLine): AppRevenueLineSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    paidDate: row.paidDate ? String(row.paidDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    status: row.status ?? null,
    milestoneName: row.milestoneName ?? null,
    description: row.description ?? null,
  };
}

async function fetchProjectRevenueLines(projectId: number): Promise<NormalizedRevenueLine[]> {
  return db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        isNull(normalizedRevenueLines.effectiveTo),
      ),
    );
}

async function fetchLinksForRevenueLines(
  revenueLineIds: number[],
): Promise<QuickBooksInvoiceLink[]> {
  if (revenueLineIds.length === 0) return [];
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, "revenue_line"),
        eq(quickbooksInvoiceLinks.qbEntityType, "invoice"),
        isNull(quickbooksInvoiceLinks.deletedAt),
        inArray(quickbooksInvoiceLinks.appEntityId, revenueLineIds),
      ),
    );
}

async function queryInvoicesForCustomer(
  qbCustomerId: string,
  options: { startDate?: string; endDate?: string } = {},
): Promise<QuickBooksInvoiceSummary[]> {
  // Escape single quotes for the QB query language.
  const safeId = String(qbCustomerId).replace(/'/g, "''");
  const parts: string[] = [`SELECT * FROM Invoice WHERE CustomerRef = '${safeId}'`];
  if (options.startDate) parts.push(`AND TxnDate >= '${options.startDate}'`);
  if (options.endDate) parts.push(`AND TxnDate <= '${options.endDate}'`);
  parts.push("ORDERBY TxnDate DESC MAXRESULTS 500");
  const query = parts.join(" ");
  const result = await queryQuickBooks<any>("Invoice", query);
  const invoices: any[] = result?.QueryResponse?.Invoice ?? [];
  return invoices.map(invoiceRawToSummary);
}

function matchRevenueLinesToInvoices(
  revenueLines: AppRevenueLineSummary[],
  invoices: QuickBooksInvoiceSummary[],
  links: QuickBooksInvoiceLink[],
): RevenueReconciliationRow[] {
  const rows: RevenueReconciliationRow[] = [];
  const invoicesById = new Map<string, QuickBooksInvoiceSummary>();
  for (const inv of invoices) invoicesById.set(inv.id, inv);
  const revLinesById = new Map<number, AppRevenueLineSummary>();
  for (const r of revenueLines) revLinesById.set(r.id, r);

  const usedRevIds = new Set<number>();
  const usedInvoiceIds = new Set<string>();

  for (const link of links) {
    if (link.appEntityType !== "revenue_line" || link.qbEntityType !== "invoice") continue;
    const revLine = revLinesById.get(link.appEntityId) ?? null;
    const invoice = invoicesById.get(link.qbEntityId) ?? null;
    if (!revLine && !invoice) continue;

    const variance =
      revLine?.amountExVat !== null && revLine?.amountExVat !== undefined &&
      invoice?.totalAmount !== null && invoice?.totalAmount !== undefined
        ? Number((invoice!.totalAmount! - revLine!.amountExVat!).toFixed(2))
        : null;

    rows.push({
      matchType: "linked",
      revenueLine: revLine,
      invoice,
      amountVariance: variance,
      hasWarning: variance !== null && Math.abs(variance) > AMOUNT_TOLERANCE,
      link,
    });
    if (revLine) usedRevIds.add(revLine.id);
    if (invoice) usedInvoiceIds.add(invoice.id);
  }

  // Exact: invoice number + amount tolerance
  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    const normRev = normalizeInvoiceNumber(rev.invoiceNumber);
    if (!normRev) continue;
    const match = invoices.find((inv) => {
      if (usedInvoiceIds.has(inv.id)) return false;
      const normInv = normalizeInvoiceNumber(inv.docNumber);
      if (!normInv || normInv !== normRev) return false;
      return amountsWithinTolerance(rev.amountExVat, inv.totalAmount);
    });
    if (match) {
      const variance =
        rev.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - rev.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_exact",
        revenueLine: rev,
        invoice: match,
        amountVariance: variance,
        hasWarning: false,
        link: null,
      });
      usedRevIds.add(rev.id);
      usedInvoiceIds.add(match.id);
    }
  }

  // Fuzzy: amount tolerance + same month (customer is already scoped by mapping)
  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    const match = invoices.find((inv) => {
      if (usedInvoiceIds.has(inv.id)) return false;
      if (!amountsWithinTolerance(rev.amountExVat, inv.totalAmount)) return false;
      return sameMonth(rev.invoiceDate, inv.txnDate);
    });
    if (match) {
      const variance =
        rev.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - rev.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_fuzzy",
        revenueLine: rev,
        invoice: match,
        amountVariance: variance,
        hasWarning: true,
        link: null,
      });
      usedRevIds.add(rev.id);
      usedInvoiceIds.add(match.id);
    }
  }

  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    rows.push({
      matchType: "app_only",
      revenueLine: rev,
      invoice: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }
  for (const inv of invoices) {
    if (usedInvoiceIds.has(inv.id)) continue;
    rows.push({
      matchType: "qb_only",
      revenueLine: null,
      invoice: inv,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }
  return rows;
}

function buildRevenueSummary(rows: RevenueReconciliationRow[]): ReconciliationSummary {
  let linked = 0;
  let exact = 0;
  let fuzzy = 0;
  let appOnly = 0;
  let qbOnly = 0;
  let totalApp = 0;
  let totalQb = 0;
  for (const row of rows) {
    switch (row.matchType) {
      case "linked": linked++; break;
      case "auto_exact": exact++; break;
      case "auto_fuzzy": fuzzy++; break;
      case "app_only": appOnly++; break;
      case "qb_only": qbOnly++; break;
    }
    if (row.revenueLine?.amountExVat !== null && row.revenueLine?.amountExVat !== undefined) {
      totalApp += row.revenueLine.amountExVat;
    }
    if (row.invoice?.totalAmount !== null && row.invoice?.totalAmount !== undefined) {
      totalQb += row.invoice.totalAmount;
    }
  }
  return {
    linkedCount: linked,
    autoExactCount: exact,
    autoFuzzyCount: fuzzy,
    appOnlyCount: appOnly,
    qbOnlyCount: qbOnly,
    totalAppAmount: Number(totalApp.toFixed(2)),
    totalQbAmount: Number(totalQb.toFixed(2)),
    amountVariance: Number((totalQb - totalApp).toFixed(2)),
  };
}

export async function runProjectRevenueReconciliation(
  projectId: number,
  options: { startDate?: string; endDate?: string } = {},
): Promise<RevenueReconciliationResult> {
  await getValidAccessToken();

  const mapping = await getCustomerMappingForProject(projectId);

  // No mapping → empty result with the mapping field null so the UI can
  // surface a "Map a customer to reconcile invoices" CTA.
  if (!mapping) {
    const revLineRows = await fetchProjectRevenueLines(projectId);
    const revenueLines = revLineRows.map(revenueLineToSummary);
    const appOnlyRows: RevenueReconciliationRow[] = revenueLines.map((rev) => ({
      matchType: "app_only",
      revenueLine: rev,
      invoice: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    }));
    return {
      projectId,
      mapping: null,
      summary: buildRevenueSummary(appOnlyRows),
      rows: appOnlyRows,
      generatedAt: new Date().toISOString(),
    };
  }

  const [invoices, revLineRows] = await Promise.all([
    queryInvoicesForCustomer(mapping.qbCustomerId, options),
    fetchProjectRevenueLines(projectId),
  ]);

  const revenueLines = revLineRows.map(revenueLineToSummary);
  const links = await fetchLinksForRevenueLines(revenueLines.map((r) => r.id));
  const rows = matchRevenueLinesToInvoices(revenueLines, invoices, links);
  const summary = buildRevenueSummary(rows);

  return {
    projectId,
    mapping,
    summary,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export async function confirmRevenueLineLink(params: {
  projectId: number | null;
  revenueLineId: number;
  invoice: QuickBooksInvoiceSummary;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  confirmedBy?: number | null;
  notes?: string | null;
}): Promise<QuickBooksInvoiceLink> {
  return createOrUpdateLink({
    projectId: params.projectId,
    appEntityType: "revenue_line",
    appEntityId: params.revenueLineId,
    qbEntityType: "invoice",
    qbEntityId: params.invoice.id,
    qbDocNumber: params.invoice.docNumber ?? null,
    qbTxnDate: params.invoice.txnDate ?? null,
    qbAmount: params.invoice.totalAmount ?? null,
    qbCounterpartyName: params.invoice.customerName ?? null,
    matchType: params.matchType ?? "manual",
    notes: params.notes ?? null,
    confirmedBy: params.confirmedBy ?? null,
  });
}
